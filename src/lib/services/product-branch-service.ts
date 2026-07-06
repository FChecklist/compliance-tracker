// Wave 106 (Master AI OS Registry): generic product-branch enablement,
// extracted from pms-enablement-service.ts's original PMS-only
// implementation. Every current and future "VERI X AI OS" vertical
// enables/disables itself through these functions, never a bespoke
// per-vertical copy -- see MASTER_AI_OS_ARCHITECTURE.md's module-reuse and
// branch-key rules for why. pms-enablement-service.ts is now a thin
// wrapper over this file with branchKey: "pms".
import { orgProductBranchEnablements, productBranches } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type BranchEnablementContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Copy-on-enable seeding is domain-specific (PMS seeds default issue types;
// a future vertical might seed nothing, or its own defaults) -- the
// generic enable function never knows what to seed, only that it should
// call back into whatever the vertical provides. Each seedFn owns its own
// idempotency check (PMS's own pattern: "only seed if this org has none
// yet"), since re-enabling after a disable must never duplicate rows.
export type BranchSeedFn = (db: TenantDb, orgId: string) => Promise<void>

async function getBranchId(db: TenantDb, branchKey: string): Promise<string> {
  const branch = await db.query.productBranches.findFirst({ where: eq(productBranches.branchKey, branchKey) })
  if (!branch) throw new ServiceError(`Product branch '${branchKey}' is not registered`, 500)
  return branch.id
}

// Lint-style guard for the layerKey namespacing convention (Master AI OS
// rule #5) -- not a DB constraint, since orchestraLayers.layerKey has none
// today and adding one is out of scope for this wave. Callers seeding a
// new orchestra layer for a vertical should call this before inserting.
export function assertValidLayerKey(branchKey: string, layerKey: string): void {
  if (!layerKey.startsWith(`${branchKey}_`)) {
    throw new ServiceError(
      `Orchestra layer key '${layerKey}' must be namespaced as '${branchKey}_<agent>_oa' per MASTER_AI_OS_ARCHITECTURE.md`,
      500
    )
  }
}

export async function isBranchEnabledForOrg(orgId: string, branchKey: string): Promise<boolean> {
  return withTenantContext({ orgId }, async (db) => {
    const branchId = await getBranchId(db, branchKey)
    const row = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    return row?.isEnabled ?? false
  })
}

/** Shared 403 gate every vertical's service/route calls first. */
export async function requireBranchEnabled(orgId: string, branchKey: string): Promise<void> {
  if (!(await isBranchEnabledForOrg(orgId, branchKey))) {
    throw new ServiceError(`This product branch is not enabled for this organisation`, 403)
  }
}

export async function getBranchEnablement(ctx: { orgId: string }, branchKey: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const branchId = await getBranchId(db, branchKey)
    const row = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    return { isEnabled: row?.isEnabled ?? false, enabledAt: row?.enabledAt ?? null, disabledAt: row?.disabledAt ?? null }
  })
}

export async function enableProductBranchForOrg(ctx: BranchEnablementContext, branchKey: string, seedFn?: BranchSeedFn) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Enabling a product branch requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const branchId = await getBranchId(db, branchKey)
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

    if (seedFn) await seedFn(db, ctx.orgId)

    return { isEnabled: true, enabledAt: now.toISOString() }
  })
}

export async function disableProductBranchForOrg(ctx: BranchEnablementContext, branchKey: string) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Disabling a product branch requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const branchId = await getBranchId(db, branchKey)
    const existing = await db.query.orgProductBranchEnablements.findFirst({
      where: and(eq(orgProductBranchEnablements.orgId, ctx.orgId), eq(orgProductBranchEnablements.productBranchId, branchId)),
    })
    if (!existing) throw new ServiceError("This product branch was never enabled for this organisation", 404)

    const now = new Date()
    await db.update(orgProductBranchEnablements)
      .set({ isEnabled: false, disabledAt: now, updatedAt: now })
      .where(eq(orgProductBranchEnablements.id, existing.id))

    return { isEnabled: false, disabledAt: now.toISOString() }
  })
}
