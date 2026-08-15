// VERIDIAN Review Framework Wave 4, Track 1b item 2 (2026-07-18): real,
// audited "act on behalf of customer" support-session capability. Confirmed
// via a fresh grep of src/ immediately before this file was written -- zero
// "act on behalf"/"impersonat"/"support session" concept existed anywhere
// in this codebase.
//
// This is inherently a cross-org operation: the initiating veridian_admin's
// own org is never the target org, so start/end/lookup-by-token all run
// through the raw (RLS-bypassing) `db` client from "@/lib/db" -- the same
// posture auth-guard.ts's autoProvisionUser and org-provisioning-service.ts
// already document for platform-level operations that predate or cross
// tenant boundaries. Route-layer callers are responsible for the actual
// `requireRole(dbUser, "veridian_admin")` gate before calling
// startSupportSession -- this file trusts its caller the same way every
// other *-service.ts in this codebase trusts its route layer to have
// already authenticated/authorized the request.
//
// The one read that is NOT cross-org -- a target org's own admin listing
// support sessions run against THEIR org -- goes through the normal
// withTenantContext/RLS path instead (listSupportSessionsForOrg), scoped by
// target_org_id = compliance.current_org_id(), matching every other
// tenant-scoped table in this schema.
import { db, supportSessions, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, sql, desc } from "drizzle-orm"
import { randomBytes } from "crypto"
import { hashSHA256 } from "@/lib/api-keys"
import { logActivity } from "@/lib/audit"
import { ServiceError } from "./compliance-service"

export type SupportSessionRow = typeof supportSessions.$inferSelect

const SESSION_DURATION_MS = 60 * 60 * 1000 // fixed 1-hour lifetime, per spec -- not admin-configurable

export function generateSupportSessionToken(): string {
  // crypto.randomBytes, not Math.random -- same stronger-guarantee posture
  // invite-link-service.ts's generateInviteToken() already established for
  // an org-scoped, security-sensitive token.
  return `ss_${randomBytes(24).toString("hex")}`
}

export type SupportSessionStatus = "active" | "expired" | "ended"

/**
 * Pure -- takes the row and "now" as plain data, does no I/O and reads no
 * clock of its own. Single place session-validity logic lives, so
 * validateSupportSessionToken and any future caller can never disagree
 * about what counts as active. Order matters: an explicitly-ended session
 * reports "ended" even past its expiry, since that's the more specific
 * (and more likely intentional) reason -- same precedent as
 * evaluateInviteLinkStatus's revoked-before-expired ordering.
 */
export function evaluateSupportSessionStatus(
  row: Pick<SupportSessionRow, "expiresAt" | "endedAt">,
  now: Date
): SupportSessionStatus {
  if (row.endedAt) return "ended"
  if (row.expiresAt.getTime() <= now.getTime()) return "expired"
  return "active"
}

export function isSupportSessionActive(
  row: Pick<SupportSessionRow, "expiresAt" | "endedAt">,
  now: Date
): boolean {
  return evaluateSupportSessionStatus(row, now) === "active"
}

export type StartSupportSessionParams = {
  initiatedBy: typeof users.$inferSelect
  targetOrgId: string
  targetUserId: string
  reason: string
}

export type StartSupportSessionResult = {
  id: string
  token: string
  expiresAt: Date
  targetUserName: string
}

/**
 * Starts a new support session and writes the opening audit_logs row in the
 * SAME logical action -- a session that exists with no corresponding audit
 * trail entry would defeat the entire point of this capability. The audit
 * row is written into the TARGET org's own audit_logs (org_id =
 * targetOrgId, via withTenantContext) so it shows up on that org's own
 * /audit page (src/app/(app)/audit/page.tsx) exactly like any other action
 * taken against their data -- not hidden in the support agent's own org.
 */
export async function startSupportSession(params: StartSupportSessionParams): Promise<StartSupportSessionResult> {
  const reason = params.reason.trim()
  if (!reason) throw new ServiceError("A reason is required to start a support session", 400)

  const targetUser = await db.query.users.findFirst({
    where: and(eq(users.id, params.targetUserId), eq(users.orgId, params.targetOrgId)),
  })
  if (!targetUser) throw new ServiceError("Target user not found in the target organisation", 404)

  const token = generateSupportSessionToken()
  const tokenHash = await hashSHA256(token)
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

  const [row] = await db.insert(supportSessions).values({
    initiatedByUserId: params.initiatedBy.id,
    initiatedByName: params.initiatedBy.name,
    targetOrgId: params.targetOrgId,
    targetUserId: params.targetUserId,
    targetUserName: targetUser.name,
    reason,
    tokenHash,
    expiresAt,
  }).returning()

  await withTenantContext({ orgId: params.targetOrgId, userId: params.targetUserId }, (tx) =>
    logActivity({
      tx,
      orgId: params.targetOrgId,
      dbUser: params.initiatedBy,
      action: "support_session.started",
      entityType: "support_session",
      entityId: row.id,
      details: reason,
      supportSession: { id: row.id, actingOnBehalfOfUserId: params.targetUserId },
    })
  )

  return { id: row.id, token, expiresAt, targetUserName: targetUser.name }
}

export async function getSupportSessionById(id: string): Promise<SupportSessionRow | null> {
  return (await db.query.supportSessions.findFirst({ where: eq(supportSessions.id, id) })) ?? null
}

export type EndSupportSessionParams = {
  id: string
  endedBy: typeof users.$inferSelect
  endedReason?: string
}

/**
 * Ends a session early (or is a no-op if it's already ended/expired).
 * Single atomic conditional UPDATE ... WHERE ended_at IS NULL RETURNING --
 * same TOCTOU-safe shape as invite-link-service.ts's use-count increment --
 * so two concurrent "end" calls can't both believe they were the one that
 * ended it.
 */
export async function endSupportSession(params: EndSupportSessionParams): Promise<{ ok: boolean; alreadyEnded: boolean }> {
  const existing = await db.query.supportSessions.findFirst({ where: eq(supportSessions.id, params.id) })
  if (!existing) throw new ServiceError("Support session not found", 404)
  if (existing.endedAt) return { ok: true, alreadyEnded: true }

  const [row] = await db.update(supportSessions)
    .set({ endedAt: new Date(), endedReason: params.endedReason?.trim() || "ended_by_admin" })
    .where(and(eq(supportSessions.id, params.id), sql`ended_at IS NULL`))
    .returning()

  if (!row) return { ok: true, alreadyEnded: true } // lost the race to a concurrent end -- still a success from the caller's POV

  await withTenantContext({ orgId: existing.targetOrgId, userId: existing.targetUserId }, (tx) =>
    logActivity({
      tx,
      orgId: existing.targetOrgId,
      dbUser: params.endedBy,
      action: "support_session.ended",
      entityType: "support_session",
      entityId: existing.id,
      details: row.endedReason ?? undefined,
      supportSession: { id: existing.id, actingOnBehalfOfUserId: existing.targetUserId },
    })
  )

  return { ok: true, alreadyEnded: false }
}

export type ValidatedSupportSession = {
  row: SupportSessionRow
}

/**
 * Looks up a session by its raw bearer token and confirms it's currently
 * active (not ended, not expired). Returns null rather than throwing on any
 * failure to look up (not-found, ended, expired) -- callers (route layer)
 * decide the right HTTP status/message, this is a pure lookup.
 */
export async function validateSupportSessionToken(token: string): Promise<ValidatedSupportSession | null> {
  if (!token || !token.startsWith("ss_")) return null
  const tokenHash = await hashSHA256(token)
  const row = await db.query.supportSessions.findFirst({ where: eq(supportSessions.tokenHash, tokenHash) })
  if (!row) return null
  if (!isSupportSessionActive(row, new Date())) return null
  return { row }
}

/**
 * The impersonated org's own admin querying support sessions run against
 * THEIR org -- real app_runtime/RLS path (target_org_id =
 * compliance.current_org_id()), not the raw client, matching every other
 * tenant-scoped table's own-org read pattern in this schema.
 */
export async function listSupportSessionsForOrg(orgId: string): Promise<SupportSessionRow[]> {
  return withTenantContext({ orgId }, (tx) =>
    tx.query.supportSessions.findMany({
      where: eq(supportSessions.targetOrgId, orgId),
      orderBy: desc(supportSessions.createdAt),
    })
  )
}
