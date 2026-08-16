// Wave 107 (VERI FM & CS AI OS) -- org-level enablement of the
// 'facilities_management' product branch. Thin wrapper over
// product-branch-service.ts (Wave 106's generic mechanism), following the
// exact shape pms-enablement-service.ts already demonstrates.
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

export type FmContext = BranchEnablementContext

// Copy-on-enable seeds NOTHING org-owned. Unlike PMS's issue types, the FM
// checklist template library is platform-owned (org_id NULL) and already
// globally available the moment the branch is enabled -- see
// fmChecklistTemplates' schema comment for why. This no-op exists only so
// enableFmForOrg's call shape matches every other *-enablement-service.ts
// file exactly.
async function seedNothing(_db: TenantDb, _orgId: string): Promise<void> {
  /* no-op: FM's checklist template library is platform-owned, not org-seeded */
}

export async function isFmEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, "facilities_management")
}

/** Shared 403 gate every FM service/route calls first. */
export async function requireFmEnabled(orgId: string): Promise<void> {
  if (!(await isFmEnabledForOrg(orgId))) {
    throw new ServiceError("VERI FM & CS AI OS is not enabled for this organisation", 403)
  }
}

export async function getFmEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, "facilities_management")
}

export async function enableFmForOrg(ctx: FmContext) {
  return enableProductBranchForOrg(ctx, "facilities_management", seedNothing)
}

export async function disableFmForOrg(ctx: FmContext) {
  return disableProductBranchForOrg(ctx, "facilities_management")
}
