/// <reference types="bun-types" />
// Offline proof of operator-digest.ts, the once-a-day operator email of the dpdp-inbound-mail Edge Function (owner decision 2026-10-01), and of
// how resend-inbound.ts routes and authenticates the {"job":"operator_digest"} request the pg_cron job (drizzle/0667) sends. The database is an
// in-memory copy of the dpdp_mail_digest_pending / dpdp_mail_digest_mark contract; the real SQL is proven by
// src/lib/services/dpdp-operator-digest-migration.pglite.test.ts.
//
// What this proves: nothing to list => NO email and NO mark; something to list => exactly one plain-text email with ticket number, class, sender,
// subject and age; the tickets listed are marked afterwards so a second run the same day sends nothing; a failed send marks nothing (tomorrow
// lists them again); a failed mark is a visible 502; dry run / no operator address send nothing; sender and subject text from a stranger is
// flattened to one line and cut, and the body of the message never appears; the job is authenticated by the timer secret (Vault RPC) or
// DPDP_INBOUND_SECRET and by nothing else, before anything runs.
//
// Run (bunfig.toml sets the test root to src/, so name the file):
//   bun test --isolate ./supabase/functions/dpdp-inbound-mail/operator-digest.test.ts
import { describe, expect, test } from "bun:test"
import type { InboundConfig, InboundDeps, OutMessage, Rpc } from "./handler.ts"
import { DIGEST_MAX_LISTED, DIGEST_WINDOW_HOURS, ageText, renderDigest, runOperatorDigest, type DigestTicket } from "./operator-digest.ts"
import { routeInbound } from "./resend-inbound.ts"

const SECRET = "test-secret-" + "x".repeat(24)
const TIMER = "timer-secret-" + "y".repeat(24)
const OPERATOR = "operator@example.test"
const NOW = new Date("2026-10-01T03:30:00Z") // 09:00 IST

type Row = { ticketNo: string; class: string; from: string; subject: string; receivedAt: string; digested: boolean }
const row = (n: number, over: Partial<Row> = {}): Row => ({
  ticketNo: `H-2026-${String(n).padStart(4, "0")}`, class: "support", from: `person${n}@example.org`, subject: `Help ${n}`,
  receivedAt: new Date(NOW.getTime() - 5 * 3600_000).toISOString(), digested: false, ...over,
})

function harness(opts: { rows?: Row[]; config?: Partial<InboundConfig>; failSend?: boolean; failMark?: boolean; failPending?: boolean } = {}) {
  const rows = opts.rows ?? []
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const sent: OutMessage[] = []
  const logs: string[] = []
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args })
    if (fn === "dpdp_mail_digest_pending") {
      if (opts.failPending) return { data: null, error: { message: "db down" } }
      const live = rows.filter((r) => !r.digested && r.class !== "auto")
      return { data: { count: live.length, tickets: live.map((r) => ({ ticketNo: r.ticketNo, class: r.class, from: r.from, subject: r.subject, receivedAt: r.receivedAt })) }, error: null }
    }
    if (fn === "dpdp_mail_digest_mark") {
      if (opts.failMark) return { data: null, error: { message: "db down" } }
      for (const r of rows) if ((args.p_ticket_nos as string[]).includes(r.ticketNo)) r.digested = true
      return { data: { ok: true }, error: null }
    }
    if (fn === "dpdp_timer_check_bearer") return { data: args.p_bearer === TIMER, error: null }
    return { data: null, error: { message: `unexpected rpc ${fn}` } }
  }
  const config: InboundConfig = { secret: SECRET, operatorEmail: OPERATOR, from: "VERIDIAN AI DPDP <dpdp@veridian-aios.com>", legalResponseDays: 90, dryRun: false, ...opts.config }
  const deps: InboundDeps = {
    rpc, config, now: () => NOW, log: (l) => { logs.push(l) },
    send: async (m) => {
      if (opts.failSend) throw new Error("Resend 500: boom")
      sent.push(m)
      return { id: `resend-${sent.length}` }
    },
  }
  return { rows, calls, sent, logs, deps }
}

describe("runOperatorDigest", () => {
  test("nothing pending: no email, no mark, 200", async () => {
    const h = harness()
    const r = await runOperatorDigest(h.deps)
    expect(r).toMatchObject({ ok: true, sent: false, count: 0, status: 200 })
    expect(h.sent).toEqual([])
    expect(h.calls.map((c) => c.fn)).toEqual(["dpdp_mail_digest_pending"])
  })
  test("asks for the documented window", async () => {
    const h = harness()
    await runOperatorDigest(h.deps)
    expect(h.calls[0].args).toEqual({ p_now: NOW.toISOString(), p_hours: DIGEST_WINDOW_HOURS })
    expect(DIGEST_WINDOW_HOURS).toBe(25)
  })
  test("something pending: ONE plain-text email with ticket, class, sender, subject and age, then exactly those tickets are marked", async () => {
    const h = harness({ rows: [
      row(1), row(2, { class: "sales", from: "buyer@corp.example", subject: "Pricing for 40 seats", receivedAt: new Date(NOW.getTime() - 26 * 3600_000).toISOString() }),
      row(3, { class: "monday", from: "ops@acme.example", subject: "Re: your week", receivedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() }),
    ] })
    const r = await runOperatorDigest(h.deps)
    expect(r).toMatchObject({ ok: true, sent: true, count: 3, status: 200 })
    expect(h.sent.length).toBe(1)
    const m = h.sent[0]
    expect(m.to).toBe(OPERATOR)
    expect(m.subject).toBe("[DPDP daily digest] 3 new tickets")
    expect(m.replyTo).toBeUndefined()
    for (const needle of ["H-2026-0001", "H-2026-0002", "H-2026-0003", "Support", "Sales", "Monday", "buyer@corp.example", "Pricing for 40 seats", "ops@acme.example"]) expect(m.text).toContain(needle)
    expect(m.text).toMatch(/H-2026-0002\s+Sales\s+1d 2h\s+buyer@corp\.example/)
    expect(m.text).toMatch(/H-2026-0003\s+Monday\s+20m\s/)
    expect(m.text).toMatch(/H-2026-0001\s+Support\s+5h\s/)
    expect(m.headers).toMatchObject({ "Auto-Submitted": "auto-generated", "X-Veridian-Origin": "operator-digest" })
    expect(h.calls.find((c) => c.fn === "dpdp_mail_digest_mark")!.args).toEqual({ p_ticket_nos: ["H-2026-0001", "H-2026-0002", "H-2026-0003"] })
    expect(h.rows.every((x) => x.digested)).toBe(true)
  })
  test("a second run the same day sends NOTHING: what was listed is not listed again", async () => {
    const h = harness({ rows: [row(1), row(2)] })
    expect((await runOperatorDigest(h.deps)).sent).toBe(true)
    const again = await runOperatorDigest(h.deps)
    expect(again).toMatchObject({ ok: true, sent: false, count: 0 })
    expect(h.sent.length).toBe(1)
  })
  test("a ticket that arrives after the first run goes out alone in the next digest", async () => {
    const h = harness({ rows: [row(1)] })
    await runOperatorDigest(h.deps)
    h.rows.push(row(2, { subject: "Second" }))
    const r = await runOperatorDigest(h.deps)
    expect(r).toMatchObject({ sent: true, count: 1 })
    expect(h.sent[1].subject).toBe("[DPDP daily digest] 1 new ticket")
    expect(h.sent[1].text).toContain("H-2026-0002")
    expect(h.sent[1].text).not.toContain("H-2026-0001")
  })
  test("auto tickets are never in the digest (the database function filters them; a stray one from a broken database is dropped here too)", async () => {
    const h = harness({ rows: [row(1, { class: "auto" })] })
    expect(await runOperatorDigest(h.deps)).toMatchObject({ sent: false, count: 0 })
    expect(h.sent).toEqual([])
  })
  test("a failed send marks NOTHING and answers 502, so the next run lists the same tickets again", async () => {
    const h = harness({ rows: [row(1)], failSend: true })
    const r = await runOperatorDigest(h.deps)
    expect(r).toMatchObject({ ok: false, sent: false, status: 502 })
    expect(h.calls.some((c) => c.fn === "dpdp_mail_digest_mark")).toBe(false)
    expect(h.rows[0].digested).toBe(false)
  })
  test("a send that worked but could not be marked is a visible 502", async () => {
    const h = harness({ rows: [row(1)], failMark: true })
    const r = await runOperatorDigest(h.deps)
    expect(r).toMatchObject({ ok: false, sent: true, status: 502 })
    expect(h.sent.length).toBe(1)
  })
  test("a database that cannot be read is 502 and sends nothing", async () => {
    const h = harness({ rows: [row(1)], failPending: true })
    expect(await runOperatorDigest(h.deps)).toMatchObject({ ok: false, sent: false, status: 502 })
    expect(h.sent).toEqual([])
  })
  test("dry run, or no operator address: nothing sent, nothing marked, 503", async () => {
    for (const config of [{ dryRun: true }, { operatorEmail: "" }, { operatorEmail: "   " }]) {
      const h = harness({ rows: [row(1)], config })
      expect(await runOperatorDigest(h.deps)).toMatchObject({ ok: false, sent: false, status: 503 })
      expect(h.sent).toEqual([])
      expect(h.calls).toEqual([])
    }
  })
  test("the idempotency key is the day plus the ticket list: the same digest re-run the same day is one mail, a different list is a different key", async () => {
    const a = harness({ rows: [row(1), row(2)] })
    await runOperatorDigest(a.deps)
    const b = harness({ rows: [row(1), row(2)] })
    await runOperatorDigest(b.deps)
    const c = harness({ rows: [row(1), row(3)] })
    await runOperatorDigest(c.deps)
    expect(a.sent[0].idempotencyKey).toBe(b.sent[0].idempotencyKey)
    expect(a.sent[0].idempotencyKey).not.toBe(c.sent[0].idempotencyKey)
    expect(a.sent[0].idempotencyKey).toMatch(/^dpdp-operator-digest-2026-10-01-[0-9a-f]{8}$/)
  })
  test("stranger-written text is flattened to one line and cut; the message body is never part of the digest", async () => {
    const h = harness({ rows: [row(1, { subject: "Hello\r\nBcc: evil@example.test\n" + "x".repeat(300), from: "A\u0000B <a@b.test>\nInjected: yes" })] })
    await runOperatorDigest(h.deps)
    const line = h.sent[0].text.split("\n").find((l) => l.startsWith("H-2026-0001"))!
    expect(line).toBeDefined()
    expect(line).not.toContain("\r")
    expect(line.length).toBeLessThan(260)
    expect(line).toContain("…")
    expect(h.sent[0].text.split("\n").some((l) => l.startsWith("Bcc:") || l.startsWith("Injected:"))).toBe(false)
  })
  test("more than DIGEST_MAX_LISTED tickets: the first ones are written out, the rest counted, and ALL are marked", async () => {
    const rows = Array.from({ length: DIGEST_MAX_LISTED + 5 }, (_, i) => row(i + 1))
    const h = harness({ rows })
    const r = await runOperatorDigest(h.deps)
    expect(r.count).toBe(DIGEST_MAX_LISTED + 5)
    expect(h.sent[0].subject).toBe(`[DPDP daily digest] ${DIGEST_MAX_LISTED + 5} new tickets`)
    expect(h.sent[0].text).toContain("... and 5 more")
    expect(h.sent[0].text).not.toContain(`H-2026-${String(DIGEST_MAX_LISTED + 1).padStart(4, "0")}  `)
    expect((h.calls.find((c) => c.fn === "dpdp_mail_digest_mark")!.args.p_ticket_nos as string[]).length).toBe(DIGEST_MAX_LISTED + 5)
  })
  test("no log line carries an address, a subject or any text of a message", async () => {
    const h = harness({ rows: [row(1, { subject: "Secret subject words", from: "private.person@example.org" })] })
    await runOperatorDigest(h.deps)
    const logged = h.logs.join("\n")
    expect(logged).not.toContain("private.person")
    expect(logged).not.toContain("Secret subject")
    expect(logged).not.toContain(OPERATOR)
  })
})

describe("renderDigest and ageText", () => {
  const t = (over: Partial<DigestTicket> = {}): DigestTicket => ({ ticketNo: "S-2026-0009", cls: "sales", from: "a@b.test", subject: "Hi", receivedAt: new Date(NOW.getTime() - 3600_000).toISOString(), ...over })
  test("singular and plural", () => {
    expect(renderDigest([t()], NOW).subject).toBe("[DPDP daily digest] 1 new ticket")
    expect(renderDigest([t(), t({ ticketNo: "S-2026-0010" })], NOW).subject).toBe("[DPDP daily digest] 2 new tickets")
  })
  test("ages", () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
    expect(ageText(ago(0), NOW)).toBe("0m")
    expect(ageText(ago(59 * 60_000), NOW)).toBe("59m")
    expect(ageText(ago(3 * 3600_000), NOW)).toBe("3h")
    expect(ageText(ago(24 * 3600_000), NOW)).toBe("1d")
    expect(ageText(ago(51 * 3600_000), NOW)).toBe("2d 3h")
    expect(ageText(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe("0m") // a clock a minute ahead is never a negative age
    expect(ageText(null, NOW)).toBe("?")
    expect(ageText("not a date", NOW)).toBe("?")
  })
})

describe("the operator_digest job through the router", () => {
  const post = (h: ReturnType<typeof harness>, headers: Record<string, string>, body: unknown = { job: "operator_digest" }) =>
    routeInbound(
      new Request("https://x.test/functions/v1/dpdp-inbound-mail", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
      { inbound: h.deps, resend: { webhookSecret: "", apiKey: "" } },
    )
  test("the timer secret (Vault RPC) runs it", async () => {
    const h = harness({ rows: [row(1)] })
    const res = await post(h, { authorization: `Bearer ${TIMER}` })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, job: "operator_digest", sent: true, count: 1 })
    expect(h.sent.length).toBe(1)
    expect(h.calls[0]).toEqual({ fn: "dpdp_timer_check_bearer", args: { p_bearer: TIMER } })
  })
  test("DPDP_INBOUND_SECRET runs it too, without asking the Vault", async () => {
    const h = harness({ rows: [row(1)] })
    expect((await post(h, { authorization: `Bearer ${SECRET}` })).status).toBe(200)
    expect(h.calls.some((c) => c.fn === "dpdp_timer_check_bearer")).toBe(false)
  })
  test("no bearer, a wrong bearer or a short one is 401 and nothing is read or sent", async () => {
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer nope-nope-nope-nope-nope-nope" }, { authorization: "Bearer short" }, { authorization: `Basic ${TIMER}` }]) {
      const h = harness({ rows: [row(1)] })
      expect((await post(h, headers)).status).toBe(401)
      expect(h.sent).toEqual([])
      expect(h.calls.some((c) => c.fn === "dpdp_mail_digest_pending")).toBe(false)
    }
  })
  test("a Vault that errors does not authorise anything", async () => {
    const h = harness({ rows: [row(1)] })
    const original = h.deps.rpc
    h.deps.rpc = async (fn, args) => (fn === "dpdp_timer_check_bearer" ? { data: true, error: { message: "boom" } } : original(fn, args))
    expect((await post(h, { authorization: `Bearer ${TIMER}` })).status).toBe(401)
    expect(h.sent).toEqual([])
  })
  test("with no DPDP_INBOUND_SECRET configured the timer secret still works (the cron must not depend on it)", async () => {
    const h = harness({ rows: [row(1)], config: { secret: "" } })
    expect((await post(h, { authorization: `Bearer ${TIMER}` })).status).toBe(200)
  })
  test("the timer secret does NOT open the reconcile job", async () => {
    const h = harness()
    expect((await post(h, { authorization: `Bearer ${TIMER}` }, { job: "reconcile" })).status).toBe(401)
  })
  test("a failed send is a 502 from the router (the cron run is visibly red); a quiet day is a 200 with sent:false", async () => {
    const bad = harness({ rows: [row(1)], failSend: true })
    expect((await post(bad, { authorization: `Bearer ${TIMER}` })).status).toBe(502)
    const quiet = harness()
    const res = await post(quiet, { authorization: `Bearer ${TIMER}` })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sent: false, count: 0 })
  })
})
