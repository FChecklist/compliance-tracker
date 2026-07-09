// Wave 108 (THE FIRM AI OS) -- org-level enablement of the 'the_firm'
// product branch. Thin wrapper over product-branch-service.ts (Wave 106's
// generic mechanism), following the exact shape fm-enablement-service.ts
// and pms-enablement-service.ts already demonstrate.
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import type { users } from "@/lib/db"
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
import { resolveAccessibleClientIds } from "./client-access-service"
export { ServiceError }

export type FirmContext = BranchEnablementContext

// Gap closure, 2026-07-09 (CRITICAL_GAPS.md #2): the shared entry point
// every other firm-*-service.ts file now goes through instead of calling
// withTenantContext directly. Resolves the caller's accessible client set
// once per call and threads it into the same GUC-based mechanism RLS reads
// -- a forgotten client_id filter in a query is now caught by Postgres the
// same way a forgotten org_id filter already was.
export type FirmServiceContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function withFirmTenantContext<T>(
  ctx: FirmServiceContext,
  fn: (db: TenantDb) => Promise<T>
): Promise<T> {
  const clientIds = await resolveAccessibleClientIds(ctx.orgId, ctx.dbUser)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId, clientIds }, fn)
}

// No org-owned defaults to seed on enable -- service-line/rate/staff-
// assignment rows are all created explicitly by the user per client, none
// of it is a platform-owned library the way FM's checklist templates are.
async function seedNothing(_db: TenantDb, _orgId: string): Promise<void> {
  /* no-op */
}

export async function isFirmEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, "the_firm")
}

/** Shared 403 gate every THE FIRM service/route calls first. */
export async function requireFirmEnabled(orgId: string): Promise<void> {
  if (!(await isFirmEnabledForOrg(orgId))) {
    throw new ServiceError("THE FIRM AI OS is not enabled for this organisation", 403)
  }
}

export async function getFirmEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, "the_firm")
}

export async function enableFirmForOrg(ctx: FirmContext) {
  return enableProductBranchForOrg(ctx, "the_firm", seedNothing)
}

export async function disableFirmForOrg(ctx: FirmContext) {
  return disableProductBranchForOrg(ctx, "the_firm")
}
