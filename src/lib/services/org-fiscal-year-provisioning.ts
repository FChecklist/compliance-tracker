// R67 lane I (WS-I item I-03) -- no organisation is ever born unable to make
// a budget.
//
// THE REAL DEFECT: PROJEXA's Annual Budget create screen needs a fiscal year
// AND at least one account before its Save can be enabled (see
// BudgetCreateClient's fiscal-years/cost-centers/accounts/companies loads, and
// correction C-15: "the block is an org-setup precondition surfaced correctly
// (disabled-with-reason), but the reason is a paragraph inside a button").
// org-provisioning-service.ts seeds a currency, a department and two product-
// branch enablements for a new org -- but never a fiscal year and never a
// chart of accounts. So every organisation, including the demo one every
// prospect is shown, is created in a state where the Budget chain cannot be
// exercised at all: create -> object -> edit -> submit is blocked at step one,
// and no screenshot of it was ever possible.
//
// Two halves, deliberately separated:
//   * this module -- the CODE half, called from provisionOrganisation() so no
//     FUTURE org is born blocked. Non-fatal by design (see below).
//   * drizzle/0530_r67_i03_boq_amounts_demo_fiscal_year.sql -- the DATA half,
//     which back-fills the ALREADY-created demo organisation
//     (democeo@projexa-ai.com). Code cannot fix an org that already exists.
//
// WHY THE HOOK IS NON-FATAL: it matches the exact posture of every other
// seeding block in provisionOrganisation() (base currency, VERI Treasure,
// VERI Chat v2) -- a failure here must never strand a tenant that is otherwise
// fully created. A missing fiscal year degrades to the same
// disabled-with-reason Budget screen the product already handles honestly; a
// half-provisioned tenant with no department and no user does not.
//
// WHY A CALENDAR YEAR: erpFiscalYears carries no start-month setting anywhere
// in this codebase (checked: the table is yearName/startDate/endDate/isClosed
// only), so there is no per-org preference to read and none is invented here.
// A calendar year is the honest default and an admin can create the real one
// alongside it -- this seeds a year, it never deletes or rewrites one.
import { erpAccounts, erpFiscalYears } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

export type FiscalYearWindow = {
  yearName: string
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
}

/**
 * The calendar-year fiscal window containing `now`, in UTC. UTC deliberately:
 * erpFiscalYears.startDate/endDate are `date` columns with mode 'string' and
 * carry no timezone, so reading the local year would make a new org created at
 * 23:30 on 31 December in Dubai land in the wrong fiscal year depending only on
 * which machine ran the provisioning.
 */
export function currentFiscalYearWindow(now: Date = new Date()): FiscalYearWindow {
  const year = now.getUTCFullYear()
  return { yearName: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` }
}

export type SeedAccount = {
  accountNumber: string
  accountName: string
  rootType: "asset" | "liability" | "equity" | "income" | "expense"
  accountType: string | null
  isGroup: boolean
}

/**
 * The minimal chart of accounts a new organisation starts with: one group node
 * per root type on the balance-sheet side, plus the three postable P&L
 * accounts a construction budget actually needs. Six rows, not sixty -- this
 * is the smallest set that makes the Budget chain runnable, not an attempt to
 * ship a real accountant's CoA (that is the org's own to build; nothing here
 * blocks or replaces it).
 *
 * Direct Costs and Overheads are separate because a construction budget line
 * is always one or the other, and the Budget vs Actual report's byHead
 * breakdown is meaningless if everything posts to a single "Expenses" row.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly SeedAccount[] = [
  { accountNumber: "1000", accountName: "Assets", rootType: "asset", accountType: null, isGroup: true },
  { accountNumber: "2000", accountName: "Liabilities", rootType: "liability", accountType: null, isGroup: true },
  { accountNumber: "3000", accountName: "Equity", rootType: "equity", accountType: null, isGroup: true },
  { accountNumber: "4000", accountName: "Revenue", rootType: "income", accountType: "income", isGroup: false },
  { accountNumber: "5000", accountName: "Direct Costs", rootType: "expense", accountType: "expense", isGroup: false },
  { accountNumber: "6000", accountName: "Overheads", rootType: "expense", accountType: "expense", isGroup: false },
]

export type FiscalYearProvisioningResult = {
  fiscalYearCreated: boolean
  accountsCreated: number
}

/**
 * Seeds the current fiscal year and DEFAULT_CHART_OF_ACCOUNTS for `orgId`.
 *
 * INSERT-ONLY AND IDEMPOTENT. Nothing is ever updated or deleted: an existing
 * fiscal year with the same yearName, or an existing account with the same
 * accountNumber, is left exactly as it is and skipped. Re-running is a no-op,
 * which is what makes it safe to call from provisioning AND to back-fill an
 * org by hand.
 *
 * Guarded with an existence check rather than ON CONFLICT DO NOTHING on
 * purpose: neither erp_fiscal_years nor erp_accounts has a unique constraint on
 * (org_id, name/number) today, and ADDING one would have to hold over every
 * existing customer's already-entered accounts -- a real risk of a failing
 * migration on live data for no benefit here. See
 * drizzle/0530_r67_i03_boq_amounts_demo_fiscal_year.sql, whose seed statements
 * use the same NOT EXISTS shape for the same reason.
 */
export async function provisionFiscalYearAndAccounts(
  orgId: string,
  now: Date = new Date()
): Promise<FiscalYearProvisioningResult> {
  const window = currentFiscalYearWindow(now)

  return withTenantContext({ orgId }, async (db) => {
    let fiscalYearCreated = false
    const existingYear = await db.query.erpFiscalYears.findFirst({
      where: and(eq(erpFiscalYears.orgId, orgId), eq(erpFiscalYears.yearName, window.yearName)),
    })
    if (!existingYear) {
      await db.insert(erpFiscalYears).values({
        orgId,
        yearName: window.yearName,
        startDate: window.startDate,
        endDate: window.endDate,
        isClosed: false,
      })
      fiscalYearCreated = true
    }

    const existingAccounts = await db.query.erpAccounts.findMany({
      where: eq(erpAccounts.orgId, orgId),
      columns: { accountNumber: true },
    })
    const takenNumbers = new Set(existingAccounts.map((a) => a.accountNumber).filter((n): n is string => !!n))
    const missing = DEFAULT_CHART_OF_ACCOUNTS.filter((a) => !takenNumbers.has(a.accountNumber))
    if (missing.length > 0) {
      await db.insert(erpAccounts).values(
        missing.map((a) => ({
          orgId,
          accountName: a.accountName,
          accountNumber: a.accountNumber,
          rootType: a.rootType,
          accountType: a.accountType,
          isGroup: a.isGroup,
        }))
      )
    }

    return { fiscalYearCreated, accountsCreated: missing.length }
  })
}
