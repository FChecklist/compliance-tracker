// Marketing pass-through (owner decision 2026-11-08): mail addressed to rina@veridian-aios.com is the MARKETING address, not DPDP.
// It must never be classified, ticketed or acknowledged as DPDP. It is forwarded as plain text to one fixed address (the LUCIFER mail lane)
// and only the Resend message id and the time are logged -- no address, subject or text.
//
// Rules (pure, tested in passthrough.test.ts):
//   - matches when any received_for / To / Cc / Bcc address is exactly rina@ or rina+<tag>@ at veridian-aios.com (case-insensitive);
//   - NEVER when a DPDP address (dpdp@, dpdp+tag@, grievance@, partners@, postmaster@, abuse@) is also a recipient: a legal request must
//     not lose its DPDP ticket because someone put rina@ on Cc, so that message takes the normal DPDP path (rina's copy is not forwarded);
//   - the target is MARKETING_FORWARD_TO (function secret). Unset or not one plain address: pass-through is OFF and nothing changes
//     (rollback = unset the secret, or redeploy the previous version).
// mom@ is NOT handled here (left as it is).
import { MAILBOX_DOMAIN, parseRecipient } from "../_shared/mail-taxonomy.ts"
import type { OutMessage } from "./handler.ts"

export const MARKETING_LOCAL = "rina"
const DPDP_LOCALS = ["grievance", "partners", "postmaster", "abuse"]

export function isMarketingAddress(address: string): boolean {
  const a = address.trim().toLowerCase()
  const at = a.lastIndexOf("@")
  if (at < 1 || a.slice(at + 1) !== MAILBOX_DOMAIN) return false
  const local = a.slice(0, at)
  return local === MARKETING_LOCAL || local.startsWith(`${MARKETING_LOCAL}+`)
}

function isDpdpAddress(address: string): boolean {
  const a = address.trim().toLowerCase()
  const at = a.lastIndexOf("@")
  if (at < 1 || a.slice(at + 1) !== MAILBOX_DOMAIN) return false
  return parseRecipient(a).ours || DPDP_LOCALS.includes(a.slice(0, at))
}

/** True: forward to marketing and do nothing DPDP. */
export function isMarketingPassthrough(recipients: string[]): boolean {
  return recipients.some(isMarketingAddress) && !recipients.some(isDpdpAddress)
}

/** MARKETING_FORWARD_TO as one plain address, or null (pass-through off). */
export function marketingTarget(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim()
  if (!s || s.length > 254) return null
  return /^[^\s@<>,;"()[\]\\]+@[^\s@<>,;"()[\]\\]+\.[^\s@<>,;"()[\]\\]+$/.test(s) ? s : null
}

function oneLine(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim()
}

export type PassthroughInput = {
  emailId: string
  fromHeader: string
  fromAddress: string
  subject: string
  text: string
  truncated: boolean
  receivedAt: Date
}

/** The forwarded copy: plain text, original sender named in the body and set as Reply-To. */
export function renderPassthrough(m: PassthroughInput, to: string): OutMessage {
  const who = oneLine(m.fromHeader) || m.fromAddress || "(unknown sender)"
  const lines = [`Forwarded unchanged from rina@${MAILBOX_DOMAIN}. Original sender: ${who}`, `Received: ${m.receivedAt.toISOString()}`, "", m.text.trim() || "(empty)"]
  if (m.truncated) lines.push("", `(The text above may be cut. The whole message is in Resend, received-email id ${m.emailId}.)`)
  return {
    from: `Rina inbound <rina@${MAILBOX_DOMAIN}>`,
    to,
    subject: oneLine(m.subject) || "(no subject)",
    text: lines.join("\n"),
    replyTo: m.fromAddress && !isMarketingAddress(m.fromAddress) ? m.fromAddress : undefined,
    headers: { "X-Veridian-Origin": "marketing-passthrough", "Auto-Submitted": "auto-generated" },
    idempotencyKey: `marketing-passthrough-${m.emailId}`,
  }
}
