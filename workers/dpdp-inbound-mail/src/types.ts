// Types shared by the dpdp-inbound-mail Email Worker.
//
// The message type below is declared structurally instead of importing
// @cloudflare/workers-types: the Worker only touches six members of
// ForwardableEmailMessage, a structural type is enough for the real runtime
// object to be passed in, and tests can hand in a plain object without a type
// package or a cast. If Cloudflare renames one of these members the Worker
// fails at runtime, not at compile time -- the "wrangler dev" check in the
// README exists to catch exactly that.

/** The subset of Cloudflare's ForwardableEmailMessage this Worker uses. */
export interface InboundEmailMessage {
  /** SMTP envelope sender (MAIL FROM). Empty string for a bounce. */
  readonly from: string
  /** SMTP envelope recipient (RCPT TO): the address the mail was really sent to. */
  readonly to: string
  readonly headers: Headers
  /** The raw RFC 5322 message. A stream: it can be read once. */
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number
  /** Refuse the mail at the SMTP level with a permanent failure (the sender gets a bounce). */
  setReject(reason: string): void
  /** Hand the untouched original to a verified Email Routing destination address. */
  forward(rcptTo: string, headers?: Headers): Promise<unknown>
}

/**
 * Worker configuration. Everything is optional in the type because a missing
 * or malformed value must be handled at runtime by forwarding the mail, never
 * by refusing to start.
 */
export interface Env {
  /** https URL of the dpdp-inbound-mail Supabase Edge Function. */
  DPDP_INBOUND_URL?: string
  /** Shared bearer secret. A Worker SECRET (wrangler secret put), never a plain var. */
  DPDP_INBOUND_SECRET?: string
  /** A VERIFIED Email Routing destination address: where mail goes if anything fails. */
  FALLBACK_FORWARD_TO?: string
  /** Wall-clock limit for the Edge Function call, milliseconds. Default 8000. */
  POST_TIMEOUT_MS?: string | number
  /** Read at most this many bytes of the raw message. Default 1 MiB. */
  MAX_RAW_BYTES?: string | number
}

/**
 * The JSON body POSTed to the dpdp-inbound-mail Edge Function. This type IS the
 * wire contract between the Worker and the function: change a field here and
 * the function's parser must change with it (the field names are snake_case
 * because the function reads them straight into dpdp.mail_inbound columns).
 *
 * Header values are the raw (RFC 2047 still encoded) header text, clipped;
 * `subject` and `from_name` are decoded. Nothing here is trusted: every value
 * comes from the sender, including the headers the classifier keys on.
 */
export type InboundMailPayload = {
  /** Payload schema version. Bump it when a field changes meaning. */
  version: 1
  /** ISO-8601, Worker clock at the time the mail was handled. */
  received_at: string
  /** SMTP MAIL FROM. Empty string for a bounce (null reverse-path). */
  envelope_from: string
  /**
   * SMTP RCPT TO, lower-cased. This is what parseRecipient() reads the class
   * tag from. The legacy aliases grievance@ / partners@ are rewritten to
   * dpdp+grv@ / dpdp+prt@ here (see envelope_to_raw for what actually arrived).
   */
  envelope_to: string
  /** RCPT TO exactly as it arrived (lower-cased, angle brackets removed). */
  envelope_to_raw: string
  /** Header From, raw. */
  header_from: string
  /** Parsed address of the header From, lower-cased, or null if it did not parse. */
  from_address: string | null
  /** Decoded display name of the header From, or null. */
  from_name: string | null
  /** Header To, raw. */
  header_to: string
  /** Header Reply-To, raw, or null. */
  reply_to: string | null
  /** Decoded subject. Empty string if the mail has none. */
  subject: string
  message_id: string | null
  in_reply_to: string | null
  references: string | null
  // The four below are null when the header is absent and "" when it is
  // present but empty. Presence alone is a signal (X-Autoreply: with no value
  // still marks an auto-reply), so do not test them for truthiness.
  auto_submitted: string | null
  precedence: string | null
  x_autoreply: string | null
  x_auto_response_suppress: string | null
  /** Top-level Content-Type with parameters, e.g. multipart/report; report-type=delivery-status. */
  content_type: string | null
  /**
   * The headers the classifier keys on, in the shape it takes them: lower-cased
   * name -> first raw value, clipped. Only names on the allowlist in
   * payload.ts, and only headers the mail actually carries. PRESENCE is the
   * signal for several of them (x-autoreply, x-auto-response-suppress,
   * x-veridian-origin), so a header that is present but empty appears as "".
   * Return-Path is here too (an empty return path is "<>"). Values are
   * sender-controlled and spoofable, like every other header.
   */
  headers: Record<string, string>
  /** First 4096 bytes (UTF-8 safe) of the text body: text/plain, else tag-stripped html. */
  text: string
  has_attachments: boolean
  /** Size of the whole message in bytes as reported by the runtime. */
  raw_size: number
  /** True when the message was larger than the read cap, so `text` may be incomplete. */
  truncated: boolean
}
