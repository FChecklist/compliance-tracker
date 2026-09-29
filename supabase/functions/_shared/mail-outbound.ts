// DPDP single-mailbox, OUTBOUND half -- what every platform email must carry so
// that a person's Reply lands, classified, in the one public inbox
// (dpdp@veridian-aios.com). Used by dpdp-monday-email and dpdp-invoice-email;
// the inbound half (worker + dpdp-inbound-mail) reads what this writes.
//
// WHAT IT DOES, per message:
//   * From     "VERIDIAN AI DPDP <dpdp@veridian-aios.com>" (DPDP_EMAIL_FROM overrides).
//   * Reply-To dpdp+<tag>.<ref>@veridian-aios.com (mail-taxonomy.replyToAddress):
//              the class and the outbound row travel in the address itself, so a
//              reply is classified with no keyword guessing.
//   * Subject  "[VERIDIAN DPDP · <Class>] ..." -- added once, never stacked.
//   * Headers  X-Veridian-Class / X-Veridian-Ref (outboundHeaders).
//   * Log      one dpdp.mail_outbound row per message, written through the
//              service-role-only wrapper public.dpdp_mail_log_outbound.
//
// THE LOG IS BEST-EFFORT, ON PURPOSE. Nothing here may stop or fail a send:
// the email has already left by the time logOutbound runs, and losing the log
// row costs only the thread lookup -- the class and ref are ALSO in the
// Reply-To address, so the inbound classifier still gets it right from the
// address alone. logOutbound therefore never throws, never waits longer than
// LOG_TIMEOUT_MS, and reports failure as `false` plus a console.warn.
//
// HONEST LIMITS
//   * provider_message_id is Resend's own `id`, NOT the RFC 5322 Message-ID the
//     recipient's mail client will quote in In-Reply-To. Resend does not let us
//     set that header. So a thread match on In-Reply-To alone will not find the
//     row; the ref in the Reply-To address is the reliable link and the
//     Message-ID match is a bonus if the provider's id ever equals it.
//   * A failed send is not logged (there is nothing to reply to).
//   * The RPC's org/membership parameters are text (the dpdp schema keeps those
//     ids as 32-hex text). Real ids are always uuid-shaped, so uuidOrNull passes
//     them through; anything that is not uuid-shaped is sent as null rather than
//     stored as junk. The argument NAMES are part of the contract with the
//     migration (PostgREST matches a call by them, and a wrong name is "function
//     not found", not a soft failure): dpdp-mail-outbound.test.ts reads the
//     migration SQL and fails if logOutbound sends a name the function lacks.
//
// PURE MODULE like mail-taxonomy.ts: no Deno global, no network of its own, no
// supabase-js import (the client is a structural type), so bun tests run it.
import {
  type MailClass, MAILBOX, MAILBOX_DOMAIN, isValidRef, newRef, outboundHeaders, replyToAddress, withSubjectPrefix,
} from "./mail-taxonomy.ts"

/** What the public sees and what a fresh install sends from. One address, one name. */
export const DEFAULT_FROM = `VERIDIAN AI DPDP <${MAILBOX}>`

/** The service-role-only wrapper (created with the mail_outbound table), by the name PostgREST sees. */
export const LOG_RPC = "dpdp_mail_log_outbound"

/** A slow database must not hold up the next email; this is the longest a log write is waited for. */
export const LOG_TIMEOUT_MS = 4000

/** DPDP_EMAIL_FROM if it holds something, else the single public address. Takes the value so this file reads no env. */
export function resolveFrom(envValue: string | null | undefined): string {
  const v = (envValue ?? "").trim()
  return v || DEFAULT_FROM
}

/** "dpdp@veridian-aios.com" or "Name <dpdp@veridian-aios.com>" -> "veridian-aios.com". */
export function domainOfFrom(from: string): string | null {
  const m = /<([^>]+)>/.exec(from)
  const addr = (m ? m[1] : from).trim()
  const at = addr.lastIndexOf("@")
  return at === -1 ? null : addr.slice(at + 1)
}

/**
 * A warning string when the configured From is NOT on the mailbox domain, else
 * null. The usual cause is a stale DPDP_EMAIL_FROM function secret still naming
 * the old send.veridian-aios.com subdomain: it overrides the new default, so
 * mail would silently keep going out from the old identity. Replies still route
 * to dpdp@ (Reply-To is fixed), but SPF/DKIM/DMARC alignment and what the
 * recipient sees would not be the single address the Owner asked for.
 */
export function foreignSenderWarning(from: string): string | null {
  const domain = domainOfFrom(from)?.toLowerCase() ?? null
  if (domain === MAILBOX_DOMAIN) return null
  return `DPDP_EMAIL_FROM sends from ${domain ?? "an address that could not be parsed"}, not ${MAILBOX_DOMAIN}; `
    + `unset the DPDP_EMAIL_FROM secret (or set it to ${DEFAULT_FROM}) so mail goes out from the single public address.`
}

export type OutboundEnvelope = {
  /** Ties this message to its mail_outbound row and to the Reply-To address. */
  ref: string
  cls: MailClass
  from: string
  reply_to: string
  /** Already carries the "[VERIDIAN DPDP · Class] " prefix, once. */
  subject: string
  /** Caller-supplied headers (e.g. List-Unsubscribe) plus X-Veridian-Class / X-Veridian-Ref; ours win on a clash. */
  headers: Record<string, string>
}

export type BuildOptions = {
  /** Already-resolved From (see resolveFrom). Defaults to DEFAULT_FROM. */
  from?: string
  /** Pass a ref you needed earlier (e.g. to build a List-Unsubscribe mailto with the SAME ref); otherwise a fresh one is made. */
  ref?: string
  headers?: Record<string, string>
}

/** Everything the send needs beyond the body, for ONE message. Throws only on a malformed `ref` you passed in. */
export function buildOutbound(cls: MailClass, subject: string, opts: BuildOptions = {}): OutboundEnvelope {
  const ref = opts.ref ?? newRef()
  return {
    ref,
    cls,
    from: opts.from?.trim() || DEFAULT_FROM,
    reply_to: replyToAddress(cls, ref),
    subject: withSubjectPrefix(cls, subject),
    headers: { ...(opts.headers ?? {}), ...outboundHeaders(cls, ref) },
  }
}

/** The Resend REST body for one recipient. Kept here so both functions send the identical shape. */
export function resendPayload(to: string, out: OutboundEnvelope, body: { html: string; text: string }): Record<string, unknown> {
  return { from: out.from, to: [to], reply_to: out.reply_to, subject: out.subject, html: body.html, text: body.text, headers: out.headers }
}

export type OutboundLogEntry = {
  ref: string
  cls: MailClass
  to: string
  /** The subject as sent (prefixed). */
  subject: string
  /** Resend's `id`; null when the provider returned none. */
  providerMessageId: string | null
  membershipId?: string | null
  orgId?: string | null
}

/** The one thing of a Supabase client this file uses; any SupabaseClient satisfies it. */
export type RpcClient = {
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: any) => PromiseLike<unknown>
}

const UUID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i

/** The value if Postgres will read it as a uuid (dashed or 32 hex), else null. */
export function uuidOrNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim()
  return UUID_RE.test(s) ? s : null
}

/**
 * Writes one mail_outbound row. NEVER throws and never blocks a send: returns
 * true when the database confirmed the row, false otherwise (warned, not raised).
 * Call it right after the provider accepted the message, before anything else
 * that could fail, so a later error in the caller cannot leave a sent email
 * with no log row.
 */
export async function logOutbound(sb: RpcClient, entry: OutboundLogEntry, timeoutMs: number = LOG_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (!isValidRef(entry.ref)) throw new Error(`invalid ref ${JSON.stringify(entry.ref)}`)
    const call = Promise.resolve(sb.rpc(LOG_RPC, {
      p_ref: entry.ref,
      p_class: entry.cls,
      p_to_addr: entry.to.trim(),
      p_subject: entry.subject,
      p_provider_message_id: entry.providerMessageId?.trim() || null,
      p_membership_id: uuidOrNull(entry.membershipId),
      p_org_id: uuidOrNull(entry.orgId),
    })).then((res) => {
      const error = (res as { error?: { message?: string } | null } | null | undefined)?.error
      if (error) throw new Error(error.message || "rpc returned an error")
    })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs)
    })
    await Promise.race([call, timeout])
    return true
  } catch (e) {
    console.warn(`${LOG_RPC} failed for ref ${entry.ref} (the email WAS sent; the class and ref are still in its Reply-To): ${e instanceof Error ? e.message : String(e)}`)
    return false
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
