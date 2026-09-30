// End-to-end contract test for the whole single-mailbox path, with NOTHING between the pieces mocked except the network edges:
//
//   raw MIME -> the Worker's real handleInbound (real postal-mime parse, real payload builder)
//            -> its POST, delivered in-process to the Edge Function's real handleInbound (real auth, parser, classifier)
//            -> the RPCs, executed by REAL Postgres (PGlite) against drizzle/0662, as service_role, by named argument, the way PostgREST does
//            -> the outbound side (buildOutbound / logOutbound) writes the rows that a reply is matched to.
//
// WHY IT EXISTS. Each component has its own tests, and each of those tests feeds the component a payload or an RPC answer written by
// hand in that component's own vocabulary, so none of them can see a name or a shape the neighbour does not really produce or accept.
// This file is the one place that connects them: a renamed payload field, an RPC argument the migration does not have, a status the
// Worker misreads, a key the Edge Function expects and the SQL does not return -- each fails here and nowhere else.
//
// Only the edges are faked: the Resend send (captured, nothing leaves the process) and the clock. No live service, no .env.
//
// NOT COVERED: workerd, Cloudflare Email Routing, the Deno entry (index.ts), Resend itself, two simultaneous deliveries.
//
// Run from this directory:  bun test src/pipeline.test.ts     (needs `bun install` here for postal-mime, and the repo root's
// node_modules for @electric-sql/pglite, which Node resolution finds by walking up).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

import { handleInbound as edgeHandle, type InboundDeps, type OutMessage } from "../../../supabase/functions/dpdp-inbound-mail/handler.ts"
import { buildOutbound, logOutbound, type RpcClient } from "../../../supabase/functions/_shared/mail-outbound.ts"
import { MAILBOX, isValidRef, replyToAddress } from "../../../supabase/functions/_shared/mail-taxonomy.ts"
import { handleInbound as workerHandle } from "./handler.ts"
import type { Env, InboundEmailMessage } from "./types.ts"

const SECRET = "pipeline-test-secret-0123456789"
const NOW = new Date("2026-09-29T10:00:00.000Z")
const URL_ = "https://example.supabase.co/functions/v1/dpdp-inbound-mail"
const REPO_ROOT = new URL("../../../", import.meta.url)
const MIGRATION = readFileSync(new URL("drizzle/0662_dpdp_single_mailbox_mail_log.sql", REPO_ROOT), "utf8")

const BASE_SQL = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA dpdp;
GRANT USAGE ON SCHEMA dpdp TO service_role; GRANT USAGE ON SCHEMA public TO service_role;
`

let pg: PGlite

// ---- the database, called the way PostgREST calls it: as service_role, one named argument per key ----
const CAST: Record<string, string> = {
  p_received_at: "::timestamptz", p_due_days: "::integer", p_message_ids: "::text[]", p_raw_forwarded: "::boolean", p_wants_ack: "::boolean",
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
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

// ---- the Edge Function, with the network edge captured ----
type Config = InboundDeps["config"]
const baseConfig: Config = { secret: SECRET, operatorEmail: "operator@example.com", from: "VERIDIAN AI DPDP <dpdp@veridian-aios.com>", legalResponseDays: 90, dryRun: false }
let sent: OutMessage[] = []
let edgeStatuses: number[] = []
let config: Config = baseConfig
const edgeDeps = (): InboundDeps => ({
  rpc,
  config,
  now: () => NOW,
  log: () => {},
  send: async (m) => { sent.push(m); return { id: `resend-${sent.length}` } },
})

// ---- the Worker, with its fetch pointed at the Edge Function above ----
type Delivery = { forwarded: { to: string; headers: Headers | undefined }[]; rejected: string[]; statuses: number[] }
function mime(o: { from: string; to: string; subject: string; body: string; messageId?: string; headers?: string[]; contentType?: string }): string {
  return [
    `From: ${o.from}`, `To: ${o.to}`, `Subject: ${o.subject}`, ...(o.messageId ? [`Message-ID: <${o.messageId}>`] : []),
    ...(o.headers ?? []), `Content-Type: ${o.contentType ?? "text/plain; charset=utf-8"}`, "", o.body,
  ].join("\r\n")
}
async function deliver(raw: string, o: { to?: string; envelopeFrom?: string; env?: Partial<Env>; url?: string } = {}): Promise<Delivery> {
  const bytes = new TextEncoder().encode(raw)
  const forwarded: Delivery["forwarded"] = []
  const rejected: string[] = []
  edgeStatuses = []
  const message: InboundEmailMessage = {
    from: o.envelopeFrom ?? "asha@example.org",
    to: o.to ?? MAILBOX,
    headers: new Headers(),
    raw: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close() } }),
    rawSize: bytes.length,
    setReject: (r) => { rejected.push(r) },
    forward: async (to, headers) => { forwarded.push({ to, headers }) },
  }
  const env: Env = { DPDP_INBOUND_URL: o.url ?? URL_, DPDP_INBOUND_SECRET: SECRET, FALLBACK_FORWARD_TO: "fallback@example.com", ...o.env }
  await workerHandle(message, env, {
    now: () => NOW,
    fetch: async (url, init) => {
      const res = await edgeHandle(new Request(url, init), edgeDeps())
      edgeStatuses.push(res.status)
      return res
    },
  })
  return { forwarded, rejected, statuses: edgeStatuses }
}

const inbound = async (ticket: string) => (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where ticket_no = $1", [ticket]))[0]
const ticketOf = (m: OutMessage): string => /\b([A-Z]-\d{4}-\d{4,})\b/.exec(m.subject)?.[1] ?? ""

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(BASE_SQL)
  await pg.exec(MIGRATION)
}, 60_000)
afterAll(async () => { await pg?.close() })

describe("Worker -> Edge Function -> Postgres, nothing between them mocked", () => {
  test("a data-erasure request to dpdp@ is ticketed, acknowledged, announced and NOT forwarded", async () => {
    sent = []
    const d = await deliver(mime({ from: "Asha M <Asha@Example.org>", to: MAILBOX, subject: "Please delete my data", body: "Please erase all my personal data you hold about me.", messageId: "erase-1@example.org" }))
    expect(d.statuses).toEqual([200])
    expect(d.forwarded).toEqual([])

    const row = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = '<erase-1@example.org>'"))[0]
    expect(row.class).toBe("data_request")
    expect(String(row.ticket_no)).toMatch(/^D-2026-\d{4}$/)
    expect(row.from_addr).toBe("asha@example.org")
    expect(row.to_addr).toBe(MAILBOX)
    expect(String(row.classifier_reason)).toContain("keyword:data_request")
    expect(new Date(row.due_at as string).getTime() - new Date(row.received_at as string).getTime()).toBe(90 * 24 * 3600_000)
    expect(row.status).toBe("acknowledged")
    expect(row.ack_sent_at).not.toBeNull()
    expect(row.operator_notified_at).not.toBeNull()
    expect(String(row.excerpt)).toContain("erase all my personal data")

    const ack = sent.find((m) => m.to === "asha@example.org")!
    const notice = sent.find((m) => m.to === "operator@example.com")!
    expect(ack.subject).toContain(row.ticket_no as string)
    expect(ack.text).toContain(row.ticket_no as string)
    expect(notice.subject).toBe(`[DATA REQUEST ${row.ticket_no}] Please delete my data`)
    expect(notice.replyTo).toBe("asha@example.org")

    // The acknowledgement was logged, so a reply to it lands on the same class and carries the ticket.
    const ackRef = /^dpdp\+dsr\.([0-9a-z]{10})@/.exec(ack.replyTo ?? "")![1]
    expect(isValidRef(ackRef)).toBe(true)
    const logged = (await rows<Record<string, unknown>>("select * from dpdp.mail_outbound where ref = $1", [ackRef]))[0]
    expect(logged).toMatchObject({ class: "data_request", to_addr: "asha@example.org", ticket_no: row.ticket_no, provider_message_id: expect.stringMatching(/^resend-/) })
  })

  test("the legacy grievance@ address is filed as a grievance through the plus-tag rule, though the text is neutral", async () => {
    sent = []
    const d = await deliver(mime({ from: "b@example.org", to: "grievance@veridian-aios.com", subject: "Hello", body: "Good morning.", messageId: "legacy-1@example.org" }), { to: "grievance@veridian-aios.com" })
    expect(d.statuses).toEqual([200])
    const row = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = '<legacy-1@example.org>'"))[0]
    expect(row.class).toBe("grievance")
    expect(row.classifier_reason).toBe("tag:grv")
    expect(row.to_addr).toBe("dpdp+grv@veridian-aios.com")
    expect(row.due_at).not.toBeNull()
    expect(sent.map((m) => m.to).sort()).toEqual(["b@example.org", "operator@example.com"])
  })

  test("a reply to a Monday email is matched to that email's log row by the ref in the plus-tag and by In-Reply-To", async () => {
    const out = buildOutbound("monday", "Your week", {})
    expect(out.reply_to).toBe(replyToAddress("monday", out.ref))
    expect(await logOutbound(sb, { ref: out.ref, cls: "monday", to: "owner@example.org", subject: out.subject, providerMessageId: "prov-id-777" })).toBe(true)

    sent = []
    const d = await deliver(mime({ from: "owner@example.org", to: out.reply_to, subject: `Re: ${out.subject}`, body: "Thanks, noted.", messageId: "reply-mon-1@example.org" }), { to: out.reply_to })
    expect(d.statuses).toEqual([200])
    const row = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = '<reply-mon-1@example.org>'"))[0]
    expect(row).toMatchObject({ class: "monday", ref: out.ref, matched_outbound_ref: out.ref, due_at: null })
    expect(String(row.ticket_no)).toMatch(/^M-2026-\d{4}$/)
    expect(sent.map((m) => m.to)).toEqual(["operator@example.com"]) // no legal clock, so no acknowledgement

    // No tag at all (a client that stripped it): the thread header alone finds the row, and a sales mail becomes sales_chain.
    const sales = buildOutbound("sales", "Our proposal", {})
    await logOutbound(sb, { ref: sales.ref, cls: "sales", to: "lead@example.org", subject: sales.subject, providerMessageId: "prov-sales-1" })
    const d2 = await deliver(mime({ from: "lead@example.org", to: MAILBOX, subject: "Re: Our proposal", body: "Sounds good.", messageId: "reply-sal-1@example.org", headers: ["In-Reply-To: <prov-sales-1>"] }))
    expect(d2.statuses).toEqual([200])
    const row2 = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = '<reply-sal-1@example.org>'"))[0]
    expect(row2).toMatchObject({ class: "sales_chain", matched_outbound_ref: sales.ref })
    expect(String(row2.ticket_no)).toMatch(/^T-2026-\d{4}$/)

    // References alone (the newest id last, as mail clients write it) is enough too.
    const inv = buildOutbound("invoice", "Invoice 42", {})
    await logOutbound(sb, { ref: inv.ref, cls: "invoice", to: "acct@example.org", subject: inv.subject, providerMessageId: "prov-inv-1" })
    const d3 = await deliver(mime({ from: "acct@example.org", to: MAILBOX, subject: "Re: Invoice 42", body: "Received, thank you.", messageId: "reply-inv-1@example.org", headers: ["References: <old@x> <prov-inv-1>"] }))
    expect(d3.statuses).toEqual([200])
    const row3 = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = '<reply-inv-1@example.org>'"))[0]
    expect(row3).toMatchObject({ class: "invoice", matched_outbound_ref: inv.ref })
  })

  test("a bounce (empty envelope sender, delivery-status report) is logged as auto: no notice, no acknowledgement, no forward", async () => {
    sent = []
    const body = ["--b1", "Content-Type: text/plain", "", "Delivery has failed to these recipients.", "--b1", "Content-Type: message/delivery-status", "", "Reporting-MTA: dns; mail.example.org", "--b1--", ""].join("\r\n")
    const d = await deliver(
      mime({ from: "MAILER-DAEMON@mail.example.org", to: MAILBOX, subject: "Undelivered Mail Returned to Sender", body, messageId: "bounce-1@mail.example.org", headers: ["Return-Path: <>"], contentType: 'multipart/report; report-type=delivery-status; boundary="b1"' }),
      { envelopeFrom: "" },
    )
    expect(d.statuses).toEqual([200])
    expect(d.forwarded).toEqual([])
    const row = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = '<bounce-1@mail.example.org>'"))[0]
    expect(row).toMatchObject({ class: "auto", due_at: null, ack_sent_at: null, operator_notified_at: null })
    expect(String(row.ticket_no)).toMatch(/^A-2026-\d{4}$/)
    expect(sent).toEqual([])
  })

  test("a header that is present but EMPTY still counts (Auto-Submitted: with no value), so the wire keeps null and \"\" apart", async () => {
    sent = []
    const d = await deliver(mime({ from: "robot@example.org", to: MAILBOX, subject: "Status", body: "All good.", messageId: "empty-hdr-1@example.org", headers: ["Auto-Submitted:"] }))
    expect(d.statuses).toEqual([200])
    const row = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = '<empty-hdr-1@example.org>'"))[0]
    expect(row.class).toBe("auto")
    expect(String(row.classifier_reason)).toContain("Auto-Submitted=(empty)")
    expect(sent).toEqual([])
  })

  test("Authentication-Results reaches the acknowledgement guard: dmarc=fail means the operator is told but the (possibly forged) sender is not written to", async () => {
    const send = async (id: string, verdict: string) => {
      sent = []
      const d = await deliver(mime({ from: "e@example.org", to: MAILBOX, subject: "Complaint", body: "I have a complaint.", messageId: id, headers: [`Authentication-Results: mx.example.net; spf=pass; dmarc=${verdict}`] }))
      expect(d.statuses).toEqual([200])
      return { row: (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = $1", [`<${id}>`]))[0], to: sent.map((m) => m.to).sort() }
    }
    const forged = await send("dmarc-fail-1@example.org", "fail")
    expect(forged.row).toMatchObject({ class: "grievance", ack_sent_at: null })
    expect(forged.row.operator_notified_at).not.toBeNull()
    expect(forged.to).toEqual(["operator@example.com"])
    const genuine = await send("dmarc-pass-1@example.org", "pass")
    expect(genuine.row.ack_sent_at).not.toBeNull()
    expect(genuine.to).toEqual(["e@example.org", "operator@example.com"])
  })

  test("the same delivery twice (the Worker cannot know its first answer was lost) is one ticket, one notice, one acknowledgement", async () => {
    sent = []
    const raw = mime({ from: "c@example.org", to: MAILBOX, subject: "I have a complaint", body: "Nobody answered me.", messageId: "twice-1@example.org" })
    const first = await deliver(raw)
    const second = await deliver(raw)
    expect(first.statuses).toEqual([200])
    expect(second.statuses).toEqual([200])
    const found = await rows<Record<string, unknown>>("select ticket_no, class from dpdp.mail_inbound where message_id = '<twice-1@example.org>'")
    expect(found.length).toBe(1)
    expect(found[0].class).toBe("grievance")
    expect(sent.filter((m) => m.to === "c@example.org").length).toBe(1)
    expect(sent.filter((m) => m.to === "operator@example.com").length).toBe(1)
    expect(sent.map(ticketOf)).toEqual([found[0].ticket_no as string, found[0].ticket_no as string])
  })

  test("a recipient that is not ours is refused at SMTP level and never reaches the Edge Function", async () => {
    const d = await deliver(mime({ from: "x@example.org", to: "sales@veridian-aios.com", subject: "hi", body: "hi", messageId: "nope-1@example.org" }), { to: "sales@veridian-aios.com" })
    expect(d.rejected).toEqual(["Unknown recipient"])
    expect(d.statuses).toEqual([])
    expect(await rows("select 1 from dpdp.mail_inbound where message_id = '<nope-1@example.org>'")).toEqual([])
  })
})

describe("every way the Edge Function can say no, the Worker forwards the original instead of losing it", () => {
  const raw = () => mime({ from: "d@example.org", to: MAILBOX, subject: "Data request", body: "Please send me a copy of my data.", messageId: `fail-${Math.random().toString(36).slice(2)}@example.org` })

  test("wrong shared secret: 401 -> forwarded, nothing recorded", async () => {
    const r = raw()
    const before = (await rows<{ n: string }>("select count(*)::text as n from dpdp.mail_inbound"))[0].n
    const d = await deliver(r, { env: { DPDP_INBOUND_SECRET: "a-different-secret-0123456789" } })
    expect(d.statuses).toEqual([401])
    expect(d.forwarded.length).toBe(1)
    expect(d.forwarded[0].to).toBe("fallback@example.com")
    expect(d.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("post_http_401")
    expect((await rows<{ n: string }>("select count(*)::text as n from dpdp.mail_inbound"))[0].n).toBe(before)
  })

  test("Edge Function secret unset or short: 503 -> forwarded", async () => {
    config = { ...baseConfig, secret: "short" }
    try {
      const d = await deliver(raw())
      expect(d.statuses).toEqual([503])
      expect(d.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("post_http_503")
    } finally { config = baseConfig }
  })

  test("dry run (no Resend key): the message IS recorded, but nobody was told, so the answer is 502 and the Worker forwards", async () => {
    config = { ...baseConfig, dryRun: true }
    sent = []
    const r = raw()
    try {
      const d = await deliver(r)
      expect(d.statuses).toEqual([502])
      expect(d.forwarded.length).toBe(1)
      expect(d.forwarded[0].headers?.get("X-Veridian-Fallback-Reason")).toBe("post_http_502")
      expect(sent).toEqual([])
      const id = /Message-ID: (<[^>]+>)/.exec(r)![1]
      const row = (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where message_id = $1", [id]))[0]
      expect(row).toMatchObject({ class: "data_request", ack_sent_at: null, operator_notified_at: null })
    } finally { config = baseConfig }
  })

  test("no operator address configured: recorded, 502, forwarded", async () => {
    config = { ...baseConfig, operatorEmail: "" }
    try {
      const d = await deliver(raw())
      expect(d.statuses).toEqual([502])
      expect(d.forwarded.length).toBe(1)
    } finally { config = baseConfig }
  })
})
