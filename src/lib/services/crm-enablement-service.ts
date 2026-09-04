// Priority 12 (OPEN-07 point 8, Owner directive 2026-07-13): org-level
// enablement of the pre-existing 'sales' product branch (VERI SALES AI OS,
// in product_branches since Wave 106, status='planned' in the catalog but
// its CRM surface -- crm/leads, crm/opportunities -- has been live and
// unenforced this whole time). Same thin-wrapper shape as erp-enablement-
// service.ts/firm-enablement-service.ts; branchKey is 'sales' to match the
// product_branches catalog row, file is named crm- to match the API surface
// it actually gates (src/app/api/crm/**). sales-hq (the Rajat-only partner/
// channel portal) is a separate, already admin-gated surface -- deliberately
// NOT gated by this, since it isn't an org-purchasable module.
import {
  enableProductBranchForOrg,
  disableProductBranchForOrg,
  isBranchEnabledForOrg,
  isBranchEnabledForOrgWithDb,
  getBranchEnablement,
  type BranchEnablementContext,
  ServiceError,
} from "./product-branch-service"
import type { TenantDb } from "@/lib/db/tenant-scoped"
export { ServiceError }

export type SalesContext = BranchEnablementContext

export async function isSalesEnabledForOrg(orgId: string): Promise<boolean> {
  return isBranchEnabledForOrg(orgId, "sales")
}

/** R74 Phase 10 fix: db-handle-accepting variant -- see isBranchEnabledForOrgWithDb's own comment in product-branch-service.ts. */
export async function isSalesEnabledForOrgWithDb(db: TenantDb, orgId: string): Promise<boolean> {
  return isBranchEnabledForOrgWithDb(db, orgId, "sales")
}

// Owner's exact wording (2026-07-13, OPEN-07 decision c) -- see
// erp-enablement-service.ts for the same template applied to ERP.
/** Shared 403 gate every Sales/CRM service/route calls first. */
export async function requireSalesEnabled(orgId: string): Promise<void> {
  if (!(await isSalesEnabledForOrg(orgId))) {
    throw new ServiceError(
      "This capability is not part of the Module your organization purchased. Please contact your organization's administrator. This capability is already in the Sales module.",
      403
    )
  }
}

export async function getSalesEnablement(ctx: { orgId: string }) {
  return getBranchEnablement(ctx, "sales")
}

export async function enableSalesForOrg(ctx: SalesContext) {
  return enableProductBranchForOrg(ctx, "sales")
}

export async function disableSalesForOrg(ctx: SalesContext) {
  return disableProductBranchForOrg(ctx, "sales")
}
