// Wave 20 (module reusability): read-only Module Registry + Product-Branch
// catalog service. Global-read tables (no org scoping, same posture as
// orchestra_layers) -- uses the raw `db` client, same precedent as
// orchestra-model-resolver.ts's own orchestraLayers reads. Catalog
// mutation is a migration-only, Layer-1 action; no create/update/delete is
// exposed here.
import { db, moduleRegistry, productBranches, productBranchModules } from "@/lib/db"
import { and, eq, type SQL } from "drizzle-orm"

export async function listModules(filters?: { domain?: string; category?: string; isActive?: boolean }) {
  const conditions: SQL[] = []
  if (filters?.domain) conditions.push(eq(moduleRegistry.domain, filters.domain))
  if (filters?.category) conditions.push(eq(moduleRegistry.category, filters.category))
  if (filters?.isActive !== undefined) conditions.push(eq(moduleRegistry.isActive, filters.isActive))

  return db.query.moduleRegistry.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (t, { asc }) => [asc(t.category), asc(t.displayName)],
  })
}

export async function getModule(moduleKey: string) {
  return db.query.moduleRegistry.findFirst({ where: eq(moduleRegistry.moduleKey, moduleKey) })
}

export async function listEnabledModulesForBranch(branchKey: string) {
  const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, branchKey) })
  if (!branch) return null

  const enablements = await db.query.productBranchModules.findMany({
    where: and(eq(productBranchModules.productBranchId, branch.id), eq(productBranchModules.isEnabled, true)),
  })
  const moduleKeys = enablements.map((e) => e.moduleKey)
  if (moduleKeys.length === 0) return { branch, modules: [] }

  const modules = await db.query.moduleRegistry.findMany({
    where: (t, { inArray }) => inArray(t.moduleKey, moduleKeys),
    orderBy: (t, { asc }) => [asc(t.category), asc(t.displayName)],
  })
  return { branch, modules }
}
