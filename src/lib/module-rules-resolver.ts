// Wave 21 (module reusability) -- generalizes orchestra-model-resolver.ts's
// resolveModelConfig() "most-specific-scope-wins" pattern to module
// behavior. This is the concrete mechanism behind "same module, customized
// rules per product/project/company/account/user, module evolves over
// time" instead of forking a module's schema/code per customer.
//
// Resolution chain (most-specific-first): user -> client -> project -> org
// -> productBranch -> platform. `user` is accepted for shape completeness
// but has no rule-setting API/UI yet (see module-rule-service.ts) and no
// seeded rule uses it -- most GRC rules are organizational, not personal.
//
// platform/productBranch levels use the raw `db` client (global catalog
// reads, no tenant context needed, same precedent as
// resolveModelConfig()'s own orchestraLayers reads). org/project/client
// levels use withTenantContext so RLS is the real enforcement, not just
// service-layer trust.
import { db, moduleRuleConfigs, productBranches } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

export type ModuleRuleScope = {
  orgId: string
  projectId?: string
  clientId?: string
  userId?: string
  productBranchKey?: string // defaults to 'grc' -- the only branch that exists today
}

export type ResolvedModuleRule = { value: unknown; resolvedScopeType: string }

async function findConfig(moduleKey: string, ruleKey: string, scopeType: string, scopeId: string | null) {
  return db.query.moduleRuleConfigs.findFirst({
    where: and(
      eq(moduleRuleConfigs.moduleKey, moduleKey),
      eq(moduleRuleConfigs.ruleKey, ruleKey),
      eq(moduleRuleConfigs.scopeType, scopeType),
      eq(moduleRuleConfigs.isActive, true),
      scopeId === null ? undefined : eq(moduleRuleConfigs.scopeId, scopeId)
    ),
  })
}

export async function resolveModuleRule(
  moduleKey: string,
  ruleKey: string,
  scope: ModuleRuleScope
): Promise<ResolvedModuleRule | null> {
  // user/client/project levels go through withTenantContext so RLS gates
  // what's actually visible -- a caller can never resolve another org's
  // override even if it (somehow) shared the same scope id by coincidence.
  if (scope.userId) {
    const row = await withTenantContext({ orgId: scope.orgId, userId: scope.userId }, (tx) => findConfigTx(tx, moduleKey, ruleKey, "user", scope.userId!))
    if (row) return { value: row.ruleValue, resolvedScopeType: "user" }
  }
  if (scope.clientId) {
    const row = await withTenantContext({ orgId: scope.orgId, userId: scope.userId }, (tx) => findConfigTx(tx, moduleKey, ruleKey, "client", scope.clientId!))
    if (row) return { value: row.ruleValue, resolvedScopeType: "client" }
  }
  if (scope.projectId) {
    const row = await withTenantContext({ orgId: scope.orgId, userId: scope.userId }, (tx) => findConfigTx(tx, moduleKey, ruleKey, "project", scope.projectId!))
    if (row) return { value: row.ruleValue, resolvedScopeType: "project" }
  }
  {
    const row = await withTenantContext({ orgId: scope.orgId, userId: scope.userId }, (tx) => findConfigTx(tx, moduleKey, ruleKey, "org", scope.orgId))
    if (row) return { value: row.ruleValue, resolvedScopeType: "org" }
  }

  const branchKey = scope.productBranchKey ?? "grc"
  const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, branchKey) })
  if (branch) {
    const row = await findConfig(moduleKey, ruleKey, "product_branch", branch.id)
    if (row) return { value: row.ruleValue, resolvedScopeType: "product_branch" }
  }

  const platformRow = await findConfig(moduleKey, ruleKey, "platform", null)
  if (platformRow) return { value: platformRow.ruleValue, resolvedScopeType: "platform" }

  return null
}

// withTenantContext hands the callback a tenant-scoped drizzle instance
// (RLS-enforced); this small helper reuses the same query shape as
// findConfig() above but against that scoped `tx` instead of the raw `db`.
async function findConfigTx(
  tx: TenantDb,
  moduleKey: string,
  ruleKey: string,
  scopeType: string,
  scopeId: string
) {
  return tx.query.moduleRuleConfigs.findFirst({
    where: and(
      eq(moduleRuleConfigs.moduleKey, moduleKey),
      eq(moduleRuleConfigs.ruleKey, ruleKey),
      eq(moduleRuleConfigs.scopeType, scopeType),
      eq(moduleRuleConfigs.scopeId, scopeId),
      eq(moduleRuleConfigs.isActive, true)
    ),
  })
}
