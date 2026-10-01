// DPDP single mailbox -- the operator's once-a-day digest (owner decision 2026-10-01).
//
// Per-message operator emails now exist only for grievance and data_request (handler.ts). Everything else is recorded in
// dpdp.mail_inbound and surfaces HERE: one short plain-text email, sent only on a day when at least one non-auto, not-closed
// ticket was recorded in the last 25 hours and has not been in an earlier digest. A quiet day sends nothing.
//
// Called by the pg_cron job `dpdp-operator-digest` (drizzle/0667, 03:30 UTC = 09:00 IST) as POST {"job":"operator_digest"} through
// resend-inbound.ts's job router. The database and the provider are passed in (`deps.rpc`, `deps.send`), the same seam as handler.ts.
//
// ORDER, AND WHY. 1. dpdp_mail_digest_pending (read) -> 2. nothing to list: stop, send nothing -> 3. send ONE email -> 4. dpdp_mail_digest_mark
// on exactly the tickets that were listed. Marking AFTER the send means a failed send leaves everything unmarked, so tomorrow's digest
// lists it again; the cost is that a send that succeeded but could not be marked would list the same tickets again tomorrow, which is why
// the Resend idempotency key is derived from the day AND the ticket list (a re-run of the same digest the same day is dropped by the
// provider) and why a failed mark answers 502 so the cron run is visibly red.
//
// The email lists ticket number, class, sender, subject and age. Sender and subject are text a stranger wrote: they are flattened to one
// line and cut, and nothing else of the message (no body, no excerpt) is included. Dry run (no RESEND_API_KEY) or no DPDP_OPERATOR_EMAIL:
// nothing is sent and nothing is marked, and the answer is 503 so the problem shows.
import { CLASS_LABEL, MAILBOX, MAIL_CLASSES, type MailClass } from "../_shared/mail-taxonomy.ts"
import { formatIst, type InboundDeps } from "./handler.ts"

/** Window passed to dpdp_mail_digest_pending: the cron runs every 24 hours; the extra hour covers a run that is a few minutes late. */
export const DIGEST_WINDOW_HOURS = 25
/** Most tickets written out in one email; the rest are counted and named by number range in one line, and are still marked as listed. */
export const DIGEST_MAX_LISTED = 60
const SUBJECT_CHARS = 90
const SENDER_CHARS = 60

export type DigestTicket = { ticketNo: string; cls: MailClass; from: string; subject: string; receivedAt: string | null }

export type DigestResult = {
  ok: boolean
  job: "operator_digest"
  /** true: an email went out. */
  sent: boolean
  /** Tickets in the digest (listed in the email, or counted in its "and N more" line). */
  count: number
  /** Why nothing was sent, or what went wrong. */
  note?: string
  /** HTTP status the router should answer with. */
  status: 200 | 502 | 503
}

function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim()
}

function cut(value: string, max: number): string {
  const s = oneLine(value)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** "35m", "5h", "1d 3h": how long ago the ticket was received. */
export function ageText(receivedAt: string | null, now: Date): string {
  const t = receivedAt ? Date.parse(receivedAt) : NaN
  if (!Number.isFinite(t)) return "?"
  const minutes = Math.max(0, Math.round((now.getTime() - t) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

function readTickets(data: unknown): DigestTicket[] {
  const list = data && typeof data === "object" && Array.isArray((data as { tickets?: unknown }).tickets) ? (data as { tickets: unknown[] }).tickets : []
  const out: DigestTicket[] = []
  for (const row of list) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const ticketNo = typeof r.ticketNo === "string" ? r.ticketNo : ""
    const cls = typeof r.class === "string" && MAIL_CLASSES.includes(r.class as MailClass) ? (r.class as MailClass) : null
    if (!ticketNo || !cls) continue
    out.push({ ticketNo, cls, from: typeof r.from === "string" ? r.from : "", subject: typeof r.subject === "string" ? r.subject : "", receivedAt: typeof r.receivedAt === "string" ? r.receivedAt : null })
  }
  return out
}

/** Short stable hash (FNV-1a, 32 bit) so the idempotency key changes when the list changes but stays within the provider's key length. */
function hashList(items: string[]): string {
  let h = 0x811c9dc5
  for (const ch of items.join("|")) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

export function renderDigest(tickets: DigestTicket[], now: Date): { subject: string; text: string } {
  const n = tickets.length
  const lines = [
    `${n} new ${n === 1 ? "ticket" : "tickets"} reached ${MAILBOX} since the last digest and ${n === 1 ? "is" : "are"} still open.`,
    "Grievances and data requests are also emailed one by one when they arrive; they are listed here as well so the day's list is complete.",
    "",
    "Ticket          Class          Age     From  --  Subject",
  ]
  for (const t of tickets.slice(0, DIGEST_MAX_LISTED)) {
    lines.push(`${t.ticketNo.padEnd(15)} ${CLASS_LABEL[t.cls].padEnd(14)} ${ageText(t.receivedAt, now).padEnd(7)} ${cut(t.from || "(unknown)", SENDER_CHARS)}  --  ${cut(t.subject || "(no subject)", SUBJECT_CHARS)}`)
  }
  if (n > DIGEST_MAX_LISTED) lines.push("", `... and ${n - DIGEST_MAX_LISTED} more (${tickets[DIGEST_MAX_LISTED].ticketNo} to ${tickets[n - 1].ticketNo}); read them in dpdp.mail_inbound.`)
  lines.push("", `Sent ${formatIst(now)}. The full text of each message is in dpdp.mail_inbound (the ticket number is the key). This email has no reply address.`)
  return { subject: `[DPDP daily digest] ${n} new ${n === 1 ? "ticket" : "tickets"}`, text: lines.join("\n") }
}

export async function runOperatorDigest(deps: InboundDeps): Promise<DigestResult> {
  const cfg = deps.config
  const log = deps.log ?? ((line: string) => console.log(line))
  const now = deps.now ? deps.now() : new Date()
  const base = { job: "operator_digest" as const }
  const operatorEmail = cfg.operatorEmail.trim()
  if (cfg.dryRun || !operatorEmail) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", job: "operator_digest", error: cfg.dryRun ? "dry run: no RESEND_API_KEY" : "DPDP_OPERATOR_EMAIL is not set" }))
    return { ...base, ok: false, sent: false, count: 0, note: cfg.dryRun ? "dry run: nothing sent" : "no operator email configured", status: 503 }
  }

  let tickets: DigestTicket[]
  try {
    const { data, error } = await deps.rpc("dpdp_mail_digest_pending", { p_now: now.toISOString(), p_hours: DIGEST_WINDOW_HOURS })
    if (error) throw new Error(error.message)
    tickets = readTickets(data)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log(JSON.stringify({ evt: "dpdp-inbound-mail", job: "operator_digest", error: "could not read the pending tickets", detail: detail.slice(0, 200) }))
    return { ...base, ok: false, sent: false, count: 0, note: "could not read the pending tickets", status: 502 }
  }
  if (tickets.length === 0) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", job: "operator_digest", sent: false, count: 0 }))
    return { ...base, ok: true, sent: false, count: 0, note: "nothing new", status: 200 }
  }

  const { subject, text } = renderDigest(tickets, now)
  const ist = formatIst(now).slice(0, 10)
  try {
    await deps.send({
      from: cfg.from,
      to: operatorEmail,
      subject,
      text,
      headers: { "X-Veridian-Origin": "operator-digest", "Auto-Submitted": "auto-generated" },
      idempotencyKey: `dpdp-operator-digest-${ist}-${hashList(tickets.map((t) => t.ticketNo))}`,
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log(JSON.stringify({ evt: "dpdp-inbound-mail", job: "operator_digest", error: "send failed", detail: detail.slice(0, 200), count: tickets.length }))
    return { ...base, ok: false, sent: false, count: tickets.length, note: "the digest could not be sent; nothing was marked, tomorrow's run lists these again", status: 502 }
  }

  try {
    const { error } = await deps.rpc("dpdp_mail_digest_mark", { p_ticket_nos: tickets.map((t) => t.ticketNo) })
    if (error) throw new Error(error.message)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log(JSON.stringify({ evt: "dpdp-inbound-mail", job: "operator_digest", error: "sent but not marked", detail: detail.slice(0, 200), count: tickets.length }))
    return { ...base, ok: false, sent: true, count: tickets.length, note: "the digest was sent but the tickets could not be marked as listed; they will be listed again", status: 502 }
  }
  log(JSON.stringify({ evt: "dpdp-inbound-mail", job: "operator_digest", sent: true, count: tickets.length }))
  return { ...base, ok: true, sent: true, count: tickets.length, status: 200 }
}
