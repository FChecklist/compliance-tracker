// Wave 173 (GAP-DELEGATION-AUTHORITY). approval-preference-service.ts (Wave
// 161) covers "always approve this action CATEGORY" -- a type-level
// self-service preference a person sets for themself. This is a real,
// narrower, DIFFERENT thing: one person formally handing their own
// authority over a specific scope to someone else (or to any holder of a
// given role), for a bounded or open-ended time, revocably. Genuinely
// usable -- isDelegated() below is a real check function other code can
// call before treating a delegate's action as if the delegator performed
// it, not just a schema stub with no consumer.
import { scopedDelegations } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, isNull, or } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export const DELEGATION_SCOPE_TYPES = ["task", "workflow", "project", "module", "communication_type", "approval_type"] as const
export type DelegationScopeType = (typeof DELEGATION_SCOPE_TYPES)[number]

export type CreateDelegationInput = {
  delegatorUserId: string
  delegateUserId?: string | null
  delegateRoleKey?: string | null
  scopeType: DelegationScopeType
  scopeId?: string | null
  expiresAt?: Date | null
}

// ─── Pure validation/decision logic (unit-testable without a DB) ──────────

/**
 * Exactly one of delegateUserId/delegateRoleKey must be set (never both,
 * never neither); a delegator can't delegate to themself; a supplied
 * expiresAt must be strictly in the future. Extracted as a pure predicate,
 * matching this repo's established pattern for guardrail-style logic (see
 * task-service.ts's validateChainDepth / approval-workflow-service.ts's
 * isSelfApproval).
 */
export function validateDelegationInput(
  input: Pick<CreateDelegationInput, "delegatorUserId" | "delegateUserId" | "delegateRoleKey" | "expiresAt">,
  now: Date = new Date()
): { valid: true } | { valid: false; reason: string } {
  const hasUser = Boolean(input.delegateUserId)
  const hasRole = Boolean(input.delegateRoleKey)
  if (hasUser === hasRole) {
    return { valid: false, reason: "Exactly one of delegateUserId or delegateRoleKey must be set." }
  }
  if (hasUser && input.delegateUserId === input.delegatorUserId) {
    return { valid: false, reason: "Cannot delegate authority to yourself." }
  }
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "expiresAt must be in the future." }
  }
  return { valid: true }
}

/** Is this already-fetched delegation row currently active (not revoked, not expired)? Split out from isDelegated()'s DB fetch so the actual active/inactive decision is directly testable, same split as work-dashboard-service.ts's categorize*()/buildWorkDashboard(). */
export function isDelegationActive(delegation: { revokedAt: Date | null; expiresAt: Date | null }, now: Date = new Date()): boolean {
  if (delegation.revokedAt) return false
  if (delegation.expiresAt && delegation.expiresAt.getTime() <= now.getTime()) return false
  return true
}

/** Pure match: given an already-fetched, already-active delegation row, does it grant `userId` (holding `userRoleKeys`) authority? */
export function delegationGrantsUser(
  delegation: { delegateUserId: string | null; delegateRoleKey: string | null },
  userId: string,
  userRoleKeys: string[]
): boolean {
  if (delegation.delegateUserId) return delegation.delegateUserId === userId
  if (delegation.delegateRoleKey) return userRoleKeys.includes(delegation.delegateRoleKey)
  return false
}

// ─── DB-touching ────────────────────────────────────────────────────────

export async function createDelegation(ctx: { orgId: string; userId: string }, input: CreateDelegationInput) {
  const check = validateDelegationInput(input)
  if (!check.valid) throw new ServiceError(check.reason, 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(scopedDelegations).values({
      orgId: ctx.orgId,
      delegatorUserId: input.delegatorUserId,
      delegateUserId: input.delegateUserId ?? null,
      delegateRoleKey: input.delegateRoleKey ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      expiresAt: input.expiresAt ?? null,
    }).returning()
    return created
  })
}

export type RevokeDelegationResult = { ok: true } | { ok: false; reason: string }

/**
 * Only the original delegator may revoke their own delegation -- a real
 * authority check, not just a status flip anyone with API access could
 * flip. (An org admin override, if ever needed, belongs at the route layer
 * via requireRole() alongside this, not folded into this function's own
 * authority rule.)
 */
export async function revokeDelegation(ctx: { orgId: string; userId: string }, delegationId: string): Promise<RevokeDelegationResult> {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.scopedDelegations.findFirst({
      where: and(eq(scopedDelegations.id, delegationId), eq(scopedDelegations.orgId, ctx.orgId)),
    })
    if (!existing) return { ok: false, reason: "Delegation not found" }
    if (existing.revokedAt) return { ok: false, reason: "Already revoked" }
    if (existing.delegatorUserId !== ctx.userId) return { ok: false, reason: "Only the delegator can revoke this delegation" }

    await db.update(scopedDelegations).set({ revokedAt: new Date() }).where(eq(scopedDelegations.id, delegationId))
    return { ok: true }
  })
}

export async function listMyDelegations(ctx: { orgId: string; userId: string }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.scopedDelegations.findMany({
      where: and(eq(scopedDelegations.orgId, ctx.orgId), or(eq(scopedDelegations.delegatorUserId, ctx.userId), eq(scopedDelegations.delegateUserId, ctx.userId))),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

/**
 * The real check function other code can call before treating a delegate's
 * action as authorized on the delegator's behalf: does ANY active
 * delegation grant `userId` (holding `userRoleKeys`, typically just
 * [dbUser.role]) authority over (scopeType, scopeId) in this org? Checks
 * both a scopeId-specific grant and a scopeType-level grant (scopeId
 * IS NULL, "delegated for every X"), mirroring
 * approval-preference-service.ts's checkApprovalPreference precedent for
 * most-specific-scope-wins lookups.
 *
 * Takes an already-open TenantDb (like checkApprovalPreference does) so a
 * caller already inside its own withTenantContext transaction (e.g.
 * task-service.ts's createTask) can call this without opening a second,
 * nested transaction. A caller with no open transaction should wrap this
 * in withTenantContext itself, same as every other db-param service
 * function in this codebase.
 */
export async function isDelegated(
  db: TenantDb, orgId: string,
  scopeType: DelegationScopeType, scopeId: string | undefined,
  userId: string, userRoleKeys: string[] = []
): Promise<boolean> {
  const now = new Date()
  const candidates = await db.query.scopedDelegations.findMany({
    where: and(
      eq(scopedDelegations.orgId, orgId),
      eq(scopedDelegations.scopeType, scopeType),
      isNull(scopedDelegations.revokedAt),
      scopeId ? or(eq(scopedDelegations.scopeId, scopeId), isNull(scopedDelegations.scopeId)) : isNull(scopedDelegations.scopeId)
    ),
  })
  return candidates.some((d) => isDelegationActive(d, now) && delegationGrantsUser(d, userId, userRoleKeys))
}
