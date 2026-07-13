// Wave 67 (multi-entity/consolidation, the biggest architectural gap for
// a Rs 1000cr group identified against the ERPNext Company doctype as
// reference): erp_companies is a legal entity WITHIN an org's ERP,
// distinct from the org (VERIDIAN tenant) itself. Chart of accounts stays
// shared across an org's companies; consolidation is computed here at
// report-runtime by walking the company tree, never a stored "group GL".
import { erpCompanies, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listCompanies(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpCompanies.findMany({ where: eq(erpCompanies.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.companyName) })
  })
}

export type CompanyInput = {
  companyName: string
  abbr?: string
  parentCompanyId?: string
  isGroup?: boolean
  defaultCurrencyId?: string
  country?: string
  dateOfIncorporation?: string
}

export async function createCompany(ctx: ErpContext, input: CompanyInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.companyName?.trim()) throw new ServiceError("companyName is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.parentCompanyId) {
      const parent = await db.query.erpCompanies.findFirst({ where: and(eq(erpCompanies.id, input.parentCompanyId), eq(erpCompanies.orgId, ctx.orgId)) })
      if (!parent) throw new ServiceError("Parent company not found", 404)
    }
    const [company] = await db.insert(erpCompanies).values({
      orgId: ctx.orgId, companyName: input.companyName, abbr: input.abbr, parentCompanyId: input.parentCompanyId,
      isGroup: input.isGroup ?? false, defaultCurrencyId: input.defaultCurrencyId, country: input.country,
      dateOfIncorporation: input.dateOfIncorporation,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_company.created", entityType: "erp_company", entityId: company.id })
    return company
  })
}

export async function updateCompany(ctx: ErpContext, companyId: string, input: Partial<CompanyInput> & { isActive?: boolean }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.erpCompanies.findFirst({ where: and(eq(erpCompanies.id, companyId), eq(erpCompanies.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Company not found", 404)
    if (input.parentCompanyId === companyId) throw new ServiceError("A company cannot be its own parent", 400)

    const [updated] = await db.update(erpCompanies).set({
      companyName: input.companyName, abbr: input.abbr, parentCompanyId: input.parentCompanyId,
      isGroup: input.isGroup, defaultCurrencyId: input.defaultCurrencyId, country: input.country,
      dateOfIncorporation: input.dateOfIncorporation, isActive: input.isActive,
    }).where(eq(erpCompanies.id, companyId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_company.updated", entityType: "erp_company", entityId: companyId })
    return updated
  })
}

/**
 * Walks the company tree from `rootCompanyId` and returns rootCompanyId
 * plus every descendant's id -- the exact set of companies a consolidated
 * report must aggregate. Done in JS (not a recursive SQL CTE) since an
 * org's company list is small (dozens at most, never a deep/wide tree),
 * matching this codebase's existing preference for simple application-
 * layer tree walks over the recursive-CTE pattern (see the parent-chain
 * walk in document-service.ts's version history).
 */
export async function getCompanyDescendantIds(ctx: { orgId: string }, rootCompanyId: string): Promise<string[]> {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const all = await db.query.erpCompanies.findMany({ where: eq(erpCompanies.orgId, ctx.orgId) })
    const byParent = new Map<string, string[]>()
    for (const c of all) {
      if (!c.parentCompanyId) continue
      byParent.set(c.parentCompanyId, [...(byParent.get(c.parentCompanyId) ?? []), c.id])
    }
    const result: string[] = []
    const queue = [rootCompanyId]
    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)
      queue.push(...(byParent.get(current) ?? []))
    }
    return result
  })
}
