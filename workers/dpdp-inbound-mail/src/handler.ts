// dpdp-inbound-mail -- the handler behind the Cloudflare Email Worker for
// dpdp@veridian-aios.com. (index.ts holds only the `export default` the
// runtime looks for; the logic lives here so it can be exported and tested
// without adding non-handler exports to the deployed Worker module.)
//
// WHERE THIS SITS
//   sender -> Cloudflare Email Routing (dpdp@ rule + catch-all) -> THIS WORKER
//          -> POST JSON -> Supabase Edge Function dpdp-inbound-mail
//          -> classify, ticket, notify the operator, acknowledge the sender.
// The Worker is deliberately thin: it does no classification. It parses the
// MIME, extracts the fields the classifier needs (see InboundMailPayload in
// ./types.ts) and hands them over. The classifier is a pure function in the
// Edge Function, testable in one place and changeable without redeploying
// this Worker.
//
// THE ONE RULE: NEVER LOSE A MAIL.
// The owner's core requirement is that nothing sent to dpdp@ is silently
// dropped -- some of it (grievances, data-subject requests) starts a legal
// response clock. So every way the normal path can fail ends the same way:
//
//   config missing / insecure URL, read error, parse error, an unusable parse,
//   network error, timeout, any non-2xx from the Edge Function
//        => message.forward(FALLBACK_FORWARD_TO)   (the untouched original,
//           plus X-Veridian-Fallback-Reason so the operator can see why the
//           ticketing was bypassed)
//
// Two deliberate consequences, both chosen over the alternative of losing mail:
//   * DUPLICATES ARE POSSIBLE. If the Edge Function did the work but its reply
//     was lost (timeout, dropped connection), the Worker cannot know, forwards
//     the mail, and the operator sees it twice. message_id is in the payload
//     so the function can de-duplicate the ticket side.
//   * If the forward itself fails (FALLBACK_FORWARD_TO unset, or not a
//     verified Email Routing destination address) the handler THROWS. The
//     runtime then does not accept the message, so the sender's server is told
//     it failed rather than being told it succeeded. That is the last resort;
//     it is the reason the README makes verifying the fallback address a
//     deploy step, and why the setup check sends a mail with a wrong secret.
//
// MAIL LARGER THAN THE READ CAP (MAX_RAW_BYTES, default 1 MiB) is not read to
// the end: the head is parsed and ticketed with truncated=true, AND the full
// original is forwarded to the operator, because the ticket only holds an
// excerpt. That is an intentional double delivery for a rare case.
//
// SECURITY
//   * Recipient allowlist (./recipient.ts): dpdp@, dpdp+*@ and the two legacy
//     aliases only. Everything else is refused at the SMTP level, which keeps
//     catch-all spam out of the ticket queue.
//   * The bearer secret is only ever sent to an https URL (http is tolerated
//     for localhost so "wrangler dev" works) and the response body is never
//     read. Redirects are not followed, so a 3xx cannot carry the
//     Authorization header to another host; it counts as a failure.
//   * Logs carry event names, reason codes and numbers only -- never a body,
//     subject, address or header value. Mail content is personal data.
//
// CPU BUDGET (honest limitation): parsing runs inside the Worker's CPU limit,
// which is 10 ms on the free Workers plan. Ordinary text enquiries are far
// below that; a large HTML newsletter or a mail with a big attachment may not
// be. The mail is then not lost -- the runtime fails the invocation and the
// sender is told the delivery failed -- but the README says how to measure
// CPU on real traffic and to lower MAX_RAW_BYTES (or move to the paid plan) if
// it gets close.

import PostalMime from "postal-mime"
import type { Email, PostalMimeOptions } from "postal-mime"

import { buildPayload, looksUnparseable } from "./payload.ts"
import { resolveRecipient } from "./recipient.ts"
import type { Env, InboundEmailMessage, InboundMailPayload } from "./types.ts"

export type { Env, InboundEmailMessage, InboundMailPayload } from "./types.ts"

const DEFAULT_TIMEOUT_MS = 8_000
const MAX_TIMEOUT_MS = 25_000
const DEFAULT_MAX_RAW_BYTES = 1024 * 1024
const MIN_MAX_RAW_BYTES = 4 * 1024
const CEILING_MAX_RAW_BYTES = 8 * 1024 * 1024

// Bounds on what a hostile message can make the parser do. Legitimate mail is
// nowhere near any of these.
const PARSE_OPTIONS: PostalMimeOptions = {
  maxNestingDepth: 32,
  maxRfc822NestingDepth: 3,
  maxHeadersSize: 256 * 1024,
}

/** Injection points. Production uses the defaults; tests replace them. */
export type Deps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  now: () => Date
  parse: (raw: Uint8Array) => Promise<Email>
}

const defaultDeps: Deps = {
  // Looked up at call time (not captured) so a patched globalThis.fetch is honoured.
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => new Date(),
  parse: (raw) => PostalMime.parse(raw, PARSE_OPTIONS),
}

/** A failure with a stable, log-safe reason code (also sent to the operator in a header). */
class Failure extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ svc: "dpdp-inbound-mail", event, ...fields }))
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err
}

function intVar(value: string | number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

type Config = { url: string; secret: string; timeoutMs: number; maxRawBytes: number }

function readConfig(env: Env): Config {
  const url = (env.DPDP_INBOUND_URL ?? "").trim()
  const secret = env.DPDP_INBOUND_SECRET ?? ""
  if (url === "" || secret === "") throw new Failure("config_missing")
  // The bearer must never travel in clear text. Plain http is allowed only for
  // a local "wrangler dev" run against a stub server.
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url)
  if (!/^https:\/\//i.test(url) && !local) throw new Failure("config_insecure_url")
  return {
    url,
    secret,
    timeoutMs: intVar(env.POST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS),
    maxRawBytes: intVar(env.MAX_RAW_BYTES, DEFAULT_MAX_RAW_BYTES, MIN_MAX_RAW_BYTES, CEILING_MAX_RAW_BYTES),
  }
}

/**
 * Reads the message stream up to `cap` bytes and cancels it after that, so a
 * 25 MB message costs the same as a 1 MB one. `truncated` is true when bytes
 * were left unread.
 */
export async function readCapped(
  stream: ReadableStream<Uint8Array>,
  cap: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      const room = cap - total
      if (value.byteLength > room) {
        if (room > 0) chunks.push(value.subarray(0, room))
        total += Math.max(room, 0)
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return { bytes, truncated }
}

/** POSTs the payload. Resolves only on a 2xx; every other outcome throws a Failure. */
async function postPayload(payload: InboundMailPayload, cfg: Config, fetchFn: Deps["fetch"]): Promise<void> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Flag and reject BEFORE aborting: aborting makes the in-flight fetch
      // reject with an AbortError, and that must not be mistaken for a
      // network error (it was, before the ordering was fixed).
      timedOut = true
      reject(new Failure("post_timeout"))
      controller.abort()
    }, cfg.timeoutMs)
  })
  let response: Response
  try {
    const request = fetchFn(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.secret}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "manual",
    })
    // If the timeout wins the race, the aborted request still rejects later;
    // without this it would surface as an unhandled rejection.
    request.catch(() => {})
    response = await Promise.race([request, timeout])
  } catch (err) {
    if (timedOut) throw new Failure("post_timeout")
    throw err instanceof Failure ? err : new Failure("post_network_error")
  } finally {
    clearTimeout(timer)
  }
  // The reply body is not needed, and an unread body can pin the connection.
  await response.body?.cancel().catch(() => {})
  if (response.status < 200 || response.status > 299) throw new Failure(`post_http_${response.status}`)
}

/** Printable ASCII only, so it is always a legal header value. */
function headerSafe(value: string, max: number): string {
  return value.replace(/[^\x20-\x7E]/g, "?").slice(0, max)
}

/**
 * The fallback: hand the untouched original to the operator's mailbox. Throws
 * if that is impossible, on purpose -- see the header comment.
 */
async function forwardOriginal(
  message: InboundEmailMessage,
  env: Env,
  reason: string,
  envelopeTo: string,
): Promise<void> {
  const to = (env.FALLBACK_FORWARD_TO ?? "").trim()
  if (to === "") {
    log("forward_impossible", { reason, why: "FALLBACK_FORWARD_TO_unset" })
    throw new Error(`dpdp-inbound-mail: could not deliver (${reason}) and FALLBACK_FORWARD_TO is not set`)
  }
  let annotated: Headers | undefined
  try {
    annotated = new Headers({
      "X-Veridian-Fallback-Reason": headerSafe(reason, 100),
      "X-Veridian-Envelope-To": headerSafe(envelopeTo, 200),
    })
  } catch {
    annotated = undefined
  }
  try {
    await (annotated ? message.forward(to, annotated) : message.forward(to))
  } catch (first) {
    // The annotation is a courtesy; the mail is not. Retry bare before giving up.
    try {
      await message.forward(to)
    } catch (second) {
      log("forward_failed", { reason, error: errorName(second), first_error: errorName(first) })
      throw second
    }
  }
  log("forwarded_to_fallback", { reason })
}

/**
 * The whole job. Exported for tests; the runtime calls the default export.
 * Resolves when the mail was ticketed or forwarded, or refused at the
 * recipient check. Rejects only when the mail could be neither.
 */
export async function handleInbound(
  message: InboundEmailMessage,
  env: Env,
  overrides: Partial<Deps> = {},
): Promise<void> {
  const deps: Deps = { ...defaultDeps, ...overrides }

  const recipient = resolveRecipient(message.to)
  if (!recipient.accepted) {
    log("rejected_unknown_recipient")
    message.setReject("Unknown recipient")
    return
  }

  let truncated = false
  try {
    const cfg = readConfig(env)

    let read: { bytes: Uint8Array; truncated: boolean }
    try {
      read = await readCapped(message.raw, cfg.maxRawBytes)
    } catch {
      throw new Failure("read_failed")
    }
    truncated = read.truncated || message.rawSize > cfg.maxRawBytes

    let email: Email
    try {
      email = await deps.parse(read.bytes)
    } catch {
      throw new Failure("parse_failed")
    }
    if (looksUnparseable(email)) throw new Failure("parse_unusable")

    const payload = buildPayload({
      email,
      envelopeFrom: message.from,
      envelopeTo: recipient.address,
      envelopeToRaw: recipient.raw,
      rawSize: message.rawSize,
      truncated,
      receivedAt: deps.now(),
    })
    await postPayload(payload, cfg, deps.fetch)
    log("ticketed", { raw_size: message.rawSize, truncated, legacy_alias: recipient.legacyAlias ?? "" })
  } catch (err) {
    const reason = err instanceof Failure ? err.reason : "unexpected_error"
    log("primary_path_failed", { reason, error: errorName(err) })
    await forwardOriginal(message, env, reason, recipient.address)
    return
  }

  if (truncated) {
    // The ticket holds only an excerpt of a message this large. Also give the
    // operator the whole thing. The mail is already ticketed, so a failure
    // here is logged, not thrown.
    try {
      await forwardOriginal(message, env, "oversize_full_copy", recipient.address)
    } catch {
      log("oversize_copy_failed")
    }
  }
}
