// pm-urgent-share-leak (2026-09-12). Owner ruling D91 (claude_log id 375,
// quoted verbatim): "Any unauthenticated share token CAN NEVER CARRY COST."
//
// resolveReportShareLink() is a genuinely public, unauthenticated route (no
// session, no role check, by design -- a plain URL pasted into WhatsApp).
// It was found returning real cost/budget/variance/profit figures for BOTH
// 'project_status' (getProjectDashboard()'s budget/ledgerBudget/revenue/
// expenses/projectValue/earnedValue/percentByValue/contractValue, plus
// boqBudgetVarianceReport()'s per-line amount/rate/vendorAmount/committed/
// variance/budgetRemaining and its totals.budget/totals.vendorAmount) and
// 'attendance_summary' (attendanceSummary()'s per-trade/total labour `cost`
// and the reconciliation's costFromStatuses/costFromTrades) -- and, found in
// the same pass, the ORIGINAL 'work_progress' branch too (getBoq()'s raw
// lineItems carry rateProject, schema.ts's own "THE MOST SENSITIVE FIELD IN
// THE PRODUCT" column, plus rate/amount/vendorAmount/materialCost/
// labourCost/equipmentCost/overheadPercent/profitPercent/budgetPercentage/
// materialAmount/manpowerAmount/qtyProject/qtyContract/rateContract).
//
// This file proves, for each of the three branches, that the real service
// dependencies' cost data does NOT reach the public response -- by mocking
// each dependency to return a fixture carrying a unique, unmistakable cost
// sentinel value (999999.99 / "CONFIDENTIAL_VENDOR" / etc.) in every cost
// field the real function is known to return, then asserting the sentinel
// appears NOWHERE in the resolved response (deep key-walk, not just the
// obvious top-level fields -- a redaction that missed a nested field would
// still pass a shallow check).
//
// No live DB: lookupReportShareLinkByToken and the three report-producing
// service functions are mocked, matching this file's own established
// pattern (report-share-service.test.ts's header).
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const COST_SENTINEL = 999999.99
const VENDOR_SENTINEL = "CONFIDENTIAL_VENDOR_SENTINEL"

const BASE_LINK = {
  id: "link-1",
  orgId: "org-leak-test",
  reportType: "project_status",
  reportRef: JSON.stringify({ projectId: "proj-1", from: "2026-09-01", to: "2026-09-30" }),
  token: "tok-1",
  createdById: null,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
}

/** Every cost/budget/variance/profit field getProjectDashboard() really returns, per its own type. */
const FAKE_DASHBOARD = {
  projectId: "proj-1",
  projectName: "Villa 21",
  budget: COST_SENTINEL,
  ledgerBudget: COST_SENTINEL,
  revenue: COST_SENTINEL,
  expenses: COST_SENTINEL,
  progressPercent: 42,
  progressByActivityLogPct: 42,
  progressByBoqValuePct: 77,
  delayedTaskCount: 3,
  photoCount: 10,
  taskCount: 20,
  generatedAt: "2026-09-12T00:00:00.000Z",
  projectValue: COST_SENTINEL,
  projectValueSource: "entered" as const,
  earnedValue: COST_SENTINEL,
  percentByValue: 77,
  contractValue: COST_SENTINEL,
  permitsExpiringCount: 1,
  permitsExpiredCount: 0,
  categories: [{ categoryId: "cat-1", name: "Civil", percentComplete: 50 }],
  recentEntries: [{ id: "e1", activityId: "a1", activityName: "Slab", entryDate: "2026-09-10", quantityDone: "5", percentComplete: "50" }],
}

/** One root BOQ line, carrying every cost field toBudgetLine() really returns. */
const FAKE_BUDGET_LINE = {
  serialNumber: 1, lineItemId: "li-1", boqId: "boq-1", sNo: 1, isRootLine: true,
  code: "C-01", category: "Civil", description: "Excavation", unit: "m3", quantity: 100,
  rate: COST_SENTINEL, parentLineItemId: null, amount: COST_SENTINEL, budgetPercentage: 25,
  budget: COST_SENTINEL, materialAmount: COST_SENTINEL, manpowerAmount: COST_SENTINEL,
  vendorId: "vendor-1", vendorName: VENDOR_SENTINEL, vendorAmount: COST_SENTINEL,
  committed: COST_SENTINEL, variance: COST_SENTINEL, budgetRemaining: COST_SENTINEL,
  budgetIsDerived: false, percentOfParent: null, actual: COST_SENTINEL, revenue: COST_SENTINEL,
}

const FAKE_VARIANCE = {
  boqId: "boq-1", boqTitle: "Villa 21 BOQ", boqVersion: 1,
  lines: [FAKE_BUDGET_LINE],
  subTaskLineCount: 0,
  totalBudget: COST_SENTINEL, totalVendorAmount: COST_SENTINEL,
  totalCommitted: COST_SENTINEL, totalVariance: COST_SENTINEL, budgetRemaining: COST_SENTINEL,
  totalMaterialAmount: COST_SENTINEL, totalManpowerAmount: COST_SENTINEL,
  availableCategories: ["Civil"], availableVendors: [{ id: "vendor-1", name: VENDOR_SENTINEL }],
  filters: { categories: [], vendorId: null, groupBy: "scope" as const },
  revenueBudgetActual: { rows: [], groupBy: "scope" as const },
  categorySubtotals: [],
  totalActual: COST_SENTINEL, totalRevenue: COST_SENTINEL,
  linesOverBudget: 0, lineCount: 1,
  note: "note",
}

/** Every cost field attendanceSummary() really returns, per its own type. */
const FAKE_ATTENDANCE = {
  projectId: "proj-1", from: "2026-09-01", to: "2026-09-30",
  rows: [{ trade: "Mason", present: 5, halfDay: 1, absent: 0, workerDays: 5.5, cost: COST_SENTINEL }],
  totals: { present: 5, halfDay: 1, absent: 0, workerDays: 5.5, cost: COST_SENTINEL },
  headcount: 6,
  reconciliation: { ties: true, rowCountFromStatuses: 6, rowCountFromTrades: 6, costFromStatuses: COST_SENTINEL, costFromTrades: COST_SENTINEL },
}

/** Recursively collects every leaf value in an object/array as strings, so a sentinel embedded at ANY depth is caught. */
function collectLeafStrings(value: unknown, out: string[] = []): string[] {
  if (value === null || value === undefined) return out
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectLeafStrings(v, out)
  } else {
    out.push(String(value))
  }
  return out
}

async function mockModules(opts: {
  link: Record<string, unknown>
  dashboard?: typeof FAKE_DASHBOARD
  variance?: typeof FAKE_VARIANCE
  attendance?: typeof FAKE_ATTENDANCE
}) {
  await mock.module("@/lib/db/preauth-lookups", () => ({
    lookupReportShareLinkByToken: async () => opts.link,
  }))
  await mock.module("./construction-dashboard-service", () => ({
    getProjectDashboard: async () => opts.dashboard ?? FAKE_DASHBOARD,
  }))
  await mock.module("./construction-reports-service", () => ({
    boqBudgetVarianceReport: async () => opts.variance ?? FAKE_VARIANCE,
    attendanceSummary: async () => opts.attendance ?? FAKE_ATTENDANCE,
  }))
}

const REAL_MODULES = {
  preauth: await import("@/lib/db/preauth-lookups"),
  dashboard: await import("./construction-dashboard-service"),
  reports: await import("./construction-reports-service"),
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/preauth-lookups", () => REAL_MODULES.preauth)
  await mock.module("./construction-dashboard-service", () => REAL_MODULES.dashboard)
  await mock.module("./construction-reports-service", () => REAL_MODULES.reports)
})

describe("resolveReportShareLink -- public share links can never carry cost (D91)", () => {
  test("project_status: no cost/budget/variance sentinel anywhere in the response", async () => {
    await mockModules({ link: { ...BASE_LINK, reportType: "project_status" } })
    const { resolveReportShareLink } = await import("./report-share-service")

    const result = await resolveReportShareLink("tok-1")
    const leaves = collectLeafStrings(result)

    expect(leaves).not.toContain(String(COST_SENTINEL))
    expect(leaves).not.toContain(VENDOR_SENTINEL)
    // Explicit, named assertions too -- not just the sentinel sweep -- so a
    // future reviewer sees exactly which real fields this pins as absent.
    const dashboard = (result as { dashboard: Record<string, unknown> }).dashboard
    for (const key of ["budget", "ledgerBudget", "revenue", "expenses", "projectValue", "projectValueSource", "earnedValue", "percentByValue", "contractValue", "progressByBoqValuePct"]) {
      expect(dashboard).not.toHaveProperty(key)
    }
    expect(result).not.toHaveProperty("totals")
    const line = (result as { lines: Record<string, unknown>[] }).lines[0]
    for (const key of ["rate", "amount", "budgetPercentage", "budget", "materialAmount", "manpowerAmount", "vendorId", "vendorName", "vendorAmount", "committed", "variance", "budgetRemaining", "budgetIsDerived", "percentOfParent", "actual", "revenue"]) {
      expect(line).not.toHaveProperty(key)
    }
    // And that the customer-safe facts survived the redaction.
    expect(dashboard.progressPercent).toBe(42)
    expect(line.code).toBe("C-01")
    expect(line.quantity).toBe(100)
  })

  test("attendance_summary: no labour-cost sentinel anywhere in the response", async () => {
    await mockModules({ link: { ...BASE_LINK, reportType: "attendance_summary" } })
    const { resolveReportShareLink } = await import("./report-share-service")

    const result = await resolveReportShareLink("tok-1")
    const leaves = collectLeafStrings(result)

    expect(leaves).not.toContain(String(COST_SENTINEL))
    const r = result as { rows: Record<string, unknown>[]; totals: Record<string, unknown>; reconciliation: Record<string, unknown> }
    expect(r.rows[0]).not.toHaveProperty("cost")
    expect(r.totals).not.toHaveProperty("cost")
    expect(r.reconciliation).not.toHaveProperty("costFromStatuses")
    expect(r.reconciliation).not.toHaveProperty("costFromTrades")
    // Customer-safe facts survived.
    expect(r.rows[0].trade).toBe("Mason")
    expect(r.rows[0].present).toBe(5)
    expect(r.reconciliation.ties).toBe(true)
  })
})
