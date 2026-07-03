// Wave 26 (VERIDIAN AI PMS) service layer -- org-level enablement of the
// 'pms' product branch. Every other PMS service/route calls
// requirePmsEnabled() as its first gate; enabling seeds real, org-owned
// default issue types (copy-on-enable, per PLATFORM_STRATEGY.md §14 -- not
// a live-resolved platform catalog). Disabling never deletes data.
import { orgProductBranchEnablements, productBranches, pmsIssueTypes } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const DEFAULT_ISSUE_TYPES = [
  { name: "Task", icon: "check-square", isEpic: false, isDefault: true },
  { name: "Bug", icon: "bug", isEpic: false, isDefault: false },
  { name: "Story", icon: "bookmark", isEpic: false, isDefault: false },
  { name: "Epic", icon: "layers", isEpic: true, isDefault: false },
]

async function getPmsBranchId(db: TenantDb) {
  const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, "pms") })
  if (!branch) throw new ServiceError("PMS product branch is not registered", 500)
  return branch.id
}

export async function isPmsEnabledForOrg(orgId: string): Promise<boolean> {
  return withTenantContext({ orgId }, async (db) => {
    const branchId = await getPmsBranchId(db)
    const row = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    return row?.isEnabled ?? false
  })
}

/** Shared 403 gate every PMS service/route calls first. */
export async function requirePmsEnabled(orgId: string): Promise<void> {
  if (!(await isPmsEnabledForOrg(orgId))) {
    throw new ServiceError("VERIDIAN AI PMS is not enabled for this organisation", 403)
  }
}

export async function getPmsEnablement(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const branchId = await getPmsBranchId(db)
    const row = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    return { isEnabled: row?.isEnabled ?? false, enabledAt: row?.enabledAt ?? null, disabledAt: row?.disabledAt ?? null }
  })
}

export async function enablePmsForOrg(ctx: PmsContext) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Enabling VERIDIAN AI PMS requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const branchId = await getPmsBranchId(db)
    const existing = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })

    const now = new Date()
    if (existing) {
      await db.update(orgProductBranchEnablements)
        .set({ isEnabled: true, enabledAt: now, enabledById: ctx.userId, disabledAt: null, updatedAt: now })
        .where(eq(orgProductBranchEnablements.id, existing.id))
    } else {
      await db.insert(orgProductBranchEnablements).values({
        orgId: ctx.orgId, productBranchId: branchId, isEnabled: true, enabledAt: now, enabledById: ctx.userId,
      })
    }

    // Copy-on-enable: seed org-owned default issue types, only if this org
    // has none yet (re-enabling after a disable must not duplicate them).
    const existingTypes = await db.query.pmsIssueTypes.findMany({ where: eq(pmsIssueTypes.orgId, ctx.orgId) })
    if (existingTypes.length === 0) {
      await db.insert(pmsIssueTypes).values(DEFAULT_ISSUE_TYPES.map((t) => ({ orgId: ctx.orgId, ...t })))
    }

    return { isEnabled: true, enabledAt: now.toISOString() }
  })
}

export async function disablePmsForOrg(ctx: PmsContext) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Disabling VERIDIAN AI PMS requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const branchId = await getPmsBranchId(db)
    const existing = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    if (!existing) throw new ServiceError("PMS was never enabled for this organisation", 404)

    const now = new Date()
    await db.update(orgProductBranchEnablements)
      .set({ isEnabled: false, disabledAt: now, updatedAt: now })
      .where(eq(orgProductBranchEnablements.id, existing.id))

    return { isEnabled: false, disabledAt: now.toISOString() }
  })
}
