// Area 15/18 (U-D27.B1.S1, "3 of 4 spec'd invitation paths" gap): Secure
// Invite Link, the second invitation path alongside Master-Admin-direct-add
// (POST /api/users -- one named person, invited by email via
// supabaseAdmin.auth.admin.inviteUserByEmail). This path is for the
// "shareable via WhatsApp/email" case in the source spec: an admin
// generates one link, anyone holding it can join THIS org at the role
// fixed at generation time.
//
// Security properties, stated plainly for review (per dispatch brief):
//   - org-scoped: the token is bound to one orgId + one role at CREATE
//     time, in a DB row -- never inferred from anything the redeemer sends.
//   - short-lived: expiresAt (default 7 days, admin-settable up to 30) is
//     enforced server-side on every preview/consume call, not just checked
//     once at generation time.
//   - use-budgeted, not inherently single-use: maxUses is nullable (=
//     unlimited-until-expiry, the default -- matches "share one link with
//     the whole team over WhatsApp", not "one email, one recipient").
//     An admin can set maxUses=1 for a tighter single-use guarantee.
//     Enforced by ONE atomic conditional UPDATE...RETURNING in
//     consumeInviteLinkAndProvisionUser -- not a SELECT-then-UPDATE, which
//     would let two concurrent redemptions both pass validation before
//     either commits (a real TOCTOU race for a maxUses=1 link).
//   - revocable: an admin can kill a link early (revokedAt).
//   - the raw token is never persisted -- only its SHA-256 hash
//     (tokenHash, unique), the same posture apiKeys.keyHash already uses.
//   - redemption still requires a real Supabase Auth signup (real email
//     ownership, Supabase's own verification) -- this mechanism is never
//     reachable by an unauthenticated caller with no Supabase identity at
//     all; it only decides which ORG an already-authenticating identity
//     lands in.
import { db, organisations, orgInviteLinks, users, aiAssistants } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, desc, sql } from "drizzle-orm"
import { randomBytes } from "crypto"
import { hashSHA256 } from "@/lib/api-keys"
import { canAssignSeat } from "@/lib/org-license-service"

// Deliberately narrower than the full 10-value userRoleEnum -- same
// restriction api/users/route.ts's VALID_ROLES already applies to
// direct-add, kept in sync by hand since it's a small, stable list.
export const INVITE_ROLES = ["admin", "manager", "member", "viewer"] as const
export type InviteRole = typeof INVITE_ROLES[number]

export function isInviteRole(value: string): value is InviteRole {
  return (INVITE_ROLES as readonly string[]).includes(value)
}

const DEFAULT_EXPIRY_DAYS = 7
const MAX_EXPIRY_DAYS = 30

export function generateInviteToken(): string {
  // crypto.randomBytes, not Math.random (unlike the pre-existing
  // generateApiKey() in this same file's sibling module) -- an org-join
  // token is worth the stronger guarantee, and randomBytes was already an
  // established import in this codebase's auth-adjacent code (api/users/
  // route.ts's placeholder password hash).
  return `il_${randomBytes(24).toString("hex")}`
}

export function inviteTokenPrefix(token: string): string {
  // "il_" + 8 hex chars -- enough for an admin to visually tell two links
  // apart in a list; nowhere near enough entropy to redeem the link.
  return token.slice(0, 11)
}

export type InviteLinkRow = typeof orgInviteLinks.$inferSelect

export type InviteLinkStatus = "valid" | "expired" | "revoked" | "exhausted"

/**
 * Pure -- takes the row and "now" as plain data, does no I/O and reads no
 * clock of its own. This is the single place invite-link validity logic
 * lives; both previewInviteLink (public, pre-signup) and
 * consumeInviteLinkAndProvisionUser (at redemption) call it, so the two can
 * never disagree about what counts as valid. Order matters: a revoked link
 * reports "revoked" even past its expiry, since that's the more specific
 * (and more likely intentional-admin-action) reason.
 */
export function evaluateInviteLinkStatus(
  row: Pick<InviteLinkRow, "expiresAt" | "revokedAt" | "maxUses" | "useCount">,
  now: Date
): InviteLinkStatus {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt.getTime() <= now.getTime()) return "expired"
  if (row.maxUses !== null && row.useCount >= row.maxUses) return "exhausted"
  return "valid"
}

export async function createInviteLink(params: {
  orgId: string
  role: InviteRole
  createdByUserId: string
  label?: string
  expiresInDays?: number
  maxUses?: number | null
}): Promise<{ id: string; token: string; role: InviteRole; expiresAt: Date; maxUses: number | null }> {
  const expiresInDays = Math.min(Math.max(params.expiresInDays ?? DEFAULT_EXPIRY_DAYS, 1), MAX_EXPIRY_DAYS)
  const token = generateInviteToken()
  const tokenHash = await hashSHA256(token)
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

  const [row] = await withTenantContext({ orgId: params.orgId, userId: params.createdByUserId }, (tx) =>
    tx.insert(orgInviteLinks).values({
      orgId: params.orgId,
      role: params.role,
      tokenHash,
      tokenPrefix: inviteTokenPrefix(token),
      label: params.label?.trim() || null,
      createdByUserId: params.createdByUserId,
      maxUses: params.maxUses ?? null,
      expiresAt,
    }).returning()
  )

  // token is returned to the caller exactly once -- it is not retrievable
  // again after this call, matching apiKeys' generateApiKey() convention.
  return { id: row.id, token, role: params.role, expiresAt, maxUses: row.maxUses }
}

export async function listInviteLinks(orgId: string): Promise<InviteLinkRow[]> {
  return withTenantContext({ orgId }, (tx) =>
    tx.query.orgInviteLinks.findMany({
      where: eq(orgInviteLinks.orgId, orgId),
      orderBy: desc(orgInviteLinks.createdAt),
    })
  )
}

export async function revokeInviteLink(orgId: string, id: string, revokedByUserId: string): Promise<boolean> {
  const rows = await withTenantContext({ orgId, userId: revokedByUserId }, (tx) =>
    tx.update(orgInviteLinks)
      .set({ revokedAt: new Date(), revokedByUserId, updatedAt: new Date() })
      .where(eq(orgInviteLinks.id, id)) // org scoping is enforced by RLS (app_runtime_tenant_isolation), not just this WHERE
      .returning({ id: orgInviteLinks.id })
  )
  return rows.length > 0
}

export type InviteLinkPreview =
  | { valid: true; orgName: string; role: InviteRole }
  | { valid: false; reason: "not_found" | InviteLinkStatus }

/**
 * Public preview -- called by the unauthenticated invite-landing/signup
 * page before any Supabase Auth identity exists for the visitor. Uses the
 * raw (RLS-bypassing) db client deliberately: there is no session and
 * therefore no tenant context to scope the lookup by yet -- same rationale
 * auth-guard.ts's autoProvisionUser and api-key-auth.ts's validateApiKey
 * already document for this exact situation.
 */
export async function previewInviteLink(token: string): Promise<InviteLinkPreview> {
  if (!token || !token.startsWith("il_")) return { valid: false, reason: "not_found" }
  const tokenHash = await hashSHA256(token)
  const row = await db.query.orgInviteLinks.findFirst({ where: eq(orgInviteLinks.tokenHash, tokenHash) })
  if (!row) return { valid: false, reason: "not_found" }

  const status = evaluateInviteLinkStatus(row, new Date())
  if (status !== "valid") return { valid: false, reason: status }

  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, row.orgId), columns: { name: true } })
  return { valid: true, orgName: org?.name ?? "this organisation", role: row.role as InviteRole }
}

export type ConsumeInviteLinkResult =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: string }

/**
 * Consumes one use of the link and, on success, provisions the
 * compliance.users row for the invitee -- the "mirrors what direct-add
 * does today" step, minus the email-invite/placeholder-password plumbing
 * direct-add needs (this caller has already completed real Supabase Auth
 * signup by the time this runs -- see auth-guard.ts's autoProvisionUser,
 * the sole caller). Every code path below runs on the raw db client for
 * the same "no tenant context exists yet" reason as previewInviteLink.
 *
 * Ordering is deliberate: the seat-capacity check happens BEFORE the atomic
 * use-count increment below, so a full org never burns a use of a link on
 * a signup that's about to fail anyway -- the link stays fully valid for
 * someone else (or the same person, later) once a seat frees up.
 */
export async function consumeInviteLinkAndProvisionUser(
  token: string,
  authUser: { id: string; email: string; fullName: string }
): Promise<ConsumeInviteLinkResult> {
  const tokenHash = await hashSHA256(token)
  const row = await db.query.orgInviteLinks.findFirst({ where: eq(orgInviteLinks.tokenHash, tokenHash) })
  if (!row) return { ok: false, reason: "This invite link is invalid." }

  const preStatus = evaluateInviteLinkStatus(row, new Date())
  if (preStatus !== "valid") {
    return { ok: false, reason: `This invite link has ${preStatus === "exhausted" ? "already been used" : preStatus}.` }
  }

  const seatCheck = await canAssignSeat(row.orgId)
  if (!seatCheck.allowed) return { ok: false, reason: seatCheck.reason }

  // Single atomic conditional UPDATE...RETURNING -- see module comment on
  // why this, and not a second SELECT check, is what actually prevents a
  // maxUses=1 link from being redeemed twice by concurrent requests.
  const consumed = (await db.execute(sql`
    UPDATE compliance.org_invite_links
    SET use_count = use_count + 1, updated_at = now()
    WHERE id = ${row.id}
      AND revoked_at IS NULL
      AND expires_at > now()
      AND (max_uses IS NULL OR use_count < max_uses)
    RETURNING id
  `)) as { id: string }[]
  if (consumed.length === 0) {
    return { ok: false, reason: "This invite link was just used up, revoked, or expired. Ask for a new one." }
  }

  if (!isInviteRole(row.role)) {
    // Defensive only -- createInviteLink only ever writes an INVITE_ROLES
    // value, this guards against a hand-edited DB row with a stale/invalid
    // role rather than an expected runtime path.
    return { ok: false, reason: "This invite link has an invalid role and cannot be redeemed." }
  }

  const [newUser] = await db.insert(users).values({
    name: authUser.fullName,
    email: authUser.email,
    passwordHash: "supabase-auth-managed", // legacy NOT NULL column, matches autoProvisionUser's normal-signup convention exactly
    role: row.role,
    orgId: row.orgId,
    authUserId: authUser.id,
    // The seat check above already gated this -- unlike direct-add's
    // isActive:false ("becomes active after they accept invite"), there is
    // no separate accept step left after this point, so this user is
    // immediately active.
    isActive: true,
  }).returning()

  // Wave 2 parity: every user gets 5 numbered AI Assistants, same as
  // direct-add (api/users/route.ts) and normal signup (autoProvisionUser).
  await db.insert(aiAssistants).values(
    Array.from({ length: 5 }, (_, i) => ({
      userId: newUser.id,
      assistantNumber: i + 1,
      label: `Assistant ${i + 1}`,
    }))
  )

  return { ok: true, user: newUser }
}
