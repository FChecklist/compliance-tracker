/// <reference types="bun-types" />
// Offline proof of resend-inbound.ts, the Resend inbound adapter of the dpdp-inbound-mail Edge Function, run against the REAL
// handler.ts / classify.ts with a fake database (an in-memory copy of the public.dpdp_mail_* contract of drizzle/0662; the
// real SQL is proven by src/lib/services/dpdp-single-mailbox-migration.pglite.test.ts), a fake mail provider and a fake
// Resend API (fetch). Signatures are made here with node:crypto, an implementation independent of the Web Crypto code under test.
//
// What this proves:
//   * the Svix signature: computed over the RAW body, constant-time, every v1 candidate tried, a 5-minute window in BOTH
//     directions, fail-closed 503 when the secret is unset or malformed, 401 (and nothing fetched, nothing recorded) otherwise;
//   * only email.received is acted on; the full message is fetched (10 s timeout, no redirects, key never leaves the API host);
//   * the message is mapped to the Worker's payload and run through the SAME pipeline: tags, threads, auto headers, html-only
//     bodies, the 4096-byte cut, attachments, the Message-ID, the real received time;
//   * the recipient policy (Resend accepts every address): dpdp / dpdp+tag over aliases over postmaster / abuse over unknown;
//     grievance@ = grv, partners@ = prt; postmaster@ / abuse@ = support, operator told, never acknowledged; an unknown address is
//     `auto` and logged only unless the sender's own words are a data request or grievance;
//   * a message Resend says failed DMARC (or failed SPF and DKIM together) is ticketed and reported, never acknowledged, and the
//     verdicts come from Resend, never from a header the sender wrote;
//   * 2xx only after the ticket exists: a failed fetch, a failed database and an unsent operator notice are 502, a retry creates
//     no second ticket, no second acknowledgement and no second notice;
//   * nothing we send can start a loop;
//   * the reconcile job: bearer-only, window and limit checked, idempotent, and it repairs a missed message.
//
// Run (bunfig.toml sets the test root to src/, so name the file with a ./ prefix):
//   bun test --isolate ./supabase/functions/dpdp-inbound-mail/resend-inbound.test.ts
import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { MAILBOX, type MailClass } from "../_shared/mail-taxonomy.ts"
import { applyPolicy, htmlToText, parseInbound, renderNotification, withNoticeLines, type InboundConfig, type InboundDeps, type OutMessage, type Rpc } from "./handler.ts"
import { bareAddress, classify, type Classification } from "./classify.ts"
import {
  MAX_FETCHED_CHARS, RECONCILE_MAX_HOURS, SVIX_TOLERANCE_SECONDS, authenticationResults, chooseRecipient, extractAddresses, handleResendWebhook,
  headerMap, mapReceivedEmail, parseWebhookSecret, parseWhen, reconcile, routeInbound, timingSafeEqual, utf8Prefix, verifySvix, type RouteDeps,
} from "./resend-inbound.ts"

const SECRET = "test-secret-" + "x".repeat(24) // DPDP_INBOUND_SECRET
const KEY_BYTES = "x".repeat(24)
const WHSEC = "whsec_" + btoa(KEY_BYTES) // built at runtime: no secret-looking literal in the source
const API_KEY = "test-resend-api-key"
const OPERATOR = "operator@example.test"
const NOW = new Date("2026-09-29T15:33:00Z")
const NOW_S = Math.floor(NOW.getTime() / 1000)
const REF = "k3f9x2ab7q"
const EID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"

const PREFIX: Record<MailClass, string> = {
  grievance: "G", data_request: "D", review: "R", sales: "S", sales_chain: "T", invoice: "I", monday: "M", clock: "K", partner: "P", support: "H", auto: "A",
}

// ---------------------------------------------------------------------------------------------------------------------
// The fake database: the public.dpdp_mail_* contract, in memory, shared by every rig that is given the same one.
// ---------------------------------------------------------------------------------------------------------------------
type OutboundRow = { ref: string; class: MailClass; ticketNo: string | null; providerId: string | null; headerId: string | null; to: string }
type InboundRow = { ticketNo: string; class: MailClass; from: string; messageId: string | null; ackSent: boolean; notified: boolean; args: Record<string, unknown> }

function makeDb() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const outbound: OutboundRow[] = []
  const inbound: InboundRow[] = []
  const counters = new Map<string, number>()
  const failRpc: Record<string, Error | undefined> = {}
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args })
    const boom = failRpc[fn]
    if (boom) return { data: null, error: { message: boom.message } }
    switch (fn) {
      case "dpdp_mail_lookup_outbound": {
        const ids = (args.p_message_ids as string[]) ?? []
        const hit = outbound.find((o) => o.ref === args.p_ref) ?? outbound.find((o) => (o.providerId && ids.includes(o.providerId)) || (o.headerId && ids.includes(o.headerId)))
        return { data: hit ? { ref: hit.ref, class: hit.class, ticketNo: hit.ticketNo, orgId: null, membershipId: null, sentAt: NOW.toISOString(), matchedBy: hit.ref === args.p_ref ? "ref" : "message_id" } : null, error: null }
      }
      case "dpdp_mail_insert_inbound": {
        const from = String(args.p_from_addr).toLowerCase()
        const mid = (args.p_message_id as string | null) ?? null
        const dup = mid ? inbound.find((r) => r.from === from && r.messageId === mid) : undefined
        const row = dup ?? (() => {
          const cls = args.p_class as MailClass
          const n = (counters.get(cls) ?? 0) + 1
          counters.set(cls, n)
          const r: InboundRow = { ticketNo: `${PREFIX[cls]}-2026-${String(n).padStart(4, "0")}`, class: cls, from, messageId: mid, ackSent: false, notified: false, args }
          inbound.push(r)
          return r
        })()
        const due = args.p_due_days == null ? null : new Date(new Date(args.p_received_at as string).getTime() + (args.p_due_days as number) * 86400_000).toISOString()
        return {
          data: {
            id: `id-${row.ticketNo}`, ticketNo: row.ticketNo, class: row.class, status: "open", dueAt: due, duplicate: Boolean(dup),
            ackDue: Boolean(args.p_wants_ack) && !row.ackSent, operatorNotified: row.notified,
          },
          error: null,
        }
      }
      case "dpdp_mail_log_outbound": {
        const existing = outbound.find((o) => o.ref === args.p_ref)
        if (existing) existing.providerId = (args.p_provider_message_id as string | null) ?? existing.providerId
        else outbound.push({ ref: String(args.p_ref), class: args.p_class as MailClass, ticketNo: (args.p_ticket_no as string | null) ?? null, providerId: (args.p_provider_message_id as string | null) ?? null, headerId: null, to: String(args.p_to_addr) })
        return { data: { ref: args.p_ref }, error: null }
      }
      case "dpdp_mail_mark_ack": {
        const r = inbound.find((x) => x.ticketNo === args.p_ticket_no)
        if (r) r.ackSent = true
        return { data: { ok: Boolean(r) }, error: null }
      }
      case "dpdp_mail_mark_notified": {
        const r = inbound.find((x) => x.ticketNo === args.p_ticket_no)
        if (r) r.notified = true
        return { data: { ok: Boolean(r) }, error: null }
      }
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } }
  }
  return { rpc, calls, outbound, inbound, failRpc }
}
type Db = ReturnType<typeof makeDb>

// ---------------------------------------------------------------------------------------------------------------------
// A fake Resend API: GET /emails/receiving/{id} and GET /emails/receiving?limit&after.
// ---------------------------------------------------------------------------------------------------------------------
type Stored = Record<string, unknown>

/** A received email as GET /emails/receiving/{id} returns it. */
const email = (over: Stored = {}): Stored => ({
  object: "email",
  id: EID,
  to: [MAILBOX],
  from: "Asha M <asha@example.org>",
  created_at: "2026-09-29T15:30:00.000Z",
  subject: "Question",
  html: null,
  text: "Hello there, this is only a test.",
  headers: { "message-id": "<abc123@example.org>", "content-type": "text/plain; charset=utf-8" },
  bcc: [],
  cc: [],
  reply_to: [],
  message_id: "<abc123@example.org>",
  attachments: [],
  received_for: [MAILBOX],
  authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  raw: { download_url: "https://example.invalid/raw", expires_at: "2026-09-29T16:30:00.000Z" },
  ...over,
})

function makeResend(pageSize = 100) {
  const emails = new Map<string, Stored>()
  const order: string[] = [] // newest first
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const failWith = new Map<string, () => Response | Promise<Response>>() // per email id, and "(list)"
  const put = (id: string, e: Stored) => {
    emails.set(id, { ...e, id })
    if (!order.includes(id)) order.push(id)
  }
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.push({ url, init })
    const u = new URL(url)
    const jsonRes = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } })
    if (u.pathname.startsWith("/emails/receiving/")) {
      const id = decodeURIComponent(u.pathname.slice("/emails/receiving/".length))
      const f = failWith.get(id)
      if (f) return f()
      const e = emails.get(id)
      return e ? jsonRes(e) : jsonRes({ name: "not_found", message: "not found" }, 404)
    }
    if (u.pathname === "/emails/receiving") {
      const f = failWith.get("(list)")
      if (f) return f()
      const after = u.searchParams.get("after")
      const start = after ? order.indexOf(after) + 1 : 0
      const slice = order.slice(start, start + Math.min(pageSize, Number(u.searchParams.get("limit") ?? "20")))
      const data = slice.map((id) => {
        const e = emails.get(id)!
        return { id, to: e.to, from: e.from, created_at: e.created_at, subject: e.subject, message_id: e.message_id, bcc: [], cc: [], reply_to: [], attachments: e.attachments }
      })
      return jsonRes({ object: "list", has_more: start + slice.length < order.length, data })
    }
    return jsonRes({ name: "not_found" }, 404)
  }) as typeof fetch
  return { fetch: fetchImpl, emails, put, order, calls, failWith }
}

// ---------------------------------------------------------------------------------------------------------------------
// The rig: the route, the fakes, and helpers to deliver a signed webhook.
// ---------------------------------------------------------------------------------------------------------------------
function rig(opts: { db?: Db; resend?: ReturnType<typeof makeResend>; config?: Partial<InboundConfig>; webhookSecret?: string; apiKey?: string; classify?: InboundDeps["classify"]; failSend?: (m: OutMessage) => boolean; timeoutMs?: number; budgetMs?: number } = {}) {
  const db = opts.db ?? makeDb()
  const resend = opts.resend ?? makeResend()
  const sent: OutMessage[] = []
  const logs: string[] = []
  const config: InboundConfig = { secret: SECRET, operatorEmail: OPERATOR, from: "VERIDIAN AI DPDP <dpdp@veridian-aios.com>", legalResponseDays: 90, dryRun: false, ...opts.config }
  const deps: RouteDeps = {
    inbound: {
      rpc: db.rpc,
      config,
      now: () => NOW,
      random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
      log: (line) => { logs.push(line) },
      classify: opts.classify,
      send: async (m) => {
        if (opts.failSend?.(m)) throw new Error("Resend 500: boom")
        sent.push(m)
        return { id: `resend-${sent.length}` }
      },
    },
    resend: { webhookSecret: opts.webhookSecret ?? WHSEC, apiKey: opts.apiKey ?? API_KEY },
    fetch: resend.fetch,
    timeoutMs: opts.timeoutMs,
    budgetMs: opts.budgetMs,
    paceMs: 0,
    seen: new Map(),
  }
  const event = (id: string, over: Stored = {}, type = "email.received"): Stored => {
    const e = resend.emails.get(id)
    return {
      type,
      created_at: "2026-09-29T15:30:01.000Z",
      data: { email_id: id, created_at: e?.created_at ?? "2026-09-29T15:30:00.000Z", from: e?.from ?? "asha@example.org", to: e?.to ?? [MAILBOX], bcc: [], cc: [], received_for: e?.received_for ?? [MAILBOX], message_id: e?.message_id ?? null, subject: e?.subject ?? "", attachments: e?.attachments ?? [], ...over },
    }
  }
  const sign = (id: string, ts: number | string, body: string) => `v1,${createHmac("sha256", KEY_BYTES).update(`${id}.${ts}.`).update(body).digest("base64")}`
  /** POST a signed webhook. `raw` overrides the body AFTER it is signed (a tampered body). */
  const deliver = (ev: unknown, o: { svixId?: string; ts?: number; signature?: string | null; raw?: string; headers?: Record<string, string | null>; method?: string } = {}) => {
    const body = typeof ev === "string" ? ev : JSON.stringify(ev)
    const id = o.svixId ?? "msg_test_1"
    const ts = o.ts ?? NOW_S
    const headers: Record<string, string> = { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(ts), "svix-signature": o.signature === undefined ? sign(id, ts, body) : (o.signature ?? "") }
    for (const [k, v] of Object.entries(o.headers ?? {})) { if (v === null) delete headers[k]; else headers[k] = v }
    const method = o.method ?? "POST"
    return routeInbound(new Request("https://x.test/functions/v1/dpdp-inbound-mail", { method, headers, body: method === "POST" ? (o.raw ?? body) : undefined }), deps)
  }
  /** Store an email in the fake Resend, deliver its webhook, return the response. */
  const receive = async (e: Stored, id = EID, evOver: Stored = {}) => {
    resend.put(id, e)
    return deliver(event(id, evOver))
  }
  const job = (body: unknown, bearer: string | null = SECRET) =>
    routeInbound(
      new Request("https://x.test/functions/v1/dpdp-inbound-mail", { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }),
      deps,
    )
  const acks = () => sent.filter((m) => m.headers["X-Veridian-Origin"] === "acknowledgement")
  const notices = () => sent.filter((m) => m.headers["X-Veridian-Origin"] === "inbound-notification")
  return { db, resend, sent, logs, deps, event, sign, deliver, receive, job, acks, notices }
}

const body = async (r: Response) => (await r.json()) as Record<string, unknown>
const inserts = (db: Db) => db.calls.filter((c) => c.fn === "dpdp_mail_insert_inbound").map((c) => c.args)

// ---------------------------------------------------------------------------------------------------------------------
describe("Svix signature (verifySvix, parseWebhookSecret, timingSafeEqual)", () => {
  const key = parseWebhookSecret(WHSEC)!
  const bodyText = '{"type":"email.received"}'
  const good = (id = "msg_1", ts = NOW_S) => `v1,${createHmac("sha256", KEY_BYTES).update(`${id}.${ts}.${bodyText}`).digest("base64")}`
  const check = (o: Partial<Parameters<typeof verifySvix>[0]> = {}) =>
    verifySvix({ key, id: "msg_1", timestamp: String(NOW_S), signature: good(), body: new TextEncoder().encode(bodyText), nowMs: NOW.getTime(), ...o })

  test("a correct signature over id.timestamp.body is accepted", async () => {
    expect(await check()).toEqual({ ok: true })
  })

  test("a wrong signature, a wrong id, a wrong timestamp and a wrong body are each refused", async () => {
    expect(await check({ signature: good().slice(0, -3) + "AAA" })).toEqual({ ok: false, reason: "mismatch" })
    expect(await check({ id: "msg_2" })).toEqual({ ok: false, reason: "mismatch" })
    expect(await check({ timestamp: String(NOW_S + 1), signature: good("msg_1", NOW_S) })).toEqual({ ok: false, reason: "mismatch" })
    expect(await check({ body: new TextEncoder().encode(bodyText + " ") })).toEqual({ ok: false, reason: "mismatch" })
  })

  test("the window is 300 seconds in BOTH directions: the edge passes, one second beyond is stale / future", async () => {
    expect(SVIX_TOLERANCE_SECONDS).toBe(300)
    const at = (ts: number) => check({ timestamp: String(ts), signature: good("msg_1", ts) })
    expect(await at(NOW_S - 300)).toEqual({ ok: true })
    expect(await at(NOW_S + 300)).toEqual({ ok: true })
    expect(await at(NOW_S - 301)).toEqual({ ok: false, reason: "stale-timestamp" })
    expect(await at(NOW_S + 301)).toEqual({ ok: false, reason: "future-timestamp" })
  })

  test("a timestamp that is not a plain number is refused; so are missing headers", async () => {
    for (const ts of ["abc", "1e9", "-5", "", "12.5", "1".repeat(20)]) expect((await check({ timestamp: ts })).ok, ts).toBe(false)
    expect(await check({ id: null })).toEqual({ ok: false, reason: "missing-headers" })
    expect(await check({ timestamp: null })).toEqual({ ok: false, reason: "missing-headers" })
    expect(await check({ signature: null })).toEqual({ ok: false, reason: "missing-headers" })
  })

  test("a list of signatures (secret rotation): any v1 candidate that matches is enough, other versions are ignored", async () => {
    expect(await check({ signature: `v1,${btoa("nonsense")} ${good()}` })).toEqual({ ok: true })
    expect(await check({ signature: `${good()} v1,${btoa("nonsense")}` })).toEqual({ ok: true })
    expect(await check({ signature: good().replace("v1,", "v0,") })).toEqual({ ok: false, reason: "no-v1-signature" })
    expect(await check({ signature: good().replace("v1,", "v1a,") })).toEqual({ ok: false, reason: "no-v1-signature" })
    expect(await check({ signature: `v1,${btoa("a")} v1,${btoa("b")}` })).toEqual({ ok: false, reason: "mismatch" })
  })

  test("the secret must be whsec_ + base64 of at least 16 bytes, otherwise there is no key at all", () => {
    expect(parseWebhookSecret(WHSEC)?.length).toBe(24)
    for (const bad of ["", "   ", undefined, null, "whsec_", "abc", "whsec_!!!not-base64!!!", "whsec_" + btoa("short"), btoa(KEY_BYTES)]) {
      expect(parseWebhookSecret(bad as string | undefined | null), String(bad)).toBeNull()
    }
  })

  test("timingSafeEqual: equal bytes; a different length; one differing byte anywhere", () => {
    const a = Uint8Array.from([1, 2, 3, 4])
    expect(timingSafeEqual(a, Uint8Array.from([1, 2, 3, 4]))).toBe(true)
    expect(timingSafeEqual(a, Uint8Array.from([1, 2, 3]))).toBe(false)
    expect(timingSafeEqual(a, Uint8Array.from([1, 2, 3, 4, 0]))).toBe(false)
    expect(timingSafeEqual(a, Uint8Array.from([0, 2, 3, 4]))).toBe(false)
    expect(timingSafeEqual(a, Uint8Array.from([1, 2, 3, 5]))).toBe(false)
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("the webhook route: authentication, fail-closed configuration, event filtering", () => {
  test("a valid signed email.received is fetched, ticketed and answered 200", async () => {
    const r = rig()
    const res = await r.receive(email({ text: "I want to file a complaint about a grievance I have." }))
    const b = await body(res)
    expect(res.status).toBe(200)
    expect(b.ok).toBe(true)
    expect(b.ticket).toBe("G-2026-0001")
    expect(b.class).toBe("grievance")
    expect(b.source).toBe("resend")
    expect(r.db.inbound).toHaveLength(1)
  })

  test("missing signature headers, a wrong signature and a tampered body are 401 and touch nothing", async () => {
    const r = rig()
    r.resend.put(EID, email())
    const ev = r.event(EID)
    const tries: Array<[string, Response]> = [
      ["no svix headers at all is not even a webhook (falls to the bearer route: 401)", await r.deliver(ev, { headers: { "svix-id": null, "svix-timestamp": null, "svix-signature": null } })],
      ["no signature", await r.deliver(ev, { headers: { "svix-signature": null } })],
      ["no id", await r.deliver(ev, { headers: { "svix-id": null } })],
      ["no timestamp", await r.deliver(ev, { headers: { "svix-timestamp": null } })],
      ["wrong signature", await r.deliver(ev, { signature: "v1," + btoa("x".repeat(32)) })],
      ["empty signature", await r.deliver(ev, { signature: "" })],
      ["tampered body", await r.deliver(ev, { raw: JSON.stringify(ev).replace("email.received", "email.received ") })],
      ["a body re-serialised with different whitespace (the RAW bytes are what is signed)", await r.deliver(ev, { raw: JSON.stringify(ev, null, 1) })],
    ]
    for (const [name, res] of tries) expect(res.status, name).toBe(401)
    expect(r.resend.calls).toHaveLength(0)
    expect(r.db.calls).toHaveLength(0)
    expect(r.sent).toHaveLength(0)
  })

  test("a stale or a future timestamp is 401 even with a valid signature", async () => {
    const r = rig()
    r.resend.put(EID, email())
    expect((await r.deliver(r.event(EID), { ts: NOW_S - 301 })).status).toBe(401)
    expect((await r.deliver(r.event(EID), { ts: NOW_S + 301 })).status).toBe(401)
    expect((await r.deliver(r.event(EID), { ts: NOW_S - 299 })).status).toBe(200)
    expect(r.db.inbound).toHaveLength(1)
  })

  test("a multi-byte body is verified over its bytes, not over a re-encoded string", async () => {
    const r = rig()
    const res = await r.receive(email({ subject: "Shikayat \u0936\u093f\u0915\u093e\u092f\u0924 \u20ac", text: "please delete my data" }), EID, { subject: "\u20ac \u0936\u093f\u0915\u093e\u092f\u0924" })
    expect(res.status).toBe(200)
  })

  test("an unset or malformed DPDP_RESEND_WEBHOOK_SECRET is 503 (fail closed) and does nothing else", async () => {
    for (const bad of ["", "not-a-whsec-secret", "whsec_", "whsec_" + btoa("short")]) {
      const r = rig({ webhookSecret: bad })
      r.resend.put(EID, email())
      const res = await r.deliver(r.event(EID))
      expect(res.status, bad).toBe(503)
      expect(r.resend.calls).toHaveLength(0)
      expect(r.db.calls).toHaveLength(0)
      expect(r.logs.join("\n")).not.toContain(bad.length > 8 ? bad : "@@")
    }
  })

  test("only email.received is acted on: every other event type is answered 200 and ignored", async () => {
    const r = rig()
    r.resend.put(EID, email())
    for (const type of ["email.delivered", "email.bounced", "email.sent", "domain.updated", "email.received.extra", ""]) {
      const res = await r.deliver(r.event(EID, {}, type))
      expect(res.status, type).toBe(200)
      expect((await body(res)).ignored, type).toBe(true)
    }
    expect(r.resend.calls).toHaveLength(0)
    expect(r.db.calls).toHaveLength(0)
  })

  test("a signed event without a usable email_id is 400; an id with path characters is never put in a URL", async () => {
    const r = rig()
    for (const id of ["", "../admin", "a/b", "x?y=1", "a b", "e".repeat(200)]) {
      const res = await r.deliver({ type: "email.received", data: { email_id: id } })
      expect(res.status, id).toBe(400)
    }
    expect((await r.deliver({ type: "email.received", data: {} })).status).toBe(400)
    expect((await r.deliver({ type: "email.received" })).status).toBe(400)
    expect((await r.deliver("not json")).status).toBe(400)
    expect((await r.deliver("[1,2]")).status).toBe(400)
    expect(r.resend.calls).toHaveLength(0)
  })

  test("GET is 405; an oversized body is 413 before anything is verified", async () => {
    const r = rig()
    expect((await r.deliver(r.event(EID), { method: "GET" })).status).toBe(405)
    const big = JSON.stringify({ type: "email.received", data: { email_id: EID, pad: "x".repeat(300_000) } })
    expect((await r.deliver(big)).status).toBe(413)
    expect(r.resend.calls).toHaveLength(0)
  })

  test("no RESEND_API_KEY: the message cannot be fetched, so 503 (Svix retries; Resend keeps the message)", async () => {
    const r = rig({ apiKey: "" })
    r.resend.put(EID, email())
    const res = await r.deliver(r.event(EID))
    expect(res.status).toBe(503)
    expect(r.resend.calls).toHaveLength(0)
    expect(r.db.calls).toHaveLength(0)
  })

  test("the Worker's bearer route is untouched by the Resend routing", async () => {
    const r = rig()
    const res = await routeInbound(
      new Request("https://x.test/f", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({ version: 1, envelope_from: "a@example.org", envelope_to: "dpdp+grv@veridian-aios.com", header_from: "a@example.org", from_address: "a@example.org", subject: "help", message_id: "<w1@example.org>", text: "I have a grievance" }),
      }),
      r.deps,
    )
    expect(res.status).toBe(200)
    expect((await body(res)).class).toBe("grievance")
    expect(r.resend.calls).toHaveLength(0)
    const bad = await routeInbound(new Request("https://x.test/f", { method: "POST", headers: { authorization: "Bearer wrong-wrong-wrong-wrong-wrong" }, body: "{}" }), r.deps)
    expect(bad.status).toBe(401)
    expect((await routeInbound(new Request("https://x.test/f", { method: "GET" }), r.deps)).status).toBe(405)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("fetching the full message from Resend", () => {
  test("GET https://api.resend.com/emails/receiving/{id} with the bearer key, no redirects, a timeout signal", async () => {
    const r = rig()
    await r.receive(email())
    expect(r.resend.calls).toHaveLength(1)
    const c = r.resend.calls[0]
    expect(c.url).toBe(`https://api.resend.com/emails/receiving/${EID}`)
    expect(c.init?.method).toBe("GET")
    expect((c.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`)
    expect(c.init?.redirect).toBe("error")
    expect(c.init?.signal).toBeDefined()
  })

  test("a failed fetch (404, 500, 429), a network error and a non-JSON answer are each 502 with nothing recorded and no mail but the operator alert", async () => {
    for (const make of [
      () => new Response("gone", { status: 404 }),
      () => new Response("boom", { status: 500 }),
      () => new Response("slow down", { status: 429 }),
      () => new Response("<html>not json</html>", { status: 200 }),
    ]) {
      const r = rig()
      r.resend.put(EID, email())
      r.resend.failWith.set(EID, make)
      const res = await r.deliver(r.event(EID))
      expect(res.status).toBe(502)
      expect(r.db.calls).toHaveLength(0)
      // Nothing is recorded and nobody is acknowledged, but the operator is told once (review of 2026-09-30: a failure before the ticket
      // exists must not live only in the Svix log); see "nothing fails only in the Svix log" at the end of this file.
      expect(r.sent.map((m) => m.headers["X-Veridian-Origin"])).toEqual(["inbound-alert"])
      expect(r.deps.seen!.has(EID)).toBe(false)
    }
    const r = rig()
    r.resend.put(EID, email())
    r.resend.failWith.set(EID, () => { throw new TypeError("network down") })
    expect((await r.deliver(r.event(EID))).status).toBe(502)
    expect(r.db.calls).toHaveLength(0)
  })

  test("a hung fetch is aborted at the timeout and answered 502", async () => {
    const r = rig({ timeoutMs: 20 })
    r.resend.put(EID, email())
    r.deps.fetch = ((_url: string, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch
    const started = Date.now()
    const res = await r.deliver(r.event(EID))
    expect(res.status).toBe(502)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(r.db.calls).toHaveLength(0)
  })

  test("a message too large to read is still ticketed, from the webhook's metadata, and the notice says so", async () => {
    const r = rig()
    r.resend.put(EID, email())
    r.resend.failWith.set(EID, () => new Response("x".repeat(MAX_FETCHED_CHARS + 1), { status: 200 }))
    const res = await r.deliver(r.event(EID, { subject: "Please delete my data", from: "Asha M <asha@example.org>" }))
    expect(res.status).toBe(200)
    expect(r.db.inbound).toHaveLength(1)
    expect(r.notices()[0].text).toContain("too large to read here")
    expect(inserts(r.db)[0].p_message_id).toBe(`<resend-${EID}@resend-inbound.invalid>`)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("mapping a received email to the pipeline's payload", () => {
  test("sender, subject, Message-ID, recipient, excerpt and the message's own received time reach the ticket", async () => {
    const r = rig()
    await r.receive(email({ subject: "Complaint about my account", text: "I have a grievance and I want to file a complaint." }))
    const a = inserts(r.db)[0]
    expect(a.p_class).toBe("grievance")
    expect(a.p_from_addr).toBe("asha@example.org")
    expect(a.p_subject).toBe("Complaint about my account")
    expect(a.p_message_id).toBe("<abc123@example.org>")
    expect(a.p_to_addr).toBe(MAILBOX)
    expect(a.p_excerpt).toBe("I have a grievance and I want to file a complaint.")
    expect(a.p_received_at).toBe("2026-09-29T15:30:00.000Z")
    expect(a.p_due_days).toBe(90)
    expect(a.p_wants_ack).toBe(true)
  })

  test("the plus-tag and its ref survive: a reply to dpdp+mon.<ref>@ is looked up by ref and filed as the Monday reply", async () => {
    const r = rig()
    r.db.outbound.push({ ref: REF, class: "monday", ticketNo: null, providerId: null, headerId: null, to: "asha@example.org" })
    const res = await r.receive(email({ to: [`dpdp+mon.${REF}@veridian-aios.com`], received_for: [`dpdp+mon.${REF}@veridian-aios.com`], text: "Thanks, got it." }))
    const b = await body(res)
    expect(b.class).toBe("monday")
    expect(b.rule).toBe("tag")
    expect(r.db.calls.find((c) => c.fn === "dpdp_mail_lookup_outbound")!.args.p_ref).toBe(REF)
    expect(inserts(r.db)[0].p_ref).toBe(REF)
    expect(inserts(r.db)[0].p_matched_outbound_ref).toBe(REF)
  })

  test("In-Reply-To / References from the headers find a message we sent (sales -> sales_chain)", async () => {
    const r = rig()
    r.db.outbound.push({ ref: REF, class: "sales", ticketNo: null, providerId: null, headerId: "sent-1@veridian-aios.com", to: "asha@example.org" })
    const res = await r.receive(email({ text: "Sounds good, let us talk.", headers: { "message-id": "<r1@example.org>", "in-reply-to": "<sent-1@veridian-aios.com>", references: "<x@y> <sent-1@veridian-aios.com>" }, message_id: "<r1@example.org>" }))
    const b = await body(res)
    expect(b.class).toBe("sales_chain")
    expect(b.rule).toBe("thread")
    const lookup = r.db.calls.find((c) => c.fn === "dpdp_mail_lookup_outbound")!
    expect(lookup.args.p_message_ids).toContain("sent-1@veridian-aios.com")
    expect(inserts(r.db)[0].p_in_reply_to).toBe("<sent-1@veridian-aios.com>")
  })

  test("auto-mail headers reach the classifier: a vacation reply is auto, logged and not sent to the operator", async () => {
    const r = rig()
    const res = await r.receive(email({ subject: "Automatic reply: Monday digest", text: "I am away until Monday.", headers: { "message-id": "<oo@example.org>", "auto-submitted": "auto-replied", precedence: "auto_reply" }, message_id: "<oo@example.org>" }))
    const b = await body(res)
    expect(b.class).toBe("auto")
    expect(b.notified).toBe("skipped_auto")
    expect(r.sent).toHaveLength(0)
  })

  test("an empty Return-Path (a bounce) is auto", async () => {
    const r = rig()
    const res = await r.receive(email({ from: "MAILER-DAEMON@example.org", subject: "Undelivered Mail Returned to Sender", text: "delete my data", headers: { "message-id": "<b1@example.org>", "return-path": "<>" }, message_id: "<b1@example.org>" }))
    expect((await body(res)).class).toBe("auto")
    expect(r.acks()).toHaveLength(0)
  })

  test("an HTML-only message is read as text with tags removed", async () => {
    const r = rig()
    await r.receive(email({ text: null, html: "<html><style>p{}</style><body><p>Please <b>delete my data</b>.</p><script>evil()</script></body></html>" }))
    const a = inserts(r.db)[0]
    expect(a.p_class).toBe("data_request")
    expect(a.p_excerpt).toBe("Please delete my data.")
  })

  test("only the first 4096 UTF-8 bytes of the text are kept, never half a character, and the notice says it was cut", async () => {
    const r = rig()
    const text = "Please delete my data. " + "\u20ac".repeat(3000)
    await r.receive(email({ text }))
    const excerpt = String(inserts(r.db)[0].p_excerpt)
    expect(new TextEncoder().encode(excerpt).length).toBeLessThanOrEqual(4096)
    expect(excerpt.includes("\ufffd")).toBe(false)
    expect(text.startsWith(excerpt)).toBe(true)
    expect(excerpt.length).toBeGreaterThan(1000)
    expect(r.notices()[0].text).toContain("Only the first 4096 bytes of the text")
    const short = rig()
    await short.receive(email({ text: "Please delete my data." }))
    expect(short.notices()[0].text).not.toContain("Only the first 4096 bytes")
  })

  test("utf8Prefix cuts at a character boundary for 1-, 2-, 3- and 4-byte characters", () => {
    expect(utf8Prefix("abc", 4096)).toEqual({ text: "abc", cut: false })
    for (const ch of ["a", "\u00e9", "\u20ac", "\u{1F600}"]) {
      const s = ch.repeat(5000)
      const out = utf8Prefix(s, 4096)
      expect(out.cut).toBe(true)
      expect(new TextEncoder().encode(out.text).length).toBeLessThanOrEqual(4096)
      expect(new TextEncoder().encode(out.text).length).toBeGreaterThan(4096 - 4)
      expect(s.startsWith(out.text)).toBe(true)
      expect(out.text.includes("\ufffd")).toBe(false)
    }
    expect(utf8Prefix("\u20ac\u20ac", 4)).toEqual({ text: "\u20ac", cut: true })
    expect(utf8Prefix("\u20ac", 2)).toEqual({ text: "", cut: true })
  })

  test("attachments: named in the operator's notice, kept by Resend, never downloaded", async () => {
    const r = rig()
    await r.receive(email({ text: "See attached, please delete my data.", attachments: [{ id: "a1", filename: "id-proof.pdf", content_type: "application/pdf", content_disposition: "attachment", content_id: null }, { id: "a2", filename: "photo\r\n.png", content_type: "image/png", content_disposition: "attachment", content_id: null }] }))
    const text = r.notices()[0].text
    expect(text).toContain("Attachments (2): id-proof.pdf (application/pdf), photo .png (image/png)")
    expect(text).toContain("Resend keeps them; this system does not download them")
    expect(r.resend.calls.every((c) => c.url.includes("/emails/receiving/"))).toBe(true)
    expect(r.resend.calls).toHaveLength(1)
  })

  test("received_at is the message's own time, also in Postgres form; a future or missing time becomes ours", () => {
    const at = (created: unknown) => (mapReceivedEmail({ emailId: EID, data: { created_at: created }, email: null, now: NOW }).payload.received_at as string)
    expect(at("2026-09-29T15:30:00.000Z")).toBe("2026-09-29T15:30:00.000Z")
    expect(at("2026-09-29 15:30:00.123+00")).toBe("2026-09-29T15:30:00.123Z")
    expect(at("2026-09-29T15:30:00.674981+00:00")).toBe("2026-09-29T15:30:00.674Z")
    expect(at("2027-01-01T00:00:00Z")).toBe(NOW.toISOString())
    expect(at("garbage")).toBe(NOW.toISOString())
    expect(at(undefined)).toBe(NOW.toISOString())
    expect(parseWhen("")).toBeNull()
  })

  test("the display name and the bare address are split; the envelope sender is the Return-Path address when there is one", () => {
    const p = mapReceivedEmail({ emailId: EID, data: {}, email: email({ from: '"Asha, M" <Asha@Example.org>', headers: { "return-path": "<bounce+1@mailer.example.org>", "message-id": "<a@b>" } }), now: NOW }).payload
    expect(p.from_address).toBe("asha@example.org")
    expect(p.from_name).toBe("Asha, M")
    expect(p.envelope_from).toBe("bounce+1@mailer.example.org")
    const plain = mapReceivedEmail({ emailId: EID, data: {}, email: email({ from: "asha@example.org" }), now: NOW }).payload
    expect(plain.from_name).toBeNull()
    expect(plain.envelope_from).toBe("asha@example.org")
    expect(plain.version).toBe(1)
  })

  test("headerMap: lower-cased, first value, one line, list-of-pairs and object forms, no prototype tricks", () => {
    expect(headerMap({ "X-Autoreply": "yes\r\nInjected: 1", Precedence: ["bulk", "junk"], n: 5 })).toEqual({ "x-autoreply": "yes Injected: 1", precedence: "bulk", n: "5" } as Record<string, string>)
    const h = headerMap([{ name: "Auto-Submitted", value: "auto-replied" }, ["Cc", "a@b"], { name: "__proto__", value: "x" }])
    expect(h["auto-submitted"]).toBe("auto-replied")
    expect(h.cc).toBe("a@b")
    expect(Object.getPrototypeOf(h)).toBeNull()
    expect(headerMap(null)).toEqual({} as Record<string, string>)
  })

  test("a message without a Message-ID gets a stable synthetic one, so it is deduplicated too", async () => {
    const r = rig()
    const noId = email({ message_id: null, headers: { "content-type": "text/plain" } })
    await r.receive(noId)
    const r2 = rig({ db: r.db, resend: r.resend })
    const res = await r2.deliver(r2.event(EID)) // a fresh isolate (own seen cache), the same database
    expect((await body(res)).duplicate).toBe(true)
    expect(r.db.inbound).toHaveLength(1)
    expect(inserts(r.db)[0].p_message_id).toBe(`<resend-${EID}@resend-inbound.invalid>`)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("recipient policy: Resend accepts every address at the domain", () => {
  test("chooseRecipient: dpdp / dpdp+tag, then aliases, then postmaster / abuse, then unknown, then other domains; ties keep order", () => {
    const pick = (...c: string[]) => chooseRecipient(c)
    expect(pick("info@veridian-aios.com", "grievance@veridian-aios.com", "dpdp+dsr.k3f9x2ab7q@veridian-aios.com").kind).toBe("mailbox")
    expect(pick("info@veridian-aios.com", "grievance@veridian-aios.com", "dpdp+dsr.k3f9x2ab7q@veridian-aios.com").address).toBe("dpdp+dsr.k3f9x2ab7q@veridian-aios.com")
    expect(pick("dpdp@veridian-aios.com", "dpdp+grv@veridian-aios.com").address).toBe("dpdp+grv@veridian-aios.com") // a class tag beats the bare mailbox
    expect(pick("dpdp+aut@veridian-aios.com", "dpdp+dsr@veridian-aios.com").address).toBe("dpdp+dsr@veridian-aios.com") // an `aut` tag names nothing, so a real class tag beats it
    expect(pick("postmaster@veridian-aios.com", "grievance@veridian-aios.com").kind).toBe("alias")
    expect(pick("partners@veridian-aios.com", "abuse@veridian-aios.com").address).toBe("dpdp+prt@veridian-aios.com")
    expect(pick("info@veridian-aios.com", "abuse@veridian-aios.com").kind).toBe("role")
    expect(pick("info@veridian-aios.com", "someone@other.example").kind).toBe("unknown")
    expect(pick("someone@other.example", "info@veridian-aios.com").address).toBe("info@veridian-aios.com")
    expect(pick("someone@other.example").kind).toBe("foreign")
    expect(pick("a@veridian-aios.com", "b@veridian-aios.com").address).toBe("a@veridian-aios.com")
    expect(pick().kind).toBe("none")
    expect(pick("dpdp@veridian-aios.com").policy).toBeNull()
    expect(pick("dpdp+rev.k3f9x2ab7q@veridian-aios.com", "dpdp+dsr.k3f9x2ab7q@veridian-aios.com").address).toBe("dpdp+rev.k3f9x2ab7q@veridian-aios.com")
    // near misses are not the mailbox, the aliases or the roles
    expect(pick("dpdp@send.veridian-aios.com").kind).toBe("foreign")
    expect(pick("postmaster+x@veridian-aios.com").kind).toBe("unknown")
    expect(pick("grievances@veridian-aios.com").kind).toBe("unknown")
    expect(pick("dpdp2@veridian-aios.com").kind).toBe("unknown")
  })

  test("extractAddresses: names, lists, case, duplicates", () => {
    expect(extractAddresses(["Asha <Asha@Example.org>", "b@c.example, d@e.example", 5, "asha@example.org"])).toEqual(["asha@example.org", "b@c.example", "d@e.example"])
    expect(extractAddresses("x")).toEqual([])
    expect(extractAddresses(undefined)).toEqual([])
  })

  test("dpdp@ and dpdp+tag@ go through the normal pipeline, with no policy", async () => {
    const r = rig()
    const res = await r.receive(email({ received_for: ["dpdp+grv.k3f9x2ab7q@veridian-aios.com"], to: ["dpdp+grv.k3f9x2ab7q@veridian-aios.com"], text: "Hello." }))
    const b = await body(res)
    expect(b.class).toBe("grievance")
    expect(b.rule).toBe("tag")
    expect(b.recipient).toBe("mailbox")
    expect(r.acks()).toHaveLength(1)
  })

  test("grievance@ is treated as the tag grv (a grievance, acknowledged) and partners@ as prt (a partner enquiry)", async () => {
    const g = rig()
    const gb = await body(await g.receive(email({ to: ["grievance@veridian-aios.com"], received_for: ["grievance@veridian-aios.com"], text: "Hello." })))
    expect(gb.class).toBe("grievance")
    expect(gb.rule).toBe("tag")
    expect(inserts(g.db)[0].p_to_addr).toBe("dpdp+grv@veridian-aios.com")
    expect(g.acks()).toHaveLength(1)

    const p = rig()
    const pb = await body(await p.receive(email({ to: ["Partners <partners@veridian-aios.com>"], received_for: ["partners@veridian-aios.com"], text: "Hello." })))
    expect(pb.class).toBe("partner")
    expect(pb.rule).toBe("tag")
    expect(p.acks()).toHaveLength(0)
    expect(p.notices()).toHaveLength(0) // a partner enquiry is recorded for the daily digest, no per-message email
    expect(pb.notified).toBe("digest")
  })

  test("among several recipients the best one decides: a message to info@ AND grievance@ is a grievance; to info@ AND dpdp@ is normal", async () => {
    const r = rig()
    const b1 = await body(await r.receive(email({ to: ["info@veridian-aios.com", "grievance@veridian-aios.com"], received_for: ["info@veridian-aios.com"], text: "Hello." })))
    expect(b1.class).toBe("grievance")
    const r2 = rig()
    const b2 = await body(await r2.receive(email({ to: ["info@veridian-aios.com"], cc: ["dpdp@veridian-aios.com"], received_for: ["info@veridian-aios.com"], text: "Hello there." })))
    expect(b2.recipient).toBe("mailbox")
    expect(b2.class).toBe("review") // the default: nothing matched, and nothing is dropped
  })

  test("postmaster@ and abuse@ are support: left for the daily digest (no per-message email), the sender is NEVER acknowledged", async () => {
    for (const role of ["postmaster", "abuse"]) {
      const r = rig()
      const res = await r.receive(email({ to: [`${role}@veridian-aios.com`], received_for: [`${role}@veridian-aios.com`], text: "Hello, this is a report." }))
      const b = await body(res)
      expect(b.class, role).toBe("support")
      expect(b.notified, role).toBe("digest")
      expect(r.notices(), role).toHaveLength(0)
      expect(r.acks(), role).toHaveLength(0)
      expect(String(inserts(r.db)[0].p_classifier_reason)).toContain(`role-mailbox:${role}`)
    }
  })

  test("a data request sent to abuse@ keeps its legal class, ticket and due date, and is still not acknowledged", async () => {
    const r = rig()
    const b = await body(await r.receive(email({ to: ["abuse@veridian-aios.com"], received_for: ["abuse@veridian-aios.com"], text: "Please delete my data." })))
    expect(b.class).toBe("data_request")
    expect(inserts(r.db)[0].p_due_days).toBe(90)
    expect(inserts(r.db)[0].p_wants_ack).toBe(false)
    expect(r.acks()).toHaveLength(0)
    expect(r.notices()).toHaveLength(1)
    expect(r.notices()[0].text).toContain("Acknowledgement: NOT sent -- no acknowledgement for this address")
  })

  test("any other address at the domain is `auto`, reason unknown-recipient, logged only: no notice, no acknowledgement", async () => {
    for (const to of ["info@veridian-aios.com", "sales@veridian-aios.com", "postmaster+x@veridian-aios.com", "dpdp2@veridian-aios.com"]) {
      const r = rig()
      const res = await r.receive(email({ to: [to], received_for: [to], text: "Hello, we offer SEO services for your website." }))
      const b = await body(res)
      expect(res.status, to).toBe(200)
      expect(b.class, to).toBe("auto")
      expect(b.notified, to).toBe("skipped_auto")
      expect(b.ticket, to).toMatch(/^A-2026-\d{4}$/)
      expect(r.sent, to).toHaveLength(0)
      expect(String(inserts(r.db)[0].p_classifier_reason), to).toContain("unknown-recipient")
      expect(inserts(r.db)[0].p_to_addr, to).toBe(to)
    }
  })

  test("but a data request or a grievance in the sender's own words to an unknown address keeps its legal class: ticket, clock, operator told", async () => {
    for (const [text, cls] of [["Please delete my data.", "data_request"], ["I have a grievance and I want to file a complaint.", "grievance"]] as const) {
      const r = rig()
      const b = await body(await r.receive(email({ to: ["privacy@veridian-aios.com"], received_for: ["privacy@veridian-aios.com"], text })))
      expect(b.class, text).toBe(cls)
      expect(b.notified, text).toBe("sent")
      expect(inserts(r.db)[0].p_due_days, text).toBe(90)
      expect(String(inserts(r.db)[0].p_classifier_reason), text).toContain("unknown-recipient")
      expect(r.acks(), text).toHaveLength(1) // a legal request is acknowledged like any other (the usual guards still apply)
    }
  })

  test("bulk mail to a guessed address is not a request: with auto-mail headers it stays auto even if it says unsubscribe", async () => {
    const r = rig()
    const b = await body(await r.receive(email({ to: ["info@veridian-aios.com"], received_for: ["info@veridian-aios.com"], text: "Big sale! To unsubscribe, click here.", headers: { "message-id": "<spam@example.org>", precedence: "bulk" }, message_id: "<spam@example.org>" })))
    expect(b.class).toBe("auto")
    expect(r.sent).toHaveLength(0)
  })

  test("an address at another domain (the Resend account may receive for more than one) is auto, logged, never acknowledged", async () => {
    const r = rig()
    const b = await body(await r.receive(email({ to: ["hello@other-domain.example"], received_for: ["hello@other-domain.example"], text: "Please delete my data." })))
    expect(b.class).toBe("auto")
    expect(r.sent).toHaveLength(0)
    expect(String(inserts(r.db)[0].p_classifier_reason)).toContain("recipient-not-on-our-domain")
  })

  test("a message with no recipient information at all goes through the normal pipeline (review: never demoted)", async () => {
    const r = rig()
    const b = await body(await r.receive(email({ to: [], received_for: [], text: "Hello there." })))
    expect(b.class).toBe("review")
    expect(b.notified).toBe("digest") // review is acknowledged but surfaces in the daily digest
  })

  test("if the classifier throws, an unknown address is NOT demoted: it stays review and the operator is told", async () => {
    const r = rig({ classify: () => { throw new Error("boom") } })
    const b = await body(await r.receive(email({ to: ["info@veridian-aios.com"], received_for: ["info@veridian-aios.com"], text: "Hello." })))
    expect(b.class).toBe("review")
    expect(b.notified).toBe("sent")
    expect(r.notices()).toHaveLength(1)
  })

  test("applyPolicy: never overrides the self loop guard; only demotes what it is told to", () => {
    // built from a real classification, then pinned to the fields this test reads: Classification may grow fields, and applyPolicy spreads whatever it is given
    const base: Classification = { ...classify({ recipients: [MAILBOX], senders: ["x@example.org"], subject: "", text: "", headers: {} }), cls: "review", rule: "default", confidence: "low", reason: "default:none", tagRef: null, autoSignals: [], strongAuto: false, escalatedFrom: null }
    expect(applyPolicy(base, undefined)).toBe(base)
    expect(applyPolicy(base, { noAck: true })).toBe(base)
    expect(applyPolicy({ ...base, cls: "auto", rule: "self" }, { forceClass: "support" }).cls).toBe("auto")
    expect(applyPolicy(base, { forceClass: "auto", reason: "unknown-recipient" }).cls).toBe("auto")
    expect(applyPolicy({ ...base, cls: "data_request", rule: "keyword" }, { forceClass: "auto", unlessLegal: true, reason: "x" }).cls).toBe("data_request")
    expect(applyPolicy({ ...base, cls: "data_request", rule: "keyword" }, { forceClass: "auto", reason: "x" }).cls).toBe("auto")
    expect(applyPolicy({ ...base, cls: "data_request", rule: "keyword", autoSignals: ["Precedence=bulk"] }, { forceClass: "auto", unlessLegal: true }).cls).toBe("auto")
    expect(applyPolicy({ ...base, cls: "review" }, { forceClass: "auto", unlessLegal: true }).cls).toBe("auto") // review is a default, not a finding
  })

  test("withNoticeLines puts the lines under the first line and leaves the rest alone", () => {
    expect(withNoticeLines("first\n\nsecond\nthird", ["a", "b"])).toBe("first\n\na\nb\n\nsecond\nthird")
    expect(withNoticeLines("only", ["a"])).toBe("only\n\na")
    expect(withNoticeLines("x\n\ny", undefined)).toBe("x\n\ny")
    expect(withNoticeLines("x\n\ny", [])).toBe("x\n\ny")
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("authentication: the verdicts are Resend's, and a failed one is never acknowledged", () => {
  const grievance = { text: "I have a grievance and I want to file a complaint." }

  test("DMARC fail: ticketed and the operator told, but NO acknowledgement; the notice says why, with the verdicts and the Resend id", async () => {
    const r = rig()
    const res = await r.receive(email({ ...grievance, authentication: { spf: "pass", dkim: "fail", dmarc: "fail" } }))
    const b = await body(res)
    expect(res.status).toBe(200)
    expect(b.class).toBe("grievance")
    expect(b.ack).toBe("skipped")
    expect(r.acks()).toHaveLength(0)
    expect(r.notices()).toHaveLength(1)
    const t = r.notices()[0].text
    expect(t).toContain("Acknowledgement: NOT sent -- the sender failed DMARC")
    expect(t).toContain(`Resend received-email id: ${EID}`)
    expect(t).toContain("SPF pass, DKIM fail, DMARC fail")
    expect(t).toContain("GET /emails/receiving/<id>")
    expect(inserts(r.db)[0].p_wants_ack).toBe(false)
  })

  test("SPF and DKIM both failing counts as a DMARC failure even when Resend gives DMARC no verdict", async () => {
    for (const dmarc of ["gray", "unknown", "processing_failed"]) {
      const r = rig()
      await r.receive(email({ ...grievance, authentication: { spf: "fail", dkim: "fail", dmarc } }))
      expect(r.acks(), dmarc).toHaveLength(0)
      expect(r.notices(), dmarc).toHaveLength(1)
    }
  })

  test("one failing mechanism, or no verdict, does not block the acknowledgement (only a failure of DMARC, or of both, does)", async () => {
    for (const authentication of [
      { spf: "fail", dkim: "pass", dmarc: "pass" },
      { spf: "pass", dkim: "fail", dmarc: "pass" },
      { spf: "gray", dkim: "gray", dmarc: "gray" },
      { spf: "processing_failed", dkim: "unknown", dmarc: "unknown" },
      undefined,
    ]) {
      const r = rig()
      await r.receive(email({ ...grievance, authentication }))
      expect(r.acks(), JSON.stringify(authentication)).toHaveLength(1)
    }
  })

  test("the verdicts come from Resend, not from a header the sender wrote", async () => {
    const forgedFail = rig()
    await forgedFail.receive(email({ ...grievance, headers: { "message-id": "<abc123@example.org>", "authentication-results": "mx.example; dmarc=fail" } }))
    expect(forgedFail.acks()).toHaveLength(1) // Resend says pass; the sender's own header is not read
    const forgedPass = rig()
    await forgedPass.receive(email({ ...grievance, authentication: { spf: "pass", dkim: "fail", dmarc: "fail" }, headers: { "message-id": "<abc123@example.org>", "authentication-results": "mx.example; dmarc=pass" } }))
    expect(forgedPass.acks()).toHaveLength(0) // Resend says fail; a forged pass does not help
    const noVerdicts = rig()
    await noVerdicts.receive(email({ ...grievance, authentication: undefined, headers: { "message-id": "<abc123@example.org>", "authentication-results": "mx.example; dmarc=fail" } }))
    expect(noVerdicts.acks()).toHaveLength(1) // no verdicts from Resend: the sender's own header is still not read
  })

  test("authenticationResults: fixed words only, dmarc=fail exactly when it should be", () => {
    expect(authenticationResults({ spf: "pass", dkim: "pass", dmarc: "pass" })).toBe("resend; spf=pass; dkim=pass; dmarc=pass")
    expect(/\bdmarc=fail\b/.test(authenticationResults({ spf: "pass", dkim: "pass", dmarc: "fail" }))).toBe(true)
    expect(/\bdmarc=fail\b/.test(authenticationResults({ spf: "fail", dkim: "fail", dmarc: "gray" }))).toBe(true)
    expect(/\bdmarc=fail\b/.test(authenticationResults({ spf: "fail", dkim: "pass", dmarc: "gray" }))).toBe(false)
    expect(/\bdmarc=fail\b/.test(authenticationResults({ spf: "pass", dkim: "pass", dmarc: "pass" }))).toBe(false)
    const odd = mapReceivedEmail({ emailId: EID, data: {}, email: email({ authentication: { spf: "pass; dmarc=fail", dkim: 5, dmarc: "PASS" } }), now: NOW })
    expect((odd.payload.headers as Record<string, string>)["authentication-results"]).toBe("resend; spf=unknown; dkim=unknown; dmarc=pass") // unknown words never reach the header
  })

  test("every Resend-sourced notice states the verdicts and the Resend id, also for a class that is not acknowledged", async () => {
    const r = rig()
    await r.receive(email({ to: ["abuse@veridian-aios.com"], received_for: ["abuse@veridian-aios.com"], text: "Please delete my data.", authentication: { spf: "pass", dkim: "pass", dmarc: "pass" } }))
    const t = r.notices()[0].text
    expect(t.split("\n")[0]).toBe(`A message reached ${MAILBOX}.`)
    expect(t).toContain(`Resend received-email id: ${EID}`)
    expect(t).toContain("Authentication as reported by Resend: SPF pass, DKIM pass, DMARC pass")
    const none = rig()
    await none.receive(email({ authentication: undefined, text: "I have a complaint about my account." }))
    expect(none.notices()[0].text).toContain("Resend reported no SPF / DKIM / DMARC verdicts")
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("2xx only after the ticket exists; a retry is harmless", () => {
  const legal = { text: "I have a grievance and I want to file a complaint." }

  test("the ticket row exists by the time the 200 is returned", async () => {
    const r = rig()
    r.resend.put(EID, email(legal))
    const res = await r.deliver(r.event(EID))
    expect(res.status).toBe(200)
    expect(r.db.inbound).toHaveLength(1)
    expect(r.db.inbound[0].ticketNo).toBe((await body(res)).ticket as string)
  })

  test("the database is down: 502 (never 2xx), the operator is sent the raw message; when it is back the retry records it once", async () => {
    const r = rig()
    r.db.failRpc.dpdp_mail_insert_inbound = new Error("connection refused")
    r.resend.put(EID, email(legal))
    const first = await r.deliver(r.event(EID))
    expect(first.status).toBe(502)
    expect((await body(first)).ok).toBe(false)
    expect(r.db.inbound).toHaveLength(0)
    expect(r.deps.seen!.has(EID)).toBe(false)
    expect(r.notices().length + r.sent.filter((m) => m.subject.includes("UNRECORDED")).length).toBeGreaterThan(0) // not lost while waiting
    r.db.failRpc.dpdp_mail_insert_inbound = undefined
    const retry = await r.deliver(r.event(EID), { svixId: "msg_test_2" })
    expect(retry.status).toBe(200)
    expect(r.db.inbound).toHaveLength(1)
    expect(r.acks()).toHaveLength(1)
  })

  test("the operator cannot be told: 502, the ticket and the acknowledgement stand; the retry sends the notice, not a second acknowledgement", async () => {
    let failNotices = true
    const r = rig({ failSend: (m) => failNotices && m.headers["X-Veridian-Origin"] === "inbound-notification" })
    r.resend.put(EID, email(legal))
    const first = await r.deliver(r.event(EID))
    expect(first.status).toBe(502)
    expect(r.db.inbound).toHaveLength(1)
    expect(r.acks()).toHaveLength(1)
    failNotices = false
    const retry = await r.deliver(r.event(EID), { svixId: "msg_test_2" })
    expect(retry.status).toBe(200)
    expect(r.db.inbound).toHaveLength(1)
    expect(r.acks()).toHaveLength(1)
    expect(r.notices()).toHaveLength(1)
  })

  test("the acknowledgement cannot be sent: 502 so Svix retries; the retry sends it (once) and does not tell the operator a second time", async () => {
    let failAcks = true
    const r = rig({ failSend: (m) => failAcks && m.headers["X-Veridian-Origin"] === "acknowledgement" })
    r.resend.put(EID, email(legal))
    const first = await r.deliver(r.event(EID))
    expect(first.status).toBe(502)
    expect((await body(first)).error).toContain("acknowledgement could not be sent")
    expect(r.db.inbound).toHaveLength(1)
    expect(r.notices()).toHaveLength(1)
    expect(r.notices()[0].text).toContain("Acknowledgement: FAILED")
    expect(r.acks()).toHaveLength(0)
    expect(r.deps.seen!.has(EID)).toBe(false)
    failAcks = false
    const retry = await r.deliver(r.event(EID), { svixId: "msg_test_2" })
    expect(retry.status).toBe(200)
    expect(r.db.inbound).toHaveLength(1)
    expect(r.acks()).toHaveLength(1)
    expect(r.notices()).toHaveLength(1)
  })

  test("the same delivery twice (a fresh isolate each time, same database): one ticket, one acknowledgement, one notice", async () => {
    const db = makeDb()
    const resend = makeResend()
    const first = rig({ db, resend })
    const second = rig({ db, resend })
    await first.receive(email(legal))
    const res = await second.deliver(second.event(EID), { svixId: "msg_test_1" })
    const b = await body(res)
    expect(res.status).toBe(200)
    expect(b.duplicate).toBe(true)
    expect(b.notified).toBe("already")
    expect(db.inbound).toHaveLength(1)
    expect(first.acks().length + second.acks().length).toBe(1)
    expect(first.notices().length + second.notices().length).toBe(1)
  })

  test("a recorded email id is remembered: the retry does not even fetch it again", async () => {
    const r = rig()
    await r.receive(email(legal))
    expect(r.resend.calls).toHaveLength(1)
    const again = await r.deliver(r.event(EID), { svixId: "msg_test_9" })
    expect(again.status).toBe(200)
    expect((await body(again)).cached).toBe(true)
    expect(r.resend.calls).toHaveLength(1)
    expect(r.db.inbound).toHaveLength(1)
  })

  test("a failure is never remembered: the retry fetches again", async () => {
    const r = rig()
    r.resend.put(EID, email(legal))
    r.resend.failWith.set(EID, () => new Response("boom", { status: 500 }))
    expect((await r.deliver(r.event(EID))).status).toBe(502)
    r.resend.failWith.delete(EID)
    expect((await r.deliver(r.event(EID), { svixId: "msg_test_2" })).status).toBe(200)
    expect(r.resend.calls).toHaveLength(2)
  })

  test("the acknowledgement and the notice carry Idempotency-Keys that do not change between deliveries", async () => {
    const db = makeDb()
    const resend = makeResend()
    const a = rig({ db, resend, failSend: (m) => m.headers["X-Veridian-Origin"] === "inbound-notification" })
    resend.put(EID, email(legal))
    await a.deliver(a.event(EID))
    const b = rig({ db, resend })
    await b.deliver(b.event(EID), { svixId: "msg_test_2" })
    expect(a.acks()[0].idempotencyKey).toBe("dpdp-inbound-ack-G-2026-0001")
    expect(b.notices()[0].idempotencyKey).toBe("dpdp-inbound-notify-G-2026-0001")
  })

  test("two different emails from the same sender are two tickets", async () => {
    const r = rig()
    await r.receive(email({ ...legal, message_id: "<m1@example.org>" }), "e1")
    await r.receive(email({ ...legal, message_id: "<m2@example.org>" }), "e2")
    expect(r.db.inbound).toHaveLength(2)
  })

  test("no log line carries an address, a subject, a text, the secret or the key", async () => {
    const r = rig()
    await r.receive(email({ subject: "Very Private Subject", text: "Please delete my data. Very Private Text" }))
    const all = r.logs.join("\n")
    for (const secret of ["asha@example.org", "Very Private", WHSEC, SECRET, API_KEY, KEY_BYTES]) expect(all).not.toContain(secret)
    expect(all).toContain(EID)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("loop safety: nothing we send can make us send again", () => {
  test("mail from our own mailbox (also a dpdp+tag@ sender) is auto and never acknowledged, whatever it says", async () => {
    for (const from of ["VERIDIAN AI DPDP <dpdp@veridian-aios.com>", "dpdp@veridian-aios.com", `dpdp+grv.${REF}@veridian-aios.com`]) {
      const r = rig()
      const b = await body(await r.receive(email({ from, text: "I have a grievance. Please delete my data." })))
      expect(b.class, from).toBe("auto")
      expect(r.acks(), from).toHaveLength(0)
      expect(r.sent, from).toHaveLength(0)
    }
  })

  test("the acknowledgement we send is stamped so a compliant responder will not answer it, and it is logged as ours", async () => {
    const r = rig()
    await r.receive(email({ text: "I have a grievance and I want to file a complaint." }))
    const ack = r.acks()[0]
    expect(ack.headers["Auto-Submitted"]).toBe("auto-replied")
    expect(ack.headers["X-Auto-Response-Suppress"]).toBe("All")
    expect(ack.headers["X-Veridian-Origin"]).toBe("acknowledgement")
    expect(ack.to).toBe("asha@example.org")
    expect(ack.text).not.toContain("complaint")
    expect(r.db.outbound.some((o) => o.ticketNo === "G-2026-0001")).toBe(true)
  })

  test("an auto-responder answering our acknowledgement (it carries X-Veridian-* and auto headers) is auto and is not acknowledged", async () => {
    const r = rig()
    r.db.outbound.push({ ref: REF, class: "grievance", ticketNo: "G-2026-0007", providerId: null, headerId: null, to: "asha@example.org" })
    const b = await body(await r.receive(email({
      to: [`dpdp+grv.${REF}@veridian-aios.com`], received_for: [`dpdp+grv.${REF}@veridian-aios.com`],
      from: "auto@example.org", subject: "Re: [VERIDIAN DPDP] We received your message (ticket G-2026-0007)", text: "This is an automatic reply.",
      headers: { "message-id": "<oo2@example.org>", "auto-submitted": "auto-replied", "x-veridian-origin": "acknowledgement", "x-veridian-class": "grievance", "x-veridian-ref": REF },
      message_id: "<oo2@example.org>",
    })))
    expect(b.class).toBe("auto")
    expect(r.acks()).toHaveLength(0)
    expect(r.notices()).toHaveLength(0)
  })

  test("even with legal words in it, a header-flagged reply to our own acknowledgement is ticketed and reported but NOT acknowledged again", async () => {
    const r = rig()
    r.db.outbound.push({ ref: REF, class: "grievance", ticketNo: "G-2026-0007", providerId: null, headerId: null, to: "asha@example.org" })
    const b = await body(await r.receive(email({
      to: [`dpdp+grv.${REF}@veridian-aios.com`], received_for: [`dpdp+grv.${REF}@veridian-aios.com`],
      from: "auto@example.org", subject: "Automatic reply", text: "Please delete my data. I want to complain.",
      headers: { "message-id": "<oo3@example.org>", "auto-submitted": "auto-replied", "x-veridian-origin": "acknowledgement" },
      message_id: "<oo3@example.org>",
    })))
    expect(b.class === "data_request" || b.class === "grievance").toBe(true)
    expect(r.acks()).toHaveLength(0)
    expect(r.notices()).toHaveLength(1)
    expect(r.notices()[0].text).toContain("automatic reply to our own acknowledgement of ticket G-2026-0007")
  })

  test("a no-reply sender is never acknowledged", async () => {
    const r = rig()
    await r.receive(email({ from: "no-reply@example.org", text: "I have a grievance and I want to file a complaint." }))
    expect(r.acks()).toHaveLength(0)
    expect(r.notices()).toHaveLength(1)
  })

  test("the operator's notice is stamped auto-generated and is never sent to the mailbox itself", async () => {
    const r = rig()
    await r.receive(email({ text: "Please delete my data." }))
    const n = r.notices()[0]
    expect(n.headers["Auto-Submitted"]).toBe("auto-generated")
    expect(n.to).toBe(OPERATOR)
    expect(n.to).not.toBe(MAILBOX)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe("the reconcile job (bearer-protected; Svix retries are the primary path)", () => {
  const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
  const fill = (r: ReturnType<typeof rig>) => {
    r.resend.put("e1", email({ created_at: ago(1), message_id: "<m1@example.org>", text: "I have a grievance and I want to file a complaint." }))
    r.resend.put("e2", email({ created_at: ago(5), message_id: "<m2@example.org>", from: "ravi@example.org", text: "Please delete my data." }))
    r.resend.put("e3", email({ created_at: ago(72), message_id: "<m3@example.org>", from: "old@example.org", text: "Please delete my data." }))
    r.resend.put("e4", email({ created_at: ago(300), message_id: "<m4@example.org>", from: "older@example.org", text: "Please delete my data." }))
  }

  test("it needs the bearer: none, wrong and unconfigured are 401 / 401 / 503, and nothing is listed", async () => {
    const r = rig()
    fill(r)
    expect((await r.job({ job: "reconcile" }, null)).status).toBe(401)
    expect((await r.job({ job: "reconcile" }, "wrong-wrong-wrong-wrong-wrong-wrong")).status).toBe(401)
    expect(r.resend.calls).toHaveLength(0)
    const noSecret = rig({ config: { secret: "" } })
    expect((await noSecret.job({ job: "reconcile" })).status).toBe(503)
    expect(noSecret.resend.calls).toHaveLength(0)
    const noKey = rig({ apiKey: "" })
    expect((await noKey.job({ job: "reconcile" })).status).toBe(503)
  })

  test("the arguments are checked: unknown job, hours, limit", async () => {
    const r = rig()
    expect((await r.job({ job: "explode" })).status).toBe(400)
    for (const hours of [0, -1, 1.5, "48", null, RECONCILE_MAX_HOURS + 1]) expect((await r.job({ job: "reconcile", hours })).status, String(hours)).toBe(400)
    for (const limit of [0, 1.5, "5", 201]) expect((await r.job({ job: "reconcile", limit })).status, String(limit)).toBe(400)
    expect(r.resend.calls).toHaveLength(0)
  })

  test("it lists the window, ingests what the database does not have, and skips what is older than the window", async () => {
    const r = rig()
    fill(r)
    const res = await r.job({ job: "reconcile", hours: 48 })
    const b = await body(res)
    expect(res.status).toBe(200)
    expect(b).toMatchObject({ ok: true, job: "reconcile", hours: 48, listed: 2, ingested: 2, duplicates: 0, failed: 0, partial: false })
    expect(r.db.inbound.map((x) => x.from).sort()).toEqual(["asha@example.org", "ravi@example.org"])
    expect(r.resend.calls[0].url).toBe("https://api.resend.com/emails/receiving?limit=100")
    expect(r.resend.calls[0].init?.redirect).toBe("error")
    const wide = rig({ db: r.db, resend: r.resend })
    const b2 = await body(await wide.job({ job: "reconcile", hours: 168 }))
    expect(b2).toMatchObject({ listed: 3, ingested: 1, duplicates: 2 }) // e3 is new (72 h ago), e4 (300 h) is outside
  })

  test("the legal clock starts at the message's real time, not at the time of the repair", async () => {
    const r = rig()
    fill(r)
    await r.job({ job: "reconcile", hours: 168 })
    const e3 = inserts(r.db).find((a) => a.p_from_addr === "old@example.org")!
    expect(e3.p_received_at).toBe(ago(72))
    expect(e3.p_due_days).toBe(90)
  })

  test("it is idempotent: a second run (even in a fresh isolate) creates no ticket, no acknowledgement, no notice", async () => {
    const r = rig()
    fill(r)
    await r.job({ job: "reconcile", hours: 48 })
    const acks = r.acks().length
    const notices = r.notices().length
    expect(acks).toBe(2)
    expect(notices).toBe(2)
    const again = rig({ db: r.db, resend: r.resend })
    const b = await body(await again.job({ job: "reconcile", hours: 48 }))
    expect(b).toMatchObject({ listed: 2, ingested: 0, duplicates: 2, failed: 0 })
    expect(again.sent).toHaveLength(0)
    expect(r.db.inbound).toHaveLength(2)
  })

  test("it repairs a message the webhook never delivered, and does not touch one the webhook already handled", async () => {
    const r = rig()
    fill(r)
    await r.deliver(r.event("e1")) // the webhook handled e1 only
    expect(r.db.inbound).toHaveLength(1)
    const b = await body(await r.job({ job: "reconcile", hours: 48 }))
    expect(b).toMatchObject({ listed: 2, ingested: 1, duplicates: 1 })
    expect(r.db.inbound).toHaveLength(2)
    expect(r.acks()).toHaveLength(2)
    // the webhook and the reconcile job derive the same dedup key for the same email
    const fresh = rig({ db: r.db, resend: r.resend })
    const b2 = await body(await fresh.job({ job: "reconcile", hours: 48 }))
    expect(b2).toMatchObject({ ingested: 0, duplicates: 2 })
    expect(r.db.inbound).toHaveLength(2)
  })

  test("it follows the listing's pages (has_more / after)", async () => {
    const r = rig({ resend: makeResend(1) })
    fill(r)
    const b = await body(await r.job({ job: "reconcile", hours: 168 }))
    expect(b).toMatchObject({ listed: 3, ingested: 3 })
    const urls = r.resend.calls.filter((c) => !c.url.includes("/emails/receiving/")).map((c) => c.url)
    expect(urls[0]).toBe("https://api.resend.com/emails/receiving?limit=100")
    expect(urls[1]).toBe("https://api.resend.com/emails/receiving?limit=100&after=e1")
    expect(urls.length).toBeGreaterThanOrEqual(3)
  })

  test("`limit` caps one run and says it stopped early", async () => {
    const r = rig()
    fill(r)
    const b = await body(await r.job({ job: "reconcile", hours: 168, limit: 2 }))
    expect(b).toMatchObject({ listed: 2, ingested: 2, partial: true })
    const b2 = await body(await r.job({ job: "reconcile", hours: 168, limit: 2 }))
    expect(b2.partial).toBe(true)
  })

  test("one email that cannot be fetched is reported by id and the others are still ingested; the answer is 502 so a cron notices", async () => {
    const r = rig()
    fill(r)
    r.resend.failWith.set("e1", () => new Response("boom", { status: 500 }))
    const res = await r.job({ job: "reconcile", hours: 48 })
    const b = (await body(res)) as { ok: boolean; failed: number; ingested: number; failures: Array<{ emailId: string; status: number }> }
    expect(res.status).toBe(502)
    expect(b.ok).toBe(false)
    expect(b.failed).toBe(1)
    expect(b.ingested).toBe(1)
    expect(b.failures[0]).toMatchObject({ emailId: "e1", status: 502 })
    expect(JSON.stringify(b)).not.toContain("example.org")
  })

  test("a failing listing (429 or 500) is a failed run, not a silent empty one", async () => {
    for (const status of [429, 500]) {
      const r = rig()
      fill(r)
      r.resend.failWith.set("(list)", () => new Response("no", { status }))
      const res = await r.job({ job: "reconcile", hours: 48 })
      const b = await body(res)
      expect(res.status, String(status)).toBe(502)
      expect(b.ok).toBe(false)
      expect(b.rateLimited).toBe(status === 429)
      expect(r.db.inbound).toHaveLength(0)
    }
  })

  test("reconcile() called directly returns the same shape (the operator can also call it from a script)", async () => {
    const r = rig()
    fill(r)
    const out = await reconcile(r.deps, { hours: 2, limit: 10 })
    expect(out).toMatchObject({ ok: true, listed: 1, ingested: 1 })
  })

  test("a Worker payload is never mistaken for a job, and a job body needs the bearer even when it looks like a mail", async () => {
    const r = rig()
    const res = await r.job({ job: "reconcile", subject: "hi", envelope_to: MAILBOX }, null)
    expect(res.status).toBe(401)
    expect(r.db.calls).toHaveLength(0)
  })
})

describe("direct handleResendWebhook use", () => {
  test("handleResendWebhook is the same entry point routeInbound uses for svix-* requests", async () => {
    const r = rig()
    r.resend.put(EID, email({ text: "Please delete my data." }))
    const ev = JSON.stringify(r.event(EID))
    const res = await handleResendWebhook(
      new Request("https://x.test/f", { method: "POST", headers: { "svix-id": "msg_direct", "svix-timestamp": String(NOW_S), "svix-signature": r.sign("msg_direct", NOW_S, ev) }, body: ev }),
      r.deps,
    )
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Added by the adversarial review of 2026-09-30. Every test here was first seen to FAIL against the code as it was (a quadratic
// regular expression, no operator alert, first `<...>` group, ...) and to pass after the fix; the end-to-end version of most of them,
// against the real SQL, is src/lib/services/dpdp-resend-inbound-adversarial.pglite.test.ts.
describe("hostile input stays linear: a message that pins the CPU is killed by the platform and never recorded", () => {
  const fast = (label: string, f: () => unknown, ms = 750) => {
    const t = performance.now()
    f()
    const took = performance.now() - t
    expect(took, `${label} took ${Math.round(took)} ms`).toBeLessThan(ms)
  }

  test("htmlToText: a run of '<', of spaces, of tabs, of unclosed <script> and of unclosed <style> (each quadratic for the regular expressions it replaced)", () => {
    fast("'<' x 60k", () => htmlToText("<".repeat(60_000)))
    fast("spaces x 60k", () => htmlToText(" ".repeat(60_000) + "x"))
    fast("tab+space x 60k", () => htmlToText("\t ".repeat(30_000) + "x"))
    fast("<script> x 8k unclosed", () => htmlToText("<script>".repeat(8_000)))
    fast("<style> x 8k unclosed", () => htmlToText("<style>x".repeat(8_000)))
    fast("'<a' x 30k", () => htmlToText("<a".repeat(30_000)))
    fast("2 MB of markup", () => htmlToText("<p>hello <b>world</b></p>\n".repeat(80_000)))
  })

  test("htmlToText: the output is what it was for well-formed HTML", () => {
    expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\nb")
    expect(htmlToText("x<script>evil()</script>y<style>p{}</style>z")).toBe("x y z")
    expect(htmlToText("<SCRIPT type=x>evil()</SCRIPT>y")).toBe("y")
    expect(htmlToText("<script>alert(1) hello")).toBe("alert(1) hello") // never closed: an ordinary tag, its content is text, as before
    expect(htmlToText("a <b and more")).toBe("a <b and more") // no ">" anywhere after: text
    expect(htmlToText("a<br>b<br />c<BR/>d")).toBe("a\nb\nc\nd")
    expect(htmlToText("<div>one</div><li>two</li><h2>three</h2><tr>four</tr>")).toBe("one\ntwo\nthree\nfour")
    expect(htmlToText("&amp;lt;b&amp;gt; &nbsp;x")).toBe("&lt;b&gt;  x")
    expect(htmlToText("a  \t \nb")).toBe("a\nb")
    expect(htmlToText("a\n\n\n\n\nb")).toBe("a\n\nb")
    expect(htmlToText("<p title='x>y'>z</p>")).toBe("y'>z") // the first ">" ends a tag, as before
    expect(htmlToText("")).toBe("")
  })

  test("htmlToText: a '<' that cannot start a tag is text, so it neither swallows the words after it nor hides a <script> opener", () => {
    expect(htmlToText("if a < b and 5 < 6 then <b>go</b>")).toBe("if a < b and 5 < 6 then go")
    expect(htmlToText("I love you <3 <p>x</p>")).toBe("I love you <3 x")
    expect(htmlToText("x < y <script>evil()</script> z")).not.toContain("evil")
    expect(htmlToText("Please delete my data < thanks >")).toBe("Please delete my data < thanks >")
  })

  test("htmlToText stops at 200 000 characters of output", () => {
    expect(htmlToText("word ".repeat(200_000)).length).toBeLessThanOrEqual(200_005)
  })

  test("extractAddresses: 60 000 address characters with no '@' (a 200 000-character To header took 95 s)", () => {
    fast("'a' run", () => extractAddresses("a".repeat(60_000)))
    fast("dots run", () => extractAddresses(".a".repeat(30_000)))
    fast("a list of 1000 long entries", () => extractAddresses(Array.from({ length: 1000 }, () => "a".repeat(200))))
    expect(extractAddresses("Asha <Asha@Example.org>, b@c.co")).toEqual(["asha@example.org", "b@c.co"])
    expect(extractAddresses(["dpdp@veridian-aios.com", "x@y.z"])).toEqual(["dpdp@veridian-aios.com", "x@y.z"])
    expect(extractAddresses(Array.from({ length: 900 }, (_, i) => `u${i}@x.example`))).toHaveLength(500) // at most 500
  })

  test("parseInbound (the Worker route's parser shares the address regex): a 200 000-character Cc / To", () => {
    fast("cc", () => parseInbound({ cc: ["a".repeat(60_000)], envelope_from: "x@y.co", text: "hi" }))
    fast("header_to", () => parseInbound({ header_to: ".".repeat(60_000), envelope_from: "x@y.co", text: "hi" }))
    const m = parseInbound({ header_to: "dpdp@veridian-aios.com", envelope_from: "x@y.co", text: "hi" })!
    expect(m.recipients).toContain("dpdp@veridian-aios.com")
  })

  test("bareAddress: a long run of commas / quotes is trimmed in linear time; the address group is the LAST <...>", () => {
    fast("commas", () => bareAddress(",".repeat(60_000) + "x"))
    fast("quotes", () => bareAddress("'\"".repeat(30_000) + "x"))
    fast("angles", () => bareAddress("<".repeat(60_000)))
    expect(bareAddress('"x <victim@example.com>" <attacker@evil.example>')).toBe("attacker@evil.example")
    expect(bareAddress("Asha M <Asha@Example.ORG>")).toBe("asha@example.org")
    expect(bareAddress('"Doe, John" <john@x.example>')).toBe("john@x.example")
    expect(bareAddress("  plain@x.example,")).toBe("plain@x.example")
    expect(bareAddress("'q@x.example'")).toBe("q@x.example")
    expect(bareAddress("<>")).toBe("")
    expect(bareAddress("x <y@z.co>;")).toBe("y@z.co")
  })

  test("a whole webhook with hostile bodies and header runs is ticketed in well under a second each", async () => {
    for (const over of [
      { text: null, html: "<".repeat(200_000) },
      { text: null, html: " ".repeat(200_000) + "x" },
      { text: null, html: "<script>".repeat(20_000) },
      { to: [MAILBOX, "a".repeat(200_000)] },
      { cc: [".".repeat(200_000)] },
      { from: ",".repeat(200_000) + "x" },
    ]) {
      const r = rig()
      const t = performance.now()
      const res = await r.receive(email({ message_id: "<hostile@example.org>", ...over }))
      expect(res.status).toBe(200)
      expect(performance.now() - t).toBeLessThan(1500)
    }
  })

  test("To and Cc lists of 800 KB each (the fetched message, not the webhook, carries them) do not push the payload over handleInbound's limit: a 413 there would be retried by Svix for a day and never recorded", async () => {
    const r = rig()
    const list = Array.from({ length: 200 }, () => "a@b.co,".repeat(700)) // 200 entries of 4900 characters: each is cut to 4000
    r.resend.put(EID, email({ to: [MAILBOX, ...list], cc: list, message_id: "<bigto@example.org>" }))
    const res = await r.deliver(r.event(EID, { to: [MAILBOX], cc: [] }))
    expect(res.status).toBe(200)
    expect(inserts(r.db)).toHaveLength(1)
  })
})

describe("nothing fails only in the Svix log: an unprocessable webhook tells the operator", () => {
  const alerts = (r: ReturnType<typeof rig>) => r.sent.filter((m) => m.headers["X-Veridian-Origin"] === "inbound-alert")

  test("a fetch that Resend refuses (401: a sending-only key) is 502 and ONE alert per email id, with the key hint and no body text", async () => {
    const r = rig()
    r.resend.put(EID, email({ text: "SECRET-BODY delete my data" }))
    r.resend.failWith.set(EID, () => new Response('{"name":"restricted_api_key"}', { status: 401 }))
    const ev = r.event(EID, { subject: "Hello\r\nBcc: evil@evil.test", from: "Real <real@example.org>" })
    const a = await r.deliver(ev)
    const b = await r.deliver(ev)
    expect([a.status, b.status]).toEqual([502, 502])
    expect(r.db.inbound).toHaveLength(0)
    const al = alerts(r)
    expect(al).toHaveLength(2) // one per attempt...
    expect(new Set(al.map((m) => m.idempotencyKey))).toEqual(new Set([`dpdp-inbound-unprocessed-${EID}`])) // ...but ONE at the provider
    expect(al[0].to).toBe(OPERATOR)
    expect(al[0].subject).toBe(`[UNPROCESSED ${EID}] Hello Bcc: evil@evil.test`)
    expect(al[0].text).toContain(EID)
    expect(al[0].text).toContain("real@example.org")
    expect(al[0].text).toContain("sending-only key")
    expect(al[0].text).not.toContain("SECRET-BODY")
    expect(/[\r\n]/.test(al[0].subject)).toBe(false)
  })

  test("404, 429, 500, a network error, garbage and a non-object answer are each 502 with an alert; when Resend recovers the retry makes the ticket", async () => {
    const kinds: Array<[string, () => Response | Promise<Response>]> = [
      ["404", () => new Response("{}", { status: 404 })],
      ["429", () => new Response("{}", { status: 429 })],
      ["500", () => new Response("{}", { status: 500 })],
      ["throw", () => { throw new TypeError("fetch failed") }],
      ["garbage", () => new Response("<html>", { status: 200 })],
      ["null", () => new Response("null", { status: 200 })],
      ["array", () => new Response("[]", { status: 200 })],
    ]
    for (const [name, f] of kinds) {
      const r = rig()
      r.resend.put(EID, email({ text: "Please delete my data." }))
      r.resend.failWith.set(EID, f)
      const res = await r.deliver(r.event(EID))
      expect(res.status, name).toBe(502)
      expect(alerts(r), name).toHaveLength(1)
      expect(r.acks(), name).toHaveLength(0)
      r.resend.failWith.delete(EID)
      const again = await r.deliver(r.event(EID))
      expect(again.status, name).toBe(200)
      expect(r.acks(), name).toHaveLength(1)
      expect(alerts(r), name).toHaveLength(1) // recovery adds none
    }
  })

  test("no alert in a dry run or without an operator address, none from the reconcile job, and a failing alert never throws", async () => {
    for (const config of [{ dryRun: true }, { operatorEmail: "" }]) {
      const r = rig({ config })
      r.resend.put(EID, email())
      r.resend.failWith.set(EID, () => new Response("{}", { status: 500 }))
      expect((await r.deliver(r.event(EID))).status).toBe(502)
      expect(r.sent).toHaveLength(0)
    }
    const rc = rig()
    rc.resend.put(EID, email())
    rc.resend.failWith.set(EID, () => new Response("{}", { status: 500 }))
    expect((await rc.job({ job: "reconcile", hours: 168 })).status).toBe(502)
    expect(alerts(rc)).toHaveLength(0)
    const bad = rig({ failSend: () => true })
    bad.resend.put(EID, email())
    bad.resend.failWith.set(EID, () => new Response("{}", { status: 500 }))
    expect((await bad.deliver(bad.event(EID))).status).toBe(502)
    expect(bad.logs.some((l) => l.includes("operator alert failed"))).toBe(true)
  })

  test("the pipeline recording nothing (an unset DPDP_INBOUND_SECRET makes handleInbound answer 503) is also announced", async () => {
    const r = rig({ config: { secret: "short" } })
    r.resend.put(EID, email())
    const res = await r.deliver(r.event(EID))
    expect(res.status).toBe(503)
    expect(alerts(r)).toHaveLength(1)
  })
})

describe("recipient policy: bulk mail to a guessed address, and the wording of the notice", () => {
  test("mail to a guessed address with a List-Unsubscribe or List-Id header is bulk: auto, even with 'unsubscribe' in it; without those headers the legal class is kept", async () => {
    for (const headers of [{ "list-unsubscribe": "<mailto:u@bulk.example>" }, { "list-id": "<news.bulk.example>" }]) {
      const r = rig()
      const b = await body(await r.receive(email({ to: ["contact@veridian-aios.com"], received_for: ["contact@veridian-aios.com"], text: "Big deals! To unsubscribe click here.", headers: { "message-id": "<b@x>", ...headers }, message_id: "<b@x>" })))
      expect(b.class, JSON.stringify(headers)).toBe("auto")
      expect(r.sent, JSON.stringify(headers)).toHaveLength(0)
      expect(String(inserts(r.db)[0].p_classifier_reason)).toContain("bulk: List-Unsubscribe / List-Id header")
    }
    const r = rig()
    const b = await body(await r.receive(email({ to: ["contact@veridian-aios.com"], received_for: ["contact@veridian-aios.com"], text: "Please unsubscribe me and delete my data." })))
    expect(b.class).toBe("data_request")
    // postmaster@ keeps its policy (support, operator told) whatever the headers
    const p = rig()
    const pb = await body(await p.receive(email({ to: ["postmaster@veridian-aios.com"], received_for: ["postmaster@veridian-aios.com"], text: "Hello", headers: { "message-id": "<p@x>", "list-id": "<x.y>" }, message_id: "<p@x>" })))
    expect(pb.class).toBe("support")
  })

  test("a text part that is only whitespace does not hide the request in the HTML part", async () => {
    const r = rig()
    const b = await body(await r.receive(email({ text: " \n\n", html: "<p>Please erase all my personal data.</p>" })))
    expect(b.class).toBe("data_request")
  })

  test("a From with no readable address is not an empty-envelope bounce: the message is read like any other; only an explicit Return-Path <> is a null sender", async () => {
    for (const from of ["not an address", "undisclosed-recipients:;", ""]) {
      const r = rig()
      const b = await body(await r.receive(email({ from, text: "Please send me your pricing brochure." })))
      expect(b.class, JSON.stringify(from)).toBe("sales") // was `auto`: logged, nobody told
      expect(b.notified, JSON.stringify(from)).toBe("digest") // read as a sales enquiry: recorded for the daily digest, no per-message email
      expect(r.notices(), JSON.stringify(from)).toHaveLength(0)
      expect("envelope_from" in mapReceivedEmail({ emailId: EID, data: {}, email: email({ from }), now: NOW }).payload).toBe(false)
    }
    const bounce = mapReceivedEmail({ emailId: EID, data: {}, email: email({ headers: { "return-path": "<>", "message-id": "<a@b>" } }), now: NOW })
    expect(bounce.payload.envelope_from).toBe("")
    const normal = mapReceivedEmail({ emailId: EID, data: {}, email: email({ from: "Asha <asha@example.org>" }), now: NOW })
    expect(normal.payload.envelope_from).toBe("asha@example.org")
  })

  test("the notice for an adapter-supplied message does not say the attachments are 'not stored anywhere' or that the Worker cut the text", async () => {
    const r = rig()
    await r.receive(email({ text: "I have a complaint. " + "x".repeat(6000), attachments: [{ id: "a1", filename: "proof.pdf", content_type: "application/pdf" }] }))
    const t = r.notices()[0].text
    expect(t).toContain("Attachments (1): proof.pdf (application/pdf). Resend keeps them")
    expect(t).toContain("Only the first 4096 bytes")
    expect(t).not.toContain("not stored anywhere")
    expect(t).not.toContain("larger than the Worker reads")
  })

  test("renderNotification without an adapter keeps the Worker wording", () => {
    const m = parseInbound({ envelope_from: "a@b.example", text: "hi", has_attachments: true, truncated: true })!
    const o = { ticket: "S-2026-0001", cls: "sales" as const, reason: "r", dueAt: null, ack: "not applicable", rawForwarded: false, duplicate: false }
    const plain = renderNotification(m, o, null, NOW)
    expect(plain).toContain("They are not stored anywhere.")
    expect(plain).toContain("larger than the Worker reads")
    const adapter = renderNotification(m, o, null, NOW, { noticeLines: ["x"] })
    expect(adapter).not.toContain("not stored anywhere")
    expect(adapter).not.toContain("larger than the Worker reads")
  })
})

describe("the 4096-byte excerpt is not the Worker's `truncated`", () => {
  const digestQuote = "> your weekly DPDP digest, one line per job\n".repeat(200) // about 9 KB of quoted text
  const reply = (own: string) => `${own}\n\nOn Mon, 28 Sep 2026 at 08:00, VERIDIAN AI DPDP <dpdp@veridian-aios.com> wrote:\n${digestQuote}`

  test("a short reply on top of a long quoted digest is filed by its tag (monday), exactly as when the quote is short; the payload says truncated only for a body that really was cut", async () => {
    for (const own of ["Thanks!", "ok noted"]) {
      const r = rig()
      r.db.outbound.push({ ref: REF, class: "monday", ticketNo: null, providerId: null, headerId: null, to: "asha@example.org" })
      const b = await body(await r.receive(email({ to: [`dpdp+mon.${REF}@veridian-aios.com`], received_for: [`dpdp+mon.${REF}@veridian-aios.com`], text: reply(own) })))
      expect(b.class, own).toBe("monday")
      expect(inserts(r.db)[0].p_wants_ack, own).toBe(false) // no legal clock, no acknowledgement for "Thanks!"
      const short = rig()
      short.db.outbound.push({ ref: REF, class: "monday", ticketNo: null, providerId: null, headerId: null, to: "asha@example.org" })
      const bs = await body(await short.receive(email({ to: [`dpdp+mon.${REF}@veridian-aios.com`], received_for: [`dpdp+mon.${REF}@veridian-aios.com`], text: `${own}\n\n> short quote` })))
      expect(bs.class, own).toBe("monday")
    }
    // the mapping itself: the excerpt is cut (the notice says so) but the payload is not marked truncated; a body that could not be read at all is
    expect(mapReceivedEmail({ emailId: EID, data: {}, email: email({ text: "x".repeat(9000) }), now: NOW }).payload.truncated).toBe(false)
    expect(mapReceivedEmail({ emailId: EID, data: {}, email: email({ text: "x".repeat(200_000) }), now: NOW }).payload.truncated).toBe(true) // past the Worker's 128 KiB read cap
    expect(mapReceivedEmail({ emailId: EID, data: {}, email: null, now: NOW }).payload.truncated).toBe(true) // too large to fetch
  })

  test("a vacation reply that quotes the long digest stays auto", async () => {
    const r = rig()
    r.db.outbound.push({ ref: REF, class: "monday", ticketNo: null, providerId: null, headerId: null, to: "asha@example.org" })
    const b = await body(await r.receive(email({ to: [`dpdp+mon.${REF}@veridian-aios.com`], received_for: [`dpdp+mon.${REF}@veridian-aios.com`], subject: "Automatic reply: Your week", text: reply("Out of office."), headers: { "message-id": "<v@x>", "auto-submitted": "auto-replied" }, message_id: "<v@x>" })))
    expect(b.class).toBe("auto")
    expect(r.sent).toHaveLength(0)
  })
})

describe("the webhook body is read only up to its limit", () => {
  test("a body with no Content-Length is 413 after about MAX_WEBHOOK_BYTES, and the rest is never pulled", async () => {
    const r = rig()
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 65_536
        if (pulled > 40_000_000) c.close()
        else c.enqueue(new Uint8Array(65_536))
      },
    })
    const res = await routeInbound(new Request("https://x.test/f", { method: "POST", headers: { "svix-id": "msg_big", "svix-timestamp": String(NOW_S), "svix-signature": `v1,${btoa("x".repeat(32))}` }, body: stream, duplex: "half" } as RequestInit), r.deps)
    expect(res.status).toBe(413)
    expect(pulled).toBeLessThan(4_000_000)
    expect(r.resend.calls).toHaveLength(0)
  })
})
