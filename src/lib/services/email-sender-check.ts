// PROJEXA-BUILD-002 WP-12 (register rows AW-604, AW-904): who may make an inbound email do work. The resend-inbound webhook asks this
// before it stores, reads or analyses anything for a message: the From address must belong to an active person of the organisation the
// recipient alias resolved to, at member rank or above (the rank the from-document route asks of a person who uploads the same file).
// An address that is not such a person is a refusal that is recorded on the message row; no attachment is downloaded, stored or read
// and the body is not sent to a model.
//
// What this proves and what it does not. It proves the From line names a known person. A From line can be written by anyone, so when
// the message carries a receiving-server verdict (an Authentication-Results header) that says SPF, DKIM or DMARC failed, the message is
// refused too. Whether Resend's inbound service adds that header for every delivery is not proven here (no live delivery has been
// made); a message without the header is not refused for lacking it, and the owner checklist says so. Nothing this check lets through
// writes anything: an email only ever produces a proposal that a person approves (email-attachment-intake.ts).
//
// The lookup uses the plain db client, like email-alias-service.ts: the webhook has no session, so there is no tenant context yet, and
// the query names the organisation itself.
import { and, eq, sql } from "drizzle-orm"
import { users, type db as appDb } from "@/lib/db"
import { hasRole } from "@/lib/supabase/role-rank"

/** The one query builder this check uses, from the route's own db client. */
export type SenderDb = Pick<typeof appDb, "select">

export type SenderRefusalCode =
  | "sender_address_unreadable"
  | "sender_not_a_user_of_this_organisation"
  | "sender_role_too_low"
  | "sender_authentication_failed"

export type SenderVerdict =
  | { ok: true; address: string; person: { id: string; role: string } }
  | { ok: false; code: SenderRefusalCode; note: string }

// An address is 254 characters at most (RFC 5321); one local part, one domain, no whitespace, no angle brackets left over.
const ADDRESS_SHAPE = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/

/**
 * The bare, lower-case address in a From value: `Name <a@b.example>`, `"Name" <a@b.example>` and `a@b.example` all give
 * `a@b.example`. Null for anything else (no address, two addresses, control characters, too long). A display name is never trusted:
 * only what is inside the last angle brackets, or the whole value when there are none.
 */
export function parseSenderAddress(from: string | null | undefined): string | null {
  if (typeof from !== "string") return null
  const value = from.trim()
  if (value === "" || value.length > 600 || /[\u0000-\u001f\u007f]/.test(value)) return null
  const open = value.lastIndexOf("<")
  let candidate: string
  if (open >= 0) {
    if (!value.endsWith(">")) return null
    candidate = value.slice(open + 1, -1).trim()
  } else {
    candidate = value
  }
  candidate = candidate.toLowerCase()
  if (candidate.length > 254 || !ADDRESS_SHAPE.test(candidate)) return null
  return candidate
}

/**
 * What the receiving server said about SPF, DKIM and DMARC: `fail` when its Authentication-Results header says any of them failed,
 * `pass` when it is present and none failed, `absent` when there is no such header. The header name is matched without regard to case.
 * A value that is not a string is read as absent.
 */
export function readAuthenticationVerdict(headers: Record<string, unknown> | null | undefined): "pass" | "fail" | "absent" {
  if (!headers || typeof headers !== "object") return "absent"
  let seen = false
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "authentication-results" || typeof value !== "string") continue
    seen = true
    if (/\b(spf|dkim|dmarc)\s*=\s*fail\b/i.test(value)) return "fail"
  }
  return seen ? "pass" : "absent"
}

/** The active person of this organisation with this address, or null. The address is compared without regard to case. */
export async function findOrganisationPerson(
  db: SenderDb,
  orgId: string,
  address: string,
): Promise<{ id: string; role: string } | null> {
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true), sql`lower(${users.email}) = ${address}`))
    .limit(1)
  const row = rows[0]
  return row ? { id: row.id, role: String(row.role) } : null
}

/**
 * The verdict on one delivery: a known member-or-above person of the organisation, and no failed authentication verdict. The note of a
 * refusal names the reason and never repeats anything from the message body or its files. It does include the address that was
 * refused, because the owner needs it to see who wrote in; the address is the sender's own header, not file content.
 */
export async function verifySender(
  db: SenderDb,
  args: { orgId: string; fromAddress: string | null | undefined; headers?: Record<string, unknown> | null },
): Promise<SenderVerdict> {
  const address = parseSenderAddress(args.fromAddress)
  if (!address) {
    return { ok: false, code: "sender_address_unreadable", note: "message refused: the From address could not be read" }
  }
  if (readAuthenticationVerdict(args.headers) === "fail") {
    return { ok: false, code: "sender_authentication_failed", note: `message refused: the receiving server reported a failed SPF, DKIM or DMARC check for ${address}` }
  }
  const person = await findOrganisationPerson(db, args.orgId, address)
  if (!person) {
    return { ok: false, code: "sender_not_a_user_of_this_organisation", note: `message refused: ${address} is not an active person of this organisation` }
  }
  if (!hasRole(person, "member")) {
    return { ok: false, code: "sender_role_too_low", note: `message refused: ${address} has a role below member` }
  }
  return { ok: true, address, person }
}
