// Wave 21 (module reusability) service layer -- lets an org/project/client
// admin set a module-rule override without any code change, resolved via
// module-rules-resolver.ts's most-specific-scope-wins chain.
//
// scope_type='user' is deliberately rejected here: the resolver supports it
// for shape completeness, but no rule-setting UI/API exists for it yet --
// most GRC rules are organizational, not personal (see
// module-rules-resolver.ts's own note). platform/product_branch scope is
// also rejected here -- only service_role (a migration) may write those,
// same discipline as worker_agents' tier='global' write-exclusion.
import { moduleRuleConfigs, moduleRegistry } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, type SQL } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type ModuleRuleContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const WRITABLE_SCOPE_TYPES = new Set(["org", "project", "client"])

export async function setModuleRule(
  ctx: ModuleRuleContext,
  input: { moduleKey: string; ruleKey: string; ruleValue: unknown; scopeType: string; scopeId: string }
) {
  if (!WRITABLE_SCOPE_TYPES.has(input.scopeType)) {
    throw new ServiceError(
      `scopeType must be one of: ${[...WRITABLE_SCOPE_TYPES].join(", ")} (platform/product_branch defaults are migration-managed; user-scoped rules aren't supported yet)`,
      400
    )
  }
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Setting a module rule requires admin role or higher", 403)
  if (!input.moduleKey?.trim() || !input.ruleKey?.trim()) throw new ServiceError("moduleKey and ruleKey are required", 400)
  if (!input.scopeId?.trim()) throw new ServiceError("scopeId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const moduleRow = await db.query.moduleRegistry.findFirst({ where: eq(moduleRegistry.moduleKey, input.moduleKey) })
    if (!moduleRow) throw new ServiceError("Unknown moduleKey", 404)

    const existing = await db.query.moduleRuleConfigs.findFirst({
      where: and(
        eq(moduleRuleConfigs.moduleKey, input.moduleKey),
        eq(moduleRuleConfigs.ruleKey, input.ruleKey),
        eq(moduleRuleConfigs.scopeType, input.scopeType),
        eq(moduleRuleConfigs.scopeId, input.scopeId)
      ),
    })

    const [row] = existing
      ? await db.update(moduleRuleConfigs).set({ ruleValue: input.ruleValue as object, updatedAt: new Date() })
          .where(eq(moduleRuleConfigs.id, existing.id)).returning()
      : await db.insert(moduleRuleConfigs).values({
          moduleKey: input.moduleKey, ruleKey: input.ruleKey, ruleValue: input.ruleValue as object,
          scopeType: input.scopeType, scopeId: input.scopeId, createdById: ctx.userId,
        }).returning()

    return { id: row.id, moduleKey: row.moduleKey, ruleKey: row.ruleKey, ruleValue: row.ruleValue, scopeType: row.scopeType, scopeId: row.scopeId }
  })
}

export async function listModuleRules(ctx: { orgId: string; userId?: string }, filters: { moduleKey?: string; scopeType?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) => {
    const conditions: SQL[] = []
    if (filters.moduleKey) conditions.push(eq(moduleRuleConfigs.moduleKey, filters.moduleKey))
    if (filters.scopeType) conditions.push(eq(moduleRuleConfigs.scopeType, filters.scopeType))
    return db.query.moduleRuleConfigs.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: (t, { desc }) => desc(t.updatedAt),
    })
  })
}
