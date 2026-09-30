/// <reference types="bun-types" />
// Offline proof of handler.ts, the request handler of the dpdp-inbound-mail Edge Function, run with a fake
// database (an in-memory copy of the public.dpdp_mail_* contract of drizzle/0662; the real SQL is proven by
// src/lib/services/dpdp-single-mailbox-migration.pglite.test.ts) and a fake mail provider.
//
// What this proves: fail-closed auth before anything else runs; every class flows to the right ticket, due
// date, acknowledgement and operator notice; a Monday reply or an invoice reply that carries a data request or
// a grievance is raised to that legal class and acknowledged (also under sender-chosen auto headers, except a
// header-flagged reply to our own acknowledgement), while a vacation reply to the digest stays auto and silent;
// the acknowledgement says received / ticket / will respond and nothing more (it never repeats the sender's
// subject, and a `review` one shows no REVIEW label) and is never sent to a bounce, to ourselves, to a no-reply
// or forged sender, nor past the per-sender or the overall hourly limit; a
// classifier throw, a failed outbound lookup, a database outage and a failed notice each degrade toward the
// operator being told, never toward a lost message; a retried delivery neither double-tickets nor double-sends;
// dry run records and sends nothing; no log line carries the secret or any text of the message.
//
// Run (bunfig.toml sets the test root to src/, so name the file):
//   bun test --isolate supabase/functions/dpdp-inbound-mail/handler.test.ts
import { describe, expect, test } from "bun:test"
import { MAILBOX, replyToAddress, type MailClass } from "../_shared/mail-taxonomy.ts"
import {
  DEFAULT_LEGAL_RESPONSE_DAYS, EXCERPT_CHARS, MAX_BODY_CHARS, MESSAGE_ID_REUSED_NOTE, ackBlocker, ackSubject, formatIst, handleInbound, htmlToText, parseInbound, parseLegalDays,
  redactSecrets, renderAck, receivedAtOf, secretMatches, type InboundConfig, type InboundDeps, type OutMessage, type Rpc,
} from "./handler.ts"

const SECRET = "test-secret-" + "x".repeat(24)
const OPERATOR = "operator@example.test"
const REF = "k3f9x2ab7q"
const NOW = new Date("2026-09-29T15:33:00Z") // 21:03 IST

const PREFIX: Record<MailClass, string> = {
  grievance: "G", data_request: "D", review: "R", sales: "S", sales_chain: "T", invoice: "I", monday: "M", clock: "K", partner: "P", support: "H", auto: "A",
}

type OutboundRow = { ref: string; class: MailClass; ticketNo: string | null; providerId: string | null; headerId: string | null; to: string }
type InboundRow = { ticketNo: string; class: MailClass; from: string; messageId: string | null; ackSent: boolean; notified: boolean; args: Record<string, unknown> }

function harness(opts: {
  config?: Partial<InboundConfig>
  outbound?: OutboundRow[]
  failRpc?: Record<string, Error>
  failSend?: (m: OutMessage) => boolean
  ackAllowed?: boolean
  /** Which limit the fake database reports when ackAllowed is false (the real one is proven in the PGlite test). Omitted: none named. */
  ackLimit?: "sender" | "hourly"
  classify?: InboundDeps["classify"]
} = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const sent: OutMessage[] = []
  const logs: string[] = []
  const outbound: OutboundRow[] = [...(opts.outbound ?? [])]
  const inbound: InboundRow[] = []
  const counters = new Map<string, number>()
  const config: InboundConfig = { secret: SECRET, operatorEmail: OPERATOR, from: "VERIDIAN AI DPDP <dpdp@veridian-aios.com>", legalResponseDays: 90, dryRun: false, ...opts.config }

  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args })
    const boom = opts.failRpc?.[fn]
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
            ackDue: Boolean(args.p_wants_ack) && !row.ackSent && (opts.ackAllowed ?? true), operatorNotified: row.notified,
            ...(opts.ackAllowed === false && opts.ackLimit ? { ackLimit: opts.ackLimit } : {}),
          },
          error: null,
        }
      }
      case "dpdp_mail_log_outbound": {
        const existing = outbound.find((o) => o.ref === args.p_ref)
        if (existing) { existing.providerId = (args.p_provider_message_id as string | null) ?? existing.providerId }
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

  const deps: InboundDeps = {
    rpc,
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
  }
  const run = (body: unknown, headers: Record<string, string> = {}, method = "POST") =>
    handleInbound(
      new Request("https://x.test/functions/v1/dpdp-inbound-mail", {
        method,
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", ...headers },
        body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      }),
      deps,
    )
  return { run, calls, sent, logs, inbound, outbound, deps, fns: () => calls.map((c) => c.fn) }
}

// The Worker's wire shape (workers/dpdp-inbound-mail/src/types.ts, InboundMailPayload, version 1).
const sender = (address: string, name: string | null = null) => ({
  envelope_from: address,
  header_from: name ? `${name} <${address}>` : address,
  from_address: address || null,
  from_name: name,
})
const payload = (over: Record<string, unknown> = {}) => ({
  version: 1,
  received_at: NOW.toISOString(),
  ...sender("asha@example.org", "Asha M"),
  envelope_to: replyToAddress("grievance", REF),
  envelope_to_raw: replyToAddress("grievance", REF),
  header_to: MAILBOX,
  reply_to: null,
  subject: "Complaint about my account",
  message_id: "<m1@example.org>",
  in_reply_to: null,
  references: null,
  auto_submitted: null,
  precedence: null,
  x_autoreply: null,
  x_auto_response_suppress: null,
  content_type: "text/plain; charset=utf-8",
  headers: {},
  text: "I have not received a response.\nPlease look into it.",
  has_attachments: false,
  raw_size: 1234,
  truncated: false,
  ...over,
})

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe("auth: fail closed, before anything else runs", () => {
  test("a wrong bearer is 401 and touches nothing", async () => {
    const h = harness()
    const res = await h.run(payload(), { authorization: "Bearer not-the-secret-not-the-secret" })
    expect(res.status).toBe(401)
    expect(h.calls).toEqual([])
    expect(h.sent).toEqual([])
  })
  test("no Authorization header is 401", async () => {
    const h = harness()
    const res = await handleInbound(new Request("https://x.test/", { method: "POST", body: JSON.stringify(payload()) }), h.deps)
    expect(res.status).toBe(401)
    expect(h.calls.length).toBe(0)
  })
  test("a non-Bearer scheme and an empty bearer are 401", async () => {
    const h = harness()
    expect((await h.run(payload(), { authorization: `Basic ${SECRET}` })).status).toBe(401)
    expect((await h.run(payload(), { authorization: "Bearer   " })).status).toBe(401)
    expect(h.calls.length).toBe(0)
  })
  test("the secret with one character changed, or a prefix or extension of it, is 401", async () => {
    const h = harness()
    for (const bad of [SECRET.slice(0, -1), `${SECRET}x`, `${SECRET.slice(0, -1)}Z`, SECRET.toUpperCase()]) {
      expect((await h.run(payload(), { authorization: `Bearer ${bad}` })).status).toBe(401)
    }
    expect(h.calls.length).toBe(0)
  })
  test("the right bearer, in any scheme case, is accepted", async () => {
    const h = harness()
    expect((await h.run(payload(), { authorization: `bearer ${SECRET}` })).status).toBe(200)
  })
  test("no secret configured, or a short one, refuses everything with 503 -- even a request that presents that short secret", async () => {
    for (const secret of ["", "short"]) {
      const h = harness({ config: { secret } })
      const res = await h.run(payload(), { authorization: `Bearer ${secret}` })
      expect(res.status).toBe(503)
      expect(h.calls.length).toBe(0)
      expect(h.sent.length).toBe(0)
    }
  })
  test("only POST", async () => {
    const h = harness()
    for (const method of ["GET", "PUT", "DELETE"]) {
      expect((await h.run(null, {}, method)).status).toBe(405)
    }
    expect(h.calls.length).toBe(0)
  })
  test("secretMatches is exact", async () => {
    expect(await secretMatches("abc", "abc")).toBe(true)
    expect(await secretMatches("abc", "abd")).toBe(false)
    expect(await secretMatches("", "abc")).toBe(false)
    expect(await secretMatches("abc", "abcd")).toBe(false)
  })
})

describe("body handling", () => {
  test("invalid JSON is 400", async () => {
    const h = harness()
    expect((await h.run("{not json")).status).toBe(400)
    expect(h.calls.length).toBe(0)
  })
  test("a JSON body that is not an object, or is empty, is 400", async () => {
    const h = harness()
    for (const body of ["[]", "null", "42", '"hello"', "{}", '{"from":"","subject":"  ","text":""}']) {
      expect((await h.run(body)).status).toBe(400)
    }
    expect(h.calls.length).toBe(0)
  })
  test("over MAX_BODY_CHARS is 413", async () => {
    const h = harness()
    expect((await h.run(`{"text":"${"x".repeat(MAX_BODY_CHARS)}"}`)).status).toBe(413)
    expect(h.calls.length).toBe(0)
  })
  test("a declared Content-Length far past the limit is 413 before the body is read", async () => {
    const h = harness()
    let read = false
    const req = {
      method: "POST",
      headers: new Headers({ authorization: `Bearer ${SECRET}`, "content-length": String(MAX_BODY_CHARS * 4 + 1) }),
      text: async () => { read = true; return "{}" },
    } as unknown as Request
    expect((await handleInbound(req, h.deps)).status).toBe(413)
    expect(read).toBe(false)
    expect(h.calls.length).toBe(0)
  })
})

describe("a grievance to a tagged address", () => {
  test("recorded with a 90-day due date, acknowledged, and the operator told -- in that order", async () => {
    const h = harness()
    const res = await h.run(payload())
    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body).toMatchObject({ ok: true, ticket: "G-2026-0001", class: "grievance", rule: "tag", duplicate: false, dryRun: false, ack: "sent", notified: "sent", degraded: false })

    expect(h.fns()).toEqual([
      "dpdp_mail_lookup_outbound", "dpdp_mail_insert_inbound", "dpdp_mail_log_outbound", "dpdp_mail_log_outbound", "dpdp_mail_mark_ack", "dpdp_mail_mark_notified",
    ])
    const insert = h.calls[1].args
    expect(insert).toMatchObject({
      p_class: "grievance", p_from_addr: "asha@example.org", p_subject: "Complaint about my account", p_message_id: "<m1@example.org>",
      p_due_days: 90, p_ref: REF, p_to_addr: replyToAddress("grievance", REF), p_classifier_reason: "tag:grv", p_matched_outbound_ref: null,
      p_raw_forwarded: false, p_wants_ack: true, p_received_at: NOW.toISOString(),
    })
    expect(h.calls[0].args).toEqual({ p_ref: REF, p_message_ids: [] })

    expect(h.sent.length).toBe(2)
    const [ack, notice] = h.sent
    expect(ack.to).toBe("asha@example.org")
    expect(notice.to).toBe(OPERATOR)
  })

  test("the acknowledgement: prefixed subject, tagged Reply-To on a NEW ref, loop-guard headers, threading, idempotency key", async () => {
    const h = harness()
    await h.run(payload())
    const ack = h.sent[0]
    expect(ack.from).toBe("VERIDIAN AI DPDP <dpdp@veridian-aios.com>")
    expect(ack.subject).toBe("[VERIDIAN DPDP · GRIEVANCE] We received your message (ticket G-2026-0001)")
    expect(ack.replyTo).toMatch(/^dpdp\+grv\.[0-9abcdefghjkmnpqrstvwxyz]{10}@veridian-aios\.com$/)
    expect(ack.replyTo).not.toContain(REF)
    const ackRef = ack.replyTo!.split(".")[1].split("@")[0]
    expect(ack.headers).toMatchObject({
      "X-Veridian-Class": "grievance", "X-Veridian-Ref": ackRef, "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All",
      "X-Veridian-Origin": "acknowledgement", "In-Reply-To": "<m1@example.org>", References: "<m1@example.org>",
    })
    expect(ack.idempotencyKey).toBe("dpdp-inbound-ack-G-2026-0001")
    // The reply-to ref is logged, tied to the ticket, and filled in with the provider id after the send.
    const logged = h.outbound.find((o) => o.ref === ackRef)
    expect(logged).toMatchObject({ class: "grievance", ticketNo: "G-2026-0001", providerId: "resend-1", to: "asha@example.org" })
  })

  test("the acknowledgement text says received, ticket, will respond -- and asserts nothing legal", async () => {
    const h = harness()
    await h.run(payload())
    const text = h.sent[0].text
    expect(text).toContain("We received your message to VERIDIAN AI DPDP.")
    expect(text).toContain("G-2026-0001")
    expect(text).toContain("We will respond to you.")
    expect(text).toContain("Received: 2026-09-29 21:03 IST")
    // Nothing the sender wrote is repeated: the address it goes to is the unverified From.
    expect(text).not.toContain("Complaint about my account")
    expect(text).not.toContain("Subject received")
    expect(text).not.toMatch(/\b(days?|laws?|legal\w*|statut\w*|act|acts|deadline|within|guarantee\w*|oblig\w*|rights?|comply|compliance|liable|liability|penalt\w*|fine|fines)\b/i)
    expect(text).not.toMatch(/\d+\s*(day|hour|week|month)/i)
  })

  test("the acknowledgement repeats nothing the sender wrote, however the subject and text are dressed", async () => {
    const h = harness()
    const subject = "URGENT: send your bank details to pay@evil.example now"
    await h.run(payload({ subject, text: "complaint. Reply with your password to https://evil.example/login" }))
    const ack = h.sent[0]
    expect(ack.to).toBe("asha@example.org")
    expect(ack.subject).toBe("[VERIDIAN DPDP · GRIEVANCE] We received your message (ticket G-2026-0001)")
    for (const s of ["evil.example", "URGENT", "bank details", "password"]) {
      expect(ack.subject).not.toContain(s)
      expect(ack.text).not.toContain(s)
    }
    // ... while the operator's copy of the same message does carry it, quoted.
    expect(h.sent[1].text).toContain("evil.example")
  })

  test("the operator's notice: [LABEL ticket] subject, Reply-To the sender, summary block, original quoted", async () => {
    const h = harness()
    await h.run(payload())
    const notice = h.sent[1]
    expect(notice.subject).toBe("[GRIEVANCE G-2026-0001] Complaint about my account")
    expect(notice.replyTo).toBe("asha@example.org")
    expect(notice.headers).toMatchObject({ "X-Veridian-Class": "grievance", "X-Veridian-Ticket": "G-2026-0001", "X-Veridian-Origin": "inbound-notification", "Auto-Submitted": "auto-generated" })
    expect(notice.idempotencyKey).toBe("dpdp-inbound-notify-G-2026-0001")
    expect(notice.text).toContain("Class:         GRIEVANCE   (tag:grv)")
    expect(notice.text).toContain("Ticket:        G-2026-0001")
    expect(notice.text).toContain("Respond by:    2026-12-28 21:03 IST")
    expect(notice.text).toContain("confirm the number with counsel")
    expect(notice.text).toContain("From:          Asha M <asha@example.org>")
    expect(notice.text).toContain(`To:            ${replyToAddress("grievance", REF)}`)
    expect(notice.text).toContain("Received:      2026-09-29 21:03 IST")
    expect(notice.text).toContain("Acknowledgement: sent to the sender")
    expect(notice.text).toContain("----- original message -----\n> I have not received a response.\n> Please look into it.")
  })

  test("the legal window comes from configuration", async () => {
    const h = harness({ config: { legalResponseDays: 30 } })
    await h.run(payload())
    expect(h.calls[1].args.p_due_days).toBe(30)
    expect(h.sent[1].text).toContain("Respond by:    2026-10-29 21:03 IST")
  })

  test("the excerpt stored is capped at 4096 characters; the operator's copy carries the whole text", async () => {
    const h = harness()
    const long = "line of text\n".repeat(1000)
    await h.run(payload({ text: long }))
    expect((h.calls[1].args.p_excerpt as string).length).toBe(EXCERPT_CHARS)
    expect(h.sent[1].text).toContain(long.trim().split("\n").map((l) => `> ${l}`).slice(-1)[0])
    expect(h.sent[1].text.length).toBeGreaterThan(EXCERPT_CHARS * 2)
  })

  test("the Worker's received_at is the ticket's received time, and the due date counts from it", async () => {
    const h = harness()
    await h.run(payload({ received_at: "2026-09-29T15:30:00.000Z" }))
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_received_at).toBe("2026-09-29T15:30:00.000Z")
    expect(h.sent[1].text).toContain("Received:      2026-09-29 21:00 IST")
    expect(h.sent[1].text).toContain("Respond by:    2026-12-28 21:00 IST")
    // A Worker clock that is wildly off is ignored in favour of ours.
    const skewed = harness()
    await skewed.run(payload({ received_at: "2020-01-01T00:00:00.000Z" }))
    expect(skewed.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_received_at).toBe(NOW.toISOString())
  })

  test("a message the Worker only partly read says so", async () => {
    const h = harness()
    await h.run(payload({ truncated: true }))
    expect(h.sent[1].text).toContain("larger than the Worker reads")
  })

  test("an X-Autoreply that the Worker sent only as the top-level field, present but empty, is an auto-mail signal", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_to: MAILBOX, x_autoreply: "", subject: "hello", text: "hello" }))
    expect(await bodyOf(res)).toMatchObject({ class: "auto", notified: "skipped_auto" })
    expect(h.sent).toEqual([])
  })

  test("attachments are noted, never stored", async () => {
    const h = harness()
    await h.run(payload({ has_attachments: true }))
    expect(h.sent[1].text).toContain("The message had attachments. They are not stored anywhere.")
  })
})

describe("each class through the pipeline", () => {
  const CASES: Array<{ name: string; over: Record<string, unknown>; cls: MailClass; ticket: string; legal: boolean }> = [
    { name: "data request by keyword", over: { envelope_to: MAILBOX, subject: "Please delete my data", text: "delete my data" }, cls: "data_request", ticket: "D-2026-0001", legal: true },
    { name: "nothing recognisable is review", over: { envelope_to: MAILBOX, subject: "hello", text: "hello" }, cls: "review", ticket: "R-2026-0001", legal: true },
    { name: "monday reply by tag", over: { envelope_to: replyToAddress("monday", REF), subject: "Re: your week", text: "done" }, cls: "monday", ticket: "M-2026-0001", legal: false },
    { name: "reply to a statutory notice by tag", over: { envelope_to: replyToAddress("clock", REF), subject: "Re: [VERIDIAN DPDP · Statutory] 72-hour clock: data leak at Acme", text: "done, thanks" }, cls: "clock", ticket: "K-2026-0001", legal: false },
    { name: "sales by keyword", over: { envelope_to: MAILBOX, subject: "Hello", text: "what is your pricing?" }, cls: "sales", ticket: "S-2026-0001", legal: false },
    { name: "invoice by tag", over: { envelope_to: replyToAddress("invoice", REF), subject: "Re: your receipt", text: "thanks" }, cls: "invoice", ticket: "I-2026-0001", legal: false },
    { name: "partner by keyword", over: { envelope_to: MAILBOX, subject: "Hello", text: "we are a reseller" }, cls: "partner", ticket: "P-2026-0001", legal: false },
    { name: "support by keyword", over: { envelope_to: MAILBOX, subject: "Hello", text: "I need help with login" }, cls: "support", ticket: "H-2026-0001", legal: false },
  ]
  for (const c of CASES) {
    test(c.name, async () => {
      const h = harness()
      const res = await h.run(payload(c.over))
      const body = await bodyOf(res)
      expect(res.status).toBe(200)
      expect(body).toMatchObject({ ticket: c.ticket, class: c.cls, notified: "sent", ack: c.legal ? "sent" : "not_applicable" })
      const insert = h.calls.find((x) => x.fn === "dpdp_mail_insert_inbound")!.args
      expect(insert.p_due_days).toBe(c.legal ? 90 : null)
      expect(insert.p_wants_ack).toBe(c.legal)
      // The operator is always told; the sender is acknowledged only when a legal clock starts.
      expect(h.sent.filter((m) => m.to === OPERATOR).length).toBe(1)
      expect(h.sent.filter((m) => m.to === "asha@example.org").length).toBe(c.legal ? 1 : 0)
    })
  }

  test("a reply to something we sent is matched by message id and inherits its class (sales -> sales_chain)", async () => {
    const h = harness({ outbound: [{ ref: "m8n4p2qrs5", class: "sales", ticketNo: null, providerId: null, headerId: "sent-1@veridian-aios.com", to: "asha@example.org" }] })
    const res = await h.run(payload({ envelope_to: MAILBOX, subject: "Re: our proposal", text: "sounds good", in_reply_to: "<Sent-1@Veridian-AIOS.com>", references: "<old@x> <Sent-1@Veridian-AIOS.com>" }))
    expect(await bodyOf(res)).toMatchObject({ ticket: "T-2026-0001", class: "sales_chain", rule: "thread" })
    expect(h.calls[0].fn).toBe("dpdp_mail_lookup_outbound")
    expect(h.calls[0].args).toEqual({ p_ref: null, p_message_ids: ["sent-1@veridian-aios.com", "old@x"] })
    expect(h.calls[1].args).toMatchObject({ p_matched_outbound_ref: "m8n4p2qrs5", p_in_reply_to: "<Sent-1@Veridian-AIOS.com>" })
    expect(h.sent[0].text).toContain("In reply to:   our Sales message (ref m8n4p2qrs5)")
  })

  test("a tagged reply to our acknowledgement is tied back to the ticket it acknowledged", async () => {
    const h = harness({ outbound: [{ ref: REF, class: "grievance", ticketNo: "G-2026-0007", providerId: null, headerId: null, to: "asha@example.org" }] })
    await h.run(payload({ text: "any update?" }))
    expect(h.calls[1].args.p_matched_outbound_ref).toBe(REF)
    expect(h.sent.find((m) => m.to === OPERATOR)!.text).toContain("In reply to:   ticket G-2026-0007, our GRIEVANCE message (ref k3f9x2ab7q)")
  })
})

describe("escalation: a legal request is ticketed, due-dated and acknowledged whichever mail it answers", () => {
  const monday = (over: Record<string, unknown> = {}) => payload({ envelope_to: replyToAddress("monday", REF), subject: "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week", message_id: "<esc-1@example.org>", ...over })

  test("a Monday reply that says 'stop sending, delete my data' is a data_request: due date, acknowledgement, operator notice", async () => {
    const h = harness()
    const res = await h.run(monday({ text: "Please stop sending me these emails. Delete my data." }))
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ ok: true, ticket: "D-2026-0001", class: "data_request", rule: "escalation", ack: "sent", notified: "sent" })
    const insert = h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args
    expect(insert).toMatchObject({ p_class: "data_request", p_due_days: 90, p_wants_ack: true, p_ref: REF })
    expect(String(insert.p_classifier_reason)).toMatch(/^tag:mon; escalated keyword:data_request:"/)
    const [ack, notice] = h.sent
    expect(ack.to).toBe("asha@example.org")
    expect(ack.subject).toBe("[VERIDIAN DPDP · DATA REQUEST] We received your message (ticket D-2026-0001)")
    expect(ack.replyTo).toMatch(/^dpdp\+dsr\.[0-9abcdefghjkmnpqrstvwxyz]{10}@veridian-aios\.com$/)
    expect(notice.to).toBe(OPERATOR)
    expect(notice.subject).toBe("[DATA REQUEST D-2026-0001] [VERIDIAN DPDP · Monday] Acme: DPDP this week")
    expect(notice.text).toContain('Class:         DATA REQUEST   (tag:mon; escalated keyword:data_request:"')
    expect(notice.text).toContain("Respond by:    2026-12-28 21:03 IST")
    expect(notice.text).toContain("Acknowledgement: sent to the sender")
  })

  test("a reply on an invoice thread that says 'I want to file a complaint' is a grievance, matched to the invoice it answers", async () => {
    const h = harness({ outbound: [{ ref: "m8n4p2qrs5", class: "invoice", ticketNo: null, providerId: "prov-inv-1", headerId: null, to: "asha@example.org" }] })
    const res = await h.run(payload({
      envelope_to: MAILBOX, subject: "Re: [VERIDIAN DPDP · Invoice] Your VERIDIAN receipt", message_id: "<esc-2@example.org>",
      in_reply_to: "<prov-inv-1>", text: "I want to file a complaint about misuse of my data.",
    }))
    expect(await bodyOf(res)).toMatchObject({ ticket: "G-2026-0001", class: "grievance", rule: "escalation", ack: "sent", notified: "sent" })
    const insert = h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args
    expect(insert).toMatchObject({ p_class: "grievance", p_due_days: 90, p_wants_ack: true, p_matched_outbound_ref: "m8n4p2qrs5" })
    expect(String(insert.p_classifier_reason)).toBe('thread:invoice(message_id:m8n4p2qrs5); escalated keyword:grievance:"complain"')
    expect(h.sent[0].subject).toBe("[VERIDIAN DPDP · GRIEVANCE] We received your message (ticket G-2026-0001)")
  })

  test("a plain 'thanks for the invoice' stays an invoice reply: no due date, no acknowledgement", async () => {
    const h = harness({ outbound: [{ ref: "m8n4p2qrs5", class: "invoice", ticketNo: null, providerId: "prov-inv-1", headerId: null, to: "asha@example.org" }] })
    const res = await h.run(payload({ envelope_to: MAILBOX, subject: "Re: [VERIDIAN DPDP · Invoice] Your VERIDIAN receipt", in_reply_to: "<prov-inv-1>", text: "Thanks for the invoice, received." }))
    expect(await bodyOf(res)).toMatchObject({ ticket: "I-2026-0001", class: "invoice", rule: "thread", ack: "not_applicable", notified: "sent" })
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args).toMatchObject({ p_due_days: null, p_wants_ack: false })
    expect(h.sent.map((m) => m.to)).toEqual([OPERATOR])
  })

  test("a reply to a statutory notice (class clock) is ticketed K-, notified, not acknowledged; a complaint in it is raised", async () => {
    const outbound = [{ ref: REF, class: "clock" as MailClass, ticketNo: null, providerId: null, headerId: null, to: "asha@example.org" }]
    const thanks = harness({ outbound })
    expect(await bodyOf(await thanks.run(payload({ envelope_to: replyToAddress("clock", REF), subject: "Re: [VERIDIAN DPDP · Statutory] 72-hour clock: data leak at Acme - tell the Data Protection Board", text: "Done, thanks." }))))
      .toMatchObject({ ticket: "K-2026-0001", class: "clock", ack: "not_applicable", notified: "sent" })
    expect(thanks.sent.map((m) => m.to)).toEqual([OPERATOR])
    expect(thanks.sent[0].subject).toBe("[Statutory K-2026-0001] [VERIDIAN DPDP · Statutory] 72-hour clock: data leak at Acme - tell the Data Protection Board")
    expect(thanks.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args).toMatchObject({ p_class: "clock", p_due_days: null, p_wants_ack: false })

    const angry = harness({ outbound })
    expect(await bodyOf(await angry.run(payload({ envelope_to: replyToAddress("clock", REF), subject: "Re: [VERIDIAN DPDP · Statutory] 72-hour clock: data leak at Acme", text: "This is a complaint: nobody told me." }))))
      .toMatchObject({ ticket: "G-2026-0001", class: "grievance", ack: "sent" })
  })

  test("a vacation reply to the Monday digest that QUOTES it (footer and all) stays auto: recorded, nobody emailed, no acknowledgement", async () => {
    const h = harness()
    const quoted = [
      "I am out of the office until 5 October.",
      "",
      "On Mon, 28 Sep 2026 at 06:00, VERIDIAN AI DPDP <dpdp@veridian-aios.com> wrote:",
      "> Acme: DPDP this week — 3 open jobs, 1 escalated to you",
      "> Late 7 days or more — your DPDP coordinator has been copied.",
      "> Stop these weekly emails (statutory notices continue): https://x.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=abc",
    ].join("\n")
    const res = await h.run(monday({ subject: "Automatic reply: [VERIDIAN DPDP · Monday] Acme: DPDP this week — 3 open jobs, 1 escalated to you", headers: { "auto-submitted": "auto-replied" }, auto_submitted: "auto-replied", text: quoted }))
    expect(await bodyOf(res)).toMatchObject({ ok: true, class: "auto", rule: "auto", ticket: "A-2026-0001", ack: "not_applicable", notified: "skipped_auto" })
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args).toMatchObject({ p_class: "auto", p_due_days: null, p_wants_ack: false })
    expect(h.sent).toEqual([])
  })

  test("the SAME auto header on a real 'delete my data' is a data_request, ACKNOWLEDGED (sender-chosen headers do not hide a legal request), operator told", async () => {
    const h = harness()
    const res = await h.run(monday({ subject: "Automatic reply: [VERIDIAN DPDP · Monday] Acme: DPDP this week", headers: { "auto-submitted": "auto-replied" }, auto_submitted: "auto-replied", text: "Please delete my data." }))
    expect(await bodyOf(res)).toMatchObject({ ticket: "D-2026-0001", class: "data_request", rule: "escalation", ack: "sent", notified: "sent" })
    expect(h.sent.map((m) => m.to)).toEqual(["asha@example.org", OPERATOR])
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args).toMatchObject({ p_wants_ack: true, p_due_days: 90 })
    expect(String(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_classifier_reason)).toMatch(/^auto:Auto-Submitted=auto-replied, auto-reply style subject; escalated keyword:data_request:/)
    // Our own acknowledgement is still stamped so a compliant responder will not answer it.
    expect(h.sent[0].headers).toMatchObject({ "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All", "X-Veridian-Origin": "acknowledgement" })
  })

  test("LOOP GUARD: a header-flagged reply to our OWN acknowledgement that mentions a complaint is ticketed and reported, but NOT acknowledged again", async () => {
    const h = harness({ outbound: [{ ref: REF, class: "grievance", ticketNo: "G-2026-0007", providerId: "resend-x", headerId: null, to: "asha@example.org" }] })
    const res = await h.run(payload({ subject: "Automatic reply: We received your message", headers: { "auto-submitted": "auto-replied" }, auto_submitted: "auto-replied", text: "Your complaint has been registered as ticket 4411." }))
    expect(await bodyOf(res)).toMatchObject({ class: "grievance", rule: "escalation", ack: "skipped", notified: "sent" })
    expect(h.sent.map((m) => m.to)).toEqual([OPERATOR])
    expect(h.sent[0].text).toContain("Acknowledgement: NOT sent -- an automatic reply to our own acknowledgement of ticket G-2026-0007")
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_wants_ack).toBe(false)
    // The same reply with no legal words is auto: nobody emailed at all.
    const quiet = harness({ outbound: [{ ref: REF, class: "grievance", ticketNo: "G-2026-0007", providerId: "resend-x", headerId: null, to: "asha@example.org" }] })
    expect(await bodyOf(await quiet.run(payload({ subject: "Automatic reply: We received your message", headers: { "auto-submitted": "auto-replied" }, auto_submitted: "auto-replied", text: "I am on leave." }))))
      .toMatchObject({ class: "auto", notified: "skipped_auto" })
    expect(quiet.sent).toEqual([])
  })

  test("X-Veridian-Origin without a thread match is only a header anyone can type: the message is read, not hidden", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_to: MAILBOX, subject: "hello", text: "hello", headers: { "x-veridian-origin": "acknowledgement" } }))
    expect(await bodyOf(res)).toMatchObject({ class: "review", notified: "sent" })
    expect(h.sent.some((m) => m.to === OPERATOR)).toBe(true)
  })

  test("a bounce that quotes our mail and someone's 'delete my data' stays auto: never escalated, nobody emailed", async () => {
    const h = harness()
    const res = await h.run(payload({
      envelope_from: "", header_from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", from_address: "mailer-daemon@googlemail.com", from_name: "Mail Delivery Subsystem",
      envelope_to: replyToAddress("grievance", REF), subject: "Delivery Status Notification (Failure)", content_type: "multipart/report; report-type=delivery-status",
      text: "550 user unknown\n\nPlease delete my data. This is a complaint.", message_id: "<bounce-2@googlemail.com>",
    }))
    expect(await bodyOf(res)).toMatchObject({ class: "auto", notified: "skipped_auto", ack: "not_applicable" })
    expect(h.sent).toEqual([])
    expect(String(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_classifier_reason)).not.toContain("escalated keyword")
  })
})

describe("the acknowledgement of a review message shows no REVIEW label", () => {
  test("ackSubject: review is neutral, every other class keeps its label", () => {
    expect(ackSubject("review", "R-2026-0001")).toBe("[VERIDIAN DPDP] We received your message (ticket R-2026-0001)")
    expect(ackSubject("grievance", "G-2026-0001")).toBe("[VERIDIAN DPDP · GRIEVANCE] We received your message (ticket G-2026-0001)")
    expect(ackSubject("data_request", "D-2026-0001")).toBe("[VERIDIAN DPDP · DATA REQUEST] We received your message (ticket D-2026-0001)")
  })
  test("through the pipeline: an unclassifiable message is acknowledged as '[VERIDIAN DPDP] We received your message (ticket R-...)', the operator's notice still says REVIEW", async () => {
    const h = harness()
    await h.run(payload({ envelope_to: MAILBOX, subject: "hello", text: "hello" }))
    const [ack, notice] = h.sent
    expect(ack.to).toBe("asha@example.org")
    expect(ack.subject).toBe("[VERIDIAN DPDP] We received your message (ticket R-2026-0001)")
    expect(ack.subject).not.toMatch(/review/i)
    expect(ack.text).not.toMatch(/review/i)
    expect(notice.subject).toBe("[REVIEW R-2026-0001] hello")
    // The class is still on the Reply-To tag and the headers, so a reply to it is filed as review.
    expect(ack.replyTo).toMatch(/^dpdp\+rev\./)
    expect(ack.headers["X-Veridian-Class"]).toBe("review")
  })
})

describe("auto mail: logged, never announced, never acknowledged", () => {
  test("an auto-reply is recorded as auto and nobody is emailed", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_to: MAILBOX, subject: "Automatic reply: hello", text: "I am away", auto_submitted: "auto-replied", headers: { "auto-submitted": "auto-replied" } }))
    expect(await bodyOf(res)).toMatchObject({ ok: true, class: "auto", ticket: "A-2026-0001", notified: "skipped_auto", ack: "not_applicable" })
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args).toMatchObject({ p_class: "auto", p_due_days: null, p_wants_ack: false })
    expect(h.sent).toEqual([])
  })
  test("a bounce from MAILER-DAEMON with a delivery-status content type", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_from: "", header_from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", from_address: "mailer-daemon@googlemail.com", from_name: "Mail Delivery Subsystem", envelope_to: MAILBOX, subject: "Delivery Status Notification (Failure)", content_type: "multipart/report; report-type=delivery-status", text: "550 user unknown" }))
    expect((await bodyOf(res)).class).toBe("auto")
    expect(h.sent).toEqual([])
  })
  test("mail from our own mailbox is auto (loop guard) and sends nothing", async () => {
    const h = harness()
    const res = await h.run(payload({ ...sender(MAILBOX), envelope_to: MAILBOX, text: "delete my data" }))
    expect(await bodyOf(res)).toMatchObject({ class: "auto", notified: "skipped_auto" })
    expect(h.sent).toEqual([])
  })
  test("a grievance-TAGGED message with auto headers and no earlier message of ours behind it is ticketed, reported AND acknowledged (owner decision: a legal channel is answered; only a reply to our own acknowledgement is the loop)", async () => {
    const h = harness()
    const res = await h.run(payload({ message_id: "<ooo@example.org>", headers: { "auto-submitted": "auto-replied" }, auto_submitted: "auto-replied", text: "I am out of office" }))
    expect(await bodyOf(res)).toMatchObject({ class: "grievance", rule: "tag", ack: "sent", notified: "sent" })
    expect(h.sent.map((m) => m.to)).toEqual(["asha@example.org", OPERATOR])
    expect(h.sent[1].text).toContain("Acknowledgement: sent to the sender")
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args).toMatchObject({ p_wants_ack: true, p_due_days: 90 })
    // The acknowledgement itself is stamped so that a compliant responder will not answer it.
    expect(h.sent[0].headers).toMatchObject({ "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All", "X-Veridian-Origin": "acknowledgement" })
    expect(String(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_classifier_reason)).toContain("auto-mail headers ignored for a legal tag")
  })
  test("an automatic List-Unsubscribe mailto (dpdp+dsr.<ref>@ carrying the ref of a MONDAY row, with auto headers and no words) is a data_request: ticketed, the operator told AND the sender acknowledged, not auto", async () => {
    const h = harness({ outbound: [{ ref: REF, class: "monday", ticketNo: null, providerId: null, headerId: null, to: "asha@example.org" }] })
    const res = await h.run(payload({ envelope_to: replyToAddress("data_request", REF), message_id: "<unsub@example.org>", subject: "", text: "", headers: { "auto-submitted": "auto-generated", precedence: "bulk" } }))
    expect(await bodyOf(res)).toMatchObject({ ok: true, class: "data_request", rule: "tag", notified: "sent", ack: "sent" })
    const insert = h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args
    expect(insert).toMatchObject({ p_class: "data_request", p_due_days: 90, p_wants_ack: true, p_matched_outbound_ref: REF })
    expect(h.sent.map((m) => m.to)).toEqual(["asha@example.org", OPERATOR])
    expect(h.sent[0].subject).toContain("DATA REQUEST")
    expect(h.sent[1].subject).toContain("DATA REQUEST")
  })
  test("the same automatic unsubscribe when a row of a LEGAL class without a ticket number is what it matched: still not the loop, still acknowledged", async () => {
    const h = harness({ outbound: [{ ref: REF, class: "grievance", ticketNo: null, providerId: null, headerId: null, to: "asha@example.org" }] })
    const res = await h.run(payload({ envelope_to: replyToAddress("data_request", REF), message_id: "<unsub2@example.org>", subject: "", text: "", headers: { precedence: "bulk" } }))
    expect(await bodyOf(res)).toMatchObject({ class: "data_request", rule: "tag", ack: "sent", notified: "sent" })
  })
  test("LOOP GUARD, tag form: the same message as a reply to our OWN acknowledgement (its outbound row has the ticket number) is auto: recorded, nobody emailed", async () => {
    const h = harness({ outbound: [{ ref: REF, class: "data_request", ticketNo: "D-2026-0007", providerId: "resend-x", headerId: null, to: "asha@example.org" }] })
    const res = await h.run(payload({ envelope_to: replyToAddress("data_request", REF), message_id: "<oof@example.org>", subject: "Automatic reply: We received your message", text: "", headers: { "auto-submitted": "auto-replied" }, auto_submitted: "auto-replied" }))
    expect(await bodyOf(res)).toMatchObject({ class: "auto", notified: "skipped_auto", ack: "not_applicable" })
    expect(h.sent).toEqual([])
  })
  test("a legal tag with auto headers stays bounded by the caps: when the database holds the acknowledgement back (per sender / hourly) the ticket and the notice remain", async () => {
    for (const ackLimit of ["sender", "hourly"] as const) {
      const h = harness({ ackAllowed: false, ackLimit })
      const res = await h.run(payload({ message_id: `<cap-${ackLimit}@example.org>`, headers: { precedence: "bulk" }, text: "" }))
      expect(await bodyOf(res)).toMatchObject({ class: "grievance", ack: "skipped", notified: "sent" })
      expect(h.sent.map((m) => m.to)).toEqual([OPERATOR])
      expect(h.sent[0].text).toContain(ackLimit === "sender" ? "24-hour limit of 3 acknowledgements" : "overall limit of 30 acknowledgements")
    }
  })
  test("an empty envelope sender (a null reverse-path) with a real header From is a header-class signal: auto with nothing legal in it, a ticketed and acknowledged data request with one", async () => {
    const quiet = harness()
    const res = await quiet.run(payload({ envelope_from: "", envelope_to: MAILBOX, subject: "Hello", text: "Thanks for your time last week.", message_id: "<null1@example.org>" }))
    expect(await bodyOf(res)).toMatchObject({ class: "auto", rule: "auto", notified: "skipped_auto", ack: "not_applicable" })
    expect(quiet.sent).toEqual([])
    expect(String(quiet.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_classifier_reason)).toBe("auto:empty Return-Path")

    const asks = harness()
    const res2 = await asks.run(payload({ envelope_from: "", envelope_to: MAILBOX, subject: "Hello", text: "Please delete my data.", message_id: "<null2@example.org>" }))
    expect(await bodyOf(res2)).toMatchObject({ class: "data_request", rule: "escalation", ack: "sent", notified: "sent" })
    expect(asks.sent.map((m) => m.to)).toEqual(["asha@example.org", OPERATOR])
  })
  test("an ABSENT envelope sender is not a null sender: only a present, empty one is", async () => {
    const h = harness()
    const p = payload({ envelope_to: MAILBOX, subject: "Hello", text: "Thanks for your time last week.", message_id: "<null3@example.org>" }) as Record<string, unknown>
    delete p.envelope_from
    expect(await bodyOf(await h.run(p))).toMatchObject({ class: "review", notified: "sent" })
  })
})

describe("who is never acknowledged", () => {
  const BLOCKED: Array<[string, Record<string, unknown>, string]> = [
    ["a no-reply address", { ...sender("no-reply@vendor.example") }, "no-reply"],
    ["a donotreply address", { ...sender("donotreply@vendor.example") }, "no-reply"],
    ["our own mailbox as the header From with a different envelope", { header_from: `Us <${MAILBOX}>`, from_address: MAILBOX, from_name: "Us" }, "our own mailbox"],
    ["no sender at all", { ...sender(""), header_from: "" }, "no usable sender"],
    ["a sender that failed DMARC", { headers: { "authentication-results": "mx.example; dmarc=fail header.from=example.org" } }, "DMARC"],
  ]
  for (const [name, over, fragment] of BLOCKED) {
    test(`${name}: recorded and reported, no acknowledgement`, async () => {
      const h = harness()
      const res = await h.run(payload(over))
      const body = await bodyOf(res)
      // "our own mailbox" is the self rule -> auto; the rest are grievances that are simply not acknowledged.
      if (fragment === "our own mailbox") {
        expect(body.class).toBe("auto")
        return
      }
      expect(body).toMatchObject({ class: "grievance", ack: "skipped", notified: "sent" })
      expect(h.sent.every((m) => m.to === OPERATOR)).toBe(true)
      expect(h.sent[0].text).toContain(fragment)
    })
  }
  test("a postmaster sender is a NAME, not a bounce: a plain text mail from it is an ordinary mail (ticketed, ACKNOWLEDGED, reported)", async () => {
    const h = harness()
    const res = await h.run(payload({ ...sender("postmaster@vendor.example") }))
    expect(await bodyOf(res)).toMatchObject({ class: "grievance", ack: "sent", notified: "sent" })
    expect(h.sent.map((m) => m.to)).toEqual(["postmaster@vendor.example", OPERATOR])
    // ... and a legal request in it, untagged, is classified by its words like any other mail
    const asks = harness()
    const res2 = await asks.run(payload({ ...sender("postmaster@smallfirm.example"), envelope_to: MAILBOX, subject: "Request", text: "Please delete my data.", message_id: "<pm2@smallfirm.example>" }))
    expect(await bodyOf(res2)).toMatchObject({ class: "data_request", rule: "keyword", ack: "sent", notified: "sent" })
    expect(asks.sent.map((m) => m.to)).toEqual(["postmaster@smallfirm.example", OPERATOR])
  })
  test("a postmaster / mailer-daemon sender WITH a second machine signal is a bounce (machine-generated): auto, recorded, nobody emailed", async () => {
    for (const over of [
      { headers: { "return-path": "<>" } }, { envelope_from: "" }, { content_type: "multipart/report; report-type=delivery-status" },
      { headers: { "auto-submitted": "auto-generated" }, auto_submitted: "auto-generated" }, { subject: "Undeliverable: your week" },
    ]) {
      for (const who of ["postmaster@vendor.example", "mailer-daemon@vendor.example"]) {
        const h = harness()
        const res = await h.run(payload({ ...sender(who), ...over, text: "Please delete my data. This is a complaint." }))
        expect(await bodyOf(res), JSON.stringify(over)).toMatchObject({ class: "auto", notified: "skipped_auto", ack: "not_applicable" })
        expect(h.sent).toEqual([])
      }
    }
  })
  test("a database that holds the acknowledgement back (ackDue=false) still gets the ticket and the operator's notice, and the notice says to answer by hand", async () => {
    const h = harness({ ackAllowed: false })
    const res = await h.run(payload())
    expect(await bodyOf(res)).toMatchObject({ ticket: "G-2026-0001", ack: "skipped", notified: "sent" })
    expect(h.sent.map((m) => m.to)).toEqual([OPERATOR])
    expect(h.sent[0].text).toContain("Acknowledgement: NOT sent -- already acknowledged, or an acknowledgement limit was reached")
    expect(h.sent[0].text).toContain("answer by hand")
  })
  test("the per-sender limit (3 in 24 hours) and the overall hourly limit (30) are each named in the notice", async () => {
    const sender = harness({ ackAllowed: false, ackLimit: "sender" })
    await sender.run(payload())
    expect(sender.sent.map((m) => m.to)).toEqual([OPERATOR])
    expect(sender.sent[0].text).toContain("Acknowledgement: NOT sent -- this sender has reached the 24-hour limit of 3 acknowledgements")
    const hourly = harness({ ackAllowed: false, ackLimit: "hourly" })
    const res = await hourly.run(payload({ envelope_to: MAILBOX, subject: "Please delete my data", text: "delete my data" }))
    expect(await bodyOf(res)).toMatchObject({ ticket: "D-2026-0001", class: "data_request", ack: "skipped", notified: "sent" })
    expect(hourly.sent.map((m) => m.to)).toEqual([OPERATOR])
    expect(hourly.sent[0].text).toContain("Acknowledgement: NOT sent -- the overall limit of 30 acknowledgements in one hour was reached; answer this sender by hand")
    // The ticket is still due-dated: the clock runs whether or not an acknowledgement went out.
    expect(hourly.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_due_days).toBe(90)
    expect(hourly.sent[0].text).toContain("Respond by:")
  })
  test("ackBlocker is null for an ordinary sender", () => {
    const mail = parseInbound(payload())!
    expect(ackBlocker(mail, { autoSignals: [], escalatedFrom: null })).toBeNull()
  })
  test("ackBlocker: auto-mail signals block a message that was not escalated; an escalated one is acknowledged unless it answers our own acknowledgement", () => {
    const mail = parseInbound(payload())!
    expect(ackBlocker(mail, { autoSignals: ["Precedence=bulk"], escalatedFrom: null })).toContain("auto-mail signals")
    expect(ackBlocker(mail, { autoSignals: ["Precedence=bulk"], escalatedFrom: "auto" })).toBeNull()
    expect(ackBlocker(mail, { autoSignals: ["Precedence=bulk"], escalatedFrom: "auto" }, { ticketNo: null })).toBeNull()
    expect(ackBlocker(mail, { autoSignals: ["Precedence=bulk"], escalatedFrom: "auto" }, { ticketNo: "G-2026-0007" })).toContain("our own acknowledgement of ticket G-2026-0007")
    // No auto headers at all: a reply to an acknowledgement is an ordinary follow-up and is acknowledged.
    expect(ackBlocker(mail, { autoSignals: [], escalatedFrom: "monday" }, { ticketNo: "G-2026-0007" })).toBeNull()
    // The structural blockers apply to an escalated message too.
    const noreply = parseInbound(payload({ ...sender("no-reply@vendor.example") }))!
    expect(ackBlocker(noreply, { autoSignals: [], escalatedFrom: "monday" })).toContain("no-reply")
  })
  test("ackBlocker: a legal tag that stood alone against auto headers (autoHeadersIgnored) is acknowledged, unless it answers our own acknowledgement", () => {
    const mail = parseInbound(payload())!
    const ignored = { autoSignals: ["Precedence=bulk"], escalatedFrom: null, autoHeadersIgnored: true }
    expect(ackBlocker(mail, ignored)).toBeNull()
    expect(ackBlocker(mail, ignored, { ticketNo: null })).toBeNull()
    expect(ackBlocker(mail, ignored, { ticketNo: "D-2026-0007" })).toContain("our own acknowledgement of ticket D-2026-0007")
    // Without the flag the very same signals still block, and the flag does not lift a structural blocker.
    expect(ackBlocker(mail, { autoSignals: ["Precedence=bulk"], escalatedFrom: null, autoHeadersIgnored: false })).toContain("auto-mail signals")
    expect(ackBlocker(parseInbound(payload({ ...sender("no-reply@vendor.example") }))!, ignored)).toContain("no-reply")
    expect(ackBlocker(parseInbound(payload({ ...sender("bounce@vendor.example") }))!, ignored)).toContain("no-reply")
  })
  test("ackBlocker: postmaster@ and mailer-daemon@ are not refused (a legal-class message from one is a real mail); no-reply and bounce addresses are", () => {
    for (const who of ["postmaster@smallfirm.example", "mailer-daemon@smallfirm.example", "MAILER-DAEMON@smallfirm.example"]) {
      expect(ackBlocker(parseInbound(payload({ ...sender(who) }))!, { autoSignals: [], escalatedFrom: null }), who).toBeNull()
    }
    for (const who of ["noreply@x.example", "no-reply+abc@x.example", "do-not-reply@x.example", "bounces@x.example"]) {
      expect(ackBlocker(parseInbound(payload({ ...sender(who) }))!, { autoSignals: [], escalatedFrom: null }), who).toContain("no-reply")
    }
  })
})

describe("parseInbound: the null sender and the truncation flag", () => {
  test("nullSender is true only for a PRESENT, empty envelope sender (or the null reverse-path), in any of its spellings", () => {
    expect(parseInbound(payload({ envelope_from: "" }))!.nullSender).toBe(true)
    expect(parseInbound(payload({ envelope_from: "  " }))!.nullSender).toBe(true)
    expect(parseInbound(payload({ envelope_from: "<>" }))!.nullSender).toBe(true)
    expect(parseInbound(payload({ envelope_from: " < > " }))!.nullSender).toBe(true)
    expect(parseInbound({ ...payload(), envelope_from: undefined, envelopeFrom: "" })!.nullSender).toBe(true)
    expect(parseInbound({ ...payload(), envelope_from: undefined, mailFrom: "<>" })!.nullSender).toBe(true)
    expect(parseInbound(payload({ envelope_from: "asha@example.org" }))!.nullSender).toBe(false)
    expect(parseInbound(payload({ envelope_from: null }))!.nullSender).toBe(false)
    const absent = payload() as Record<string, unknown>
    delete absent.envelope_from
    expect(parseInbound(absent)!.nullSender).toBe(false)
  })
  test("truncated is read from the payload (true only for the boolean true)", () => {
    expect(parseInbound(payload({ truncated: true }))!.truncated).toBe(true)
    expect(parseInbound(payload({ truncated: "yes" }))!.truncated).toBe(false)
    expect(parseInbound(payload())!.truncated).toBe(false)
  })
})

describe("a message the Worker cut short (item: truncated + too little of the person's own text -> review)", () => {
  const MON = replyToAddress("monday", REF)
  test("through the pipeline: a truncated Monday reply with (almost) no readable text is a review: ticket R-, due date, acknowledged, operator told", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_to: MON, subject: "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week", text: "ok", truncated: true, message_id: "<trunc1@example.org>" }))
    expect(await bodyOf(res)).toMatchObject({ ok: true, ticket: "R-2026-0001", class: "review", rule: "escalation", ack: "sent", notified: "sent" })
    const insert = h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args
    expect(insert).toMatchObject({ p_class: "review", p_due_days: 90, p_wants_ack: true })
    expect(String(insert.p_classifier_reason)).toBe("tag:mon; the message was cut short and too little of the person's own text was read to classify it")
    expect(h.sent.map((m) => m.to)).toEqual(["asha@example.org", OPERATOR])
    expect(h.sent[1].text).toContain("larger than the Worker reads")
  })
  test("the same message NOT cut short is a plain Monday reply: no ticket clock, no acknowledgement", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_to: MON, subject: "Re: [VERIDIAN DPDP · Monday] Acme: DPDP this week", text: "ok", message_id: "<trunc2@example.org>" }))
    expect(await bodyOf(res)).toMatchObject({ class: "monday", ack: "not_applicable", notified: "sent" })
    expect(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args).toMatchObject({ p_due_days: null, p_wants_ack: false })
  })
  test("a truncated message with real text is read as usual", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_to: MON, subject: "Re: hello", text: "Thanks, noted, we will revert next week.", truncated: true, message_id: "<trunc3@example.org>" }))
    expect(await bodyOf(res)).toMatchObject({ class: "monday" })
  })
})

describe("a Message-ID reused for a DIFFERENT message (dpdp_mail_insert_inbound gave it its own ticket)", () => {
  test("the operator's notice and the log line say so; the ticket is not a duplicate", async () => {
    const h = harness()
    const original = h.deps.rpc
    h.deps.rpc = async (fn, args) => {
      const res = await original(fn, args)
      if (fn === "dpdp_mail_insert_inbound" && res.data) (res.data as Record<string, unknown>).messageIdReused = true
      return res
    }
    const res = await h.run(payload({ message_id: "<reused@example.org>" }))
    expect(await bodyOf(res)).toMatchObject({ ok: true, ticket: "G-2026-0001", duplicate: false })
    expect(h.sent[h.sent.length - 1].text).toContain(`; ${MESSAGE_ID_REUSED_NOTE})`)
    const line = JSON.parse(h.logs.find((l) => l.includes('"ticket"') && l.includes('"class"'))!)
    expect(line).toMatchObject({ duplicate: false, messageIdReused: true })
  })
  test("without the flag the notice carries no such note", async () => {
    const h = harness()
    await h.run(payload({ message_id: "<plain@example.org>" }))
    expect(h.sent[h.sent.length - 1].text).not.toContain(MESSAGE_ID_REUSED_NOTE)
  })
})

describe("nothing is lost: degraded paths", () => {
  test("a classifier that throws files the message as review, raw_forwarded, and tells the operator to read it", async () => {
    const h = harness({ classify: () => { throw new Error("regex exploded") } })
    const res = await h.run(payload({ envelope_to: MAILBOX, text: "delete my data" }))
    expect(await bodyOf(res)).toMatchObject({ ok: true, class: "review", ticket: "R-2026-0001", notified: "sent" })
    const insert = h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args
    expect(insert).toMatchObject({ p_class: "review", p_raw_forwarded: true, p_due_days: 90 })
    expect(String(insert.p_classifier_reason)).toContain("classifier-error:regex exploded")
    const notice = h.sent.find((m) => m.to === OPERATOR)!
    expect(notice.subject).toBe("[CLASSIFIER FAILED R-2026-0001] Complaint about my account")
    expect(notice.text).toContain("THE CLASSIFIER FAILED")
  })

  test("a failed outbound lookup does not stop classification, and the reason says so", async () => {
    const h = harness({ failRpc: { dpdp_mail_lookup_outbound: new Error("db timeout") } })
    const res = await h.run(payload({ envelope_to: MAILBOX, text: "delete my data", in_reply_to: "<something@example.org>" }))
    expect(await bodyOf(res)).toMatchObject({ ok: true, class: "data_request" })
    expect(String(h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")!.args.p_classifier_reason)).toContain("outbound lookup failed")
    expect(h.sent.some((m) => m.to === OPERATOR)).toBe(true)
  })

  test("the database cannot record: the RAW message goes to the operator, 200 degraded, no ticket, no acknowledgement", async () => {
    const h = harness({ failRpc: { dpdp_mail_insert_inbound: new Error("connection refused") } })
    const res = await h.run(payload())
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ ok: true, ticket: null, degraded: true, notified: "raw_forwarded", class: "grievance" })
    expect(h.sent.length).toBe(1)
    const raw = h.sent[0]
    expect(raw.to).toBe(OPERATOR)
    expect(raw.subject).toBe("[GRIEVANCE UNRECORDED] Complaint about my account")
    expect(raw.replyTo).toBe("asha@example.org")
    expect(raw.text).toContain("could NOT be recorded")
    expect(raw.text).toContain("connection refused")
    expect(raw.text).toContain("> I have not received a response.")
    expect(raw.text).toContain("No acknowledgement was sent to the sender")
  })

  test("the database cannot record AND the raw forward fails: 502, so the Worker forwards natively", async () => {
    const h = harness({ failRpc: { dpdp_mail_insert_inbound: new Error("down") }, failSend: () => true })
    const res = await h.run(payload())
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toMatchObject({ ok: false, degraded: true })
  })

  test("the database cannot record and there is no way to email: 502", async () => {
    for (const config of [{ dryRun: true }, { operatorEmail: "" }]) {
      const h = harness({ failRpc: { dpdp_mail_insert_inbound: new Error("down") }, config })
      expect((await h.run(payload())).status).toBe(502)
      expect(h.sent).toEqual([])
    }
  })

  test("an insert that answers without a ticket is treated as a failure, not as success", async () => {
    const h = harness()
    const original = h.deps.rpc
    h.deps.rpc = async (fn, args) => (fn === "dpdp_mail_insert_inbound" ? { data: { duplicate: false }, error: null } : original(fn, args))
    const res = await h.run(payload())
    expect(await bodyOf(res)).toMatchObject({ degraded: true })
    expect(h.sent.length).toBe(1)
  })

  test("the operator notice fails: the message IS recorded (and acknowledged), the answer is 502", async () => {
    const h = harness({ failSend: (m) => m.to === OPERATOR })
    const res = await h.run(payload())
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toMatchObject({ ok: false, ticket: "G-2026-0001", ack: "sent", notified: "failed" })
    expect(h.fns()).not.toContain("dpdp_mail_mark_notified")
    expect(h.inbound[0].notified).toBe(false)
  })

  test("no DPDP_OPERATOR_EMAIL: recorded, acknowledged, answer 502", async () => {
    const h = harness({ config: { operatorEmail: "" } })
    const res = await h.run(payload())
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toMatchObject({ ticket: "G-2026-0001", ack: "sent", notified: "no_operator_email" })
  })

  test("a failed acknowledgement is reported to the operator and does not stop the notice", async () => {
    const h = harness({ failSend: (m) => m.to === "asha@example.org" })
    const res = await h.run(payload())
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ ack: "failed", notified: "sent" })
    expect(h.sent.length).toBe(1)
    expect(h.sent[0].text).toContain("Acknowledgement: FAILED -- Resend 500: boom")
    expect(h.fns()).not.toContain("dpdp_mail_mark_ack")
  })

  test("an acknowledgement that went out but could not be recorded is still reported as sent", async () => {
    const h = harness({ failRpc: { dpdp_mail_mark_ack: new Error("db blip") } })
    const res = await h.run(payload())
    expect(await bodyOf(res)).toMatchObject({ ack: "sent", notified: "sent" })
    expect(h.sent[1].text).toContain("sent to the sender (sent, but not recorded as sent)")
  })

  test("a failing outbound log does not stop the acknowledgement", async () => {
    const h = harness({ failRpc: { dpdp_mail_log_outbound: new Error("db blip") } })
    const res = await h.run(payload())
    expect(await bodyOf(res)).toMatchObject({ ack: "sent", notified: "sent" })
    expect(h.sent.length).toBe(2)
  })
})

describe("a retried delivery", () => {
  test("the same message twice is one ticket and one notice", async () => {
    const h = harness()
    const first = await bodyOf(await h.run(payload()))
    const second = await bodyOf(await h.run(payload()))
    expect(first.ticket).toBe("G-2026-0001")
    expect(second).toMatchObject({ ticket: "G-2026-0001", duplicate: true, notified: "already", ack: "skipped" })
    expect(h.sent.length).toBe(2) // ack + notice, once
    expect(h.inbound.length).toBe(1)
  })
  test("a duplicate whose first delivery never reached the operator is notified this time", async () => {
    const h = harness({ failSend: (m) => m.to === OPERATOR })
    expect((await h.run(payload())).status).toBe(502)
    const retry = harness()
    retry.inbound.push(...h.inbound)
    retry.inbound[0].ackSent = true
    const res = await retry.run(payload())
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ ticket: "G-2026-0001", duplicate: true, notified: "sent", ack: "skipped" })
    expect(retry.sent.map((m) => m.to)).toEqual([OPERATOR])
    expect(retry.sent[0].text).toContain("(this delivery was already recorded)")
  })
})

describe("dry run (no RESEND_API_KEY)", () => {
  // The Worker reads any 2xx as "a person has been told" and then does NOT forward the mail. In dry run nobody is told, so the
  // answer must be a 502: otherwise a citizen's mail arriving before RESEND_API_KEY is set would sit unread in dpdp.mail_inbound.
  test("records and tickets, sends and marks nothing, and answers 502 so the Worker forwards the mail natively", async () => {
    const h = harness({ config: { dryRun: true } })
    const res = await h.run(payload())
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toMatchObject({ ok: false, ticket: "G-2026-0001", dryRun: true, ack: "dry_run", notified: "dry_run" })
    expect(h.sent).toEqual([])
    expect(h.fns()).toEqual(["dpdp_mail_lookup_outbound", "dpdp_mail_insert_inbound"])
    expect(h.inbound[0].notified).toBe(false)
    expect(h.inbound[0].ackSent).toBe(false)
  })
})

describe("what is logged", () => {
  test("one JSON line per message: ticket, class, rule, outcomes -- no secret, address, subject or text", async () => {
    const h = harness()
    await h.run(payload({ subject: "LEAKMARK-SUBJECT-A", text: "LEAKMARK-BODY-B please look into it, complaint" }))
    const all = h.logs.join("\n")
    expect(all).toContain("G-2026-0001")
    expect(all).not.toContain(SECRET)
    for (const s of ["LEAKMARK-SUBJECT-A", "LEAKMARK-BODY-B", "asha@example.org", OPERATOR]) expect(all).not.toContain(s)
    const line = JSON.parse(h.logs[h.logs.length - 1])
    expect(line).toMatchObject({ evt: "dpdp-inbound-mail", ticket: "G-2026-0001", class: "grievance", rule: "tag", ack: "sent", notified: "sent" })
  })
  test("the response body never echoes the message", async () => {
    const h = harness()
    const text = await (await h.run(payload({ subject: "LEAKMARK-SUBJECT-A", text: "LEAKMARK-BODY-B complaint" }))).text()
    for (const s of ["LEAKMARK-SUBJECT-A", "LEAKMARK-BODY-B", "asha@example.org"]) expect(text).not.toContain(s)
  })
})

describe("parseInbound: the Worker's payload (workers/dpdp-inbound-mail/src/types.ts, version 1)", () => {
  test("every field of InboundMailPayload is read", () => {
    const m = parseInbound({
      version: 1, received_at: "2026-09-29T15:30:00.000Z", envelope_from: "bounce+x@mailer.example.org", envelope_to: "dpdp+grv.k3f9x2ab7q@veridian-aios.com",
      envelope_to_raw: "grievance@veridian-aios.com", header_from: "Asha M <Asha@Example.org>", from_address: "asha@example.org", from_name: "Asha M",
      header_to: "Veridian <dpdp@veridian-aios.com>, x@y.example", reply_to: "other@example.org", subject: "Hi", message_id: "<M1@Example.org>",
      in_reply_to: "<S1@veridian-aios.com>", references: "<a@x> <S1@veridian-aios.com>", auto_submitted: null, precedence: "bulk", x_autoreply: "",
      x_auto_response_suppress: null, content_type: "text/plain; charset=utf-8", headers: { "return-path": "<bounce+x@mailer.example.org>", cc: "c@x.example", "x-autoreply": "" },
      text: "Body", has_attachments: true, raw_size: 4321, truncated: true,
    })!
    expect(m.senders).toEqual(["asha@example.org", "bounce+x@mailer.example.org"])
    expect(m.replyAddress).toBe("asha@example.org")
    expect(m.fromName).toBe("Asha M")
    expect(m.recipients).toEqual(["dpdp+grv.k3f9x2ab7q@veridian-aios.com", "dpdp@veridian-aios.com", "x@y.example", "c@x.example"])
    expect(m.subject).toBe("Hi")
    expect(m.messageId).toBe("<M1@Example.org>")
    expect(m.inReplyTo).toBe("<S1@veridian-aios.com>")
    expect(m.references).toBe("<a@x> <S1@veridian-aios.com>")
    expect(m.contentType).toBe("text/plain; charset=utf-8")
    expect(m.text).toBe("Body")
    expect(m.hasAttachments).toBe(true)
    expect(m.truncated).toBe(true)
    expect(m.workerReceivedAt?.toISOString()).toBe("2026-09-29T15:30:00.000Z")
  })
  test("header signals sent as top-level fields are merged into headers; null is absent, empty string is present", () => {
    const m = parseInbound({
      envelope_from: "a@b.example", auto_submitted: "auto-replied", precedence: "bulk", x_autoreply: "", x_auto_response_suppress: null, headers: { "x-veridian-origin": "" }, text: "t",
    })!
    expect(m.headers).toEqual({ "x-veridian-origin": "", "auto-submitted": "auto-replied", precedence: "bulk", "x-autoreply": "" })
    expect("x-auto-response-suppress" in m.headers).toBe(false)
  })
  test("the headers map wins over a top-level field of the same name", () => {
    const m = parseInbound({ envelope_from: "a@b.example", precedence: "list", headers: { precedence: "bulk" }, text: "t" })!
    expect(m.headers.precedence).toBe("bulk")
  })
  test("from_address null falls back to parsing header_from, then to the envelope sender", () => {
    expect(parseInbound({ envelope_from: "env@x.example", header_from: "Real <real@person.example>", from_address: null, text: "t" })!.replyAddress).toBe("real@person.example")
    expect(parseInbound({ envelope_from: "env@x.example", header_from: "garbled", from_address: null, text: "t" })!.replyAddress).toBe("env@x.example")
  })
  test("an empty envelope sender (a bounce) leaves the header From as the only sender", () => {
    const m = parseInbound({ envelope_from: "", header_from: "MAILER-DAEMON@mx.example", from_address: "mailer-daemon@mx.example", text: "t" })!
    expect(m.senders).toEqual(["mailer-daemon@mx.example"])
  })
  test("receivedAtOf uses the Worker's clock unless it is more than 48 hours from ours", () => {
    const now = new Date("2026-09-29T15:33:00Z")
    expect(receivedAtOf(new Date("2026-09-29T15:30:00Z"), now).toISOString()).toBe("2026-09-29T15:30:00.000Z")
    expect(receivedAtOf(new Date("2026-09-27T15:33:00Z"), now).toISOString()).toBe("2026-09-27T15:33:00.000Z")
    expect(receivedAtOf(new Date("2026-09-27T15:32:59Z"), now)).toBe(now)
    expect(receivedAtOf(new Date("2030-01-01T00:00:00Z"), now)).toBe(now)
    expect(receivedAtOf(null, now)).toBe(now)
  })
  test("the camelCase aliases and other spellings", () => {
    const m = parseInbound({
      from: "Bounce@Example.org", to: ["dpdp+grv.k3f9x2ab7q@veridian-aios.com"], headerFrom: "Asha M <Asha@Example.org>", headerTo: "A <a@x.example>, dpdp@veridian-aios.com",
      cc: "c@x.example", subject: "Hi", messageId: "<M1@Example.org>", inReplyTo: "<S1@veridian-aios.com>", references: "<a@x> <S1@veridian-aios.com>",
      contentType: "text/plain; charset=utf-8", headers: { "Auto-Submitted": "no", "X-Thing": ["a", "b"] }, text: "Body", hasAttachments: true,
    })!
    expect(m.senders).toEqual(["asha@example.org", "bounce@example.org"])
    expect(m.replyAddress).toBe("asha@example.org")
    expect(m.recipients).toEqual(["dpdp+grv.k3f9x2ab7q@veridian-aios.com", "a@x.example", "dpdp@veridian-aios.com", "c@x.example"])
    expect(m.subject).toBe("Hi")
    expect(m.messageId).toBe("<M1@Example.org>")
    expect(m.inReplyTo).toBe("<S1@veridian-aios.com>")
    expect(m.references).toBe("<a@x> <S1@veridian-aios.com>")
    expect(m.headers).toEqual({ "auto-submitted": "no", "x-thing": "a, b" })
    expect(m.hasAttachments).toBe(true)
  })
  test("aliases (envelopeFrom / envelopeTo) and headers given as pairs or {name,value} rows", () => {
    const m = parseInbound({ envelopeFrom: "a@b.example", envelopeTo: "dpdp@veridian-aios.com", headers: [["Message-ID", "<x@y>"], { name: "In-Reply-To", value: "<z@y>" }], text: "t" })!
    expect(m.replyAddress).toBe("a@b.example")
    expect(m.recipients).toEqual(["dpdp@veridian-aios.com"])
    expect(m.messageId).toBe("<x@y>")
    expect(m.inReplyTo).toBe("<z@y>")
  })
  test("the header From is preferred for the reply address; the envelope sender is kept as a sender", () => {
    const m = parseInbound({ from: "srs0=abc@forwarder.example", headerFrom: "Real <real@person.example>", text: "t" })!
    expect(m.replyAddress).toBe("real@person.example")
    expect(m.senders).toContain("srs0=abc@forwarder.example")
  })
  test("an HTML-only message gets text from its HTML", () => {
    const m = parseInbound({ from: "a@b.example", html: "<style>p{}</style><p>Hello&nbsp;<b>there</b></p><p>delete my data &amp; more</p>" })!
    expect(m.text).toBe("Hello there\ndelete my data & more")
  })
  test("NUL characters are removed (Postgres text cannot hold them)", () => {
    const m = parseInbound({ from: "a@b.example", subject: "a\u0000b", text: "x\u0000y" })!
    expect(m.subject).toBe("ab")
    expect(m.text).toBe("xy")
  })
  test("a value cannot start a new header line: CR, LF and other control characters become spaces", () => {
    const m = parseInbound({
      from: "a@b.example", subject: "Hi\r\nBcc: victim@example.test", messageId: "<x@y>\r\nX-Injected: 1", inReplyTo: "<z@y>\nX-Injected: 2", references: "<a@x>\r\n<b@x>",
      contentType: "text/plain\r\nX-Injected: 3", headers: { "x-h": "v1\r\nX-Injected: 4" }, text: "line one\r\nline two",
    })!
    for (const v of [m.subject, m.messageId!, m.inReplyTo!, m.references!, m.contentType, m.headers["x-h"]]) expect(v).not.toMatch(/[\r\n]/)
    expect(m.subject).toBe("Hi Bcc: victim@example.test")
    expect(m.text).toBe("line one\r\nline two") // the body keeps its line breaks; only header-bound values are flattened
  })
  test("text is capped, header values are capped", () => {
    const m = parseInbound({ from: "a@b.example", text: "x".repeat(200_000), headers: { "x-big": "y".repeat(10_000) } })!
    expect(m.text.length).toBe(64_000)
    expect(m.headers["x-big"].length).toBe(2000)
  })
  test("garbage in every field does not throw", () => {
    expect(() => parseInbound({ from: 5, to: { a: 1 }, headers: 7, subject: [1, 2], text: null, html: false })).not.toThrow()
    expect(parseInbound({ from: 5, to: { a: 1 }, headers: 7, subject: [1, 2], text: null })).toBeNull()
  })
  test("htmlToText", () => {
    expect(htmlToText("a<br>b<br/>c")).toBe("a\nb\nc")
    expect(htmlToText("<script>alert(1)</script>x")).toBe("x")
    expect(htmlToText("&lt;tag&gt; &quot;q&quot; &#39;s&#39;")).toBe("<tag> \"q\" 's'")
  })
})

describe("parseLegalDays and formatIst", () => {
  test("1..365 whole days, else 90", () => {
    expect(DEFAULT_LEGAL_RESPONSE_DAYS).toBe(90)
    expect(parseLegalDays(undefined)).toBe(90)
    expect(parseLegalDays("")).toBe(90)
    expect(parseLegalDays("30")).toBe(30)
    expect(parseLegalDays(" 45 ")).toBe(45)
    expect(parseLegalDays("1")).toBe(1)
    expect(parseLegalDays("365")).toBe(365)
    for (const bad of ["0", "-5", "366", "1000", "abc", "3.5", "30d", "1e2", "0x10"]) expect(parseLegalDays(bad)).toBe(90)
  })
  test("formatIst is a fixed +05:30 offset", () => {
    expect(formatIst(new Date("2026-09-29T15:33:00Z"))).toBe("2026-09-29 21:03 IST")
    expect(formatIst(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01 01:30 IST")
  })
  test("renderAck names the ticket and the time, and takes nothing the sender wrote", () => {
    const text = renderAck("D-2026-0002", NOW)
    expect(text).toContain("D-2026-0002")
    expect(text).toContain("Received: 2026-09-29 21:03 IST")
    expect(text).not.toContain("Subject")
    expect(renderAck.length).toBe(2) // (ticket, receivedAt): there is no parameter through which text could get in
  })
})


// A reply to our own Monday digest quotes it, and the digest carries credentials (the AI work link, one-time Undo and "done"
// links, the sign-in link, the unsubscribe token). None of that may reach dpdp.mail_inbound.excerpt or the operator's notice.
describe("redactSecrets: a reply that quotes our email must not carry its credentials into the ticket log", () => {
  const HEX = "ab".repeat(32) // 64 hex characters, low entropy on purpose (gitleaks)
  const quoted = [
    "Thanks, please delete my data.",
    "",
    "> Please open this link and help me finish my DPDP jobs for this week:",
    `> https://app.veridian-aios.com/ai/${HEX}`,
    "> Yes, it is done: https://app.veridian-aios.com/act/#one-time-token-123",
    `> Undo: https://app.veridian-aios.com/app/#undo=action1.${HEX}`,
    "> Open my page: https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/verify?token=abc123&type=magiclink&redirect_to=https://app.veridian-aios.com/app/",
    `> Stop these weekly emails: https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=${"cd".repeat(16)}`,
  ].join("\n")

  test("every credential is replaced and the words around them stay", () => {
    const out = redactSecrets(quoted)
    expect(out).toContain("Thanks, please delete my data.")
    expect(out).toContain("Please open this link and help me finish my DPDP jobs for this week:")
    expect(out).not.toContain(HEX)
    expect(out).not.toMatch(/[0-9a-f]{40}/i)
    expect(out).not.toContain("one-time-token-123")
    expect(out).not.toContain("token=abc123")
    expect(out).not.toContain("cdcdcdcd")
    expect(out).toContain("[AI work link removed]")
    expect(out).toContain("/act/#[removed]")
    expect(out).toContain("#undo=[removed]")
    expect(out).toContain("/auth/v1/verify?[removed]")
    expect(out).toContain("t=[removed]")
  })
  test("ordinary text, a short hex string and a normal link are left alone", () => {
    const plain = "Order 4f9a2c was sent on 5 October. See https://example.org/docs/ai/intro and hash deadbeef."
    expect(redactSecrets(plain)).toBe(plain)
  })
  test("a bare 64-hex string is removed wherever it appears", () => {
    expect(redactSecrets(`token ${HEX} end`)).toBe("token [64-hex removed] end")
  })
  test("end to end: the recorded excerpt and the operator's notice contain none of it, and the message is still classified", async () => {
    const h = harness()
    const res = await h.run(payload({ envelope_to: replyToAddress("monday", REF), envelope_to_raw: replyToAddress("monday", REF), text: quoted }))
    expect(res.status).toBe(200)
    const insert = h.calls.find((c) => c.fn === "dpdp_mail_insert_inbound")
    expect(insert).toBeTruthy()
    expect(String(insert!.args.p_excerpt)).not.toContain(HEX)
    expect(String(insert!.args.p_excerpt)).toContain("[AI work link removed]")
    const everything = JSON.stringify(h.calls) + JSON.stringify(h.sent)
    expect(everything).not.toContain(HEX)
    expect(everything).not.toContain("one-time-token-123")
    expect(everything).not.toContain("token=abc123")
    // the "delete my data" is still read, so a legal request is not lost to the redaction
    expect(String(insert!.args.p_class)).toBe("data_request")
  })
  test("hostile input stays linear (the platform kills a slow isolate)", () => {
    const t0 = Date.now()
    redactSecrets("/ai/".repeat(16_000))
    redactSecrets("a".repeat(64_000))
    redactSecrets(("https://" + "a".repeat(190) + "/ai/").repeat(300))
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})
