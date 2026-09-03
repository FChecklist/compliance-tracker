// R67 F-08 (R-112) -- sibling test for erp-budget-service.ts.
//
// PROJEXA's Budgets list showed a name and a status and nothing else, because
// listBudgets returned bare erp_budgets rows: the money lives in
// erp_budget_line_items and the year's name in erp_fiscal_years. The obvious
// wrong fix is a getBudget() per row -- an N+1 of transactions against a
// 5-connection pool, the exact fault R67 F-04 removed from /scope. So the two
// fields are folded on from batched reads inside the one transaction
// listBudgets already holds, and attachBudgetListFields() is that fold.
//
// This file pins the fold's honesty rules (what a missing total or an
// unresolvable fiscal year renders as) directly, and then proves the DB path
// really does issue a constant number of queries regardless of row count --
// mocking only @/lib/db/tenant-scoped, the same "capture the real module,
// restore it in afterEach" shape as construction-reports-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import { attachBudgetListFields } from "./erp-budget-service"

const BUDGETS = [
  { id: "b1", name: "FY26 Site Works", fiscalYearId: "fy1", status: "approved" },
  { id: "b2", name: "FY26 Fit-out", fiscalYearId: "fy1", status: "draft" },
  { id: "b3", name: "Legacy", fiscalYearId: "fy-gone", status: "draft" },
]

describe("attachBudgetListFields", () => {
  test("folds the grouped total and the year name onto each row without touching the row's own fields", () => {
    const rows = attachBudgetListFields(
      BUDGETS,
      [{ budgetId: "b1", total: "125000.50" }, { budgetId: "b2", total: 4000 }],
      [{ id: "fy1", yearName: "FY 2026" }]
    )

    expect(rows[0]).toEqual({ ...BUDGETS[0], annualAmount: 125000.5, fiscalYearName: "FY 2026" })
    expect(rows[1]).toEqual({ ...BUDGETS[1], annualAmount: 4000, fiscalYearName: "FY 2026" })
  })

  test("a budget with no line items is 0, not blank -- it is a real budget nothing has been allocated to yet", () => {
    const rows = attachBudgetListFields([BUDGETS[0]], [], [{ id: "fy1", yearName: "FY 2026" }])
    expect(rows[0].annualAmount).toBe(0)
  })

  test("an unresolvable fiscal year is null, NEVER the raw id -- an opaque id where a year name belongs looks like data", () => {
    const rows = attachBudgetListFields([BUDGETS[2]], [], [{ id: "fy1", yearName: "FY 2026" }])
    expect(rows[0].fiscalYearName).toBeNull()
  })

  test("a null total from coalesce/sum still reads as 0", () => {
    const rows = attachBudgetListFields([BUDGETS[0]], [{ budgetId: "b1", total: null }], [])
    expect(rows[0].annualAmount).toBe(0)
  })

  test("row order is preserved -- the list's createdAt DESC ordering is not re-sorted by the fold", () => {
    const rows = attachBudgetListFields(BUDGETS, [], [])
    expect(rows.map((r) => r.id)).toEqual(["b1", "b2", "b3"])
  })

  test("an empty budget list folds to an empty list, never a crash", () => {
    expect(attachBudgetListFields([], [{ budgetId: "b1", total: "1" }], [{ id: "fy1", yearName: "FY 2026" }])).toEqual([])
  })
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realErpEnablement = await import("./erp-enablement-service")

describe("listBudgets: constant query count, one transaction", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./erp-enablement-service", () => realErpEnablement)
  })

  async function runWith(budgets: unknown[]) {
    const groupBy = mock(async () => [{ budgetId: "b1", total: "1000" }])
    const fiscalYearsFindMany = mock(async () => [{ id: "fy1", yearName: "FY 2026" }])
    const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
      fn({
        query: {
          erpBudgets: { findMany: mock(async () => budgets) },
          erpFiscalYears: { findMany: fiscalYearsFindMany },
        },
        select: () => ({ from: () => ({ where: () => ({ groupBy }) }) }),
      })
    )
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext }))
    await mock.module("./erp-enablement-service", () => ({
      ...realErpEnablement,
      requireErpEnabled: mock(async () => {}),
    }))

    const { listBudgets } = await import("./erp-budget-service")
    const rows = await listBudgets({ orgId: "org-1" })
    return { rows, withTenantContext, groupBy, fiscalYearsFindMany }
  }

  test("three budgets cost ONE transaction and ONE totals query -- not one per budget", async () => {
    const { rows, withTenantContext, groupBy, fiscalYearsFindMany } = await runWith(BUDGETS)

    expect(withTenantContext.mock.calls.length).toBe(1)
    expect(groupBy.mock.calls.length).toBe(1)
    expect(fiscalYearsFindMany.mock.calls.length).toBe(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ id: "b1", annualAmount: 1000, fiscalYearName: "FY 2026" })
  })

  test("an org with no budgets issues neither follow-up query", async () => {
    const { rows, groupBy, fiscalYearsFindMany } = await runWith([])

    expect(rows).toEqual([])
    expect(groupBy.mock.calls.length).toBe(0)
    expect(fiscalYearsFindMany.mock.calls.length).toBe(0)
  })
})
