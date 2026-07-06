// Wave 108 (THE FIRM AI OS) -- org-level enablement of the 'the_firm'
// product branch. Thin wrapper over product-branch-service.ts (Wave 106's
// generic mechanism), following the exact shape fm-enablement-service.ts
// and pms-enablement-service.ts already demonstrate.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
export { ServiceError }

export type FirmContext = BranchEnablementContext

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
