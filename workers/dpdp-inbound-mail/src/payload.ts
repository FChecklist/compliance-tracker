// Builds the JSON body for the dpdp-inbound-mail Edge Function from a parsed
// message (see InboundMailPayload in ./types.ts for the field-by-field
// contract).
//
// Everything the classifier keys on is copied as-is from the sender's own
// headers, only clipped to a sane length. Nothing is interpreted here: the
// decision "is this an out-of-office / a grievance / a reply to our invoice"
// belongs to the pure classifier in the Edge Function, where it can be tested
// in one place and changed without redeploying this Worker.

import type { Address, Email } from "postal-mime"

import { extractExcerpt } from "./text.ts"
import type { InboundMailPayload } from "./types.ts"

// A header value is untrusted input that ends up in a database column and an
// email to the operator. These ceilings are far above anything legitimate
// (References can legitimately run to a few KB on a long thread) and low
// enough that a hostile sender cannot inflate the payload.
const MAX_HEADER = 2000
const MAX_REFERENCES = 8000
const MAX_CONTENT_TYPE = 512
const MAX_SUBJECT = 1000

// Headers copied into payload.headers. This is what the classifier needs and
// no more: an arbitrary header dump would let a sender bloat the payload and
// would put headers like Received (which carry other people's addresses and
// IPs) into the database. Add a name here only when the classifier starts
// reading it.
export const FORWARDED_HEADERS = [
  "return-path",
  "auto-submitted",
  "x-autoreply",
  "x-autorespond",
  "x-auto-reply",
  "x-auto-response-suppress",
  "precedence",
  "x-veridian-origin",
  "x-veridian-class",
  "x-veridian-ref",
  "list-id",
  "list-unsubscribe",
  "cc",
  "sender",
  // The Edge Function's acknowledgement guard reads this one (ackBlocker in supabase/functions/dpdp-inbound-mail/handler.ts:
  // "dmarc=fail" => no acknowledgement, because it would go to a forged address). Until it was listed here the guard could
  // never fire: the function looked for a header the Worker never sent. Only the first (topmost, i.e. added by the receiving
  // server) instance is copied; a sender can add its own lower down, and the worst a forged "dmarc=fail" can do is suppress
  // the acknowledgement to that sender's own address.
  "authentication-results",
] as const

function clip(value: string | undefined | null, max: number): string | null {
  if (value == null) return null
  const v = value.trim()
  return v === "" ? null : v.length > max ? v.slice(0, max) : v
}

/** First header called `name` (postal-mime lower-cases header keys), raw and unfolded. */
function header(email: Email, name: string): string | undefined {
  for (const h of email.headers) if (h.key === name) return h.value
  return undefined
}

/** null when the header is absent, "" when it is present but empty: for several signals the presence is the point. */
function presence(email: Email, name: string): string | null {
  const value = header(email, name)
  return value === undefined ? null : (clip(value, MAX_HEADER) ?? "")
}

/** The allowlisted headers the mail carries, lower-cased name -> raw value (present-but-empty is ""). */
function headerMap(email: Email): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of FORWARDED_HEADERS) {
    const value = header(email, name)
    if (value !== undefined) out[name] = clip(value, MAX_HEADER) ?? ""
  }
  return out
}

/** The first plain mailbox in an address or group. */
function firstMailbox(a: Address | undefined): { address: string; name: string } | null {
  if (!a) return null
  if (a.group) return firstMailbox(a.group[0])
  return a.address ? { address: a.address, name: a.name } : null
}

/**
 * A message that parsed into nothing usable: no sender, no subject, no
 * Message-ID. postal-mime is deliberately lenient and will "successfully"
 * parse random bytes into a handful of junk headers, so a parse that did not
 * throw is not evidence the mail was understood. Real mail always has a From.
 * The Worker treats this as a parse failure and forwards the raw original.
 */
export function looksUnparseable(email: Email): boolean {
  return !firstMailbox(email.from) && !email.subject && !email.messageId
}

export type PayloadInput = {
  email: Email
  /** Envelope MAIL FROM as reported by the runtime. */
  envelopeFrom: string
  /** Envelope RCPT TO after the recipient allowlist (legacy aliases already rewritten). */
  envelopeTo: string
  /** Envelope RCPT TO as it arrived. */
  envelopeToRaw: string
  rawSize: number
  truncated: boolean
  receivedAt: Date
}

export function buildPayload(input: PayloadInput): InboundMailPayload {
  const { email } = input
  const from = firstMailbox(email.from)
  return {
    version: 1,
    received_at: input.receivedAt.toISOString(),
    envelope_from: (input.envelopeFrom ?? "").trim().toLowerCase(),
    envelope_to: input.envelopeTo,
    envelope_to_raw: input.envelopeToRaw,
    header_from: clip(header(email, "from"), MAX_HEADER) ?? "",
    from_address: from ? from.address.toLowerCase() : null,
    from_name: from ? clip(from.name, MAX_HEADER) : null,
    header_to: clip(header(email, "to"), MAX_HEADER) ?? "",
    reply_to: clip(header(email, "reply-to"), MAX_HEADER),
    subject: clip(email.subject, MAX_SUBJECT) ?? "",
    message_id: clip(email.messageId ?? header(email, "message-id"), MAX_HEADER),
    in_reply_to: clip(email.inReplyTo ?? header(email, "in-reply-to"), MAX_REFERENCES),
    references: clip(email.references ?? header(email, "references"), MAX_REFERENCES),
    auto_submitted: presence(email, "auto-submitted"),
    precedence: presence(email, "precedence"),
    x_autoreply: presence(email, "x-autoreply"),
    x_auto_response_suppress: presence(email, "x-auto-response-suppress"),
    content_type: clip(header(email, "content-type"), MAX_CONTENT_TYPE),
    headers: headerMap(email),
    text: extractExcerpt({ text: email.text, html: email.html }),
    has_attachments: email.attachments.length > 0,
    raw_size: input.rawSize,
    truncated: input.truncated,
  }
}
