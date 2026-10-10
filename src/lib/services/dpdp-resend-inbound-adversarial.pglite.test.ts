/// <reference types="bun-types" />
// DPDP single mailbox -- adversarial end-to-end proof of the Resend inbound path, with nothing between the pieces mocked except the
// network edges:
//
//   Svix-signed webhook (signed HERE with node:crypto, independent of the Web Crypto code under test)
//     -> routeInbound (resend-inbound.ts, real)  -> fake Resend API (fetch)
//     -> handleInbound (handler.ts, real) -> classify (classify.ts, real)
//     -> the public.dpdp_mail_* functions of drizzle/0662, executed by REAL Postgres (PGlite) as service_role, by named argument
//     -> fake Resend send (captured; nothing leaves the process)
//
// The unit tests (resend-inbound.test.ts) run the same code against an in-memory copy of the database contract; this file runs it
// against the real SQL, so a shape or a rule the fake and the migration disagree about shows up here and only here.
//
// Written by the adversarial review of 2026-09-30 (forged signatures, hostile fetches, duplicate deliveries, hostile headers and
// bodies, loops, and the owner's rule: nothing silently dropped or demoted; a legal request never misses its clock or acknowledgement).
//
// NOT COVERED: two connections racing (PGlite is one connection), workerd, Deno, Resend itself, Svix itself.
//
// Run:  bun test --isolate ./src/lib/services/dpdp-resend-inbound-adversarial.pglite.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { MAILBOX, isValidRef, replyToAddress } from "../../../supabase/functions/_shared/mail-taxonomy.ts"
import { buildOutbound, logOutbound, type RpcClient } from "../../../supabase/functions/_shared/mail-outbound.ts"
import type { InboundConfig, OutMessage } from "../../../supabase/functions/dpdp-inbound-mail/handler.ts"
import { routeInbound, type RouteDeps } from "../../../supabase/functions/dpdp-inbound-mail/resend-inbound.ts"

const REPO_ROOT = new URL("../../../", import.meta.url)
const MIGRATION = readFileSync(new URL("drizzle/0662_dpdp_single_mailbox_mail_log.sql", REPO_ROOT), "utf8")
const BASE_SQL = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA dpdp;
GRANT USAGE ON SCHEMA dpdp TO service_role; GRANT USAGE ON SCHEMA public TO service_role;
`

const SECRET = "review-test-secret-" + "y".repeat(20) // DPDP_INBOUND_SECRET (built at runtime; no secret-looking literal)
const KEY_BYTES = "k".repeat(24)
const WHSEC = "whsec_" + btoa(KEY_BYTES)
const API_KEY = "review-resend-key"
const OPERATOR = "operator@example.test"
const NOW = new Date("2026-09-29T15:33:00Z")
const NOW_S = Math.floor(NOW.getTime() / 1000)

let pg: PGlite

// ---- the database, called the way PostgREST calls it -------------------------------------------------------------
const CAST: Record<string, string> = {
  p_received_at: "::timestamptz", p_due_days: "::integer", p_message_ids: "::text[]", p_raw_forwarded: "::boolean", p_wants_ack: "::boolean",
}
let dbDown: ((fn: string) => boolean) | null = null
async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  if (dbDown?.(fn)) return { data: null, error: { message: `${fn}: connection refused (simulated)` } }
  const keys = Object.keys(args)
  const list = keys.map((k, i) => `${k} => $${i + 1}${CAST[k] ?? "::text"}`).join(", ")
  try {
    await pg.exec("SET ROLE service_role")
    const r = await pg.query<{ r: unknown }>(`select public.${fn}(${list}) as r`, keys.map((k) => args[k]))
    return { data: r.rows[0].r, error: null }
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } }
  } finally {
    await pg.exec("RESET ROLE")
  }
}
const sb: RpcClient = { rpc: (fn, args) => rpc(fn, args ?? {}) }
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows
const ticketRow = async (ticket: string) => (await rows("select * from dpdp.mail_inbound where ticket_no = $1", [ticket]))[0]
const count = async (where = "true") => Number((await rows<{ n: string }>(`select count(*)::text as n from dpdp.mail_inbound where ${where}`))[0].n)

// ---- a fake Resend API ---------------------------------------------------------------------------------------------
type Stored = Record<string, unknown>
type FetchMode = "ok" | "404" | "401" | "429" | "500" | "hang" | "garbage" | "json-null" | "json-array" | "json-string" | "json-number" | "huge" | "throw"

function makeResend() {
  const emails = new Map<string, Stored>()
  const order: string[] = []
  const calls: string[] = []
  const mode = new Map<string, FetchMode>()
  const put = (id: string, e: Stored) => {
    emails.set(id, { ...e, id })
    if (!order.includes(id)) order.unshift(id)
  }
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    const u = new URL(url)
    const res = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } })
    if (u.pathname.startsWith("/emails/receiving/")) {
      const id = decodeURIComponent(u.pathname.slice("/emails/receiving/".length))
      const m = mode.get(id) ?? "ok"
      if (m === "404") return res({ name: "not_found" }, 404)
      if (m === "401") return res({ name: "restricted_api_key", message: "This API key is restricted to only send emails" }, 401)
      if (m === "429") return res({ name: "rate_limit_exceeded" }, 429)
      if (m === "500") return res({ name: "internal_server_error" }, 500)
      if (m === "throw") throw new TypeError("fetch failed")
      if (m === "hang") {
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        })
      }
      if (m === "garbage") return new Response("<html>bad gateway</html>", { status: 200 })
      if (m === "json-null") return new Response("null", { status: 200 })
      if (m === "json-array") return new Response("[1,2]", { status: 200 })
      if (m === "json-string") return new Response('"hello"', { status: 200 })
      if (m === "json-number") return new Response("42", { status: 200 })
      if (m === "huge") return new Response("x".repeat(20_000_100), { status: 200 })
      const e = emails.get(id)
      return e ? res(e) : res({ name: "not_found" }, 404)
    }
    if (u.pathname === "/emails/receiving") {
      const after = u.searchParams.get("after")
      const start = after ? order.indexOf(after) + 1 : 0
      const slice = order.slice(start, start + Math.min(100, Number(u.searchParams.get("limit") ?? "20")))
      const data = slice.map((id) => {
        const e = emails.get(id)!
        return { id, to: e.to, from: e.from, created_at: e.created_at, subject: e.subject, message_id: e.message_id, attachments: e.attachments ?? [] }
      })
      return res({ object: "list", has_more: start + slice.length < order.length, data })
    }
    return res({ name: "not_found" }, 404)
  }) as typeof fetch
  return { fetch: fetchImpl, emails, put, calls, mode }
}

let sender = 0
const email = (over: Stored = {}): Stored => ({
  object: "email", to: [MAILBOX], from: `Asha M <asha${++sender}@example.org>`, created_at: "2026-09-29T15:30:00.000Z", subject: "Question",
  html: null, text: "Hello there, this is only a test.", headers: { "message-id": "<m1@example.org>", "content-type": "text/plain; charset=utf-8" },
  bcc: [], cc: [], reply_to: [], message_id: "<m1@example.org>", attachments: [], received_for: [MAILBOX],
  authentication: { spf: "pass", dkim: "pass", dmarc: "pass" }, ...over,
})

// ---- the rig ---------------------------------------------------------------------------------------------------------
let seq = 0
function rig(o: { config?: Partial<InboundConfig>; failSend?: (m: OutMessage) => boolean; timeoutMs?: number; budgetMs?: number; webhookSecret?: string } = {}) {
  const resend = makeResend()
  const sent: OutMessage[] = []
  const logs: string[] = []
  const config: InboundConfig = { secret: SECRET, operatorEmail: OPERATOR, from: "VERIDIAN AI DPDP <dpdp@veridian-aios.com>", legalResponseDays: 90, dryRun: false, ...o.config }
  const deps: RouteDeps = {
    inbound: {
      rpc, config, now: () => NOW, log: (l) => { logs.push(l) },
      random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3 + seq) % 256),
      send: async (m) => {
        if (o.failSend?.(m)) throw new Error("Resend 500: boom")
        sent.push(m)
        return { id: `resend-${sent.length}` }
      },
    },
    resend: { webhookSecret: o.webhookSecret ?? WHSEC, apiKey: API_KEY },
    fetch: resend.fetch, timeoutMs: o.timeoutMs, budgetMs: o.budgetMs, paceMs: 0, seen: new Map(),
  }
  const event = (id: string, over: Stored = {}, type = "email.received"): Stored => {
    const e = resend.emails.get(id)
    return { type, created_at: "2026-09-29T15:30:01.000Z", data: { email_id: id, created_at: e?.created_at, from: e?.from ?? "asha@example.org", to: e?.to ?? [MAILBOX], bcc: [], cc: [], received_for: e?.received_for ?? [MAILBOX], message_id: e?.message_id ?? null, subject: e?.subject ?? "", attachments: [], ...over } }
  }
  const sign = (id: string, ts: number | string, body: string, key = KEY_BYTES) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.`).update(body).digest("base64")}`
  const deliver = (ev: unknown, x: { svixId?: string; ts?: number | string; signature?: string | null; raw?: string; headers?: Record<string, string | null>; method?: string } = {}) => {
    const bodyText = typeof ev === "string" ? ev : JSON.stringify(ev)
    const id = x.svixId ?? `msg_${++seq}`
    const ts = x.ts ?? NOW_S
    const headers: Record<string, string> = { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(ts), "svix-signature": x.signature === undefined ? sign(id, ts, bodyText) : (x.signature ?? "") }
    for (const [k, v] of Object.entries(x.headers ?? {})) { if (v === null) delete headers[k]; else headers[k] = v }
    const method = x.method ?? "POST"
    return routeInbound(new Request("https://x.test/functions/v1/dpdp-inbound-mail", { method, headers, body: method === "POST" ? (x.raw ?? bodyText) : undefined }), deps)
  }
  let n = 0
  const receive = async (e: Stored, id = `em_${++seq}_${++n}`, evOver: Stored = {}) => {
    resend.put(id, e)
    return { id, res: await deliver(event(id, evOver)) }
  }
  Object.assign(resend, { event })
  const job = (b: unknown, bearer: string | null = SECRET) =>
    routeInbound(new Request("https://x.test/f", { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(b) }), deps)
  const acks = () => sent.filter((m) => m.headers["X-Veridian-Origin"] === "acknowledgement")
  const notices = () => sent.filter((m) => m.headers["X-Veridian-Origin"] === "inbound-notification")
  return { resend: Object.assign(resend, { event }), sent, logs, deps, deliver, receive, job, acks, notices, sign }
}
const J = async (r: Response) => (await r.json()) as Record<string, unknown>

// ---- the results table --------------------------------------------------------------------------------------------------
const table: Array<{ id: string; scenario: string; expected: string; observed: string; ok: boolean }> = []
function note(id: string, scenario: string, expected: string, observed: string, ok: boolean) {
  table.push({ id, scenario, expected, observed, ok })
}

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(BASE_SQL)
  await pg.exec(MIGRATION)
}, 90_000)
afterAll(async () => {
  await pg?.close()
  if (process.env.REVIEW_TABLE === "1") {
    console.log("\n| id | scenario | expected | observed | ok |\n|---|---|---|---|---|")
    for (const t of table) console.log(`| ${t.id} | ${t.scenario} | ${t.expected} | ${t.observed} | ${t.ok ? "PASS" : "FAIL"} |`)
  }
})

// =====================================================================================================================
describe("forged and replayed webhooks (nothing is fetched, nothing is recorded)", () => {
  const forged = async (id: string, scenario: string, mk: (r: ReturnType<typeof rig>, ev: string) => Promise<Response>, expectStatus = 401) => {
    const r = rig()
    r.resend.put("em_forge", email())
    const before = await count()
    const res = await mk(r, JSON.stringify(r.resend.event("em_forge")))
    const after = await count()
    const ok = res.status === expectStatus && after === before && r.resend.calls.length === 0 && r.sent.length === 0
    note(id, scenario, `${expectStatus}, no fetch, no row, no mail`, `${res.status}, fetches=${r.resend.calls.length}, rows+${after - before}, mails=${r.sent.length}`, ok)
    expect(res.status, scenario).toBe(expectStatus)
    expect(after - before, scenario).toBe(0)
    expect(r.resend.calls, scenario).toHaveLength(0)
    expect(r.sent, scenario).toHaveLength(0)
  }

  test("A1 wrong secret", () => forged("A1", "signed with the wrong secret", (r, ev) => r.deliver(ev, { signature: r.sign("msg_x", NOW_S, ev, "z".repeat(24)), svixId: "msg_x" })))
  test("A2 truncated signature", () => forged("A2", "signature cut in half", (r, ev) => { const s = r.sign("msg_t", NOW_S, ev); return r.deliver(ev, { svixId: "msg_t", signature: s.slice(0, Math.floor(s.length / 2)) }) }))
  test("A3 old delivery replayed (10 minutes)", () => forged("A3", "valid signature, timestamp 10 min old", (r, ev) => r.deliver(ev, { ts: NOW_S - 600 })))
  test("A4 body changed by one byte", () => forged("A4", "body altered by one byte after signing", (r, ev) => r.deliver(ev, { raw: ev.replace("em_forge", "em_forgf") })))
  test("A5 far-future timestamp", () => forged("A5", "timestamp one day ahead (validly signed)", (r, ev) => r.deliver(ev, { ts: NOW_S + 86400 })))
  test("A6 signature for another svix-id", () => forged("A6", "signature made for a different svix-id", (r, ev) => r.deliver(ev, { svixId: "msg_real", signature: r.sign("msg_other", NOW_S, ev) })))
  test("A7 signature for another timestamp", () => forged("A7", "signature made for a different timestamp", (r, ev) => r.deliver(ev, { ts: NOW_S, signature: r.sign("msg_z", NOW_S - 5, ev), svixId: "msg_z" })))
  test("A8 v0 / v2 only", () => forged("A8", "only v0 and v2 signatures", (r, ev) => r.deliver(ev, { svixId: "msg_v", signature: r.sign("msg_v", NOW_S, ev).replace("v1,", "v0,") + " " + r.sign("msg_v", NOW_S, ev).replace("v1,", "v2,") })))
  test("A9 timestamp not an integer", () => forged("A9", "timestamp '1e9' / float", (r, ev) => r.deliver(ev, { ts: "1e9", signature: r.sign("msg_f", "1e9", ev), svixId: "msg_f" })))
  test("A10 signature list, valid one is the 11th (only 10 are tried)", () => forged("A10", "11 signatures, the valid one last", (r, ev) => {
    const good = r.sign("msg_l", NOW_S, ev)
    const junk = Array.from({ length: 10 }, (_, i) => `v1,${btoa("junk" + i + "x".repeat(20))}`)
    return r.deliver(ev, { svixId: "msg_l", signature: [...junk, good].join(" ") })
  }))
  test("A11 unset webhook secret => 503 and nothing else", async () => {
    const r = rig({ webhookSecret: "" })
    r.resend.put("em_s", email())
    const res = await r.deliver(r.resend.event("em_s"))
    note("A11", "DPDP_RESEND_WEBHOOK_SECRET unset", "503, nothing fetched", `${res.status}, fetches=${r.resend.calls.length}`, res.status === 503 && r.resend.calls.length === 0)
    expect(res.status).toBe(503)
    expect(r.resend.calls).toHaveLength(0)
  })
  test("A12 GET / PUT with svix headers", async () => {
    const r = rig()
    const res = await r.deliver({}, { method: "GET" })
    const res2 = await r.deliver({}, { method: "PUT" })
    note("A12", "non-POST with svix headers", "405", `${res.status}/${res2.status}`, res.status === 405 && res2.status === 405)
    expect(res.status).toBe(405)
    expect(res2.status).toBe(405)
  })
  test("A13 the bearer of the Worker route does not open the webhook, and a webhook body without svix headers is not a mail", async () => {
    const r = rig()
    r.resend.put("em_b", email())
    const ev = JSON.stringify(r.resend.event("em_b"))
    const res = await routeInbound(new Request("https://x.test/f", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: ev }), r.deps)
    const res2 = await routeInbound(new Request("https://x.test/f", { method: "POST", headers: { "content-type": "application/json" }, body: ev }), r.deps)
    note("A13", "bearer + event body / event body with nothing", "400 (not a mail) / 401", `${res.status}/${res2.status}`, res.status === 400 && res2.status === 401)
    expect(res.status).toBe(400)
    expect(res2.status).toBe(401)
    expect(r.resend.calls).toHaveLength(0)
  })

  test("B1 reordered / upper-cased headers and several signatures, one valid => accepted", async () => {
    const r = rig()
    r.resend.put("em_ok", email({ text: "I want to file a complaint about a grievance." }))
    const ev = JSON.stringify(r.resend.event("em_ok"))
    const good = r.sign("msg_ok", NOW_S, ev)
    const bad = `v1,${btoa("nonsense-signature-" + "n".repeat(16))}`
    const req = new Request("https://x.test/f", {
      method: "POST",
      headers: [["SVIX-SIGNATURE", `${bad} ${good} v2,abc`], ["Content-Type", "application/json"], ["Svix-Timestamp", String(NOW_S)], ["SVIX-ID", "msg_ok"]],
      body: ev,
    })
    const res = await routeInbound(req, r.deps)
    const b = await J(res)
    note("B1", "headers reordered, 3 signatures, the middle one valid", "200, one ticket", `${res.status} ${String(b.ticket)}`, res.status === 200 && b.ok === true)
    expect(res.status).toBe(200)
    expect(String(b.ticket)).toMatch(/^G-2026-\d{4}$/)
  })

  test("B2 the same signed delivery twice: one ticket, one acknowledgement, one operator notice", async () => {
    const r = rig()
    r.resend.put("em_dup", email({ text: "Please delete my data.", message_id: "<dup@example.org>", headers: { "message-id": "<dup@example.org>" } }))
    const ev = JSON.stringify(r.resend.event("em_dup"))
    const sig = r.sign("msg_dup", NOW_S, ev)
    const before = await count()
    const a = await r.deliver(ev, { svixId: "msg_dup", signature: sig })
    const b = await r.deliver(ev, { svixId: "msg_dup", signature: sig })
    const c = await r.deliver(ev, { svixId: "msg_dup2" }) // a different svix delivery for the same email
    const ok = a.status === 200 && b.status === 200 && c.status === 200 && (await count()) - before === 1 && r.acks().length === 1 && r.notices().length === 1
    note("B2", "same delivery replayed twice + a second delivery of the same email", "200 x3, 1 ticket, 1 ack, 1 notice", `${a.status}/${b.status}/${c.status}, tickets+${(await count()) - before}, acks=${r.acks().length}, notices=${r.notices().length}`, ok)
    expect(ok).toBe(true)
  })

  test("B3 five concurrent deliveries of one email: one ticket (Idempotency-Key keeps the mails single at the provider)", async () => {
    const r = rig()
    r.resend.put("em_conc", email({ text: "I want to file a complaint about a breach.", message_id: "<conc@example.org>", headers: { "message-id": "<conc@example.org>" } }))
    const before = await count()
    const res = await Promise.all(Array.from({ length: 5 }, () => r.deliver(r.resend.event("em_conc"))))
    const keys = new Set(r.acks().map((m) => m.idempotencyKey))
    const nkeys = new Set(r.notices().map((m) => m.idempotencyKey))
    const ok = res.every((x) => x.status === 200) && (await count()) - before === 1 && keys.size === 1 && nkeys.size === 1
    note("B3", "5 concurrent deliveries of one email (single connection: no true race)", "1 ticket; every ack/notice carries the same Idempotency-Key", `statuses=${res.map((x) => x.status).join(",")}, tickets+${(await count()) - before}, ackKeys=${keys.size}, noticeKeys=${nkeys.size}, acks=${r.acks().length}, notices=${r.notices().length}`, ok)
    expect(ok).toBe(true)
  })
})

// =====================================================================================================================
describe("a valid webhook whose fetch goes wrong: 502 so Svix retries, and the operator is told", () => {
  const modes: FetchMode[] = ["404", "401", "429", "500", "throw", "garbage", "json-null", "json-array", "json-string", "json-number"]
  for (const m of modes) {
    test(`C ${m}`, async () => {
      const r = rig()
      r.resend.put("em_f", email({ text: "Please delete my data.", subject: "Request" }))
      r.resend.mode.set("em_f", m)
      const before = await count()
      const res = await r.deliver(r.resend.event("em_f"))
      const told = r.sent.filter((x) => x.to === OPERATOR)
      const ok = res.status === 502 && (await count()) === before && told.length === 1
      note(`C-${m}`, `valid webhook, Resend fetch = ${m}`, "502 (retry) + one operator alert (nothing silently dropped)", `${res.status}, rows+${(await count()) - before}, operator mails=${told.length}`, ok)
      expect(res.status).toBe(502)
      expect(await count()).toBe(before)
      expect(told).toHaveLength(1)
      // the alert repeats on every retry only as the SAME provider Idempotency-Key
      await r.deliver(r.resend.event("em_f"))
      expect(new Set(r.sent.map((x) => x.idempotencyKey)).size).toBe(1)
      // once Resend recovers, the retry makes the ticket, acknowledges and tells the operator normally
      r.resend.mode.set("em_f", "ok")
      const again = await r.deliver(r.resend.event("em_f"))
      expect(again.status).toBe(200)
      expect(await count()).toBe(before + 1)
      expect(r.acks()).toHaveLength(1)
    })
  }

  test("C-hang the fetch hangs: aborted at the timeout, 502, operator told", async () => {
    const r = rig({ timeoutMs: 60 })
    r.resend.put("em_h", email())
    r.resend.mode.set("em_h", "hang")
    const t = Date.now()
    const res = await r.deliver(r.resend.event("em_h"))
    const ms = Date.now() - t
    const ok = res.status === 502 && ms < 2000 && r.sent.filter((x) => x.to === OPERATOR).length === 1
    note("C-hang", "Resend never answers (timeout 60 ms in the test, 10 s live)", "502 within the timeout + operator alert", `${res.status} in ${ms} ms, operator mails=${r.sent.filter((x) => x.to === OPERATOR).length}`, ok)
    expect(ok).toBe(true)
  })

  test("C-huge a 20 MB answer is not parsed: the ticket is made from the webhook's metadata and says so", async () => {
    const r = rig()
    r.resend.put("em_big", email())
    r.resend.mode.set("em_big", "huge")
    const res = await r.deliver(r.resend.event("em_big", { subject: "Big one" }))
    const b = await J(res)
    const ok = res.status === 200 && typeof b.ticket === "string"
    note("C-huge", "answer > 20M characters", "200, metadata-only ticket (review), left for the daily digest", `${res.status} ${String(b.ticket)} ${String(b.class)}`, ok && b.class === "review")
    expect(ok).toBe(true)
    expect(b.class).toBe("review")
    expect(b.notified).toBe("digest") // review rides the daily digest (owner decision 2026-10-01): no per-message email, the row exists
    expect(r.notices()).toHaveLength(0)
  })
})

// =====================================================================================================================
describe("the recipient, the sender and the words: what is filed where", () => {
  test("D1 grievance@ with DMARC fail: a grievance ticket with a clock, the operator told, NOT acknowledged", async () => {
    const r = rig()
    const { res } = await r.receive(email({ to: ["grievance@veridian-aios.com"], received_for: ["grievance@veridian-aios.com"], text: "Hello, please look at this.", authentication: { spf: "fail", dkim: "fail", dmarc: "fail" }, message_id: "<d1@example.org>", headers: { "message-id": "<d1@example.org>" } }))
    const b = await J(res)
    const row = await ticketRow(String(b.ticket))
    const ok = res.status === 200 && row.class === "grievance" && row.due_at !== null && row.ack_sent_at === null && row.operator_notified_at !== null && r.acks().length === 0 && r.notices().length === 1
    note("D1", "grievance@, Resend says SPF/DKIM/DMARC fail", "grievance ticket + due date + operator told + no ack", `${res.status} ${String(b.ticket)} class=${String(row.class)} due=${row.due_at ? "yes" : "no"} ack=${row.ack_sent_at ? "sent" : "none"} notices=${r.notices().length}`, ok)
    expect(ok).toBe(true)
    expect(r.notices()[0].text).toContain("NOT acknowledged")
  })

  test("D2 a reply to the Monday digest (dpdp+mon.<ref>) with a legal request => data request, ticket D-, acknowledged", async () => {
    const out = buildOutbound("monday", "Your week", {})
    expect(await logOutbound(sb, { ref: out.ref, cls: "monday", to: "owner@example.org", subject: out.subject, providerMessageId: "prov-mon-1" })).toBe(true)
    const r = rig()
    const { res } = await r.receive(email({ from: "owner@example.org", to: [out.reply_to], received_for: [out.reply_to], subject: `Re: ${out.subject}`, text: "Please stop sending me these emails and delete my data.\n\nOn Mon, Digest wrote:\n> escalated to you as owner", message_id: "<d2@example.org>", headers: { "message-id": "<d2@example.org>" } }))
    const b = await J(res)
    const row = await ticketRow(String(b.ticket))
    const ok = res.status === 200 && row.class === "data_request" && String(row.ticket_no).startsWith("D-") && row.matched_outbound_ref === out.ref && r.acks().length === 1
    note("D2", "reply to Monday digest asking to delete data", "data_request D-, matched to the Monday row, acknowledged", `${res.status} ${String(b.ticket)} class=${String(row.class)} matched=${String(row.matched_outbound_ref)} acks=${r.acks().length}`, ok)
    expect(ok).toBe(true)
  })

  test("D3 a vacation reply to the Monday digest (Auto-Submitted) is auto: logged, nobody told; with a legal request inside it is NOT hidden", async () => {
    const out = buildOutbound("monday", "Your week 2", {})
    await logOutbound(sb, { ref: out.ref, cls: "monday", to: "owner2@example.org", subject: out.subject, providerMessageId: "prov-mon-2" })
    const r = rig()
    const a = await r.receive(email({ from: "owner2@example.org", to: [out.reply_to], received_for: [out.reply_to], subject: `Automatic reply: ${out.subject}`, text: "I am out of the office until Monday.", headers: { "message-id": "<d3a@example.org>", "auto-submitted": "auto-replied" }, message_id: "<d3a@example.org>" }))
    const ba = await J(a.res)
    const b2 = await r.receive(email({ from: "owner2@example.org", to: [out.reply_to], received_for: [out.reply_to], subject: `Automatic reply: ${out.subject}`, text: "I am away. Also: delete my personal data.", headers: { "message-id": "<d3b@example.org>", "auto-submitted": "auto-replied" }, message_id: "<d3b@example.org>" }))
    const bb = await J(b2.res)
    const ok = ba.class === "auto" && r.notices().length === 1 && bb.class === "data_request"
    note("D3", "vacation reply, and vacation reply with a data request in it", "auto (silent) / data_request (told + acked)", `${String(ba.class)} / ${String(bb.class)}, notices=${r.notices().length}, acks=${r.acks().length}`, ok)
    expect(ok).toBe(true)
  })

  test("D4 unknown recipients: plain => auto (logged); a data request in the sender's words => kept; spam with an unsubscribe link and List-Unsubscribe => ?", async () => {
    const r = rig()
    const plain = await J((await r.receive(email({ to: ["info@veridian-aios.com"], received_for: ["info@veridian-aios.com"], text: "We offer SEO services.", message_id: "<d4a@example.org>", headers: { "message-id": "<d4a@example.org>" } }))).res)
    const legal = await J((await r.receive(email({ to: ["privacy@veridian-aios.com"], received_for: ["privacy@veridian-aios.com"], text: "Please delete my personal data.", message_id: "<d4b@example.org>", headers: { "message-id": "<d4b@example.org>" } }))).res)
    const spam = await J((await r.receive(email({ from: "deals@bulk-sender.example", to: ["sales2@veridian-aios.com"], received_for: ["sales2@veridian-aios.com"], text: "Big deals! To unsubscribe click the link below.", headers: { "message-id": "<d4c@example.org>", "list-unsubscribe": "<mailto:u@bulk-sender.example>" }, message_id: "<d4c@example.org>" }))).res)
    note("D4", "info@ plain / privacy@ data request / bulk mail with List-Unsubscribe to a guessed address", "auto / data_request / (bulk should stay auto)", `${String(plain.class)} / ${String(legal.class)} / ${String(spam.class)}`, plain.class === "auto" && legal.class === "data_request" && spam.class === "auto")
    expect(plain.class).toBe("auto")
    expect(legal.class).toBe("data_request")
    expect(spam.class).toBe("auto")
  })

  test("D5 postmaster@: a human data request keeps its legal class and ticket; the acknowledgement question", async () => {
    const r = rig()
    const b = await J((await r.receive(email({ to: ["postmaster@veridian-aios.com"], received_for: ["postmaster@veridian-aios.com"], text: "Please erase my data.", message_id: "<d5@example.org>", headers: { "message-id": "<d5@example.org>" } }))).res)
    note("D5", "postmaster@ with a human erasure request", "data_request, ticket + due date, operator told; ack = spec says never (role mailbox)", `${String(b.class)} ${String(b.ticket)} acks=${r.acks().length} notices=${r.notices().length}`, b.class === "data_request" && r.notices().length === 1)
    expect(b.class).toBe("data_request")
  })

  test("D6 our own mailbox as the sender (loop guard): auto, no mail out", async () => {
    const r = rig()
    const a = await J((await r.receive(email({ from: "DPDP <dpdp@veridian-aios.com>", text: "Please delete my data. I have a complaint.", message_id: "<d6a@x.test>", headers: { "message-id": "<d6a@x.test>" } }))).res)
    const b = await J((await r.receive(email({ from: "dpdp+grv.k3f9x2ab7q@veridian-aios.com", text: "I have a complaint.", message_id: "<d6b@x.test>", headers: { "message-id": "<d6b@x.test>" } }))).res)
    const ok = a.class === "auto" && b.class === "auto" && r.sent.length === 0
    note("D6", "From = dpdp@ / dpdp+grv.<ref>@ (ours)", "auto, nothing sent", `${String(a.class)}/${String(b.class)}, mails=${r.sent.length}`, ok)
    expect(ok).toBe(true)
  })

  test("D7 loop: request -> acknowledgement -> auto-responder answers the acknowledgement -> nothing more is sent; a human answering is a new ticket, capped at 3 acks in 24 h", async () => {
    const r = rig()
    const first = await J((await r.receive(email({ from: "loop@example.org", text: "I have a grievance and a complaint.", message_id: "<l0@example.org>", headers: { "message-id": "<l0@example.org>" } }))).res)
    const ack = r.acks()[0]
    const ackRef = /^dpdp\+grv\.([0-9a-z]{10})@/.exec(ack.replyTo ?? "")?.[1] ?? ""
    expect(isValidRef(ackRef)).toBe(true)
    const replyTo = replyToAddress("grievance", ackRef)
    const before = r.sent.length
    const bot = await J((await r.receive(email({ from: "loop@example.org", to: [replyTo], received_for: [replyTo], subject: `Auto: ${ack.subject}`, text: "I am on leave.", message_id: "<l1@example.org>", headers: { "message-id": "<l1@example.org>", "auto-submitted": "auto-replied", "in-reply-to": ack.headers["In-Reply-To"] ?? "<l0@example.org>" } }))).res)
    const afterBot = r.sent.length
    const humans: string[] = []
    for (let i = 0; i < 4; i++) {
      const h = await J((await r.receive(email({ from: "loop@example.org", to: [replyTo], received_for: [replyTo], subject: "Re: ack", text: `Thanks, waiting. (${i})`, message_id: `<lh${i}@example.org>`, headers: { "message-id": `<lh${i}@example.org>` } }))).res)
      humans.push(`${String(h.ticket)}:${String(h.ack)}`)
    }
    const sentAcks = r.acks().length
    const ok = first.class === "grievance" && bot.class === "auto" && afterBot === before && sentAcks <= 3 + 0
    note("D7", "ack loop", "auto-responder reply => auto (0 mails); human replies each ticketed; acks capped at 3/24h/sender", `bot=${String(bot.class)} mailsAfterBot=${afterBot - before}; humans=${humans.join(" ")}; acks=${sentAcks}`, ok)
    expect(bot.class).toBe("auto")
    expect(afterBot).toBe(before)
    expect(sentAcks).toBeLessThanOrEqual(3)
  })

  test("D8 header injection through the subject and the Message-ID: nothing reaches a header line of anything we send", async () => {
    const r = rig()
    const evil = "Hello\r\nBcc: attacker@evil.test\r\nX-Injected: yes"
    await r.receive(email({ subject: evil, text: "I want to file a complaint.", message_id: "<x@y>\r\nBcc: evil@evil.test", headers: { "message-id": "<x@y>\r\nBcc: evil@evil.test" } }))
    const bad = r.sent.filter((m) => /[\r\n]/.test(m.subject) || Object.values(m.headers).some((v) => /[\r\n]/.test(v)) || Object.keys(m.headers).some((k) => /[\r\n]/.test(k)))
    const ackEchoes = r.acks().some((m) => m.text.includes("Bcc") || m.subject.includes("Bcc"))
    note("D8", "CRLF + Bcc in Subject and Message-ID", "no CR/LF in any subject/header we send; ack does not echo", `bad=${bad.length}, echoes=${ackEchoes}, mails=${r.sent.length}`, bad.length === 0 && !ackEchoes)
    expect(bad).toHaveLength(0)
    expect(ackEchoes).toBe(false)
  })

  test("D9 duplicate Message-ID from the same sender with DIFFERENT content: two tickets; the retry of either is a duplicate of its own", async () => {
    const r = rig()
    const mid = "<reused@example.org>"
    const one = await r.receive(email({ from: "dup@example.org", subject: "Hello", text: "Nice weather today.", message_id: mid, headers: { "message-id": mid } }), "em_r1")
    const two = await r.receive(email({ from: "dup@example.org", subject: "Hello", text: "Please delete all my personal data.", message_id: mid, headers: { "message-id": mid } }), "em_r2")
    const b1 = await J(one.res)
    const b2 = await J(two.res)
    const retry2 = await J(await r.deliver(r.resend.event("em_r2")))
    const retry1 = await J(await r.deliver(r.resend.event("em_r1")))
    r.deps.seen!.clear() // force the database to decide (the in-memory cache is only a shortcut)
    const retry2b = await J(await r.deliver(r.resend.event("em_r2")))
    const retry1b = await J(await r.deliver(r.resend.event("em_r1")))
    const ok = b1.ticket !== b2.ticket && b2.class === "data_request" && retry2.duplicate === true && retry1.duplicate === true && retry2b.ticket === b2.ticket && retry1b.ticket === b1.ticket && retry2b.duplicate === true && retry1b.duplicate === true
    note("D9", "same sender + Message-ID, different words", "2 tickets; 2nd is a data_request; retries map back to their own ticket", `${String(b1.ticket)} / ${String(b2.ticket)} (${String(b2.class)}); retries ${String(retry1b.ticket)}(dup=${String(retry1b.duplicate)}) ${String(retry2b.ticket)}(dup=${String(retry2b.duplicate)})`, ok)
    expect(ok).toBe(true)
  })

  test("D10 a 5 MB text body: recorded within the excerpt limit, classified on the first 4096 bytes, fast", async () => {
    const r = rig()
    const big = "Please delete my personal data. ".repeat(160_000)
    const t = Date.now()
    const { res } = await r.receive(email({ text: big, message_id: "<big@example.org>", headers: { "message-id": "<big@example.org>" } }))
    const ms = Date.now() - t
    const b = await J(res)
    const row = await ticketRow(String(b.ticket))
    const ok = res.status === 200 && b.class === "data_request" && String(row.excerpt).length <= 4096 && ms < 3000
    note("D10", "5 MB text body", "200, data_request, excerpt <= 4096, < 3 s", `${res.status} ${String(b.class)} excerpt=${String(row.excerpt).length} ${ms} ms`, ok)
    expect(ok).toBe(true)
    expect(r.notices()[0].text).toContain("Only the first")
  })

  test("D11 an HTML-only mail: the words are read out of the markup", async () => {
    const r = rig()
    const { res } = await r.receive(email({ text: null, html: "<html><style>p{color:red}</style><body><p>Please <b>erase</b> all my personal data.</p></body></html>", message_id: "<h1@example.org>", headers: { "message-id": "<h1@example.org>" } }))
    const b = await J(res)
    note("D11", "html-only, no text part", "data_request", `${res.status} ${String(b.class)}`, b.class === "data_request")
    expect(b.class).toBe("data_request")
  })

  test("D12 hostile HTML-only / address fields that are quadratic for a naive regex: each is ticketed in well under 2 s", async () => {
    const hostile: Array<[string, Stored]> = [
      ["html '<' x 300k", { text: null, html: "<".repeat(300_000) }],
      ["html spaces x 300k", { text: null, html: " ".repeat(300_000) + "x" }],
      ["html '<script>' x 40k unclosed", { text: null, html: "<script>".repeat(40_000) }],
      ["To: 200k address characters, no @", { to: [MAILBOX, "a".repeat(200_000)] }],
      ["Cc: 200k dots", { cc: [".".repeat(200_000)] }],
      ["From: 200k commas", { from: ",".repeat(200_000) + "x" }],
    ]
    let worst = 0
    const cells: string[] = []
    let allOk = true
    for (const [name, over] of hostile) {
      const r = rig()
      const t = Date.now()
      const { res } = await r.receive(email({ message_id: `<hs-${name}@example.org>`, headers: { "message-id": `<hs-${name}@example.org>` }, ...over }))
      const ms = Date.now() - t
      worst = Math.max(worst, ms)
      cells.push(`${name}: ${res.status} in ${ms} ms`)
      if (!(res.status === 200 && ms < 2000)) allOk = false
    }
    note("D12", "hostile bodies and header runs (quadratic regex bait)", "each answered 200 in < 2 s", cells.join("; "), allOk)
    expect(cells.join("\n")).toContain("200")
    expect(allOk, cells.join("\n")).toBe(true)
  }, 120_000)
})

// =====================================================================================================================
describe("failure of the other edges: the database, the mail provider", () => {
  test("E1 database down: 502 (never 2xx), the operator gets the raw message; a retry after recovery makes the ticket", async () => {
    const r = rig()
    dbDown = (fn) => fn === "dpdp_mail_insert_inbound"
    const { id, res } = await r.receive(email({ text: "Please delete my data.", message_id: "<e1@example.org>", headers: { "message-id": "<e1@example.org>" } }))
    dbDown = null
    const forwarded = r.sent.filter((m) => m.to === OPERATOR)
    const ok1 = res.status === 502 && forwarded.length === 1 && /UNRECORDED/.test(forwarded[0].subject)
    const again = await r.deliver(r.resend.event(id))
    const ok = ok1 && again.status === 200
    note("E1", "insert_inbound fails", "502 + raw copy to operator; retry => 200 + ticket", `${res.status} rawcopies=${forwarded.length}; retry ${again.status}`, ok)
    expect(ok).toBe(true)
  })

  test("E2 database down AND the mail provider down: 502, message stays in Resend for the retry", async () => {
    const r = rig({ failSend: () => true })
    dbDown = (fn) => fn === "dpdp_mail_insert_inbound"
    const { res } = await r.receive(email({ message_id: "<e2@example.org>", headers: { "message-id": "<e2@example.org>" } }))
    dbDown = null
    note("E2", "insert fails and send fails", "502", String(res.status), res.status === 502)
    expect(res.status).toBe(502)
  })

  test("E3 operator notice cannot be sent: 502, the ticket exists, the retry does not make a second ticket and tells the operator", async () => {
    let fail = true
    const r = rig({ failSend: (m) => fail && m.to === OPERATOR })
    const before = await count()
    const { id, res } = await r.receive(email({ text: "I have a grievance.", message_id: "<e3@example.org>", headers: { "message-id": "<e3@example.org>" } }))
    fail = false
    const again = await r.deliver(r.resend.event(id))
    const ok = res.status === 502 && again.status === 200 && (await count()) - before === 1 && r.notices().length === 1 && r.acks().length === 1
    note("E3", "operator email fails once", "502 then 200; 1 ticket; 1 ack; 1 notice", `${res.status}/${again.status}, tickets+${(await count()) - before}, acks=${r.acks().length}, notices=${r.notices().length}`, ok)
    expect(ok).toBe(true)
  })

  test("E4 acknowledgement cannot be sent: 502, the retry sends it and does not tell the operator twice", async () => {
    let fail = true
    const r = rig({ failSend: (m) => fail && m.headers["X-Veridian-Origin"] === "acknowledgement" })
    const { id, res } = await r.receive(email({ text: "Please delete my data.", message_id: "<e4@example.org>", headers: { "message-id": "<e4@example.org>" } }))
    fail = false
    const again = await r.deliver(r.resend.event(id))
    const ok = res.status === 502 && again.status === 200 && r.acks().length === 1 && r.notices().length === 1
    note("E4", "ack email fails once", "502 then 200; 1 ack; 1 notice", `${res.status}/${again.status}, acks=${r.acks().length}, notices=${r.notices().length}`, ok)
    expect(ok).toBe(true)
  })

  test("E5 DRY RUN (no RESEND_API_KEY on the sending side): recorded, 502, nobody told", async () => {
    const r = rig({ config: { dryRun: true } })
    const before = await count()
    const { res } = await r.receive(email({ text: "I have a grievance.", message_id: "<e5@example.org>", headers: { "message-id": "<e5@example.org>" } }))
    note("E5", "dry run", "502, ticket recorded, nothing sent", `${res.status}, tickets+${(await count()) - before}, mails=${r.sent.length}`, res.status === 502 && r.sent.length === 0)
    expect(res.status).toBe(502)
    expect(r.sent).toHaveLength(0)
  })
})

// =====================================================================================================================
describe("the reconcile job", () => {
  test("F1 repairs a message whose webhook never arrived; a second run makes nothing new; bad input and a wrong bearer are refused", async () => {
    const r = rig()
    r.resend.put("em_rc1", email({ text: "I have a grievance.", message_id: "<rc1@example.org>", headers: { "message-id": "<rc1@example.org>" }, created_at: "2026-09-29T14:00:00.000Z" }))
    r.resend.put("em_rc0", email({ text: "old", message_id: "<rc0@example.org>", headers: { "message-id": "<rc0@example.org>" }, created_at: "2026-08-01T00:00:00.000Z" }))
    const before = await count()
    const a = await J(await r.job({ job: "reconcile", hours: 48, limit: 100 }))
    const rowAfter = await count()
    const b = await J(await r.job({ job: "reconcile", hours: 48, limit: 100 }))
    const badBearer = (await r.job({ job: "reconcile" }, "wrong-bearer-value-0123456789")).status
    const noBearer = (await r.job({ job: "reconcile" }, null)).status
    const bad = await Promise.all([{ hours: 0 }, { hours: 1.5 }, { hours: "48" }, { hours: 169 }, { limit: 0 }, { limit: 201 }].map(async (x) => (await r.job({ job: "reconcile", ...x })).status))
    const unknown = (await r.job({ job: "nope" })).status
    const ok = a.ingested === 1 && rowAfter - before === 1 && b.ingested === 0 && badBearer === 401 && noBearer === 401 && bad.every((s) => s === 400) && unknown === 400
    note("F1", "reconcile: missed mail / rerun / auth / input", "1 ingested (old one outside window skipped); rerun 0; 401/401; 400 x6; unknown 400", `ingested=${String(a.ingested)} rerun=${String(b.ingested)} ${badBearer}/${noBearer} ${bad.join(",")} ${unknown}`, ok)
    expect(ok).toBe(true)
  })

  test("F2 a failing message does not stop the run; it is reported and the answer is 502", async () => {
    const r = rig()
    r.resend.put("em_ok2", email({ message_id: "<rc2@example.org>", headers: { "message-id": "<rc2@example.org>" }, created_at: "2026-09-29T14:10:00.000Z" }))
    r.resend.put("em_bad2", email({ message_id: "<rc3@example.org>", headers: { "message-id": "<rc3@example.org>" }, created_at: "2026-09-29T14:20:00.000Z" }))
    r.resend.mode.set("em_bad2", "500")
    const res = await r.job({ job: "reconcile", hours: 48 })
    const b = await J(res)
    const ok = res.status === 502 && b.ingested === 1 && b.failed === 1
    note("F2", "reconcile with one unfetchable message", "502, ingested 1, failed 1", `${res.status} ingested=${String(b.ingested)} failed=${String(b.failed)}`, ok)
    expect(ok).toBe(true)
  })
})

// =====================================================================================================================
describe("hostile transport and headers (added by the fixes of the 2026-09-30 review)", () => {
  test("G1 a body with no Content-Length is read only up to the limit: 413 on the webhook route, nothing buffered whole, nothing fetched", async () => {
    const r = rig()
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 65_536
        if (pulled > 40_000_000) c.close()
        else c.enqueue(new Uint8Array(65_536))
      },
    })
    const headers = { "svix-id": "msg_big", "svix-timestamp": String(NOW_S), "svix-signature": `v1,${btoa("x".repeat(32))}` }
    const res = await routeInbound(new Request("https://x.test/f", { method: "POST", headers, body: stream, duplex: "half" } as RequestInit), r.deps)
    note("G1", "webhook body streamed with no Content-Length (40 MB available)", "413 after ~256 KB, not the whole body", `${res.status}, pulled ${(pulled / 1024).toFixed(0)} KB, fetches=${r.resend.calls.length}`, res.status === 413 && pulled < 4_000_000 && r.resend.calls.length === 0)
    expect(res.status).toBe(413)
    expect(pulled).toBeLessThan(4_000_000)
    expect(r.resend.calls).toHaveLength(0)
  })

  test("G2 the mail route does not read a large or chunked unauthenticated body to decide whether it is a job: 401 for a stranger", async () => {
    const r = rig()
    const big = "a".repeat(3000)
    const res = await routeInbound(new Request("https://x.test/f", { method: "POST", headers: { "content-type": "application/json", "content-length": String(big.length) }, body: big }), r.deps)
    const res2 = await routeInbound(new Request("https://x.test/f", { method: "POST", headers: { "content-type": "application/json", "content-length": "99999999" }, body: "{}" } as RequestInit), r.deps)
    note("G2", "unauthenticated 3 KB body / a declared 99 MB length on the mail route", "401 / 401", `${res.status}/${res2.status}`, res.status === 401 && res2.status === 401)
    expect(res.status).toBe(401)
    expect(res2.status).toBe(401)
  })

  test("G3 a display name that contains another address does not steer the acknowledgement to a third party", async () => {
    const r = rig()
    const { res } = await r.receive(email({ from: '"x <victim@example.com>" <attacker@evil.example>', text: "Please delete my personal data.", message_id: "<g3@evil.example>", headers: { "message-id": "<g3@evil.example>" } }))
    const to = r.acks().map((m) => m.to)
    note("G3", 'From: "x <victim@example.com>" <attacker@evil.example>', "acknowledgement to attacker@evil.example only", `${res.status}, acks to ${to.join(",") || "(none)"}`, res.status === 200 && to.length === 1 && to[0] === "attacker@evil.example")
    expect(to).toEqual(["attacker@evil.example"])
  })

  test("G4 a text part that is only whitespace does not hide the request in the HTML part", async () => {
    const r = rig()
    const { res } = await r.receive(email({ text: " \n\n", html: "<div>Please erase all my personal data.</div>", message_id: "<g4@example.org>", headers: { "message-id": "<g4@example.org>" } }))
    const b = await J(res)
    note("G4", "text = whitespace, html = the request", "data_request", `${res.status} ${String(b.class)}`, b.class === "data_request")
    expect(b.class).toBe("data_request")
  })

  test("G5 the unprocessed-message alert carries the Resend id and the webhook's metadata, never the body; no CR/LF; the same Idempotency-Key on every retry", async () => {
    const r = rig()
    const evil = "Line1\r\nBcc: evil@evil.test"
    r.resend.put("em_al", email({ text: "SECRET-BODY-WORDS delete my data", subject: evil }))
    r.resend.mode.set("em_al", "401")
    await r.deliver(r.resend.event("em_al", { subject: evil, from: "Real <real@example.org>" }))
    await r.deliver(r.resend.event("em_al", { subject: evil, from: "Real <real@example.org>" }))
    const a = r.sent.filter((m) => m.headers["X-Veridian-Origin"] === "inbound-alert")
    const m = a[0]
    const ok = a.length === 2 && new Set(a.map((x) => x.idempotencyKey)).size === 1 && !/[\r\n]/.test(m.subject) && m.text.includes("em_al") && m.text.includes("real@example.org") && !m.text.includes("SECRET-BODY-WORDS") && m.text.includes("sending-only key")
    note("G5", "alert for an unfetchable message (401)", "one alert per attempt, same Idempotency-Key, metadata only, key hint", `alerts=${a.length}, keys=${new Set(a.map((x) => x.idempotencyKey)).size}, subject='${m.subject}'`, ok)
    expect(ok).toBe(true)
  })

  test("H1 a short reply / a vacation notice on top of a long quoted Monday digest: monday (no ack) / auto, as when the quote is short", async () => {
    const out = buildOutbound("monday", "Your week 3", {})
    await logOutbound(sb, { ref: out.ref, cls: "monday", to: "owner3@example.org", subject: out.subject, providerMessageId: "prov-mon-3" })
    const quote = "> a line of the weekly DPDP digest\n".repeat(300)
    const wrote = "\n\nOn Mon, 28 Sep 2026 at 08:00, VERIDIAN AI DPDP <dpdp@veridian-aios.com> wrote:\n" + quote
    const r = rig()
    const thanks = await J((await r.receive(email({ from: "owner3@example.org", to: [out.reply_to], received_for: [out.reply_to], subject: `Re: ${out.subject}`, text: "Thanks!" + wrote, message_id: "<h1a@example.org>", headers: { "message-id": "<h1a@example.org>" } }))).res)
    const vac = await J((await r.receive(email({ from: "owner3@example.org", to: [out.reply_to], received_for: [out.reply_to], subject: `Automatic reply: ${out.subject}`, text: "Out of office." + wrote, message_id: "<h1b@example.org>", headers: { "message-id": "<h1b@example.org>", "auto-submitted": "auto-replied" } }))).res)
    const ok = thanks.class === "monday" && vac.class === "auto" && r.acks().length === 0
    note("H1", "'Thanks!' and a vacation notice on a 10 KB quoted digest", "monday (no ack) / auto", `${String(thanks.class)} / ${String(vac.class)}, acks=${r.acks().length}`, ok)
    expect(ok).toBe(true)
  })

  test("H2 a message whose From has no readable address is read like any other (sales), not filed auto", async () => {
    const r = rig()
    const b = await J((await r.receive(email({ from: "undisclosed-recipients:;", text: "Please send me your pricing brochure.", message_id: "<h2@example.org>", headers: { "message-id": "<h2@example.org>" } }))).res)
    note("H2", "From: undisclosed-recipients:; and a sales question", "sales, recorded for the daily digest (no per-message email)", `${String(b.class)}, notices=${r.notices().length}`, b.class === "sales" && r.notices().length === 0)
    expect(b.class).toBe("sales")
    expect(b.notified).toBe("digest")
    expect(r.notices()).toHaveLength(0)
  })

  test("G6 a malformed but parseable message object does not crash the function", async () => {
    const r = rig()
    r.resend.put("em_map", email({ headers: null as never, to: 5 as never }))
    const res = await r.deliver(r.resend.event("em_map"))
    note("G6", "message object with headers=null, to=5", "no thrown 500: 200 or 502", String(res.status), res.status === 200 || res.status === 502)
    expect([200, 502]).toContain(res.status)
  })
})
