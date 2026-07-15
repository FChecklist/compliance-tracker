// Priority 12 (OPEN-07 point 8, Owner directive 2026-07-13): org-level
// enablement of the pre-existing 'erp' product branch (VERI ERP --
// Accounting/Finance/Payroll/Buying/Selling/Stock, live in product_branches
// since Wave 106/108). The branch row and org_product_branch_enablements
// mechanism already existed; nothing anywhere ever called it for ERP --
// any org could hit every ERP API regardless of package. This file is the
// same thin wrapper shape as firm-enablement-service.ts/pms-enablement-
// service.ts/fm-enablement-service.ts, not a new mechanism.
//
// Priority 19 Part 2, Workstream B (2026-07-15): root-caused via direct SQL
// (compliance.erp_fiscal_years / erp_accounts / erp_cost_centers) that
// EVERY real PROJEXA org has zero rows in all three tables -- only this
// codebase's own internal demo_org ever got a fiscal year (1 row) and a
// chart of accounts (12 rows); erp_cost_centers was empty even for
// demo_org. Root cause was exactly the comment this replaces: enabling the
// 'erp' branch never seeded anything, unlike pms-enablement-service.ts's
// seedDefaultIssueTypes precedent. That silently blocked Budgets (no
// fiscal year to attach a budget to, BudgetsClient.tsx's "Create Budget"
// button no-ops with zero network request when fiscalYearId is empty) and
// Accounting (chart-of-accounts picker stuck on a misleading "Loading…"
// placeholder) identically for every org, new or already-enabled. Fixed the
// same way PMS did it: a copy-on-enable seedFn wired into
// enableProductBranchForOrg, idempotent per-table (only seeds a table that
// is genuinely empty for this org, so re-enabling after a disable, or an
// org that already created its own fiscal year/accounts/cost centers before
// this fix shipped, never gets duplicates). Already-enabled-but-empty real
// orgs (projexa_demo_org and 2 others) were backfilled once, live, via
// Supabase MCP execute_sql -- see control/priority19_dubai_e2e_testing_plan.md's
// Workstream B section for the exact backfill queries run.
import { erpFiscalYears, erpAccounts, erpCostCenters } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
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

// Minimal, country-neutral starter chart of accounts -- deliberately not
// India-flavoured (no GST/TDS-named accounts, unlike this codebase's own
// demo_org seed data) since any org enabling ERP, on any
// `organisations.country`, lands here. accountType values match the
// lowercase convention erp-financial-report-service.ts's cash-flow
// statement and erp-invoicing-service.ts actually switch on ('bank' |
// 'cash' | 'receivable' | 'payable' | ... -- see schema.ts's own comment on
// erpAccounts.accountType), not demo_org's own capitalized ("Bank",
// "Receivable") strings, which those switches never actually match -- a
// pre-existing inconsistency in demo_org's seed data, not repeated here.
const DEFAULT_ACCOUNTS: {
  accountName: string
  rootType: "asset" | "liability" | "equity" | "income" | "expense"
  accountType?: string
}[] = [
  { accountName: "Bank Account", rootType: "asset", accountType: "bank" },
  { accountName: "Cash in Hand", rootType: "asset", accountType: "cash" },
  { accountName: "Accounts Receivable", rootType: "asset", accountType: "receivable" },
  { accountName: "Accounts Payable", rootType: "liability", accountType: "payable" },
  { accountName: "Tax Payable", rootType: "liability", accountType: "tax" },
  { accountName: "Owner's Capital", rootType: "equity", accountType: "equity" },
  { accountName: "Sales Revenue", rootType: "income", accountType: "income" },
  { accountName: "Cost of Goods Sold", rootType: "expense", accountType: "expense" },
  { accountName: "Salaries & Wages", rootType: "expense", accountType: "expense" },
  { accountName: "Rent Expense", rootType: "expense", accountType: "expense" },
  { accountName: "Office & Admin Expense", rootType: "expense", accountType: "expense" },
]

// Calendar-year default (Jan 1 - Dec 31 of the current year), not India's
// April-March convention -- demo_org's own single fiscal year uses
// April-March, but that's an India-specific convention this codebase has no
// generic assumption about (erp-financial-report-service.ts's period
// generator works off whatever start/end dates a fiscal year row actually
// has, it doesn't assume either convention). Calendar year is the more
// country-neutral default for orgs enabling ERP regardless of
// `organisations.country`.
function currentCalendarFiscalYear(): { yearName: string; startDate: string; endDate: string } {
  const year = new Date().getFullYear()
  return { yearName: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` }
}

// Copy-on-enable: seed a default fiscal year + chart of accounts + one cost
// center, each independently idempotent (only seeds a table that is
// genuinely empty for this org), matching pms-enablement-service.ts's
// seedDefaultIssueTypes "only if this org has none yet" pattern so
// re-enabling after a disable, or an org that already set up its own real
// data before this fix shipped, never gets duplicates.
async function seedDefaultErpFoundation(db: TenantDb, orgId: string): Promise<void> {
  const [existingFy, existingAccount, existingCostCenter] = await Promise.all([
    db.query.erpFiscalYears.findFirst({ where: eq(erpFiscalYears.orgId, orgId) }),
    db.query.erpAccounts.findFirst({ where: eq(erpAccounts.orgId, orgId) }),
    db.query.erpCostCenters.findFirst({ where: eq(erpCostCenters.orgId, orgId) }),
  ])

  if (!existingFy) {
    const fy = currentCalendarFiscalYear()
    await db.insert(erpFiscalYears).values({ orgId, ...fy })
  }
  if (!existingAccount) {
    await db.insert(erpAccounts).values(DEFAULT_ACCOUNTS.map((a) => ({ orgId, ...a })))
  }
  if (!existingCostCenter) {
    await db.insert(erpCostCenters).values({ orgId, name: "Head Office" })
  }
}

export async function enableErpForOrg(ctx: ErpContext) {
  return enableProductBranchForOrg(ctx, "erp", seedDefaultErpFoundation)
}

export async function disableErpForOrg(ctx: ErpContext) {
  return disableProductBranchForOrg(ctx, "erp")
}
