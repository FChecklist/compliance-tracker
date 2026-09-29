// DPDP single mailbox -- the request handler of the dpdp-inbound-mail Edge Function. The database and the
// mail provider are passed in (`deps.rpc`, `deps.send`), so bun runs this REAL handler in handler.test.ts
// with fakes; index.ts only wires Deno.serve, the service-role client and Resend.
//
// THE PIPELINE (one POST per message, from the Cloudflare Email Worker in workers/dpdp-inbound-mail):
//   auth -> parse -> [outbound lookup] -> classify -> record (dpdp.mail_inbound, ticket) ->
//   [acknowledge the sender: legal-clock classes only] -> [tell the operator: every class but auto]
//
// FAIL-CLOSED ON AUTH. The bearer is compared, as SHA-256 digests in constant time, with
// DPDP_INBOUND_SECRET. No secret configured (or a short one) refuses everything with 503; a wrong or
// missing bearer is 401. Nothing else runs first: no parsing, no database call.
//
// NOTHING IS LOST (the owner's core requirement). The order of preference for a message that has arrived:
//   1. recorded with a ticket and the operator told                        -> 200
//   2. classifier threw: recorded as `review`, raw_forwarded, operator told -> 200
//   3. lookup of the outbound row failed: classified without it (noted)     -> 200
//   4. the database is down: the operator gets the RAW message by email, no ticket -> 200 { degraded: true }
//   5. the operator could not be told (send failed, no DPDP_OPERATOR_EMAIL, or DRY RUN): the message IS recorded,
//      the answer is 502 -- the Worker must then forward the raw message natively (message.forward)
//   6. nothing could be done (database down AND no way to email)            -> 502
// So a 2xx means "a person has been told, or the class is auto and the row exists"; anything else means
// the Worker must not drop the message.
//
// ACKNOWLEDGEMENT (legal-clock classes only: grievance, data_request, review). It says the message was
// received, gives the ticket number and says we will respond. It asserts nothing else: no deadline, no
// statute, no promise. It is NEVER sent when the message carries an auto-mail signal (an auto-responder
// answering an auto-responder is a loop), when the sender is our own mailbox or a no-reply address, when
// the sender failed DMARC (backscatter to a forged address), or when 3 have already gone to that sender
// in 24 hours (dpdp_mail_insert_inbound decides that last one). The acknowledgement itself is stamped
// Auto-Submitted / X-Auto-Response-Suppress / X-Veridian-Origin, so a compliant responder will not answer it
// and, if it is ever returned to us, the classifier treats it as auto.
//
// DRY RUN: no RESEND_API_KEY. The message is still recorded; nothing is sent and nothing is marked sent. Because
// nobody was told, the answer is 502 (never 2xx): the Worker reads a 2xx as "a person has been told" and would not
// forward, so with Email Routing already pointed at the Worker a real citizen's mail would sit unread in the table.
//
// LOGGING: one JSON line per message with the ticket, class, rule and outcomes. Never the bearer, an
// address, a subject or any text of the message.
import {
  CLASS_LABEL, LEGAL_CLOCK_CLASSES, MAILBOX, MAIL_CLASSES, NOTIFY_CLASSES, newRef, notificationSubject, outboundHeaders, parseRecipient,
  replyToAddress, withSubjectPrefix, type MailClass,
} from "../_shared/mail-taxonomy.ts"
import { autoSignals, bareAddress, classify, extractMessageIds, readTag, type Classification, type OutboundMatch } from "./classify.ts"

export const MAX_BODY_CHARS = 1_000_000
export const MAX_TEXT_CHARS = 64_000
export const EXCERPT_CHARS = 4096
export const DEFAULT_LEGAL_RESPONSE_DAYS = 90

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null }
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>

export type OutMessage = {
  from: string
  to: string
  subject: string
  text: string
  replyTo?: string
  headers: Record<string, string>
  /** Sent to the provider as Idempotency-Key, so a retried delivery cannot send the same mail twice. */
  idempotencyKey: string
}
export type Send = (message: OutMessage) => Promise<{ id: string }>

export type InboundConfig = {
  /** DPDP_INBOUND_SECRET, the bearer the Worker presents. At least 24 characters, or every request is refused. */
  secret: string
  /** DPDP_OPERATOR_EMAIL. Empty: the message is recorded and the answer is 502. */
  operatorEmail: string
  /** DPDP_EMAIL_FROM. */
  from: string
  /** DPDP_LEGAL_RESPONSE_DAYS, already parsed (see parseLegalDays). */
  legalResponseDays: number
  /** True when there is no RESEND_API_KEY. */
  dryRun: boolean
}

export type InboundDeps = {
  rpc: Rpc
  send: Send
  config: InboundConfig
  now?: () => Date
  random?: (n: number) => Uint8Array
  /** Test seam: replaces the real classifier. */
  classify?: typeof classify
  log?: (line: string) => void
}

/**
 * DPDP_LEGAL_RESPONSE_DAYS: a whole number of days from 1 to 365, otherwise 90.
 * THE NUMBER IS THE OWNER'S AND COUNSEL'S TO CONFIRM. This code makes no legal assertion; it only turns the
 * configured number into a due date on the ticket so nothing sits unnoticed.
 */
export function parseLegalDays(raw: string | undefined | null): number {
  const s = (raw ?? "").trim()
  if (!/^\d{1,3}$/.test(s)) return DEFAULT_LEGAL_RESPONSE_DAYS
  const n = Number(s)
  return n >= 1 && n <= 365 ? n : DEFAULT_LEGAL_RESPONSE_DAYS
}

// ---------------------------------------------------------------------------
// The Worker's payload.
// ---------------------------------------------------------------------------

export type InboundMail = {
  /** Every sender address known (header From, envelope from, Return-Path), bare and lower-cased. */
  senders: string[]
  /** Where an acknowledgement would go: the header From, else the envelope from. "" if neither is an address. */
  replyAddress: string
  /** The header From's display name, when the Worker decoded one. Shown in the operator's notice only. */
  fromName: string | null
  /** Envelope recipient first, then To / Cc header addresses. */
  recipients: string[]
  subject: string
  text: string
  headers: Record<string, string>
  contentType: string
  messageId: string | null
  inReplyTo: string | null
  references: string | null
  hasAttachments: boolean
  /** The Worker read only part of a large message, so `text` may be incomplete. */
  truncated: boolean
  /** The Worker's own clock (received_at), when it sent one that parses. See receivedAtOf. */
  workerReceivedAt: Date | null
}

const ADDRESS_RE = /[A-Za-z0-9._%+'\-]+@[A-Za-z0-9.\-]+/g

function clean(value: string): string {
  // Postgres text cannot hold NUL; a message with one would fail to record and degrade to a raw forward.
  return value.replace(/\u0000/g, "")
}

/** Header-safe text: control characters (CR and LF included) become a space, so a value cannot start a new header line. */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim()
}

function asText(value: unknown): string {
  if (typeof value === "string") return clean(value)
  if (Array.isArray(value)) return clean(value.filter((v) => typeof v === "string").join(", "))
  return ""
}

function addressesIn(value: unknown): string[] {
  const out: string[] = []
  const text = Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : "")).join(",") : typeof value === "string" ? value : ""
  for (const m of text.match(ADDRESS_RE) ?? []) {
    const a = m.toLowerCase()
    if (!out.includes(a)) out.push(a)
  }
  return out
}

function readHeaders(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (name: unknown, v: unknown) => {
    if (typeof name !== "string" || !name.trim()) return
    const text = oneLine(asText(v)).slice(0, 2000)
    const key = name.trim().toLowerCase()
    out[key] = key in out ? `${out[key]}, ${text}` : text
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Array.isArray(entry)) put(entry[0], entry[1])
      else if (entry && typeof entry === "object") put((entry as Record<string, unknown>).name, (entry as Record<string, unknown>).value)
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) put(k, v)
  }
  return out
}

/** Text from an HTML-only message: scripts and styles dropped, line breaks kept, tags removed, common entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Reads the Worker's JSON (workers/dpdp-inbound-mail/src/types.ts, InboundMailPayload, version 1: snake_case). That type
 * IS the wire contract; a few camelCase aliases are accepted as well because a rename must not lose mail. Returns null
 * when the body is not an object or carries nothing at all (no address, no subject, no text).
 *
 * Values that end up in a header of an email we send (subject, Message-ID, References, Content-Type, every header value)
 * are flattened to one line here, so a hostile sender cannot start a new header line. The body keeps its line breaks.
 * The header signals the Worker also sends as top-level fields (auto_submitted, precedence, x_autoreply,
 * x_auto_response_suppress: null = absent, "" = present but empty) are merged into `headers`, because for several of
 * them presence alone is the signal.
 */
export function parseInbound(raw: unknown): InboundMail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const headers = readHeaders(r.headers)
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = asText(r[k])
      if (v) return v
    }
    return ""
  }
  for (const [field, name] of [
    ["auto_submitted", "auto-submitted"], ["precedence", "precedence"], ["x_autoreply", "x-autoreply"], ["x_auto_response_suppress", "x-auto-response-suppress"],
  ] as const) {
    const v = r[field]
    if (typeof v === "string" && !(name in headers)) headers[name] = oneLine(clean(v)).slice(0, 2000)
  }

  const envelopeFrom = bareAddress(pick("envelope_from", "from", "envelopeFrom", "mailFrom"))
  const headerFrom = bareAddress(pick("from_address") || pick("header_from", "headerFrom", "fromHeader") || headers["from"] || "")
  const returnPath = bareAddress(headers["return-path"] ?? "")
  const senders = [headerFrom, envelopeFrom, returnPath].filter((a, i, all) => a && all.indexOf(a) === i)
  const replyAddress = headerFrom || envelopeFrom
  const fromName = oneLine(pick("from_name")).slice(0, 200) || null

  const envelopeTo = addressesIn(r.envelope_to ?? r.to ?? r.envelopeTo ?? r.rcptTo)
  const recipients = [
    ...envelopeTo,
    ...addressesIn(r.header_to ?? r.headerTo ?? headers["to"]),
    ...addressesIn(r.cc ?? headers["cc"]),
  ].filter((a, i, all) => all.indexOf(a) === i)

  const subject = oneLine(pick("subject") || headers["subject"] || "").slice(0, 998)
  let text = pick("text", "body", "plain")
  if (!text.trim()) {
    const html = pick("html")
    if (html) text = htmlToText(html)
  }
  text = text.slice(0, MAX_TEXT_CHARS)

  if (!senders.length && !recipients.length && !subject.trim() && !text.trim()) return null

  const idOf = (...keys: string[]): string | null => oneLine(pick(...keys)).slice(0, 998) || null
  const workerTime = Date.parse(pick("received_at", "receivedAt"))
  return {
    senders,
    replyAddress,
    fromName,
    recipients,
    subject,
    text,
    headers,
    contentType: oneLine(pick("content_type", "contentType") || headers["content-type"] || "").slice(0, 300),
    messageId: idOf("message_id", "messageId", "message-id") ?? (oneLine(headers["message-id"] ?? "") || null),
    inReplyTo: idOf("in_reply_to", "inReplyTo", "in-reply-to") ?? (oneLine(headers["in-reply-to"] ?? "") || null),
    references: oneLine(pick("references")).slice(0, 8000) || oneLine(headers["references"] ?? "").slice(0, 8000) || null,
    hasAttachments: r.has_attachments === true || r.hasAttachments === true || (typeof r.attachmentCount === "number" && r.attachmentCount > 0),
    truncated: r.truncated === true,
    workerReceivedAt: Number.isFinite(workerTime) ? new Date(workerTime) : null,
  }
}

/** The Worker's clock is used for received_at (it saw the message first) unless it is more than 48 hours from ours. */
export function receivedAtOf(workerTime: Date | null, serverNow: Date): Date {
  if (workerTime && Math.abs(workerTime.getTime() - serverNow.getTime()) <= 48 * 3600_000) return workerTime
  return serverNow
}

// ---------------------------------------------------------------------------
// Auth.
// ---------------------------------------------------------------------------

/** Compares two secrets as SHA-256 digests, so neither the length nor the first differing byte shows in the timing. */
export async function secretMatches(presented: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(presented)), crypto.subtle.digest("SHA-256", enc.encode(secret))])
  const ua = new Uint8Array(a)
  const ub = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i]
  return diff === 0
}

// ---------------------------------------------------------------------------
// The two emails this function writes.
// ---------------------------------------------------------------------------

/** "2026-09-29 21:03 IST": fixed offset, no Intl, so the text does not depend on the runtime's locale data. */
export function formatIst(d: Date): string {
  return `${new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} IST`
}

/** Why an acknowledgement must NOT be sent to this sender, or null when it may. */
export function ackBlocker(mail: InboundMail, c: Pick<Classification, "autoSignals">): string | null {
  if (c.autoSignals.length > 0) return "the message carries auto-mail signals"
  const to = mail.replyAddress
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return "no usable sender address"
  if (parseRecipient(to).ours) return "the sender is our own mailbox"
  if (/^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?)(?:[+._-]|$)/.test(to.split("@")[0])) return "the sender is a no-reply address"
  if (/\bdmarc=fail\b/i.test(mail.headers["authentication-results"] ?? "")) return "the sender failed DMARC (possible forged address)"
  return null
}

/** The acknowledgement text. It says received, ticket, will respond -- and nothing more. */
export function renderAck(ticket: string, originalSubject: string, receivedAt: Date): string {
  const subject = originalSubject.trim() || "(no subject)"
  return [
    "Hello,",
    "",
    "We received your message to VERIDIAN AI DPDP.",
    "",
    `Your ticket number is ${ticket}. Please quote it if you write to us again about this.`,
    `Subject received: ${subject}`,
    `Received: ${formatIst(receivedAt)}`,
    "",
    "We will respond to you. This is an automatic acknowledgement; it is not a reply to what your message says.",
    "",
    "-- VERIDIAN AI DPDP",
  ].join("\n")
}

type Outcome = {
  ticket: string
  cls: MailClass
  reason: string
  dueAt: string | null
  ack: string
  rawForwarded: boolean
  duplicate: boolean
}

function quote(text: string): string {
  return text.split(/\r?\n/).map((l) => `> ${l}`).join("\n")
}

/** The operator's notice: a summary block, then the original message quoted. */
export function renderNotification(mail: InboundMail, o: Outcome, outbound: OutboundMatch | null, receivedAt: Date): string {
  const lines = [
    `A message reached ${MAILBOX}.`,
    "",
    `Class:         ${CLASS_LABEL[o.cls]}   (${o.reason})`,
    `Ticket:        ${o.ticket}${o.duplicate ? "   (this delivery was already recorded)" : ""}`,
  ]
  if (o.dueAt) lines.push(`Respond by:    ${formatIst(new Date(o.dueAt))}   (the window is set by DPDP_LEGAL_RESPONSE_DAYS; confirm the number with counsel)`)
  lines.push(
    `From:          ${mail.fromName && mail.replyAddress ? `${mail.fromName} <${mail.replyAddress}>` : mail.replyAddress || "(unknown)"}`,
    `To:            ${mail.recipients.find((a) => parseRecipient(a).ours) ?? mail.recipients[0] ?? "(unknown)"}`,
    `Received:      ${formatIst(receivedAt)}`,
    `Subject:       ${mail.subject.trim() || "(no subject)"}`,
  )
  if (outbound) lines.push(`In reply to:   ${outbound.ticketNo ? `ticket ${outbound.ticketNo}, ` : ""}our ${CLASS_LABEL[outbound.cls]} message (ref ${outbound.ref})`)
  if (mail.messageId) lines.push(`Message-ID:    ${mail.messageId}`)
  if (LEGAL_CLOCK_CLASSES.includes(o.cls)) lines.push(`Acknowledgement: ${o.ack}`)
  if (o.rawForwarded) lines.push("", "THE CLASSIFIER FAILED on this message. It was filed as REVIEW; read it yourself.")
  if (mail.hasAttachments) lines.push("", "The message had attachments. They are not stored anywhere.")
  if (mail.truncated) lines.push("", "The message was larger than the Worker reads; the text below may be incomplete.")
  lines.push("", "Reply to this email to answer the sender directly (Reply-To is set to them).", "", "----- original message -----", quote(mail.text.trim() || "(empty)"))
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// The handler.
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } })
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

type InsertResult = { id: string; ticketNo: string; class: MailClass; status: string; dueAt: string | null; duplicate: boolean; ackDue: boolean; operatorNotified: boolean }

export async function handleInbound(req: Request, deps: InboundDeps): Promise<Response> {
  const cfg = deps.config
  const log = deps.log ?? ((line: string) => console.log(line))
  const now = () => (deps.now ? deps.now() : new Date())

  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405)

  if (cfg.secret.length < 24) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", error: "DPDP_INBOUND_SECRET is not set or shorter than 24 characters" }))
    return json({ ok: false, error: "not configured" }, 503)
  }
  const bearer = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim())?.[1]?.trim() ?? ""
  if (!bearer || !(await secretMatches(bearer, cfg.secret))) return json({ ok: false, error: "unauthorized" }, 401)

  // A declared length far past the limit is refused before the body is read (4 bytes per character at most).
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS * 4) return json({ ok: false, error: "payload too large" }, 413)
  let bodyText: string
  try {
    bodyText = await req.text()
  } catch {
    return json({ ok: false, error: "unreadable body" }, 400)
  }
  if (bodyText.length > MAX_BODY_CHARS) return json({ ok: false, error: "payload too large" }, 413)
  let raw: unknown
  try {
    raw = JSON.parse(bodyText)
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400)
  }
  const mail = parseInbound(raw)
  if (!mail) return json({ ok: false, error: "empty or malformed message" }, 400)

  const receivedAt = receivedAtOf(mail.workerReceivedAt, now())
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await deps.rpc(fn, args)
    if (error) throw new Error(`${fn}: ${error.message}`)
    return data as T
  }

  // 1. The outbound message this one answers, by the ref in the plus-tag or by a Message-ID we sent.
  const tag = readTag(mail.recipients)
  const messageIds = extractMessageIds([mail.inReplyTo, mail.references])
  let outbound: OutboundMatch | null = null
  let lookupNote = ""
  if (tag.ref || messageIds.length > 0) {
    try {
      const found = await call<{ ref: string; class: string; ticketNo: string | null; matchedBy: "ref" | "message_id" } | null>("dpdp_mail_lookup_outbound", {
        p_ref: tag.ref,
        p_message_ids: messageIds,
      })
      if (found && MAIL_CLASSES.includes(found.class as MailClass)) {
        outbound = { ref: found.ref, cls: found.class as MailClass, ticketNo: found.ticketNo, matchedBy: found.matchedBy }
      }
    } catch (e) {
      lookupNote = "; outbound lookup failed"
      log(JSON.stringify({ evt: "dpdp-inbound-mail", warn: "lookup failed", detail: message(e).slice(0, 200) }))
    }
  }

  // 2. Classify. A throw must not lose the message: it becomes `review`, and the operator is told to read it raw.
  let c: Classification
  let classifierFailed = false
  try {
    c = (deps.classify ?? classify)({
      recipients: mail.recipients,
      senders: mail.senders,
      subject: mail.subject,
      text: mail.text,
      headers: mail.headers,
      contentType: mail.contentType,
      outbound,
    })
  } catch (e) {
    classifierFailed = true
    let signals: string[] = []
    try {
      const s = autoSignals({ senders: mail.senders, subject: mail.subject, headers: mail.headers, contentType: mail.contentType })
      signals = [...s.strong, ...s.weak]
    } catch { /* keep [] */ }
    c = { cls: "review", rule: "default", confidence: "low", reason: `classifier-error:${message(e).slice(0, 120)}`, tagRef: tag.ref, autoSignals: signals, strongAuto: false }
  }
  const reason = `${c.reason}${lookupNote}`
  const legal = LEGAL_CLOCK_CLASSES.includes(c.cls)
  const blocker = legal ? ackBlocker(mail, c) : "not a legal-clock class"
  const operatorEmail = cfg.operatorEmail.trim()

  // 3. Record. If this fails the message is forwarded raw instead: it is never dropped.
  let rec: InsertResult
  try {
    rec = await call<InsertResult>("dpdp_mail_insert_inbound", {
      p_class: c.cls,
      p_from_addr: mail.replyAddress || mail.senders[0] || "",
      p_subject: mail.subject,
      p_message_id: mail.messageId,
      p_received_at: receivedAt.toISOString(),
      p_due_days: legal ? cfg.legalResponseDays : null,
      p_ref: tag.ref,
      p_to_addr: mail.recipients.find((a) => parseRecipient(a).ours) ?? mail.recipients[0] ?? null,
      p_in_reply_to: mail.inReplyTo,
      p_references_hdr: mail.references,
      p_excerpt: mail.text.slice(0, EXCERPT_CHARS),
      p_classifier_reason: reason,
      p_matched_outbound_ref: outbound?.ref ?? null,
      p_raw_forwarded: classifierFailed,
      p_wants_ack: legal && blocker === null,
    })
    if (!rec || typeof rec.ticketNo !== "string" || !rec.ticketNo) throw new Error("dpdp_mail_insert_inbound returned no ticket")
  } catch (e) {
    return degradedForward(mail, c.cls, message(e), receivedAt, deps, log, operatorEmail)
  }

  const outcome: Outcome = { ticket: rec.ticketNo, cls: c.cls, reason, dueAt: rec.dueAt, ack: "not applicable", rawForwarded: classifierFailed, duplicate: rec.duplicate }

  // 4. Acknowledge the sender (legal-clock classes), before the operator's notice so the notice can say how it went.
  let ackStatus = "not_applicable"
  if (legal) {
    if (blocker !== null) {
      ackStatus = "skipped"
      outcome.ack = `NOT sent -- ${blocker}`
    } else if (!rec.ackDue) {
      ackStatus = "skipped"
      outcome.ack = "NOT sent -- already acknowledged, or this sender has reached the 24-hour limit"
    } else if (cfg.dryRun) {
      ackStatus = "dry_run"
      outcome.ack = "dry run -- would be sent"
    } else {
      try {
        const detail = await sendAck(mail, c.cls, rec.ticketNo, receivedAt, deps, call, log)
        ackStatus = "sent"
        outcome.ack = `sent to the sender${detail}`
      } catch (e) {
        ackStatus = "failed"
        outcome.ack = `FAILED -- ${message(e).slice(0, 200)}`
        log(JSON.stringify({ evt: "dpdp-inbound-mail", ticket: rec.ticketNo, warn: "ack failed", detail: message(e).slice(0, 200) }))
      }
    }
  }

  // 5. Tell the operator (every class but auto).
  let notified = "skipped_auto"
  if (NOTIFY_CLASSES.includes(c.cls)) {
    if (rec.duplicate && rec.operatorNotified) {
      notified = "already"
    } else if (cfg.dryRun) {
      notified = "dry_run"
    } else if (!operatorEmail) {
      notified = "no_operator_email"
    } else {
      try {
        const subject = classifierFailed ? `[CLASSIFIER FAILED ${rec.ticketNo}] ${mail.subject.trim() || "(no subject)"}` : notificationSubject(c.cls, rec.ticketNo, mail.subject)
        await deps.send({
          from: cfg.from,
          to: operatorEmail,
          subject,
          text: renderNotification(mail, outcome, outbound, receivedAt),
          replyTo: mail.replyAddress && parseRecipient(mail.replyAddress).ours === false ? mail.replyAddress : undefined,
          headers: { "X-Veridian-Class": c.cls, "X-Veridian-Ticket": rec.ticketNo, "X-Veridian-Origin": "inbound-notification", "Auto-Submitted": "auto-generated" },
          idempotencyKey: `dpdp-inbound-notify-${rec.ticketNo}`,
        })
        notified = "sent"
        try {
          await call("dpdp_mail_mark_notified", { p_ticket_no: rec.ticketNo })
        } catch (e) {
          log(JSON.stringify({ evt: "dpdp-inbound-mail", ticket: rec.ticketNo, warn: "mark_notified failed", detail: message(e).slice(0, 200) }))
        }
      } catch (e) {
        notified = "failed"
        log(JSON.stringify({ evt: "dpdp-inbound-mail", ticket: rec.ticketNo, warn: "operator notice failed", detail: message(e).slice(0, 200) }))
      }
    }
  }

  log(JSON.stringify({ evt: "dpdp-inbound-mail", ticket: rec.ticketNo, class: c.cls, rule: c.rule, duplicate: rec.duplicate, ack: ackStatus, notified, dryRun: cfg.dryRun }))

  const body = { ok: true, ticket: rec.ticketNo, class: c.cls, rule: c.rule, duplicate: rec.duplicate, dryRun: cfg.dryRun, ack: ackStatus, notified, degraded: false }
  if (notified === "failed" || notified === "no_operator_email") {
    return json({ ...body, ok: false, error: "the message is recorded but the operator could not be told; forward it natively" }, 502)
  }
  if (notified === "dry_run") {
    return json({ ...body, ok: false, error: "dry run: the message is recorded but nobody was told; forward it natively" }, 502)
  }
  return json(body, 200)
}

/** Sends the acknowledgement and logs it in dpdp.mail_outbound so a reply to it lands on the same class. Throws if the send fails. */
async function sendAck(
  mail: InboundMail,
  cls: MailClass,
  ticket: string,
  receivedAt: Date,
  deps: InboundDeps,
  call: <T>(fn: string, args: Record<string, unknown>) => Promise<T>,
  log: (line: string) => void,
): Promise<string> {
  const ref = newRef(deps.random)
  const subject = withSubjectPrefix(cls, `We received your message (ticket ${ticket})`)
  const logArgs = { p_ref: ref, p_class: cls, p_to_addr: mail.replyAddress, p_subject: subject, p_ticket_no: ticket }
  let logged = true
  try {
    await call("dpdp_mail_log_outbound", logArgs)
  } catch (e) {
    logged = false
    log(JSON.stringify({ evt: "dpdp-inbound-mail", ticket, warn: "ack outbound log failed", detail: message(e).slice(0, 200) }))
  }
  const headers: Record<string, string> = {
    ...outboundHeaders(cls, ref),
    "Auto-Submitted": "auto-replied",
    "X-Auto-Response-Suppress": "All",
    "X-Veridian-Origin": "acknowledgement",
  }
  if (mail.messageId) {
    headers["In-Reply-To"] = mail.messageId
    headers["References"] = mail.messageId
  }
  const sent = await deps.send({
    from: deps.config.from,
    to: mail.replyAddress,
    subject,
    text: renderAck(ticket, mail.subject, receivedAt),
    replyTo: replyToAddress(cls, ref),
    headers,
    idempotencyKey: `dpdp-inbound-ack-${ticket}`,
  })
  let note = ""
  try {
    await call("dpdp_mail_log_outbound", { ...logArgs, p_provider_message_id: sent.id || null })
    await call("dpdp_mail_mark_ack", { p_ticket_no: ticket })
  } catch (e) {
    note = " (sent, but not recorded as sent)"
    log(JSON.stringify({ evt: "dpdp-inbound-mail", ticket, warn: "ack sent but not recorded", detail: message(e).slice(0, 200), logged }))
  }
  return note
}

/** The database could not record the message: email the raw message to the operator so it is not lost. */
async function degradedForward(
  mail: InboundMail,
  cls: MailClass,
  error: string,
  receivedAt: Date,
  deps: InboundDeps,
  log: (line: string) => void,
  operatorEmail: string,
): Promise<Response> {
  log(JSON.stringify({ evt: "dpdp-inbound-mail", error: "could not record the message", detail: error.slice(0, 200), class: cls }))
  if (deps.config.dryRun || !operatorEmail) {
    return json({ ok: false, degraded: true, error: "could not record the message and could not forward it; forward it natively" }, 502)
  }
  const subject = notificationSubject(cls, "UNRECORDED", mail.subject)
  const lines = [
    `A message reached ${MAILBOX} but could NOT be recorded (no ticket was created).`,
    "It is forwarded here raw so it is not lost. The classifier's provisional class is shown.",
    "",
    `Provisional class: ${CLASS_LABEL[cls]}`,
    `Why it was not recorded: ${error.slice(0, 300)}`,
    `From:          ${mail.replyAddress || "(unknown)"}`,
    `To:            ${mail.recipients.find((a) => parseRecipient(a).ours) ?? mail.recipients[0] ?? "(unknown)"}`,
    `Received:      ${formatIst(receivedAt)}`,
    `Subject:       ${mail.subject.trim() || "(no subject)"}`,
  ]
  if (mail.messageId) lines.push(`Message-ID:    ${mail.messageId}`)
  if (LEGAL_CLOCK_CLASSES.includes(cls)) lines.push("", "This may start a legal response clock. No acknowledgement was sent to the sender.")
  lines.push("", "----- original message -----", quote(mail.text.trim() || "(empty)"))
  const text = lines.join("\n")
  try {
    await deps.send({
      from: deps.config.from,
      to: operatorEmail,
      subject,
      text,
      replyTo: mail.replyAddress && !parseRecipient(mail.replyAddress).ours ? mail.replyAddress : undefined,
      headers: { "X-Veridian-Class": cls, "X-Veridian-Origin": "inbound-notification", "Auto-Submitted": "auto-generated" },
      idempotencyKey: `dpdp-inbound-raw-${(mail.messageId ?? newRef(deps.random)).replace(/[^A-Za-z0-9._@-]/g, "").slice(0, 120)}`,
    })
    return json({ ok: true, ticket: null, class: cls, degraded: true, dryRun: false, notified: "raw_forwarded" }, 200)
  } catch (e) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", error: "raw forward failed", detail: message(e).slice(0, 200) }))
    return json({ ok: false, degraded: true, error: "could not record the message and could not forward it; forward it natively" }, 502)
  }
}
