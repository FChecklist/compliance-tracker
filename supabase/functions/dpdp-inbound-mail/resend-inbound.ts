// DPDP single mailbox -- the RESEND INBOUND adapter of the dpdp-inbound-mail Edge Function.
//
//   person -> dpdp@veridian-aios.com -> (root MX) Resend inbound -> stores the message
//     -> POST https://<ref>.supabase.co/functions/v1/dpdp-inbound-mail   (Svix-signed webhook, event email.received)
//     -> THIS FILE: verify the signature -> fetch the full message from Resend -> map it to the Worker's snake_case
//        payload -> handleInbound (handler.ts, the SAME pipeline the Cloudflare Worker feeds) -> 2xx
//
// WHAT THE WEBHOOK DOES NOT CARRY. Only metadata (email_id, from, to, subject, message_id, attachment names). The body,
// the headers and the SPF / DKIM / DMARC verdicts come from GET /emails/receiving/{email_id}, so a fetch is part of every
// delivery. If it fails the answer is 502 and Svix retries; the message stays in Resend meanwhile, so nothing is lost.
//
// THE OWNER'S CORE RULE (nothing silently dropped or demoted; a legal request never misses its clock or its
// acknowledgement) shapes every answer here:
//   * 2xx ONLY after the ticket is durably recorded. A fetch failure, a database failure (the handler's "degraded" answer,
//     which emails the operator the raw message but records no ticket) and a notice that could not be sent are all 502, so
//     Svix keeps retrying until the row exists and the operator has been told.
//   * A retry is harmless. The database refuses a second ticket for the same sender + Message-ID (dpdp_mail_insert_inbound),
//     the acknowledgement is only due while ack_sent_at is empty, and both emails carry an Idempotency-Key. A message with
//     no Message-ID gets a synthetic one derived from the Resend email id, so it is deduplicated too.
//   * A message that Resend says failed DMARC (or failed both SPF and DKIM) is ticketed and the operator is told, but it is
//     never acknowledged: the acknowledgement would go to a forged address. The verdicts are written into the
//     Authentication-Results header the handler's guard reads, from Resend's own `authentication` object and NEVER from a
//     header of the message (the sender writes those).
//
// RESEND ACCEPTS EVERY ADDRESS AT THE DOMAIN (unlike the Worker, which refused unknown ones at the SMTP level). So the
// recipient decides how a message is filed (chooseRecipient): dpdp@ / dpdp+tag first, then the old aliases grievance@ and
// partners@ (treated as the tags grv / prt), then postmaster@ / abuse@ (support, operator told, NEVER acknowledged), then
// anything else (auto, reason "unknown-recipient", logged only) -- except that a data request or grievance found in the
// sender's own words keeps its legal class, because "info@ or privacy@" is exactly where a citizen would write. See
// applyPolicy in handler.ts.
//
// DEPENDENCY-FREE: Web Crypto for the signature, fetch for Resend. The database, the mail provider and fetch are passed in,
// so bun runs this real code in resend-inbound.test.ts with fakes.
import { CLASS_TAG, MAILBOX, MAILBOX_DOMAIN, MAILBOX_LOCAL, parseRecipient } from "../_shared/mail-taxonomy.ts"
import { bareAddress } from "./classify.ts"
import { handleInbound, htmlToText, secretMatches, type InboundDeps, type InboundPolicy } from "./handler.ts"

export const RESEND_API = "https://api.resend.com"
/** Svix rejects a delivery whose timestamp is more than this far from our clock, in either direction. */
export const SVIX_TOLERANCE_SECONDS = 300
export const MAX_WEBHOOK_BYTES = 262_144
export const FETCH_TIMEOUT_MS = 10_000
/** Bytes of text the Worker also sends (workers/dpdp-inbound-mail/src/text.ts): the classifier reads no more. */
export const TEXT_BYTES = 4096
/** The Worker's read cap (DEFAULT_MAX_RAW_BYTES, 128 KiB): a text longer than this is what the Worker would have flagged `truncated`. */
export const WORKER_READ_CAP_CHARS = 128 * 1024
/** A fetched message JSON longer than this is not parsed; the ticket is made from the webhook's own metadata. */
export const MAX_FETCHED_CHARS = 20_000_000
export const RECONCILE_DEFAULT_HOURS = 48
export const RECONCILE_MAX_HOURS = 168
export const RECONCILE_DEFAULT_EMAILS = 100
export const RECONCILE_MAX_EMAILS = 200
export const RECONCILE_MAX_PAGES = 20
export const RECONCILE_BUDGET_MS = 100_000
const RECONCILE_PACE_MS = 250

export type ResendConfig = {
  /** DPDP_RESEND_WEBHOOK_SECRET: the Svix signing secret, "whsec_" + base64. Unset or malformed => every webhook is refused with 503. */
  webhookSecret: string
  /** RESEND_API_KEY, used to fetch the received message. */
  apiKey: string
}

export type RouteDeps = {
  inbound: InboundDeps
  resend: ResendConfig
  /** Test seam; the real global fetch when absent. */
  fetch?: typeof fetch
  timeoutMs?: number
  /** Pause between two Resend reads in a reconcile run. */
  paceMs?: number
  /** Reconcile wall-clock budget, milliseconds. */
  budgetMs?: number
  /** email ids already recorded in THIS isolate (a cache in front of the database's own dedup, never a replacement). */
  seen?: Map<string, number>
}

const PROCESSED = new Map<string, number>()
const SEEN_MAX = 500

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === "string" ? v : "")
const EMAIL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim()
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } })
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The request body as bytes; "too-large" as soon as it passes `max` (the rest is never read); "unreadable" when the stream fails. */
async function readBounded(req: Request, max: number): Promise<Uint8Array | "too-large" | "unreadable"> {
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > max) {
        await reader.cancel().catch(() => undefined)
        return "too-large"
      }
      chunks.push(value)
    }
  } catch {
    return "unreadable"
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

function b64decode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 !== 0) return null
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Equal length and equal bytes, looking at every byte either way: neither the length nor the first differing byte shows in the timing. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

// ---------------------------------------------------------------------------
// Svix signature verification (https://docs.svix.com/receiving/verifying-payloads/how-manual).
// ---------------------------------------------------------------------------

/** "whsec_" + base64 of at least 16 bytes => the HMAC key; anything else null (the function then answers 503, it does not guess). */
export function parseWebhookSecret(secret: string | undefined | null): Uint8Array | null {
  const s = (secret ?? "").trim()
  if (!s.startsWith("whsec_")) return null
  const key = b64decode(s.slice("whsec_".length))
  return key && key.length >= 16 ? key : null
}

export type SvixCheck =
  | { ok: true }
  | { ok: false; reason: "missing-headers" | "bad-timestamp" | "stale-timestamp" | "future-timestamp" | "no-v1-signature" | "mismatch" }

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // new Uint8Array(x) copies into a plain ArrayBuffer, which is what BufferSource asks for (a view over a SharedArrayBuffer is not one)
  const k = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new Uint8Array(data)))
}

/**
 * The signed content is `${svix-id}.${svix-timestamp}.${raw body}` (the RAW bytes: nothing parsed first), the key is the
 * base64-decoded part of the secret after "whsec_", the signature is HMAC-SHA256 in base64, and the header is a
 * space-delimited list of "v1,<signature>" (several while a secret is being rotated). The timestamp must be within
 * `toleranceSec` of our clock in BOTH directions, which is what stops a captured delivery being replayed later.
 */
export async function verifySvix(input: {
  key: Uint8Array
  id: string | null
  timestamp: string | null
  signature: string | null
  body: Uint8Array
  nowMs: number
  toleranceSec?: number
}): Promise<SvixCheck> {
  const { id, timestamp, signature } = input
  if (!id || !timestamp || !signature || !/^[A-Za-z0-9_.:-]{1,256}$/.test(id)) return { ok: false, reason: "missing-headers" }
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad-timestamp" }
  const tolerance = input.toleranceSec ?? SVIX_TOLERANCE_SECONDS
  const skew = Math.floor(input.nowMs / 1000) - Number(timestamp)
  if (skew > tolerance) return { ok: false, reason: "stale-timestamp" }
  if (-skew > tolerance) return { ok: false, reason: "future-timestamp" }

  const candidates = signature.trim().split(/\s+/).filter((p) => p.startsWith("v1,")).slice(0, 10).map((p) => p.slice(3))
  if (candidates.length === 0) return { ok: false, reason: "no-v1-signature" }

  const head = new TextEncoder().encode(`${id}.${timestamp}.`)
  const signed = new Uint8Array(head.length + input.body.length)
  signed.set(head, 0)
  signed.set(input.body, head.length)
  const expected = await hmacSha256(input.key, signed)

  let matched = false
  for (const c of candidates) {
    const got = b64decode(c) ?? new Uint8Array(0)
    if (timingSafeEqual(expected, got)) matched = true // no early exit: every candidate costs the same
  }
  return matched ? { ok: true } : { ok: false, reason: "mismatch" }
}

// ---------------------------------------------------------------------------
// Which of the recipients decides how the message is filed.
// ---------------------------------------------------------------------------

// BOUNDED on purpose (review of 2026-09-30): `[..]+@` over a run of address characters with no "@" is quadratic, and a To / Cc header of
// 200 000 of them kept the CPU busy for 95 seconds -- a message the platform kills and never records. RFC 5321 caps a local part at 64
// octets and a domain at 255, so nothing legitimate is cut; each start position costs ~64 steps, linear overall.
const ADDRESS_RE = /[A-Za-z0-9._%+'\-]{1,64}@[A-Za-z0-9.\-]{1,255}/g
const ADDRESS_SCAN_MAX_CHARS = 100_000
const ADDRESS_MAX = 500

/** Every address in a string or a list of strings ("Name <a@b>", "a@b, c@d"), lower-cased, unique, in order (at most ADDRESS_MAX, from the first ADDRESS_SCAN_MAX_CHARS characters). */
export function extractAddresses(value: unknown): string[] {
  const text = (Array.isArray(value) ? value.slice(0, 1000).filter((v) => typeof v === "string").join(",") : typeof value === "string" ? value : "").slice(0, ADDRESS_SCAN_MAX_CHARS)
  const out: string[] = []
  for (const m of text.match(ADDRESS_RE) ?? []) {
    const a = m.toLowerCase().replace(/\.+$/, "")
    if (out.length < ADDRESS_MAX && a.includes("@") && !out.includes(a)) out.push(a)
  }
  return out
}

/** The two legacy published addresses, treated as the tags the Worker rewrote them to (workers/dpdp-inbound-mail/src/recipient.ts). */
const ALIASES: Readonly<Record<string, string>> = {
  grievance: `${MAILBOX_LOCAL}+${CLASS_TAG.grievance}@${MAILBOX_DOMAIN}`,
  partners: `${MAILBOX_LOCAL}+${CLASS_TAG.partner}@${MAILBOX_DOMAIN}`,
}
/** RFC 2142 role mailboxes: support, operator told, never acknowledged. */
const ROLE_LOCALS: readonly string[] = ["postmaster", "abuse"]

export type RecipientKind = "mailbox" | "alias" | "role" | "unknown" | "foreign" | "none"
export type RecipientChoice = {
  kind: RecipientKind
  /** What goes into envelope_to: aliases already rewritten to their tag. "" when there is no address at all. */
  address: string
  /** As it arrived. */
  raw: string
  policy: InboundPolicy | null
}

function rankAddress(a: string): { rank: number; kind: RecipientKind; address: string; local: string } {
  const at = a.lastIndexOf("@")
  const local = a.slice(0, at)
  if (a.slice(at + 1) !== MAILBOX_DOMAIN) return { rank: 5, kind: "foreign", address: a, local }
  const p = parseRecipient(a)
  if (p.ours) return { rank: p.cls && p.cls !== "auto" ? 0 : 1, kind: "mailbox", address: a, local }
  if (Object.hasOwn(ALIASES, local)) return { rank: 2, kind: "alias", address: ALIASES[local], local }
  if (ROLE_LOCALS.includes(local)) return { rank: 3, kind: "role", address: a, local }
  return { rank: 4, kind: "unknown", address: a, local }
}

/**
 * Prefers dpdp@ / dpdp+tag (one that names a class first), then the two aliases, then postmaster@ / abuse@, then any other
 * address at our domain, then an address at another domain. Ties keep the order given (received_for first: it is the
 * address the message was actually received for).
 */
export function chooseRecipient(candidates: string[]): RecipientChoice {
  if (candidates.length === 0) return { kind: "none", address: "", raw: "", policy: null }
  let best = rankAddress(candidates[0])
  let bestRaw = candidates[0]
  for (const c of candidates.slice(1)) {
    const r = rankAddress(c)
    if (r.rank < best.rank) { best = r; bestRaw = c }
  }
  let policy: InboundPolicy | null = null
  if (best.kind === "role") policy = { forceClass: "support", unlessLegal: true, reason: `role-mailbox:${best.local}`, noAck: true }
  else if (best.kind === "unknown") policy = { forceClass: "auto", unlessLegal: true, reason: "unknown-recipient" }
  else if (best.kind === "foreign") policy = { forceClass: "auto", reason: "recipient-not-on-our-domain" }
  return { kind: best.kind, address: best.address, raw: bestRaw, policy }
}

// ---------------------------------------------------------------------------
// Mapping a received email to the Worker's payload.
// ---------------------------------------------------------------------------

/** Longest prefix of `text` that fits `maxBytes` of UTF-8 without cutting a character in half. */
export function utf8Prefix(text: string, maxBytes: number): { text: string; cut: boolean } {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return { text, cut: false }
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end-- // bytes[end] is the first byte left out: if it continues a character, that character goes too
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), cut: true }
}

/** Lower-cased header name -> first value, one line, for an object or a list of {name, value} / [name, value]. */
export function headerMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  const put = (name: unknown, v: unknown) => {
    if (typeof name !== "string" || !name.trim()) return
    const key = name.trim().toLowerCase()
    if (key === "__proto__" || key in out) return
    const raw = Array.isArray(v) ? v.find((x) => typeof x === "string" || typeof x === "number") : v
    out[key] = oneLine(typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "").slice(0, 2000)
  }
  if (Array.isArray(value)) {
    for (const e of value) {
      if (Array.isArray(e)) put(e[0], e[1])
      else if (isObj(e)) put(e.name ?? e.key, e.value)
    }
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) put(k, v)
  }
  return out
}

/** The headers the classifier and the handler read (the Worker's allowlist), minus Authentication-Results, which is synthesised. */
const FORWARDED_HEADERS = [
  "return-path", "auto-submitted", "x-autoreply", "x-autorespond", "x-auto-reply", "x-auto-response-suppress", "precedence",
  "x-veridian-origin", "x-veridian-class", "x-veridian-ref", "list-id", "list-unsubscribe", "cc", "sender",
] as const

type Verdict = "pass" | "fail" | "gray" | "processing_failed" | "unknown"
const VERDICTS: readonly string[] = ["pass", "fail", "gray", "processing_failed", "unknown"]

export type AuthVerdicts = { spf: Verdict; dkim: Verdict; dmarc: Verdict }

export function readAuthentication(value: unknown): AuthVerdicts | null {
  if (!isObj(value)) return null
  const one = (v: unknown): Verdict => (typeof v === "string" && VERDICTS.includes(v.toLowerCase()) ? (v.toLowerCase() as Verdict) : "unknown")
  return { spf: one(value.spf), dkim: one(value.dkim), dmarc: one(value.dmarc) }
}

/**
 * The value written to headers["authentication-results"], which is what ackBlocker (handler.ts) matches with /\bdmarc=fail\b/.
 * `dmarc=fail` is written when Resend says DMARC failed, and also when SPF and DKIM BOTH failed (nothing can then align).
 * Built only from Resend's verdicts, all of which are one of five fixed words: no sender-controlled text reaches it.
 */
export function authenticationResults(a: AuthVerdicts): string {
  const bothBroken = a.dmarc !== "fail" && a.spf === "fail" && a.dkim === "fail"
  return `resend; spf=${a.spf}; dkim=${a.dkim}; dmarc=${bothBroken ? "fail (spf and dkim both failed)" : a.dmarc}`
}

/** Resend's created_at is ISO, or Postgres-style ("2026-09-29 15:30:00.123+00"). null when it is neither. */
export function parseWhen(value: unknown): Date | null {
  const s = str(value).trim()
  if (!s) return null
  let t = Date.parse(s)
  if (!Number.isFinite(t)) t = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"))
  return Number.isFinite(t) ? new Date(t) : null
}

function displayName(from: string): string | null {
  const lt = from.indexOf("<")
  if (lt <= 0) return null
  const name = oneLine(from.slice(0, lt)).replace(/^["']+|["']+$/g, "").trim().slice(0, 200)
  return name || null
}

/** A string or a list of strings, at most 200 entries of 4000 characters: a To / Cc list is only ever read for addresses. */
function strings(v: unknown): string[] {
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []
  return list.slice(0, 200).map((x) => x.slice(0, 4000))
}

export type MappedEmail = { emailId: string; payload: Record<string, unknown>; policy: InboundPolicy; recipient: RecipientChoice }

/**
 * `data` is what the webhook (or a list row) said, `email` what GET /emails/receiving/{id} returned (null when it was too
 * large to read: then only the metadata is available and the text is empty). The fetched message wins wherever both have a
 * field, and the Message-ID comes from the fetched message ONLY, so the webhook and the reconcile job derive the same
 * dedup key for the same email.
 */
export function mapReceivedEmail(input: { emailId: string; data: Record<string, unknown>; email: Record<string, unknown> | null; now: Date }): MappedEmail {
  const { emailId, data, email } = input
  const pick = (k: string): unknown => (email && email[k] != null ? email[k] : data[k])
  const h = headerMap(email ? email.headers : undefined)
  const header = (name: string): string | undefined => (name in h ? h[name] : undefined)

  const from = oneLine(str(pick("from"))).slice(0, 2000)
  const fromAddress = bareAddress(from) || extractAddresses(from)[0] || ""
  const returnPath = header("return-path")
  const emptyReturnPath = returnPath !== undefined && returnPath.replace(/\s+/g, "") === "<>"
  const envelopeFrom = emptyReturnPath ? "" : bareAddress(returnPath ?? "") || fromAddress

  const toList = strings(pick("to"))
  const ccList = strings(pick("cc"))
  const candidates = [...new Set([...extractAddresses(pick("received_for")), ...extractAddresses(toList), ...extractAddresses(ccList), ...extractAddresses(pick("bcc"))])]
  const recipient = chooseRecipient(candidates)

  const subject = oneLine(str(pick("subject"))).slice(0, 998)
  const messageId = (email ? oneLine(str(email.message_id)) || oneLine(header("message-id") ?? "") : "") || `<resend-${emailId}@resend-inbound.invalid>`

  // A text part that is only whitespace is no text: the words are in the HTML part (the same rule as the Worker's extractExcerpt).
  const html = email ? str(email.html) : ""
  const plain = email ? str(email.text) : ""
  const bodyText = plain.trim() ? plain : html ? htmlToText(html) : plain
  const { text, cut } = utf8Prefix(bodyText, TEXT_BYTES)

  const attachments = (Array.isArray(pick("attachments")) ? (pick("attachments") as unknown[]) : []).filter(isObj)
  const auth = readAuthentication(email ? email.authentication : undefined)

  const created = parseWhen(email?.created_at) ?? parseWhen(data.created_at)
  const receivedAt = created && created.getTime() <= input.now.getTime() + 5 * 60_000 ? created : input.now

  const headers: Record<string, string> = {}
  for (const name of FORWARDED_HEADERS) if (name in h) headers[name] = h[name]
  if (auth) headers["authentication-results"] = authenticationResults(auth)
  const presence = (name: string): string | null => (name in h ? h[name] : null)

  const payload: Record<string, unknown> = {
    version: 1,
    received_at: receivedAt.toISOString(),
    envelope_from: envelopeFrom,
    envelope_to: recipient.address,
    envelope_to_raw: recipient.raw,
    header_from: from,
    from_address: fromAddress || null,
    from_name: displayName(from),
    header_to: toList.join(", ").slice(0, 20_000),
    cc: ccList.slice(0, 100).map((x) => x.slice(0, 1000)),
    reply_to: header("reply-to") ?? null,
    subject,
    message_id: messageId,
    in_reply_to: header("in-reply-to") ?? null,
    references: header("references") ?? null,
    auto_submitted: presence("auto-submitted"),
    precedence: presence("precedence"),
    x_autoreply: presence("x-autoreply"),
    x_auto_response_suppress: presence("x-auto-response-suppress"),
    content_type: header("content-type") ?? null,
    headers,
    text,
    has_attachments: attachments.length > 0,
    // `truncated` means what it means for the Worker (workers/dpdp-inbound-mail: the raw message was larger than its 128 KiB read cap, so
    // the request may be exactly what was not read): the classifier then files a message with too little readable text as `review`. It does
    // NOT mean "the 4096-byte excerpt was cut" -- the Worker cuts its excerpt at 4 KB too and never says so. Mapping `cut` to it made every
    // short reply ("Thanks!") or vacation notice on top of a quoted digest longer than 4 KB a legal-clock `review` ticket with an
    // acknowledgement (found in the review of 2026-09-30). The operator's notice still says the excerpt was cut (`cut`, below).
    truncated: !email || bodyText.length > WORKER_READ_CAP_CHARS,
  }

  // `envelope_from: ""` is the Worker's way of saying "the SMTP sender was empty" (a bounce or an auto-responder): the classifier reads it
  // as a machine signal. Here an empty value would just as well mean "no address could be read out of the From header", and a human's
  // message with a From nobody can parse would then be filed `auto` (logged, nobody told). So it is sent only for an explicit `Return-Path: <>`
  // and left out otherwise (found in the review of 2026-09-30).
  if (!emptyReturnPath && envelopeFrom === "") delete payload.envelope_from

  // The operator's notice: where the raw message lives, what Resend verified, what is NOT in the ticket.
  const notice: string[] = [
    `Received by Resend inbound. Resend received-email id: ${emailId}`,
    "  (the raw message and its attachments can be fetched from Resend with this id: GET /emails/receiving/<id>, or the Receiving tab of the Resend dashboard)",
    auth
      ? `Authentication as reported by Resend: SPF ${auth.spf}, DKIM ${auth.dkim}, DMARC ${auth.dmarc}${headers["authentication-results"]?.includes("dmarc=fail") ? "  -> NOT acknowledged (possible forged sender)" : ""}`
      : "Authentication: Resend reported no SPF / DKIM / DMARC verdicts for this message.",
  ]
  if (attachments.length > 0) {
    const names = attachments.slice(0, 10).map((a) => `${oneLine(str(a.filename)).slice(0, 100) || "(unnamed)"} (${oneLine(str(a.content_type)).slice(0, 60) || "unknown type"})`)
    notice.push(`Attachments (${attachments.length}): ${names.join(", ")}${attachments.length > 10 ? ", ..." : ""}. Resend keeps them; this system does not download them.`)
  }
  if (cut) notice.push(`Only the first ${TEXT_BYTES} bytes of the text are recorded and quoted below; the whole message is in Resend (id above).`)
  if (!email) notice.push("The message body was too large to read here: the ticket was made from Resend's metadata only. Read the message in Resend (id above).")

  // Mail to a GUESSED address that carries a List-Unsubscribe or List-Id header (RFC 2369 / 2919: only mailing-list and marketing mail has
  // them) is bulk, not a request, even when its footer says "unsubscribe" (which the classifier reads as a withdrawal of consent). Filing
  // every such mailing as a data request would mean a ticket, an operator email and an acknowledgement to the sender for each piece of
  // spam this accept-all domain receives. It is still recorded (auto, reason says why); only the keep-the-legal-class exception is off.
  let recipientPolicy = recipient.policy
  if (recipientPolicy?.unlessLegal && recipient.kind === "unknown" && ("list-unsubscribe" in h || "list-id" in h)) {
    recipientPolicy = { ...recipientPolicy, unlessLegal: false, reason: `${recipientPolicy.reason ?? "unknown-recipient"} (bulk: List-Unsubscribe / List-Id header)` }
  }
  const policy: InboundPolicy = { ...(recipientPolicy ?? {}), noticeLines: notice, trustReceivedAt: true }
  return { emailId, payload, policy, recipient }
}

// ---------------------------------------------------------------------------
// Talking to Resend.
// ---------------------------------------------------------------------------

type Fetched = { ok: true; json: unknown; oversize: boolean } | { ok: false; status: number; error: string }

async function resendGet(deps: RouteDeps, path: string): Promise<Fetched> {
  const f = deps.fetch ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS)
  try {
    const res = await f(`${RESEND_API}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${deps.resend.apiKey}`, Accept: "application/json" },
      redirect: "error", // the key must never follow a redirect to another host
      signal: ctl.signal,
    })
    if (!res.ok) return { ok: false, status: res.status, error: `Resend GET ${path.split("?")[0].replace(/\/[A-Za-z0-9_-]{8,}$/, "/<id>")} answered ${res.status}` }
    const text = await res.text()
    if (text.length > MAX_FETCHED_CHARS) return { ok: true, json: null, oversize: true }
    try {
      return { ok: true, json: JSON.parse(text), oversize: false }
    } catch {
      return { ok: false, status: 502, error: "Resend answered something that is not JSON" }
    }
  } catch (e) {
    return { ok: false, status: 502, error: `Resend GET failed: ${message(e).slice(0, 160)}` }
  } finally {
    clearTimeout(timer)
  }
}

type Ingested = { status: number; body: Record<string, unknown>; recorded: boolean; duplicate: boolean }

/**
 * A webhook that could not be turned into a ticket -- Resend refused or failed the fetch (a key that may only send, an outage, a
 * message that has gone), the mapping threw, the pipeline recorded nothing -- is answered 502 so Svix retries. Svix gives up after
 * about a day, and until then nobody but the Svix dashboard knows. So the operator is told, once per email (Idempotency-Key), with what
 * the webhook itself carried (sender, recipients, subject: metadata, never the body) and how to recover. This is what "nothing is
 * silently dropped" needs when the failure is BEFORE the ticket exists: no ticket, no acknowledgement, and without this, no notice.
 * Best effort by nature (it uses the same mail provider), never throws, and stays quiet in a dry run or with no DPDP_OPERATOR_EMAIL.
 */
async function alertUnprocessed(deps: RouteDeps, emailId: string, data: Record<string, unknown>, why: string): Promise<boolean> {
  const cfg = deps.inbound.config
  const to = cfg.operatorEmail.trim()
  const log = deps.inbound.log ?? ((line: string) => console.log(line))
  if (cfg.dryRun || !to) return false
  try {
    const subject = oneLine(str(data.subject)).slice(0, 200) || "(no subject)"
    const lines = [
      `A message reached ${MAILBOX} but could NOT be processed yet: ${oneLine(why).slice(0, 300)}`,
      "This attempt recorded no ticket and sent no acknowledgement. Resend keeps the message and Svix keeps retrying the webhook for about a day.",
      "",
      `Resend received-email id: ${emailId}`,
      `From:    ${oneLine(str(data.from)).slice(0, 300) || "(unknown)"}`,
      `To:      ${extractAddresses(data.received_for ?? data.to).slice(0, 5).join(", ") || "(unknown)"}`,
      `Subject: ${subject}`,
      `Message-ID: ${oneLine(str(data.message_id)).slice(0, 300) || "(none)"}`,
      `Received: ${oneLine(str(data.created_at)).slice(0, 60) || "(unknown)"}`,
      "",
      "If the cause is fixed within a day the retry makes the ticket by itself. After that, or to be sure, run the reconcile job",
      '(POST {"job":"reconcile","hours":48} with the DPDP_INBOUND_SECRET bearer; see the function README), or read the message in the Resend',
      "dashboard (Receiving). A legal request (data request, grievance) starts its clock when it ARRIVED, not when it is found.",
    ]
    await deps.inbound.send({
      from: cfg.from,
      to,
      subject: `[UNPROCESSED ${emailId}] ${subject}`,
      text: lines.join("\n"),
      headers: { "X-Veridian-Class": "review", "X-Veridian-Origin": "inbound-alert", "Auto-Submitted": "auto-generated" },
      idempotencyKey: `dpdp-inbound-unprocessed-${emailId}`,
    })
    return true
  } catch (e) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", emailId, warn: "operator alert failed", detail: message(e).slice(0, 160) }))
    return false
  }
}

function remember(seen: Map<string, number>, emailId: string): void {
  seen.set(emailId, Date.now())
  while (seen.size > SEEN_MAX) {
    const oldest = seen.keys().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
}

/** Fetch one received email, map it, run it through the SAME pipeline as the Worker's mail. */
async function ingest(deps: RouteDeps, emailId: string, data: Record<string, unknown>, source: "webhook" | "reconcile"): Promise<Ingested> {
  const log = deps.inbound.log ?? ((line: string) => console.log(line))
  const fetched = await resendGet(deps, `/emails/receiving/${encodeURIComponent(emailId)}`)
  if (!fetched.ok) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", source, emailId, error: fetched.error }))
    const keyHint = fetched.status === 401 || fetched.status === 403 ? " -- RESEND_API_KEY may be a sending-only key: reading a received email needs full access" : ""
    if (source === "webhook") await alertUnprocessed(deps, emailId, data, `${fetched.error}${keyHint}`)
    return { status: 502, body: { ok: false, error: "could not fetch the message from Resend; it will be retried" }, recorded: false, duplicate: false }
  }
  const email = fetched.oversize ? null : isObj(fetched.json) ? fetched.json : null
  if (!fetched.oversize && !email) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", source, emailId, error: "Resend returned no message" }))
    if (source === "webhook") await alertUnprocessed(deps, emailId, data, "Resend answered with something that is not a message")
    return { status: 502, body: { ok: false, error: "Resend returned no message; it will be retried" }, recorded: false, duplicate: false }
  }
  const now = deps.inbound.now ? deps.inbound.now() : new Date()
  const mapped = mapReceivedEmail({ emailId, data, email, now })

  const internal = new Request("https://internal.invalid/dpdp-inbound-mail", {
    method: "POST",
    headers: { authorization: `Bearer ${deps.inbound.config.secret}`, "content-type": "application/json" },
    body: JSON.stringify(mapped.payload),
  })
  const res = await handleInbound(internal, deps.inbound, mapped.policy)
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const dup = body.duplicate === true

  // The handler answers 200 with `ack: "failed"` when the ticket exists and the operator was told but the acknowledgement could not
  // be sent. On the Worker path nobody retries that; here Svix can, and a legal request must not miss its acknowledgement: the
  // retry finds the ticket (duplicate), does not tell the operator again, and sends the acknowledgement that is still due.
  if (res.status === 200 && body.ok === true && body.degraded !== true && body.ack !== "failed") {
    return { status: 200, body: { ...body, source: "resend", emailId, recipient: mapped.recipient.kind }, recorded: true, duplicate: dup }
  }
  // Anything else means "no ticket, or nobody told, or no acknowledgement": Svix must retry. Never a 2xx, never a 401 (that would read as a bad signature).
  const status = res.status === 503 || res.status === 413 || res.status === 400 ? res.status : 502
  const why =
    body.degraded === true
      ? "the database could not record the message (the operator was sent the raw message); it will be retried"
      : body.ack === "failed" && res.status === 200
        ? "the message is recorded and the operator was told, but the acknowledgement could not be sent; it will be retried"
        : String(body.error ?? "not recorded").slice(0, 200)
  log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", source, emailId, status, error: why }))
  const recorded = typeof body.ticket === "string" && body.ticket !== ""
  // No ticket and no raw copy sent (the degraded path already emailed the operator the raw message): nobody knows yet, so say so.
  if (source === "webhook" && !recorded && body.degraded !== true) await alertUnprocessed(deps, emailId, data, why)
  return { status, body: { ...body, ok: false, error: why, emailId }, recorded, duplicate: dup }
}

// ---------------------------------------------------------------------------
// The webhook.
// ---------------------------------------------------------------------------

export async function handleResendWebhook(req: Request, deps: RouteDeps): Promise<Response> {
  const log = deps.inbound.log ?? ((line: string) => console.log(line))
  const seen = deps.seen ?? PROCESSED
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405)

  const key = parseWebhookSecret(deps.resend.webhookSecret)
  if (!key) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", error: "DPDP_RESEND_WEBHOOK_SECRET is not set or is not a whsec_ secret" }))
    return json({ ok: false, error: "not configured" }, 503)
  }

  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return json({ ok: false, error: "payload too large" }, 413)
  // Read at most MAX_WEBHOOK_BYTES + 1: this runs BEFORE the signature is checked, so a body with no (or a false) Content-Length
  // must not be buffered whole for a stranger (review of 2026-09-30).
  const read = await readBounded(req, MAX_WEBHOOK_BYTES)
  if (read === "too-large") return json({ ok: false, error: "payload too large" }, 413)
  if (read === "unreadable") return json({ ok: false, error: "unreadable body" }, 400)
  const body = read

  const nowMs = (deps.inbound.now ? deps.inbound.now() : new Date()).getTime()
  const svixId = req.headers.get("svix-id")
  const check = await verifySvix({
    key, id: svixId, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"), body, nowMs,
  })
  if (!check.ok) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", rejected: check.reason }))
    return json({ ok: false, error: "unauthorized" }, 401)
  }

  // From here on the sender is Resend, so the body is parsed.
  let event: unknown
  try {
    event = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400)
  }
  if (!isObj(event)) return json({ ok: false, error: "invalid event" }, 400)
  if (event.type !== "email.received") return json({ ok: true, ignored: true, type: str(event.type).slice(0, 60) })

  const data = isObj(event.data) ? event.data : {}
  const emailId = str(data.email_id)
  if (!EMAIL_ID_RE.test(emailId)) return json({ ok: false, error: "the event carries no usable email_id" }, 400)
  if (!deps.resend.apiKey) {
    log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", error: "RESEND_API_KEY is not set: the message cannot be fetched" }))
    return json({ ok: false, error: "not configured" }, 503)
  }

  if (seen.has(emailId)) return json({ ok: true, duplicate: true, cached: true, emailId })

  const meta = { ...data, created_at: data.created_at ?? event.created_at }
  let out: Ingested
  try {
    out = await ingest(deps, emailId, meta, "webhook")
  } catch (e) {
    // Nothing in the pipeline is meant to throw; if something does, the answer is still 502 (Svix retries) and the operator still hears of it.
    log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", svix: svixId, emailId, error: "unexpected", detail: message(e).slice(0, 200) }))
    await alertUnprocessed(deps, emailId, meta, `an unexpected error while processing it (${message(e).slice(0, 120)})`)
    return json({ ok: false, error: "could not process the message; it will be retried", emailId }, 502)
  }
  if (out.status === 200) remember(seen, emailId)
  log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", svix: svixId, emailId, status: out.status, duplicate: out.duplicate }))
  return json(out.body, out.status)
}

// ---------------------------------------------------------------------------
// The reconcile job (operator / cron tool; Svix retries are the primary path).
// ---------------------------------------------------------------------------

export type ReconcileResult = {
  ok: boolean
  job: "reconcile"
  hours: number
  /** Messages inside the window that Resend listed. */
  listed: number
  /** New tickets made by this run. */
  ingested: number
  /** Messages the database already had (nothing new was made; a missing acknowledgement or notice may have been sent). */
  duplicates: number
  failed: number
  /** The run stopped at its message cap or its time budget: run it again. */
  partial: boolean
  rateLimited: boolean
  failures: Array<{ emailId: string; status: number; error: string }>
}

export async function reconcile(deps: RouteDeps, opts: { hours: number; limit: number }): Promise<ReconcileResult> {
  const seen = deps.seen ?? PROCESSED
  const nowMs = (deps.inbound.now ? deps.inbound.now() : new Date()).getTime()
  const cutoff = nowMs - opts.hours * 3600_000
  const started = Date.now()
  const budget = deps.budgetMs ?? RECONCILE_BUDGET_MS
  const r: ReconcileResult = { ok: true, job: "reconcile", hours: opts.hours, listed: 0, ingested: 0, duplicates: 0, failed: 0, partial: false, rateLimited: false, failures: [] }
  const fail = (emailId: string, status: number, error: string) => {
    r.failed++
    if (r.failures.length < 20) r.failures.push({ emailId, status, error: error.slice(0, 200) })
  }

  let after = ""
  let stop = false
  for (let page = 0; page < RECONCILE_MAX_PAGES && !stop; page++) {
    const listing = await resendGet(deps, `/emails/receiving?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`)
    if (!listing.ok || listing.oversize) {
      if (!listing.ok && listing.status === 429) r.rateLimited = true
      fail("(list)", listing.ok ? 502 : listing.status, listing.ok ? "the listing was too large" : listing.error)
      break
    }
    const v = listing.json
    const rows = (Array.isArray(v) ? v : isObj(v) && Array.isArray(v.data) ? v.data : []).filter(isObj)
    const hasMore = isObj(v) && v.has_more === true
    let inWindow = 0
    for (const row of rows) {
      const id = str(row.id)
      if (!EMAIL_ID_RE.test(id)) continue
      const when = parseWhen(row.created_at)
      if (when && when.getTime() < cutoff) continue // outside the window (the listing is newest first, but no order is assumed)
      inWindow++
      if (r.listed >= opts.limit || Date.now() - started > budget) { r.partial = true; stop = true; break }
      r.listed++
      if (seen.has(id)) { r.duplicates++; continue }
      const out = await ingest(deps, id, row, "reconcile")
      if (out.status === 200) {
        remember(seen, id)
        if (out.duplicate) r.duplicates++
        else r.ingested++
      } else {
        fail(id, out.status, String(out.body.error ?? "failed"))
      }
      const pace = deps.paceMs ?? RECONCILE_PACE_MS
      if (pace > 0) await new Promise((res) => setTimeout(res, pace))
    }
    if (stop || !hasMore || rows.length === 0 || inWindow === 0) break
    after = str(rows[rows.length - 1].id)
    if (!EMAIL_ID_RE.test(after)) break
  }
  r.ok = r.failed === 0
  return r
}

// ---------------------------------------------------------------------------
// Routing: one Edge Function, three callers.
// ---------------------------------------------------------------------------

/**
 * A tiny JSON body with a string `job` is an operator job; a Worker mail is never that small or that shape. This runs BEFORE any
 * authentication, so it reads at most 2048 bytes of a clone (a body with no, or a false, Content-Length is not buffered whole for a
 * stranger; review of 2026-09-30) and gives up the moment the body is longer. The original request is untouched for the mail route.
 */
async function peekJob(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") ?? "NaN")
  if (Number.isFinite(declared) && declared > 2048) return null
  let bytes: Uint8Array | "too-large" | "unreadable"
  try {
    bytes = await readBounded(req.clone(), 2048)
  } catch {
    return null
  }
  if (typeof bytes === "string") return null
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes))
    return isObj(v) && typeof v.job === "string" ? v : null
  } catch {
    return null
  }
}

async function handleJob(req: Request, job: Record<string, unknown>, deps: RouteDeps): Promise<Response> {
  const secret = deps.inbound.config.secret
  if (secret.length < 24) return json({ ok: false, error: "not configured" }, 503)
  const bearer = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim())?.[1]?.trim() ?? ""
  if (!bearer || !(await secretMatches(bearer, secret))) return json({ ok: false, error: "unauthorized" }, 401)
  if (job.job !== "reconcile") return json({ ok: false, error: "unknown job" }, 400)

  const hours = job.hours === undefined ? RECONCILE_DEFAULT_HOURS : job.hours
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > RECONCILE_MAX_HOURS) {
    return json({ ok: false, error: `hours must be a whole number from 1 to ${RECONCILE_MAX_HOURS}` }, 400)
  }
  const limit = job.limit === undefined ? RECONCILE_DEFAULT_EMAILS : job.limit
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > RECONCILE_MAX_EMAILS) {
    return json({ ok: false, error: `limit must be a whole number from 1 to ${RECONCILE_MAX_EMAILS}` }, 400)
  }
  if (!deps.resend.apiKey) return json({ ok: false, error: "not configured" }, 503)

  const result = await reconcile(deps, { hours, limit })
  const log = deps.inbound.log ?? ((line: string) => console.log(line))
  log(JSON.stringify({ evt: "dpdp-inbound-mail", src: "resend", job: "reconcile", hours, listed: result.listed, ingested: result.ingested, duplicates: result.duplicates, failed: result.failed, partial: result.partial }))
  return json(result, result.ok ? 200 : 502)
}

/**
 * The Edge Function's one entry point.
 *   svix-* headers        -> the Resend webhook (signature, not bearer)
 *   {"job": ...} + bearer -> an operator job (reconcile)
 *   anything else         -> the Cloudflare Worker's bearer POST, unchanged (handler.ts)
 */
export async function routeInbound(req: Request, deps: RouteDeps): Promise<Response> {
  const h = req.headers
  if (h.has("svix-id") || h.has("svix-timestamp") || h.has("svix-signature")) return handleResendWebhook(req, deps)
  if (req.method === "POST") {
    const job = await peekJob(req)
    if (job) return handleJob(req, job, deps)
  }
  return handleInbound(req, deps.inbound)
}
