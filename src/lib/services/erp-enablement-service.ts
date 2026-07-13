// Priority 12 (OPEN-07 point 8, Owner directive 2026-07-13): org-level
// enablement of the pre-existing 'erp' product branch (VERI ERP --
// Accounting/Finance/Payroll/Buying/Selling/Stock, live in product_branches
// since Wave 106/108). The branch row and org_product_branch_enablements
// mechanism already existed; nothing anywhere ever called it for ERP --
// any org could hit every ERP API regardless of package. This file is the
// same thin wrapper shape as firm-enablement-service.ts/pms-enablement-
// service.ts/fm-enablement-service.ts, not a new mechanism.
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
export { ServiceError }

export type ErpContext = BranchEnablementContext

export async function isErpEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, "erp")
}

// Owner's exact wording (2026-07-13, OPEN-07 decision c): a polite,
// specific 403 -- never a generic "Forbidden" -- naming the module the
// capability actually lives in, so an admin knows what to purchase/enable.
/** Shared 403 gate every ERP service/route calls first. */
export async function requireErpEnabled(orgId: string): Promise<void> {
  if (!(await isErpEnabledForOrg(orgId))) {
    throw new ServiceError(
      "This capability is not part of the Module your organization purchased. Please contact your organization's administrator. This capability is already in the ERP module.",
      403
    )
  }
}

export async function getErpEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, "erp")
}

// No org-owned defaults to seed on enable -- ERP has no equivalent of PMS's
// default issue types; chart of accounts/companies are created explicitly
// by the org, not a platform-owned template library.
export async function enableErpForOrg(ctx: ErpContext) {
  return enableProductBranchForOrg(ctx, "erp")
}

export async function disableErpForOrg(ctx: ErpContext) {
  return disableProductBranchForOrg(ctx, "erp")
}
