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
// ACKNOWLEDGEMENT (legal-clock classes only: grievance, data_request, review -- including a message the
// classifier RAISED to grievance / data_request from a Monday reply, an invoice thread or an auto-reply header).
// It says the message was received, gives the ticket number and says we will respond. It asserts nothing else:
// no deadline, no statute, no promise, and it does NOT repeat anything the sender wrote (not even their subject:
// the address it goes to is the unverified From, and an acknowledgement that echoes text is a way to make us send
// someone else's words to a stranger). For a `review` message the subject carries no class label at all, so the
// sender never sees our internal word "REVIEW". It is NEVER sent when the message carries an auto-mail signal (an
// auto-responder answering an auto-responder is a loop) unless the classifier escalated it (a legal request is
// acknowledged whatever headers the sender chose) or a legal-clock TAG (grv / dsr / rev) stood alone against the headers
// (autoHeadersIgnored: a List-Unsubscribe mailto or the grievance@ alias, which may carry Auto-Submitted and no words at all)
// -- and even then not to a header-flagged reply to our OWN acknowledgement (its outbound row has a ticket number), which is
// how two auto-responders loop and the only loop there is --, when the sender is our own mailbox or a no-reply / bounce
// address (postmaster@ and mailer-daemon@ are NOT refused: without a second machine signal the classifier files them as
// ordinary senders), when the sender failed DMARC (backscatter to a forged address), when 3 have already gone to that
// sender in 24 hours, or when 30 have gone to anyone in the last hour (dpdp_mail_insert_inbound decides those
// last two; the ticket is still created and the operator's notice then says to answer by hand). The
// acknowledgement itself is stamped Auto-Submitted / X-Auto-Response-Suppress / X-Veridian-Origin, so a
// compliant responder will not answer it and, if it is ever returned to us, the classifier treats it as auto.
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
 * A per-message override for an adapter that knows more than the payload says (resend-inbound.ts: Resend accepts EVERY
 * address at the domain, so what the message was addressed to changes how it is filed). It is a third argument of
 * handleInbound, never a field of the JSON body, so a caller of the bearer route cannot set it.
 */
export type InboundPolicy = {
  /** File the message under this class instead of the classifier's (see applyPolicy for the two things that are never overridden). */
  forceClass?: MailClass
  /** With forceClass: a message the classifier found a data request or grievance in, from the sender's own words, keeps that legal class. */
  unlessLegal?: boolean
  /** Why (stored in the ticket's classifier reason). */
  reason?: string
  /** Never acknowledge this message, whatever its class. */
  noAck?: boolean
  /** Extra lines for the operator's notice, right under its first line (for example who received it and what Resend reported). */
  noticeLines?: string[]
  /** The message's own received_at is from a clock we trust (Resend's), so the 48-hour clamp meant for the Worker's clock is skipped. */
  trustReceivedAt?: boolean
}

/**
 * Applies InboundPolicy.forceClass. Never overrides the loop guard (`self`: a message from our own mailbox stays `auto`),
 * and with `unlessLegal` never demotes a data request or grievance that the classifier found in words the sender wrote,
 * unless the message also carries auto-mail signals (bulk mail to a guessed address is not a request).
 */
export function applyPolicy(c: Classification, policy: InboundPolicy | undefined): Classification {
  const force = policy?.forceClass
  if (!policy || !force || c.rule === "self") return c
  const keeps = policy.unlessLegal === true && (c.cls === "data_request" || c.cls === "grievance") && c.autoSignals.length === 0
  const why = policy.reason ?? `forced:${force}`
  if (keeps) return { ...c, reason: `${c.reason}; ${why} (kept: a legal request in the sender's own words)` }
  return { ...c, cls: force, rule: force === "auto" ? "auto" : "tag", confidence: "high", escalatedFrom: null, reason: `${why}; the classifier said ${c.cls} (${c.reason})` }
}

/** Puts `lines` under the first line of a notice, before its summary block. */
export function withNoticeLines(text: string, lines: string[] | undefined): string {
  if (!lines || lines.length === 0) return text
  const at = text.indexOf("\n\n")
  const block = lines.join("\n")
  return at < 0 ? `${text}\n\n${block}` : `${text.slice(0, at)}\n\n${block}${text.slice(at)}`
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
  /** The payload carried an envelope sender that is EMPTY (MAIL FROM:<>, a null reverse-path). See ClassifyInput.nullSender. */
  nullSender: boolean
  /** The Worker's own clock (received_at), when it sent one that parses. See receivedAtOf. */
  workerReceivedAt: Date | null
}

// BOUNDED on purpose (review of 2026-09-30): `[..]+@` over a run of address characters with no "@" is quadratic (a 200 000-character
// To / Cc header took 95 seconds), and a message that pins the CPU is a message that is never recorded. RFC 5321 caps a local part at 64
// octets and a domain at 255, so nothing legitimate is cut. Each start position now costs at most ~64 steps: linear overall.
const ADDRESS_RE = /[A-Za-z0-9._%+'\-]{1,64}@[A-Za-z0-9.\-]{1,255}/g
/** Longest string addressesIn scans (one header or the whole list): far beyond any real recipient list. */
const ADDRESS_SCAN_MAX_CHARS = 100_000

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
  const text = (Array.isArray(value) ? value.slice(0, 1000).map((v) => (typeof v === "string" ? v : "")).join(",") : typeof value === "string" ? value : "").slice(0, ADDRESS_SCAN_MAX_CHARS)
  for (const m of text.match(ADDRESS_RE) ?? []) {
    const a = m.toLowerCase()
    if (out.length < 500 && !out.includes(a)) out.push(a)
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

/** Most HTML characters htmlToText reads, and the most text it produces: what follows can never matter (the ticket keeps 4096 characters). */
const HTML_SCAN_MAX_CHARS = 2_000_000
const HTML_OUTPUT_MAX_CHARS = 200_000

/**
 * Text from an HTML-only message: scripts and styles dropped, line breaks kept, tags removed, common entities decoded.
 *
 * LINEAR TIME (review of 2026-09-30). The version this replaces was three regular expressions, each quadratic on input a stranger
 * can send: `<[^>]*>` over a run of "<" with no ">" (80 000 characters: 10 seconds), `<script...</script>` over a run of unclosed
 * "<script>" tags, and `[ \t]+\n` over a long run of spaces (80 000 characters: 14 seconds). A message that pins the CPU is killed by
 * the platform and never recorded, and Svix then retries it for a day. This one walks the string once with indexOf, remembers when a
 * script / style block has no closer (so it never searches for it twice), stops at HTML_OUTPUT_MAX_CHARS, and trims lines by hand.
 * Same output as before for well-formed HTML (handler.test.ts); an unterminated "<" is kept as text, as before.
 */
export function htmlToText(html: string): string {
  const src = html.length > HTML_SCAN_MAX_CHARS ? html.slice(0, HTML_SCAN_MAX_CHARS) : html
  const n = src.length
  // ASCII-only lower case: the same length as the original (String#toLowerCase can change it), so an index found in one is valid in the other.
  const lower = src.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
  const noCloser: Record<string, boolean> = Object.create(null)
  let out = ""
  let i = 0
  while (i < n && out.length < HTML_OUTPUT_MAX_CHARS) {
    const lt = src.indexOf("<", i)
    if (lt === -1) { out += src.slice(i); break }
    out += src.slice(i, lt)
    // A "<" that cannot start a tag (followed by a space, a digit, "=", another "<", the end ...: "a < b", "<3") is text. The regular
    // expressions this replaces treated it as the start of a tag running to the next ">", which swallowed the words in between (and
    // any <script> opener in between, leaking the script's code into the text). "<" + letter, "/", "!" or "?" is a tag as before.
    if (!/[A-Za-z/!?]/.test(src[lt + 1] ?? "")) { out += "<"; i = lt + 1; continue }
    const gt = src.indexOf(">", lt + 1)
    if (gt === -1) { out += src.slice(lt); break } // no ">" anywhere after: this "<" and everything after it is text, as it always was
    const head = lower.slice(lt + 1, lt + 12)
    const block = /^(script|style)(?![a-z0-9_])/.exec(head)
    if (block && !noCloser[block[1]]) {
      const close = lower.indexOf(`</${block[1]}>`, lt + 1 + block[1].length)
      if (close === -1) noCloser[block[1]] = true // no closer anywhere after: an ordinary tag from now on, and never searched for again
      else { out += " "; i = close + block[1].length + 3; continue }
    }
    // <br>, <br/>, </p> </div> </tr> </li> </h1>..</h6> end a line; every other tag is dropped whole (up to its first ">").
    const inner = gt - lt - 1 <= 40 ? lower.slice(lt + 1, gt) : "" // only a short tag can be <br> or a closing block tag
    if (/^br\s*\/?$/.test(inner) || /^\/(?:p|div|tr|li|h[1-6])$/.test(inner)) out += "\n"
    i = gt + 1
  }
  const decoded = (out.length > HTML_OUTPUT_MAX_CHARS ? out.slice(0, HTML_OUTPUT_MAX_CHARS) : out)
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&")
  // spaces and tabs before a line break go, by hand: `[ \t]+\n` is quadratic over a long run of spaces
  const lines = decoded.split("\n")
  for (let k = 0; k < lines.length - 1; k++) {
    let end = lines[k].length
    while (end > 0 && (lines[k][end - 1] === " " || lines[k][end - 1] === "\t")) end--
    if (end < lines[k].length) lines[k] = lines[k].slice(0, end)
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * A reply to one of OUR emails usually quotes it, and the Monday digest carries credentials: the person's AI work link (a 7-day
 * read + small-edits bearer link), one-time Undo and "Yes, it is done" links, the sign-in link and the unsubscribe token. The
 * reply goes to the one public mailbox, so without this the quoted digest would be written to dpdp.mail_inbound.excerpt, quoted
 * into the notice sent to the operator, and kept by the mail provider. Every such secret is replaced before anything is stored or
 * forwarded; the surrounding words stay, so the message still reads and still classifies. Linear time: bounded quantifiers only.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/[^\s<>"')\]]{0,200}\/ai\/[0-9a-f]{64}[^\s<>"')\]]{0,200}/gi, "[AI work link removed]")
    .replace(/#undo=[^\s<>"')\]]{1,300}/gi, "#undo=[removed]")
    .replace(/\/act\/#[^\s<>"')\]]{1,300}/gi, "/act/#[removed]")
    .replace(/\/auth\/v1\/verify\?[^\s<>"')\]]{1,600}/gi, "/auth/v1/verify?[removed]")
    .replace(/([?&]t=)[0-9a-f]{32,128}/gi, "$1[removed]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[64-hex removed]")
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
  text = redactSecrets(text.slice(0, MAX_TEXT_CHARS))

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
    nullSender: isNullSender(r),
    workerReceivedAt: Number.isFinite(workerTime) ? new Date(workerTime) : null,
  }
}

/**
 * True when the payload carries an envelope sender (envelope_from / envelopeFrom / mailFrom) that is present and empty, or the null
 * reverse-path "<>": what the Worker sends for a bounce or an auto-responder. An ABSENT field is not a null sender. The classifier treats
 * it as a header-class auto signal (on its own it never hides a legal request); see autoSignals in classify.ts.
 */
function isNullSender(r: Record<string, unknown>): boolean {
  for (const key of ["envelope_from", "envelopeFrom", "mailFrom"]) {
    const v = r[key]
    if (typeof v === "string") return v.replace(/\s+/g, "") === "" || v.replace(/\s+/g, "") === "<>"
  }
  return false
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

/**
 * Why an acknowledgement must NOT be sent to this sender, or null when it may.
 *
 * Auto-mail headers block it, except on a message the classifier ESCALATED to a legal class, and on one where a legal-clock TAG
 * stood alone against them (`autoHeadersIgnored`: a List-Unsubscribe mailto or the grievance@ alias that carries Auto-Submitted /
 * Precedence and no words): those headers are chosen by the sender, and the owner's rule is that a legal request is acknowledged
 * whatever headers it carries. The one thing that still blocks such a message is being a header-flagged reply to our OWN
 * acknowledgement (`outbound.ticketNo` is only ever set on an acknowledgement): the ticket already exists and answering an
 * auto-responder's answer is the loop, and the only one. Bounces never reach here as a legal class.
 *
 * A postmaster@ / mailer-daemon@ sender is NOT refused here: the classifier files such a name as machine-generated only with a
 * second machine signal, so a legal-class message that got this far from one is a real mail (postmaster@ is an ordinary, human-read
 * mailbox at a small firm) and is acknowledged like any other. no-reply / bounce addresses still are refused.
 */
export function ackBlocker(
  mail: InboundMail,
  c: Pick<Classification, "autoSignals" | "escalatedFrom"> & { autoHeadersIgnored?: boolean },
  outbound: Pick<OutboundMatch, "ticketNo"> | null = null,
): string | null {
  if (c.autoSignals.length > 0) {
    if (c.escalatedFrom === null && c.autoHeadersIgnored !== true) return "the message carries auto-mail signals"
    if (outbound?.ticketNo) return `an automatic reply to our own acknowledgement of ticket ${outbound.ticketNo} (the ticket already exists)`
  }
  const to = mail.replyAddress
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return "no usable sender address"
  if (parseRecipient(to).ours) return "the sender is our own mailbox"
  if (/^(?:no-?reply|do-?not-?reply|donotreply|bounces?)(?:[+._-]|$)/.test(to.split("@")[0])) return "the sender is a no-reply address"
  if (/\bdmarc=fail\b/i.test(mail.headers["authentication-results"] ?? "")) return "the sender failed DMARC (possible forged address)"
  return null
}

/**
 * The acknowledgement text. It says received, ticket, will respond -- and nothing more. Nothing the sender wrote is
 * repeated in it (not the subject either), so it cannot be used to make us send someone else's words to a third party.
 */
export function renderAck(ticket: string, receivedAt: Date): string {
  return [
    "Hello,",
    "",
    "We received your message to VERIDIAN AI DPDP.",
    "",
    `Your ticket number is ${ticket}. Please quote it if you write to us again about this.`,
    `Received: ${formatIst(receivedAt)}`,
    "",
    "We will respond to you. This is an automatic acknowledgement; it is not a reply to what your message says.",
    "",
    "-- VERIDIAN AI DPDP",
  ].join("\n")
}

/**
 * The acknowledgement's subject. `review` is our internal "could not classify" label, so the sender gets a neutral
 * line with no class label instead of the word REVIEW; the other legal classes keep their label.
 */
export function ackSubject(cls: MailClass, ticket: string): string {
  const line = `We received your message (ticket ${ticket})`
  return cls === "review" ? `[VERIDIAN DPDP] ${line}` : withSubjectPrefix(cls, line)
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
export function renderNotification(mail: InboundMail, o: Outcome, outbound: OutboundMatch | null, receivedAt: Date, policy?: InboundPolicy): string {
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
  // An adapter that supplies its own notice lines (resend-inbound.ts: where the whole message and its attachments live, how much was cut)
  // says it accurately, so the Worker-specific wording below is left out for it.
  const adapterNotes = (policy?.noticeLines?.length ?? 0) > 0
  if (mail.hasAttachments && !adapterNotes) lines.push("", "The message had attachments. They are not stored anywhere.")
  if (mail.truncated && !adapterNotes) lines.push("", "The message was larger than the Worker reads; the text below may be incomplete.")
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

type InsertResult = {
  id: string; ticketNo: string; class: MailClass; status: string; dueAt: string | null; duplicate: boolean; ackDue: boolean
  /** Which limit held the acknowledgement back: 3 per sender in 24 hours ("sender") or 30 to anyone in an hour ("hourly"). Absent from older databases. */
  ackLimit?: "sender" | "hourly" | null
  operatorNotified: boolean
  /** The same sender reused a Message-ID for a message that says something else: it got its OWN ticket (duplicate is false). Absent from older databases. */
  messageIdReused?: boolean
}

/** Appended to the stored classifier reason by dpdp_mail_insert_inbound (drizzle/0662) and shown in the operator's notice. Keep the two in step. */
export const MESSAGE_ID_REUSED_NOTE = "same Message-ID, different content"

export async function handleInbound(req: Request, deps: InboundDeps, policy?: InboundPolicy): Promise<Response> {
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

  const receivedAt = policy?.trustReceivedAt && mail.workerReceivedAt ? mail.workerReceivedAt : receivedAtOf(mail.workerReceivedAt, now())
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
      truncated: mail.truncated,
      nullSender: mail.nullSender,
    })
  } catch (e) {
    classifierFailed = true
    let signals: string[] = []
    try {
      const s = autoSignals({ senders: mail.senders, subject: mail.subject, headers: mail.headers, contentType: mail.contentType, nullSender: mail.nullSender, threadMatched: outbound !== null })
      signals = [...s.machine, ...s.header]
    } catch { /* keep [] */ }
    c = { cls: "review", rule: "default", confidence: "low", reason: `classifier-error:${message(e).slice(0, 120)}`, tagRef: tag.ref, autoSignals: signals, strongAuto: false, escalatedFrom: null, autoHeadersIgnored: false }
  }
  if (!classifierFailed) c = applyPolicy(c, policy) // a classifier that threw cannot justify demoting anything: it stays `review`
  const reason = `${c.reason}${lookupNote}`
  const legal = LEGAL_CLOCK_CLASSES.includes(c.cls)
  const blocker = legal ? (policy?.noAck ? "no acknowledgement for this address (recipient policy)" : ackBlocker(mail, c, outbound)) : "not a legal-clock class"
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
    return degradedForward(mail, c.cls, message(e), receivedAt, deps, log, operatorEmail, policy)
  }

  const outcome: Outcome = { ticket: rec.ticketNo, cls: c.cls, reason: rec.messageIdReused === true ? `${reason}; ${MESSAGE_ID_REUSED_NOTE}` : reason, dueAt: rec.dueAt, ack: "not applicable", rawForwarded: classifierFailed, duplicate: rec.duplicate }

  // 4. Acknowledge the sender (legal-clock classes), before the operator's notice so the notice can say how it went.
  let ackStatus = "not_applicable"
  if (legal) {
    if (blocker !== null) {
      ackStatus = "skipped"
      outcome.ack = `NOT sent -- ${blocker}`
    } else if (!rec.ackDue) {
      ackStatus = "skipped"
      outcome.ack = rec.ackLimit === "hourly"
        ? "NOT sent -- the overall limit of 30 acknowledgements in one hour was reached; answer this sender by hand"
        : rec.ackLimit === "sender"
          ? "NOT sent -- this sender has reached the 24-hour limit of 3 acknowledgements; answer them by hand if needed"
          : "NOT sent -- already acknowledged, or an acknowledgement limit was reached (per sender in 24 hours, or overall in one hour); answer by hand if needed"
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
          text: withNoticeLines(renderNotification(mail, outcome, outbound, receivedAt, policy), policy?.noticeLines),
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

  log(JSON.stringify({ evt: "dpdp-inbound-mail", ticket: rec.ticketNo, class: c.cls, rule: c.rule, duplicate: rec.duplicate, messageIdReused: rec.messageIdReused === true, ack: ackStatus, notified, dryRun: cfg.dryRun }))

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
  const subject = ackSubject(cls, ticket)
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
    text: renderAck(ticket, receivedAt),
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
  policy?: InboundPolicy,
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
  const text = withNoticeLines(lines.join("\n"), policy?.noticeLines)
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
