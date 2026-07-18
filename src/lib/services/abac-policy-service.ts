// VERIDIAN Review Framework gap-closure (2026-07-18), "ABAC / Fine-Grained
// Policies" -- Critical: "No attribute-based access control exists; RBAC
// only." This is the general-purpose overlay: an org admin can define
// deny-only policies keyed on {resourceType, action} that fire when a set
// of AND-combined resource/actor/environment attributes match (src/lib/
// abac.ts), narrowing what an RBAC-permitted actor may still do without
// inventing a second, competing access-control system.
//
// Deliberately DENY-ONLY (no 'allow' effect): RBAC (auth-guard.ts's
// hasRole/requireRole, permission-service.ts's ERP_ACTION_ROLES) remains the
// single source of truth for what is grantable at all -- this layer can only
// ever subtract from that, never add to it. A misconfigured or malicious
// row here can block a legitimate action (a real but recoverable ops
// annoyance); it can never grant one RBAC itself would have refused. That
// asymmetry is the actual security property: this module is safe to expose
// to org-admin-level configuration without becoming a privilege-escalation
// surface.
//
// Fail-open on missing attribute data by design (unknownField: "no_match"):
// this is a SUPPLEMENTARY layer over an action RBAC has already permitted --
// if the caller didn't supply an attribute a policy depends on, that policy
// simply doesn't fire (behaves as if it didn't exist), it never blocks on
// data it was never given. Callers that want a specific attribute enforced
// must actually pass it.
import { abacPolicies, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, asc } from "drizzle-orm"
import { evaluateAttributeConditions, type AttributeCondition } from "@/lib/abac"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type AbacWriteContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type AbacCheckParams = {
  resourceType: string
  action: string
  /** Real attributes of the resource/actor/environment being evaluated -- e.g. { amount, department, region, approverRole }. Only attributes the caller actually supplies can ever cause a policy to fire. */
  attributes: Record<string, unknown>
}

export type AbacCheckResult =
  | { denied: false }
  | { denied: true; policyId: string; reason: string }

/** Lists an org's ABAC deny policies, most-specific (lowest priority number) first, for the admin management UI. */
export async function listAbacPolicies(ctx: { orgId: string }, resourceType?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.abacPolicies.findMany({
      where: resourceType
        ? and(eq(abacPolicies.orgId, ctx.orgId), eq(abacPolicies.resourceType, resourceType))
        : eq(abacPolicies.orgId, ctx.orgId),
      orderBy: [asc(abacPolicies.priority), asc(abacPolicies.createdAt)],
    })
  })
}

export type CreateAbacPolicyInput = {
  resourceType: string
  action: string
  conditions: AttributeCondition[]
  description?: string
  priority?: number
}

const VALID_OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq", "neq", "in", "contains"])

function validateConditions(conditions: AttributeCondition[]): void {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new ServiceError("At least one condition is required", 400)
  }
  for (const c of conditions) {
    if (!c.field?.trim()) throw new ServiceError("Every condition needs a non-empty field", 400)
    if (!VALID_OPERATORS.has(c.operator)) throw new ServiceError(`Invalid operator: ${c.operator}`, 400)
    if (c.value === undefined || c.value === null) throw new ServiceError("Every condition needs a value", 400)
  }
}

export async function createAbacPolicy(
  ctx: AbacWriteContext,
  input: CreateAbacPolicyInput
) {
  if (!input.resourceType?.trim()) throw new ServiceError("resourceType is required", 400)
  if (!input.action?.trim()) throw new ServiceError("action is required", 400)
  validateConditions(input.conditions)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [policy] = await db.insert(abacPolicies).values({
      orgId: ctx.orgId,
      resourceType: input.resourceType,
      action: input.action,
      conditions: input.conditions,
      description: input.description ?? null,
      priority: input.priority ?? 100,
      createdById: ctx.userId,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "abac_policy.created", entityType: "abac_policy", entityId: policy.id })
    return policy
  })
}

export async function setAbacPolicyActive(
  ctx: AbacWriteContext,
  policyId: string,
  isActive: boolean
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(abacPolicies)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(abacPolicies.id, policyId), eq(abacPolicies.orgId, ctx.orgId)))
      .returning()
    if (!updated) throw new ServiceError("Policy not found", 404)
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: isActive ? "abac_policy.enabled" : "abac_policy.disabled", entityType: "abac_policy", entityId: policyId })
    return updated
  })
}

/**
 * The actual enforcement call, DB-accepting variant -- takes an
 * already-open TenantDb rather than opening its own withTenantContext
 * transaction. Matches erp-invoicing-service.ts's exported findControlAccount
 * precedent: a call site that is ALREADY inside its own withTenantContext
 * (e.g. approval-workflow-service.ts's decideApprovalStep) must reuse that
 * same transaction rather than nesting a second db.transaction() on this
 * codebase's single-connection (max: 1) pool, which would otherwise
 * deadlock waiting on a connection the outer transaction is still holding.
 * Evaluates every active deny policy for {orgId, resourceType, action}
 * against the supplied attributes and returns the FIRST match (ordered by
 * priority) -- a deny-only engine only needs to know whether at least one
 * policy fires, not every one that does.
 */
export async function checkAbacDenyPoliciesWithDb(db: TenantDb, orgId: string, params: AbacCheckParams): Promise<AbacCheckResult> {
  const policies = await db.query.abacPolicies.findMany({
    where: and(
      eq(abacPolicies.orgId, orgId),
      eq(abacPolicies.resourceType, params.resourceType),
      eq(abacPolicies.action, params.action),
      eq(abacPolicies.isActive, true),
    ),
    orderBy: [asc(abacPolicies.priority), asc(abacPolicies.createdAt)],
  })

  for (const policy of policies) {
    const conditions = (Array.isArray(policy.conditions) ? policy.conditions : []) as AttributeCondition[]
    if (conditions.length === 0) continue // a policy with no conditions can never fire -- nothing to gate on, not an unconditional deny
    if (evaluateAttributeConditions(conditions, params.attributes, { unknownField: "no_match" })) {
      return { denied: true, policyId: policy.id, reason: policy.description ?? `Denied by ABAC policy on ${params.resourceType}.${params.action}` }
    }
  }
  return { denied: false }
}

/** Standalone variant for callers with no already-open transaction -- opens its own withTenantContext. */
export async function checkAbacDenyPolicies(ctx: { orgId: string }, params: AbacCheckParams): Promise<AbacCheckResult> {
  return withTenantContext({ orgId: ctx.orgId }, (db) => checkAbacDenyPoliciesWithDb(db, ctx.orgId, params))
}

/** Throwing convenience wrapper for call sites that want a single line -- mirrors requireRole()'s throw-on-failure ergonomics. */
export async function requireAbacAllowed(ctx: { orgId: string }, params: AbacCheckParams): Promise<void> {
  const result = await checkAbacDenyPolicies(ctx, params)
  if (result.denied) throw new ServiceError(result.reason, 403)
}
