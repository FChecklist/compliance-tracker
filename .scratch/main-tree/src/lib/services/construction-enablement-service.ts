// Priority 12 (OPEN-07 point 8 follow-on, 2026-07-14): org-level enablement
// of the pre-existing 'construction' product branch (VERI Construction /
// PROJEXA, in product_branches since Wave 106/108, status='building'). Same
// gap shape as ERP/Sales before PR #282: the branch row and
// org_product_branch_enablements mechanism already existed, but nothing
// ever called it for construction -- construction-reports-service.ts's 17
// report functions and the generic Reports & Analysis Engine dispatcher both
// ran for any org regardless of package. This file is the same thin wrapper
// shape as erp-enablement-service.ts/crm-enablement-service.ts, not a new
// mechanism.
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
export { ServiceError }

export type ConstructionContext = BranchEnablementContext

export async function isConstructionEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, "construction")
}

// Owner's exact wording (2026-07-13, OPEN-07 decision c) -- see
// erp-enablement-service.ts for the same template applied to ERP.
/** Shared 403 gate every construction/PROJEXA report or service call uses first. */
export async function requireConstructionEnabled(orgId: string): Promise<void> {
  if (!(await isConstructionEnabledForOrg(orgId))) {
    throw new ServiceError(
      "This capability is not part of the Module your organization purchased. Please contact your organization's administrator. This capability is already in the Construction module.",
      403
    )
  }
}

export async function getConstructionEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, "construction")
}

// No org-owned defaults to seed on enable -- construction has no equivalent
// of PMS's default issue types; BOQs/categories/activities are created
// explicitly by the org, not a platform-owned template library.
export async function enableConstructionForOrg(ctx: ConstructionContext) {
  return enableProductBranchForOrg(ctx, "construction")
}

export async function disableConstructionForOrg(ctx: ConstructionContext) {
  return disableProductBranchForOrg(ctx, "construction")
}
