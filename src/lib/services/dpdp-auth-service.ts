// WO-DPDP-001 Phase 2 point 3: passwordless magic-link auth for
// dpdp.identity. No password field anywhere in this file or its callers.
//
// TOKEN SHAPE: an opaque, cryptographically random value, stored only as
// its sha256 hash (dpdp.login_token.tokenHash / dpdp.session.tokenHash) --
// this repo has never used a JWT/signed-token library anywhere
// (confirmed by a repo-wide search before writing this), and every other
// non-Supabase-Auth session already here (firmClientPortalLinks,
// org-join-codes, invite links) follows the same "opaque token, DB-stored
// hash, validated by lookup" shape. This file follows it too rather than
// introducing a new dependency for something one `crypto.randomBytes` call
// already does.
//
// TWO DIFFERENT TOKENS, TWO DIFFERENT LIFETIMES:
//   - login_token: the one-time link in the email. 15-minute expiry,
//     single-use (consumedAt), reuse is LOGGED not just refused (B1).
//   - session: what a consumed login_token turns into. Longer-lived,
//     length depends on level (Phase 2 point 3: "staff 90 days, anyone who
//     can see more, less") -- SESSION_DAYS_BY_LEVEL below is this file's
//     own concrete choice for "less": the work order does not give a
//     number, 30 days is chosen as a materially shorter, still-usable
//     value for an owner/can-sign member and is easy to revisit.
import { randomBytes, createHash } from "node:crypto"
import { eq, and, isNull, gt } from "drizzle-orm"
import { db, dpdpIdentity, dpdpIdentityEmail, dpdpLoginToken, dpdpSession, dpdpMembership } from "@/lib/db"
import { sendEmail, emailTemplate } from "@/lib/email"
import { logDpdpEvent } from "./dpdp-event-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000 // work order Phase 2 point 3: 15-minute expiry
const SESSION_DAYS_BY_LEVEL: Record<"owner" | "staff", number> = { staff: 90, owner: 30 }

function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url")
}
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://veridian-compliance-ai.vercel.app"

/**
 * Finds or creates the dpdp.identity for `email` (case-insensitive via the
 * unique index on identity_email.email), issues a login_token, and emails
 * the link. Never reveals whether the identity already existed -- the
 * response to the caller is identical either way, same posture this repo's
 * own passcode-login rate limiting takes for "don't leak account
 * existence."
 */
export async function requestDpdpMagicLink(rawEmail: string, opts: { requestedOrgId?: string; requestIp?: string } = {}): Promise<void> {
  const email = rawEmail.trim().toLowerCase()
  if (!email || !email.includes("@")) throw new ServiceError("A valid email is required", 400)

  const identityId = await db.transaction(async (tx) => {
    const existingEmail = await tx.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, email) })
    if (existingEmail) return existingEmail.identityId

    const [identity] = await tx.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
    await tx.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true, verifiedAt: null })
    return identity.id
  })

  const raw = newOpaqueToken()
  await db.insert(dpdpLoginToken).values({
    identityId,
    tokenHash: hashToken(raw),
    requestedOrgId: opts.requestedOrgId ?? null,
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
    requestIp: opts.requestIp ?? null,
  })

  const link = `${APP_URL}/dpdp/auth/verify?token=${raw}`
  await sendEmail({
    to: email,
    subject: "Open it →",
    // Copy deliberately mirrors the owner-supplied artefact's own "The
    // email" screen (veridian-complete.html, step 1) -- the work order
    // says do not rewrite it.
    html: emailTemplate(
      "A quick link to sign in",
      `We hold no password for you. This link signs you in — it works for you only, and it stops working after you have used it.<br><br>` +
      `↩️ Or just reply to this email and a person will read it.`,
      link,
      "Open it →"
    ),
  })
}

export type DpdpAuthResult = {
  sessionToken: string
  identityId: string
  orgId: string | null // null: a brand-new identity with no organisation yet -- see dpdp.session's own schema.ts comment
  expiresAt: Date
}

/**
 * Consumes a login_token. On success, revokes nothing (a fresh login is
 * additive, not exclusive -- someone may be signed in on two devices), picks
 * an active org (requestedOrgId if it's one the identity actually has an
 * active membership in, else the identity's most recently created active
 * membership), and issues a session.
 *
 * B1: a spent/expired/unknown token is refused AND logged as a reuse
 * attempt when it maps to a real, already-consumed token row -- an unknown
 * hash (never existed) has nothing to log against and is just refused.
 */
export async function verifyDpdpMagicLink(rawToken: string): Promise<DpdpAuthResult> {
  const tokenHash = hashToken(rawToken)
  const now = new Date()

  const row = await db.query.dpdpLoginToken.findFirst({ where: eq(dpdpLoginToken.tokenHash, tokenHash) })
  if (!row) throw new ServiceError("This link is not valid", 400)

  if (row.consumedAt || row.expiresAt < now) {
    await db.update(dpdpLoginToken).set({ reuseAttemptedAt: now }).where(eq(dpdpLoginToken.id, row.id))
    throw new ServiceError("This link has already been used or has expired. Ask for a new one.", 400)
  }

  await db.update(dpdpLoginToken).set({ consumedAt: now }).where(eq(dpdpLoginToken.id, row.id))

  const memberships = await db.query.dpdpMembership.findMany({
    where: and(eq(dpdpMembership.identityId, row.identityId), eq(dpdpMembership.state, "active")),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })

  const orgId = row.requestedOrgId && memberships.some((m) => m.orgId === row.requestedOrgId)
    ? row.requestedOrgId
    : (memberships[0]?.orgId ?? null)

  const level = memberships.find((m) => m.orgId === orgId)?.level ?? "staff"
  // A null orgId (bootstrap case) gets the shorter, "can see more" expiry
  // deliberately -- it's a narrow-purpose session that can only create an
  // organisation, not one anyone should want long-lived.
  const expiryDays = orgId ? SESSION_DAYS_BY_LEVEL[level] : SESSION_DAYS_BY_LEVEL.owner
  const raw = newOpaqueToken()
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000)
  await db.insert(dpdpSession).values({ identityId: row.identityId, activeOrgId: orgId, tokenHash: hashToken(raw), expiresAt })
  await db.update(dpdpIdentity).set({ lastSeenAt: now }).where(eq(dpdpIdentity.id, row.identityId))

  if (orgId) {
    await logDpdpEvent({ orgId, actorIdentityId: row.identityId, actorLabel: "system", kind: "identity_signed_in", summary: "Signed in via emailed link" })
  }

  return { sessionToken: raw, identityId: row.identityId, orgId, expiresAt }
}

/** Looks up a session by its raw cookie value. Returns null if missing, expired, or revoked. */
export async function resolveDpdpSession(rawSessionToken: string): Promise<{ identityId: string; orgId: string | null; sessionId: string } | null> {
  const row = await db.query.dpdpSession.findFirst({
    where: and(eq(dpdpSession.tokenHash, hashToken(rawSessionToken)), isNull(dpdpSession.revokedAt), gt(dpdpSession.expiresAt, new Date())),
  })
  if (!row) return null
  // Best-effort activity stamp -- not awaited-critical, a failed write here
  // must never fail the request it's attached to.
  db.update(dpdpSession).set({ lastSeenAt: new Date() }).where(eq(dpdpSession.id, row.id)).catch(() => {})
  return { identityId: row.identityId, orgId: row.activeOrgId, sessionId: row.id }
}

/** "Their link stops working the same minute" (People screen) -- revokes one session immediately. */
export async function revokeDpdpSession(rawSessionToken: string): Promise<void> {
  await db.update(dpdpSession).set({ revokedAt: new Date() }).where(eq(dpdpSession.tokenHash, hashToken(rawSessionToken)))
}

/** Revokes every session for an identity -- used when a membership is revoked (someone leaves). */
export async function revokeAllDpdpSessionsForIdentity(identityId: string): Promise<void> {
  await db.update(dpdpSession).set({ revokedAt: new Date() }).where(and(eq(dpdpSession.identityId, identityId), isNull(dpdpSession.revokedAt)))
}

/** Switches which org a session is "on" -- must be a membership the identity actually holds. */
export async function switchDpdpActiveOrg(sessionId: string, identityId: string, newOrgId: string): Promise<void> {
  const membership = await db.query.dpdpMembership.findFirst({
    where: and(eq(dpdpMembership.identityId, identityId), eq(dpdpMembership.orgId, newOrgId), eq(dpdpMembership.state, "active")),
  })
  if (!membership) throw new ServiceError("Not a member of that organisation", 403)
  await db.update(dpdpSession).set({ activeOrgId: newOrgId }).where(eq(dpdpSession.id, sessionId))
}
