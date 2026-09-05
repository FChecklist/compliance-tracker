// Tests aggregateDesignerTimesheetCosts() -- the pure Budget-vs-Actual
// aggregator designerTimesheetReport() feeds into -- directly, without a
// live DB. Matches this repo's established convention of unit-testing only
// DB-free aggregation/pure logic (see resolvePmsBillableRatePure in
// pms-time-service.ts, nextPaymentEntryStatus in
// erp-payment-entries-service.ts).
//
// PR #597 audit fix (N+1 + response-shape regressions): designerTimesheetReport()
// itself is a withTenantContext()-wrapped DB read, but proving "billable
// rates are fetched once, not once per time entry" and "the response
// separates project-scoped from org-wide fields" needs the real function's
// DB-call behavior under test, not just the pure aggregator. The bottom
// describe block below mocks only the DB layer (withTenantContext +
// requireConstructionEnabled), matching this repo's tenant-isolation.test.ts
// pattern -- no live DB, but the real designerTimesheetReport() code path.
//
// R67 merge note (D-11, lane D3 x lane D21): both lanes appended a new describe
// block to the end of this file, so git saw an append/append conflict where the
// merge base had neither. NOTHING WAS DROPPED -- D3's
// `aggregateManpowerDailySummary` (D-53) block and D21's
// `computeBudgetVarianceLine`/attendance-summary (D-26) blocks both survive, in
// that order. They share no symbols: D21's UNSPECIFIED_TRADE_LABEL and D3's
// UNCATEGORISED_TRADE_LABEL are distinct exports covering distinct aggregators.
//
// R67 merge note (D-11, lane D1 x lane D21, 2026-09-03): lane D1's "R67 D-62
// toBudgetLine" block also survives, in the middle of this file. Its three
// variance assertions were RESTATED, not deleted -- toBudgetLine now computes
// through D21's computeBudgetVarianceLine, which defines variance as budget
// REMAINING rather than overspend, so the same facts carry the opposite sign.
// The restatement is documented at the assertions themselves, and one new
// assertion was added there covering the half D1's vendor-only formula could
// not see (material and manpower are committed cost too).
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import {
  aggregateDesignerTimesheetCosts,
  aggregateDesignerApprovalStatus,
  aggregateWorkAnalysis,
  buildBudgetVsActualByProject,
  buildPeriodDays,
  buildReportTable,
  computeCategoryProgress,
  summariseBudgetLines,
  REPORT_REGISTRY,
  REPORT_TABLE_BUILDER_NAMES,
  computeCertifiedPayroll,
  computeEarnedValue,
  toBudgetLine,
  computeBudgetVarianceLine,
  isLineOverBudget,
  buildAttendanceSummaryRows,
  totalAttendanceSummary,
  reconcileAttendanceSummary,
  headcountOnSite,
  DERIVED_BUDGET_NOTE,
  rollUpAttendanceByTrade,
  UNSPECIFIED_TRADE_LABEL,
  WORKER_DAY_WEIGHT,
  WH347_DAY_LABELS,
  type AttendanceWorkerRow,
  type PortfolioProjectRow,
  type ReportName,
  type ReportTable,
  type BudgetLineInput,
  type DesignerTimesheetBudgetLine,
  type DesignerTimesheetEntry,
  type DesignerTimesheetRosterUser,
  type TimesheetStatusEntry,
  type WorkAnalysisEntry,
  type CertifiedPayrollAttendanceRow,
  type CertifiedPayrollWageRate,
  type EvLineItem,
  attributeBoqAmountsByCategory,
  mergeCategoryProgressWithAmounts,
  sumRootLineBudgets,
  aggregateRevenueBudgetActual,
  UNCATEGORIZED_LABEL,
} from "./construction-reports-service"

// Fixture: 3 designers across 2 projects and 3 categories.
// u1 (Alice, active) and u2 (Bob, active) are budgeted; u3 (Carol,
// inactive) has logged time but no budget line -- a real, common case
// (unbudgeted contractor/freelancer time) the aggregator must not silently
// drop or crash on.
const entries: DesignerTimesheetEntry[] = [
  { userId: "u1", userName: "Alice", userIsActive: true, projectId: "pA", projectName: "Project A", category: "Design Development", hours: 10, cost: 1000 },
  { userId: "u1", userName: "Alice", userIsActive: true, projectId: "pA", projectName: "Project A", category: "Site Visit", hours: 5, cost: 500 },
  { userId: "u2", userName: "Bob", userIsActive: true, projectId: "pA", projectName: "Project A", category: "Design Development", hours: 8, cost: 640 },
  { userId: "u3", userName: "Carol", userIsActive: false, projectId: "pB", projectName: "Project B", category: "Documentation", hours: 4, cost: 200 },
  { userId: "u2", userName: "Bob", userIsActive: true, projectId: "pB", projectName: "Project B", category: "Site Visit", hours: 6, cost: 480 },
]

const budgetLines: DesignerTimesheetBudgetLine[] = [
  { projectId: "pA", userId: "u1", amount: 1200 },
  { projectId: "pA", userId: "u2", amount: 700 },
  { projectId: "pB", userId: "u2", amount: 400 },
  { projectId: "pB", userId: null, amount: 100 }, // material line, no designer
]

describe("aggregateDesignerTimesheetCosts", () => {
  const result = aggregateDesignerTimesheetCosts(entries, budgetLines)

  test("byCategory: sums actual hours/cost per category, budget honestly null (no per-category budget dimension exists)", () => {
    expect(result.byCategory).toEqual([
      { category: "Design Development", hours: 18, actual: 1640, budget: null },
      { category: "Documentation", hours: 4, actual: 200, budget: null },
      { category: "Site Visit", hours: 11, actual: 980, budget: null },
    ])
  })

  test("byDesigner: real per-designer budget vs actual, including an unbudgeted designer at budget=0", () => {
    expect(result.byDesigner).toEqual([
      { userId: "u1", userName: "Alice", hours: 15, budget: 1200, actual: 1500, variance: -300 },
      { userId: "u2", userName: "Bob", hours: 14, budget: 1100, actual: 1120, variance: -20 },
      { userId: "u3", userName: "Carol", hours: 4, budget: 0, actual: 200, variance: -200 },
    ])
  })

  test("byProject: budget vs actual per project, including the unassigned material budget line", () => {
    expect(result.byProject).toEqual([
      { projectId: "pA", projectName: "Project A", budget: 1900, actual: 2140, variance: -240 },
      { projectId: "pB", projectName: "Project B", budget: 500, actual: 680, variance: -180 },
    ])
  })

  test("byDesignerStatus: active designers' budget/actual vs the one inactive designer's unbudgeted actual", () => {
    expect(result.byDesignerStatus).toEqual([
      { status: "active", budget: 2300, actual: 2620, variance: -320 },
      { status: "inactive", budget: 0, actual: 200, variance: -200 },
    ])
  })

  test("overall totals sum every entry/budget line regardless of dimension", () => {
    expect(result.overallBudget).toBe(2400)
    expect(result.overallActual).toBe(2820)
    expect(result.overallVariance).toBe(-420)
  })

  test("empty entries/budgetLines produce all-zero totals and empty breakdowns, never a crash", () => {
    const empty = aggregateDesignerTimesheetCosts([], [])
    expect(empty).toEqual({
      byCategory: [], byDesigner: [], byProject: [],
      byDesignerStatus: [
        { status: "active", budget: 0, actual: 0, variance: 0 },
        { status: "inactive", budget: 0, actual: 0, variance: 0 },
      ],
      overallBudget: 0, overallActual: 0, overallVariance: 0,
    })
  })
})

// Budget-undercount regression (PR #597 audit fix): a designer with a real
// pms_budget_line_items row but zero time entries anywhere in the org (e.g.
// newly budgeted, hasn't logged hours yet) must still resolve an
// active/inactive status via the full user roster, not be silently
// excluded from byDesignerStatus.
describe("aggregateDesignerTimesheetCosts: roster-inclusion (budget-undercount fix)", () => {
  // u1 has logged time; u4 (Dana) has a real budget line but never logged
  // a single time entry -- the exact scenario the audit flagged.
  const rosterEntries: DesignerTimesheetEntry[] = [
    { userId: "u1", userName: "Alice", userIsActive: true, projectId: "pA", projectName: "Project A", category: "Design Development", hours: 10, cost: 1000 },
  ]
  const rosterBudgetLines: DesignerTimesheetBudgetLine[] = [
    { projectId: "pA", userId: "u1", amount: 1200 },
    { projectId: "pA", userId: "u4", amount: 800 },
  ]
  const roster: DesignerTimesheetRosterUser[] = [
    { userId: "u1", isActive: true },
    { userId: "u4", isActive: true },
  ]

  test("without a roster, an entryless budgeted designer's budget is dropped from byDesignerStatus (pre-fix behavior, still true when roster is omitted)", () => {
    const result = aggregateDesignerTimesheetCosts(rosterEntries, rosterBudgetLines)
    const sumByStatus = result.byDesignerStatus.reduce((s, r) => s + r.budget, 0)
    expect(sumByStatus).toBe(1200) // u4's 800 is missing
    expect(sumByStatus).not.toBe(result.overallBudget)
  })

  test("with the full roster passed in, u4's budget is included in byDesignerStatus and sum(byDesignerStatus.budget) === overallBudget", () => {
    const result = aggregateDesignerTimesheetCosts(rosterEntries, rosterBudgetLines, roster)
    expect(result.overallBudget).toBe(2000)
    const sumByStatus = result.byDesignerStatus.reduce((s, r) => s + r.budget, 0)
    expect(sumByStatus).toBe(result.overallBudget)
    expect(result.byDesignerStatus).toEqual([
      { status: "active", budget: 2000, actual: 1000, variance: 1000 },
      { status: "inactive", budget: 0, actual: 0, variance: 0 },
    ])
  })

  test("a roster user who logged zero entries and has no budget line does not appear anywhere -- roster alone never fabricates activity", () => {
    const rosterOnly: DesignerTimesheetRosterUser[] = [...roster, { userId: "u5", isActive: false }]
    const result = aggregateDesignerTimesheetCosts(rosterEntries, rosterBudgetLines, rosterOnly)
    expect(result.byDesigner.some((d) => d.userId === "u5")).toBe(false)
    expect(result.byDesignerStatus.find((s) => s.status === "inactive")).toEqual({ status: "inactive", budget: 0, actual: 0, variance: 0 })
  })
})

// Design Studio timesheets (Owner item 12, "IMPORTANT", 2026-07-28):
// designer-wise approval-status view -- a distinct cut from
// aggregateDesignerTimesheetCosts' byDesignerStatus (active/inactive)
// above; this groups each designer's logged hours by where they sit in the
// draft -> submitted -> approved/rejected workflow.
describe("aggregateDesignerApprovalStatus", () => {
  test("buckets each designer's hours/entry-counts by approval status, zero-filling statuses with no entries", () => {
    const entries: TimesheetStatusEntry[] = [
      { userId: "u1", userName: "Alice", approvalStatus: "draft", hours: 3 },
      { userId: "u1", userName: "Alice", approvalStatus: "submitted", hours: 5 },
      { userId: "u1", userName: "Alice", approvalStatus: "submitted", hours: 2 },
      { userId: "u2", userName: "Bob", approvalStatus: "approved", hours: 8 },
      { userId: "u2", userName: "Bob", approvalStatus: "rejected", hours: 4 },
    ]
    const result = aggregateDesignerApprovalStatus(entries)
    expect(result).toEqual([
      {
        userId: "u1", userName: "Alice",
        draft: { hours: 3, entries: 1 },
        submitted: { hours: 7, entries: 2 },
        approved: { hours: 0, entries: 0 },
        rejected: { hours: 0, entries: 0 },
      },
      {
        userId: "u2", userName: "Bob",
        draft: { hours: 0, entries: 0 },
        submitted: { hours: 0, entries: 0 },
        approved: { hours: 8, entries: 1 },
        rejected: { hours: 4, entries: 1 },
      },
    ])
  })

  test("empty input produces an empty designer list, never a crash", () => {
    expect(aggregateDesignerApprovalStatus([])).toEqual([])
  })
})

// Design Studio timesheets: work-analysis view -- hours by task/category
// per designer over a period, built directly from the timesheet data
// already flowing through pms_time_entries/pms_issues.
describe("aggregateWorkAnalysis", () => {
  test("sums hours per designer, broken down by task and by category", () => {
    const entries: WorkAnalysisEntry[] = [
      { userId: "u1", userName: "Alice", taskId: "t1", taskName: "Lobby Elevation", category: "Design Development", hours: 4 },
      { userId: "u1", userName: "Alice", taskId: "t1", taskName: "Lobby Elevation", category: "Design Development", hours: 2 },
      { userId: "u1", userName: "Alice", taskId: "t2", taskName: "Site Visit Report", category: "Site Visit", hours: 3 },
      { userId: "u2", userName: "Bob", taskId: "t3", taskName: "BOQ Review", category: "Documentation", hours: 6 },
    ]
    const result = aggregateWorkAnalysis(entries)
    expect(result).toEqual([
      {
        userId: "u1", userName: "Alice", totalHours: 9,
        byTask: [
          { taskId: "t1", taskName: "Lobby Elevation", hours: 6 },
          { taskId: "t2", taskName: "Site Visit Report", hours: 3 },
        ],
        byCategory: [
          { category: "Design Development", hours: 6 },
          { category: "Site Visit", hours: 3 },
        ],
      },
      {
        userId: "u2", userName: "Bob", totalHours: 6,
        byTask: [{ taskId: "t3", taskName: "BOQ Review", hours: 6 }],
        byCategory: [{ category: "Documentation", hours: 6 }],
      },
    ])
  })

  test("empty input produces an empty designer list, never a crash", () => {
    expect(aggregateWorkAnalysis([])).toEqual([])
  })
})

// PR #597 audit fix -- exercises the real designerTimesheetReport() (not a
// re-implementation), mocking only the DB layer: @/lib/db/tenant-scoped's
// withTenantContext (supplies a fake drizzle-shaped db) and
// requireConstructionEnabled. Same "capture real modules, restore in
// afterEach" pattern as tenant-isolation.test.ts, to avoid mock.module()
// leaking into other test files sharing this bun test process.
const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realEnablementService = await import("./construction-enablement-service")

describe("designerTimesheetReport: N+1 fix + scope-labeled response (PR #597 audit fix)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  test("fetches billable rates once regardless of time-entry count, and returns a response with project-scoped/org-wide fields explicitly separated", async () => {
    const ORG_ID = "org-designer-timesheet-test"
    const PROJECT_ID = "proj-1"

    // 30 time entries for a single billable-designer (u1) -- if the N+1
    // bug were still present, resolving each would be its own DB call.
    const timeEntries = Array.from({ length: 30 }, (_, i) => ({
      id: `entry-${i}`, orgId: ORG_ID, issueId: "issue-1", userId: "u1",
      hours: "2", spentOn: "2026-01-15", activityType: "Design Development",
    }))

    // u2 (Bob) has a real budget line but never logged a single time entry
    // -- the exact roster-gap scenario from PR #597's audit.
    const users = [
      { id: "u1", name: "Alice", isActive: true },
      { id: "u2", name: "Bob", isActive: true },
    ]
    const budgetLineItems = [
      { budgetId: "budget-1", userId: "u1", amount: "1000" },
      { budgetId: "budget-1", userId: "u2", amount: "500" },
    ]

    const ratesFindMany = mock(async () => [{ userId: null, hourlyRate: "50", validFrom: "2020-01-01" }])

    const fakeDb = {
      query: {
        pmsIssues: { findMany: mock(async () => [{ id: "issue-1", projectId: PROJECT_ID }]) },
        projects: { findMany: mock(async () => [{ id: PROJECT_ID, name: "Project One" }]) },
        users: { findMany: mock(async () => users) },
        pmsTimeEntries: { findMany: mock(async () => timeEntries) },
        pmsBillableRates: { findMany: ratesFindMany },
        pmsBudgets: { findMany: mock(async () => [{ id: "budget-1", projectId: PROJECT_ID }]) },
        pmsBudgetLineItems: { findMany: mock(async () => budgetLineItems) },
      },
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              groupBy: () => Promise.resolve([{ userId: "u1", userName: "Alice", totalHours: 60 }]),
            }),
          }),
        }),
      }),
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablementService,
      requireConstructionEnabled: mock(async () => {}),
    }))

    const { designerTimesheetReport } = await import("./construction-reports-service")
    const result = await designerTimesheetReport({ orgId: ORG_ID }, PROJECT_ID)

    // N+1 fix: rates fetched exactly once upfront, never per time entry.
    expect(ratesFindMany.mock.calls.length).toBe(1)

    // Roster-inclusion fix: u2's entryless budget line still lands in
    // byDesignerStatus, so sum(byDesignerStatus.budget) === overallBudget.
    expect(result.projectScoped.overallBudget).toBe(1500)
    const sumByStatus = result.projectScoped.byDesignerStatus.reduce((s, r) => s + r.budget, 0)
    expect(sumByStatus).toBe(result.projectScoped.overallBudget)

    // Scope-mixing fix: project-scoped and org-wide breakdowns are returned
    // under explicit, separate keys -- not merged into one flat object.
    // R67 E-16 adds `period` -- the window the report really covered, echoed
    // back so the Cost Analysis screen captions what it got rather than what it
    // asked for. Null/null here, because this call named no period.
    expect(Object.keys(result).sort()).toEqual(["orgWide", "period", "projectScoped"])
    expect(result.period).toEqual({ from: null, to: null })
    expect(Object.keys(result.projectScoped).sort()).toEqual(
      ["byCategory", "byDesignerStatus", "byUser", "overallActual", "overallBudget", "overallVariance"].sort()
    )
    expect(Object.keys(result.orgWide).sort()).toEqual(["byDesigner", "byProject"])
  })

  // R67 E-16 (R-150): the period. The fake db below deliberately IGNORES the
  // where clause (it is a canned findMany), which is exactly why this test is
  // worth having: it proves the fold itself honours the window, so a period
  // that the SQL bounds somehow failed to narrow still cannot be counted. The
  // 30 fixture entries are all on 2026-01-15.
  test("a period excludes entries outside it, and is echoed back on the response", async () => {
    const ORG_ID = "org-designer-timesheet-period"
    const PROJECT_ID = "proj-1"
    const timeEntries = Array.from({ length: 30 }, (_, i) => ({
      id: `entry-${i}`, orgId: ORG_ID, issueId: "issue-1", userId: "u1",
      hours: "2", spentOn: "2026-01-15", activityType: "Design Development",
    }))

    const fakeDb = {
      query: {
        pmsIssues: { findMany: mock(async () => [{ id: "issue-1", projectId: PROJECT_ID }]) },
        projects: { findMany: mock(async () => [{ id: PROJECT_ID, name: "Project One" }]) },
        users: { findMany: mock(async () => [{ id: "u1", name: "Alice", isActive: true }]) },
        pmsTimeEntries: { findMany: mock(async () => timeEntries) },
        pmsBillableRates: { findMany: mock(async () => [{ userId: null, hourlyRate: "50", validFrom: "2020-01-01" }]) },
        pmsBudgets: { findMany: mock(async () => [{ id: "budget-1", projectId: PROJECT_ID }]) },
        pmsBudgetLineItems: { findMany: mock(async () => [{ budgetId: "budget-1", userId: "u1", amount: "1000" }]) },
      },
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }) }) }),
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablementService,
      requireConstructionEnabled: mock(async () => {}),
    }))

    const { designerTimesheetReport, isWithinPeriod } = await import("./construction-reports-service")

    // Both ends inclusive -- "01 to 31 January" includes the 15th and both ends.
    expect(isWithinPeriod("2026-01-15", "2026-01-01", "2026-01-31")).toBe(true)
    expect(isWithinPeriod("2026-01-01", "2026-01-01", "2026-01-31")).toBe(true)
    expect(isWithinPeriod("2026-01-31", "2026-01-01", "2026-01-31")).toBe(true)
    expect(isWithinPeriod("2026-02-01", "2026-01-01", "2026-01-31")).toBe(false)
    expect(isWithinPeriod("2026-01-15", null, null)).toBe(true)

    const inside = await designerTimesheetReport({ orgId: ORG_ID }, PROJECT_ID, { from: "2026-01-01", to: "2026-01-31" })
    expect(inside.period).toEqual({ from: "2026-01-01", to: "2026-01-31" })
    // 30 entries x 2 h x AED 50 = 3000, all inside the window.
    expect(inside.projectScoped.overallActual).toBe(3000)

    const outside = await designerTimesheetReport({ orgId: ORG_ID }, PROJECT_ID, { from: "2026-02-01", to: "2026-02-28" })
    expect(outside.period).toEqual({ from: "2026-02-01", to: "2026-02-28" })
    // Not one hour falls in February: actual is 0, and the budget is STILL
    // 1000 -- a month with no logged hours has a budget nobody spent, which is
    // the whole point of a Budget-vs-Actual view.
    expect(outside.projectScoped.overallActual).toBe(0)
    expect(outside.projectScoped.overallBudget).toBe(1000)
    expect(outside.projectScoped.byCategory).toEqual([])
  })
})


// Certified Payroll (SAP-mapping gap analysis HCM-006, "Certified Payroll
// Report (Regulatory / Public Works)", US WH-347 equivalent): tests
// computeCertifiedPayroll() -- the pure per-worker weekly aggregator --
// directly, without a live DB, same convention as
// aggregateDesignerTimesheetCosts above.
//
// WEEK_START is the only hardcoded date literal in this suite -- every
// other fixture date is derived from it via offset arithmetic (dayOf()),
// rather than hand-typing 7 separate date literals.
const WEEK_START = "2026-08-02"
function dayOf(offset: number): string {
  return new Date(new Date(WEEK_START).getTime() + offset * 86400000).toISOString().slice(0, 10)
}
function labelOf(dateStr: string): (typeof WH347_DAY_LABELS)[number] {
  return WH347_DAY_LABELS[new Date(dateStr).getUTCDay()]
}

describe("computeCertifiedPayroll", () => {
  test("a worker's hours are bucketed under their real calendar day-of-week, not an offset from weekStart", () => {
    const rows: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r1", workerName: "Worker One", trade: "Carpenter", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 320 },
      { rosterId: "r1", workerName: "Worker One", trade: "Carpenter", attendanceDate: dayOf(1), hoursWorked: 8, dailyCost: 320 },
    ]
    const result = computeCertifiedPayroll(rows, [], WEEK_START)
    const worker = result.workers[0]
    expect(worker.dailyHours[labelOf(dayOf(0))]).toBe(8)
    expect(worker.dailyHours[labelOf(dayOf(1))]).toBe(8)
    expect(worker.totalHours).toBe(16)
    expect(worker.grossWages).toBe(640)
  })

  test("rate paid is derived from real dailyCost/hoursWorked, and a worker whose rate meets the prevailing determination is compliant", () => {
    const rows: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r1", workerName: "Worker One", trade: "Carpenter", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 400 },
    ]
    const wageRates: CertifiedPayrollWageRate[] = [{ trade: "Carpenter", prevailingHourlyRate: 45, fringeBenefitRate: 5 }]
    const result = computeCertifiedPayroll(rows, wageRates, WEEK_START)
    expect(result.workers[0].ratePaid).toBe(50)
    expect(result.workers[0].prevailingHourlyRate).toBe(45)
    expect(result.workers[0].fringeBenefitRateRequired).toBe(5)
    expect(result.workers[0].complianceStatus).toBe("compliant")
    expect(result.statementOfCompliance.allWorkersCompliant).toBe(true)
    expect(result.statementOfCompliance.exceptions).toEqual([])
  })

  test("a worker paid below the project's prevailing rate for their trade is flagged rate_below_prevailing and listed as an exception", () => {
    const rows: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r1", workerName: "Worker One", trade: "Electrician", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 240 },
    ]
    const wageRates: CertifiedPayrollWageRate[] = [{ trade: "Electrician", prevailingHourlyRate: 40, fringeBenefitRate: 0 }]
    const result = computeCertifiedPayroll(rows, wageRates, WEEK_START)
    expect(result.workers[0].ratePaid).toBe(30)
    expect(result.workers[0].complianceStatus).toBe("rate_below_prevailing")
    expect(result.statementOfCompliance.allWorkersCompliant).toBe(false)
    expect(result.statementOfCompliance.exceptions).toEqual([{ rosterId: "r1", workerName: "Worker One", reason: "rate_below_prevailing" }])
  })

  test("a worker with no trade recorded, or a trade with no wage determination on file for this project, is flagged no_classification_on_file rather than silently passing", () => {
    const noTrade: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r1", workerName: "Worker One", trade: null, attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 400 },
    ]
    const unmatchedTrade: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r2", workerName: "Worker Two", trade: "Plumber", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 400 },
    ]
    expect(computeCertifiedPayroll(noTrade, [], WEEK_START).workers[0].complianceStatus).toBe("no_classification_on_file")
    expect(computeCertifiedPayroll(unmatchedTrade, [{ trade: "Carpenter", prevailingHourlyRate: 45, fringeBenefitRate: 0 }], WEEK_START).workers[0].complianceStatus).toBe("no_classification_on_file")
  })

  test("trade matching against the wage determination is case/whitespace-insensitive, matching constructionLabourRoster.trade's own free-text posture", () => {
    const rows: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r1", workerName: "Worker One", trade: "  CARPENTER  ", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 400 },
    ]
    const wageRates: CertifiedPayrollWageRate[] = [{ trade: "carpenter", prevailingHourlyRate: 45, fringeBenefitRate: 0 }]
    expect(computeCertifiedPayroll(rows, wageRates, WEEK_START).workers[0].complianceStatus).toBe("compliant")
  })

  test("deductions are honestly 0 and netWages equals grossWages -- this site-labour workforce has no link to the statutory payroll engine (disclosed gap, never fabricated)", () => {
    const rows: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r1", workerName: "Worker One", trade: "Carpenter", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 400 },
    ]
    const worker = computeCertifiedPayroll(rows, [], WEEK_START).workers[0]
    expect(worker.totalDeductions).toBe(0)
    expect(worker.netWages).toBe(worker.grossWages)
  })

  test("multiple workers are sorted by name, and the report totals sum every worker", () => {
    const rows: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r2", workerName: "Zed Worker", trade: "Carpenter", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 400 },
      { rosterId: "r1", workerName: "Amy Worker", trade: "Carpenter", attendanceDate: dayOf(0), hoursWorked: 8, dailyCost: 400 },
    ]
    const result = computeCertifiedPayroll(rows, [], WEEK_START)
    expect(result.workers.map((w) => w.workerName)).toEqual(["Amy Worker", "Zed Worker"])
    expect(result.workerCount).toBe(2)
    expect(result.totalHours).toBe(16)
    expect(result.totalGrossWages).toBe(800)
  })

  test("a worker present with no hoursWorked recorded contributes 0 hours (not a crash), and empty attendance produces an empty, not an error", () => {
    const rows: CertifiedPayrollAttendanceRow[] = [
      { rosterId: "r1", workerName: "Worker One", trade: "Carpenter", attendanceDate: dayOf(0), hoursWorked: null, dailyCost: 0 },
    ]
    const result = computeCertifiedPayroll(rows, [], WEEK_START)
    expect(result.workers[0].totalHours).toBe(0)
    expect(result.workers[0].ratePaid).toBe(0)

    const empty = computeCertifiedPayroll([], [], WEEK_START)
    expect(empty.workers).toEqual([])
    expect(empty.workerCount).toBe(0)
    expect(empty.statementOfCompliance.allWorkersCompliant).toBe(true)
  })

  test("weekEnd is 6 days after weekStart, matching WH-347's Sunday-Saturday reporting week", () => {
    const result = computeCertifiedPayroll([], [], WEEK_START)
    expect(result.weekStart).toBe(WEEK_START)
    expect(result.weekEnd).toBe(dayOf(6))
  })
})

// R46/R-51 (fault R46P5_R51_01, confirmed live 2026-08-25 -- Oakwood
// Residence, upv2q7pv8qcwdayybvu74egm): earnedValueReport() previously only
// ever read quantity_done and silently valued a line at $0 whenever no
// physical quantity had been recorded for it, even when a real
// percentComplete had been logged -- and, separately, unconditionally
// dropped a root line item's OWN progress the moment it had children (only
// children were ever summed). computeEarnedValue() is the pure rollup
// these tests exercise directly, no DB.
describe("computeEarnedValue -- R46/R-51 percent-complete fallback + root-with-children direct progress", () => {
  test("REGRESSION ORACLE: measured quantity on a weighted child still earns exactly as before (qty x rootRate x breakdownPct/100) -- the pre-existing, already-correct code path is untouched", () => {
    const items: EvLineItem[] = [
      { id: "root1", parentLineItemId: null, rate: 10, amount: 1000, breakdownPercentage: null },
      { id: "childA", parentLineItemId: "root1", rate: 6, amount: 600, breakdownPercentage: 60 },
      { id: "childB", parentLineItemId: "root1", rate: 4, amount: 400, breakdownPercentage: 40 },
    ]
    const qtyByItem = new Map([["childA", 30]]) // only childA has a real measured quantity
    const result = computeEarnedValue(items, qtyByItem, new Map())
    // 30 (qty) x 10 (ROOT's rate, not the child's own) x 60% = 180
    expect(result.earnedValue).toBe(180)
    expect(result.contractValue).toBe(1000)
    expect(result.percentByValue).toBe(18)
  })

  test("Oakwood live case: a root-with-children line has percentComplete=50 but quantityDone=0 (no measurement yet) -- previously $0, now 50% of the root's own contracted value, additive on top of its children", () => {
    const items: EvLineItem[] = [
      { id: "PP1", parentLineItemId: null, rate: 50, amount: 5000, breakdownPercentage: null },
      { id: "PP1-A", parentLineItemId: "PP1", rate: 20, amount: 2000, breakdownPercentage: 40 },
    ]
    const qtyByItem = new Map<string, number>() // both real Oakwood entries recorded quantityDone: 0
    const latestPercentByItem = new Map([["PP1", 50]]) // real entries recorded percentComplete: 50
    const result = computeEarnedValue(items, qtyByItem, latestPercentByItem)
    expect(result.contractValue).toBe(5000) // unchanged -- matches the live "AED 5,000 contract value" evidence
    expect(result.earnedValue).toBe(2500) // 50% x root's own 5000 -- was 0 before this fix
    expect(result.percentByValue).toBe(50)
  })

  test("a child (not the root) logged percent-only progress falls back to its breakdown share of the root's contract value", () => {
    const items: EvLineItem[] = [
      { id: "root1", parentLineItemId: null, rate: 10, amount: 1000, breakdownPercentage: null },
      { id: "childA", parentLineItemId: "root1", rate: 6, amount: 600, breakdownPercentage: 40 },
    ]
    const latestPercentByItem = new Map([["childA", 50]])
    const result = computeEarnedValue(items, new Map(), latestPercentByItem)
    // childA's share of contract value = 1000 x 40% = 400; 50% of that = 200
    expect(result.earnedValue).toBe(200)
    expect(result.contractValue).toBe(1000)
  })

  test("a real measured quantity always wins over a logged percentComplete on the same line -- never double-counted", () => {
    const items: EvLineItem[] = [{ id: "root1", parentLineItemId: null, rate: 20, amount: 2000, breakdownPercentage: null }]
    const qtyByItem = new Map([["root1", 50]])
    const latestPercentByItem = new Map([["root1", 90]]) // present, but must be ignored since qty is measured
    const result = computeEarnedValue(items, qtyByItem, latestPercentByItem)
    expect(result.earnedValue).toBe(1000) // 50 x 20, NOT 90% x 2000 = 1800
  })

  test("a root's own direct progress and its children's progress are both counted, additively, without double-counting", () => {
    const items: EvLineItem[] = [
      { id: "root1", parentLineItemId: null, rate: 30, amount: 3000, breakdownPercentage: null },
      { id: "child1", parentLineItemId: "root1", rate: 30, amount: 3000, breakdownPercentage: 100 },
    ]
    const qtyByItem = new Map([["root1", 20], ["child1", 10]])
    const result = computeEarnedValue(items, qtyByItem, new Map())
    expect(result.earnedValue).toBe(900) // root: 20x30=600, child: 10x30x100%=300
    expect(result.contractValue).toBe(3000)
  })

  test("no progress logged anywhere -- earnedValue 0, contractValue still the real sum of root amounts, never a crash", () => {
    const items: EvLineItem[] = [
      { id: "root1", parentLineItemId: null, rate: 10, amount: 1000, breakdownPercentage: null },
      { id: "root2", parentLineItemId: null, rate: 5, amount: 500, breakdownPercentage: null },
    ]
    const result = computeEarnedValue(items, new Map(), new Map())
    expect(result).toEqual({ earnedValue: 0, contractValue: 1500, percentByValue: 0 })
  })

  test("multiple independent (non-hierarchical) root lines each resolve quantity-vs-percent independently", () => {
    const items: EvLineItem[] = [
      { id: "rootA", parentLineItemId: null, rate: 5, amount: 500, breakdownPercentage: null },
      { id: "rootB", parentLineItemId: null, rate: 10, amount: 1000, breakdownPercentage: null },
    ]
    const qtyByItem = new Map([["rootA", 40]]) // rootA measured
    const latestPercentByItem = new Map([["rootB", 25]]) // rootB percent-only
    const result = computeEarnedValue(items, qtyByItem, latestPercentByItem)
    expect(result.earnedValue).toBe(450) // rootA: 40x5=200, rootB: 25% x 1000=250
    expect(result.contractValue).toBe(1500)
    expect(result.percentByValue).toBe(30)
  })

  test("empty line-item list -- all zero, not an error", () => {
    expect(computeEarnedValue([], new Map(), new Map())).toEqual({ earnedValue: 0, contractValue: 0, percentByValue: 0 })
  })
})

// R75 Part 2 Phase 3 (R-44/R-45): explicit, standalone checks of the two
// invariants computeEarnedValue() must hold -- not regression-oracle
// reproductions of a historical bug like the describe block above, but
// direct assertions of the formulas themselves.
describe("computeEarnedValue -- R-44/R-45 explicit invariant checks", () => {
  test("R-44: a parent's cumulative quantity equals the sum of each child's cumulative quantity x that child's breakdownPercentage/100", () => {
    const items: EvLineItem[] = [
      { id: "root1", parentLineItemId: null, rate: 1, amount: 1000, breakdownPercentage: null },
      { id: "childA", parentLineItemId: "root1", rate: 1, amount: 600, breakdownPercentage: 60 },
      { id: "childB", parentLineItemId: "root1", rate: 1, amount: 400, breakdownPercentage: 40 },
    ]
    // root1 itself has no measured quantity and no percentComplete, so it
    // contributes nothing on its own here -- isolating the children-only
    // sum. rootRate=1 on every line so earnedValue reads as pure quantity.
    const qtyByItem = new Map([
      ["childA", 30], // childA's own cumulative quantity
      ["childB", 20], // childB's own cumulative quantity
    ])
    const result = computeEarnedValue(items, qtyByItem, new Map())
    // 30 x 60/100 + 20 x 40/100 = 18 + 8 = 26
    expect(result.earnedValue).toBe(26)
  })

  test("R-45: the parent percent complete equals the parent's cumulative amount divided by its total contracted amount", () => {
    const items: EvLineItem[] = [{ id: "root1", parentLineItemId: null, rate: 25, amount: 800, breakdownPercentage: null }]
    const qtyByItem = new Map([["root1", 16]]) // root1's own cumulative quantity
    const result = computeEarnedValue(items, qtyByItem, new Map())
    expect(result.earnedValue).toBe(400) // 16 x 25 -- the parent's cumulative amount
    expect(result.contractValue).toBe(800) // the parent's total contracted amount
    expect(result.percentByValue).toBe(50) // 400 / 800 x 100
  })
})

// ---------------------------------------------------------------------------
// R67 F-10 (R-134) acceptance test.
//
// THE FAULT. requireConstructionEnabled() is the first statement of every one
// of the ~20 report functions in this service, and it is not a cheap boolean:
// it goes through isBranchEnabledForOrg(), which opens its OWN
// withTenantContext transaction and takes one of only five app_runtime
// connections. A composite report calls several report functions, so one
// /reports run could spend three or four pooled connections re-answering "does
// this org have the construction module?" -- a question whose answer is a
// purchased package and cannot change between two clicks.
//
// Two assertions, exactly the item's own:
//   (a) two consecutive report runs for the same org inside the TTL call
//       requireConstructionEnabled ONCE;
//   (b) a spy on withTenantContext records no call made while another is
//       already open -- i.e. this service opens no nested transaction, which on
//       a five-connection pool with a 25 s statement timeout is what turns a
//       two-query report into a deadlock.
const realReportsTenantScoped = await import("@/lib/db/tenant-scoped")
const realReportsEnablement = await import("./construction-enablement-service")

// A thenable proxy standing in for drizzle's chainable query builder: any
// method returns itself, and awaiting it yields rows. Every report under test
// here reads an empty set, which is a legitimate answer and keeps the fake
// honest -- what is being measured is the TRANSACTIONS opened, not the SQL.
function emptyQueryChain(): any {
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve([])
        return () => proxy
      },
    }
  )
  return proxy
}

const fakeReportsDb = {
  query: new Proxy({}, { get: () => ({ findMany: async () => [], findFirst: async () => null }) }),
  select: () => emptyQueryChain(),
}

describe("construction-reports-service: enablement memo + no nested transactions (R67 F-10)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realReportsTenantScoped)
    await mock.module("./construction-enablement-service", () => realReportsEnablement)
  })

  async function loadServiceWithSpies() {
    const requireConstructionEnabledSpy = mock(async () => {})
    let openDepth = 0
    let maxOpenDepth = 0
    const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
      openDepth += 1
      maxOpenDepth = Math.max(maxOpenDepth, openDepth)
      try {
        return await fn(fakeReportsDb)
      } finally {
        openDepth -= 1
      }
    })

    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realReportsTenantScoped, withTenantContext }))
    await mock.module("./construction-enablement-service", () => ({
      ...realReportsEnablement,
      requireConstructionEnabled: requireConstructionEnabledSpy,
    }))

    const service = await import("./construction-reports-service")
    service.__resetConstructionEnablementMemo()
    return { service, requireConstructionEnabledSpy, withTenantContext, depth: () => maxOpenDepth }
  }

  test("(a) two consecutive report runs for the same org inside the TTL check enablement ONCE", async () => {
    const { service, requireConstructionEnabledSpy } = await loadServiceWithSpies()

    await service.attendanceReport({ orgId: "org-memo" }, "p1")
    await service.attendanceReport({ orgId: "org-memo" }, "p1")

    expect(requireConstructionEnabledSpy.mock.calls.length).toBe(1)
  })

  test("(a2) different report functions for the same org share the one memoised check", async () => {
    const { service, requireConstructionEnabledSpy } = await loadServiceWithSpies()

    await service.attendanceReport({ orgId: "org-memo" }, "p1")
    await service.scopeReport({ orgId: "org-memo" }, "p1")
    await service.workProgressReport({ orgId: "org-memo" }, "p1")

    expect(requireConstructionEnabledSpy.mock.calls.length).toBe(1)
  })

  test("(a3) a DIFFERENT org is never served another org's memoised answer", async () => {
    const { service, requireConstructionEnabledSpy } = await loadServiceWithSpies()

    await service.attendanceReport({ orgId: "org-one" }, "p1")
    await service.attendanceReport({ orgId: "org-two" }, "p1")

    expect(requireConstructionEnabledSpy.mock.calls.length).toBe(2)
  })

  test("(a4) a REFUSAL is never memoised -- an org that has just enabled construction is not told 'no' for a minute", async () => {
    const requireConstructionEnabledSpy = mock(async (_orgId: string) => {
      throw new (realReportsEnablement.ServiceError as new (m: string, s: number) => Error)("not part of your Module", 403)
    })
    const withTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeReportsDb))
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realReportsTenantScoped, withTenantContext }))
    await mock.module("./construction-enablement-service", () => ({
      ...realReportsEnablement,
      requireConstructionEnabled: requireConstructionEnabledSpy,
    }))

    const service = await import("./construction-reports-service")
    service.__resetConstructionEnablementMemo()

    await expect(service.attendanceReport({ orgId: "org-blocked" }, "p1")).rejects.toThrow(/not part of your Module/)
    await expect(service.attendanceReport({ orgId: "org-blocked" }, "p1")).rejects.toThrow(/not part of your Module/)

    expect(requireConstructionEnabledSpy.mock.calls.length).toBe(2)
    // And no transaction was opened for a report that was refused.
    expect(withTenantContext.mock.calls.length).toBe(0)
  })

  test("(b) no withTenantContext is ever entered while another is already open", async () => {
    const { service, withTenantContext, depth } = await loadServiceWithSpies()

    await service.workProgressReport({ orgId: "org-nest" }, "p1")
    await service.attendanceReport({ orgId: "org-nest" }, "p1")
    await service.sitePictureReport({ orgId: "org-nest" }, "p1")
    await service.scopeReport({ orgId: "org-nest" }, "p1")
    await service.budgetSummary({ orgId: "org-nest" }, "p1")
    await service.materialConsumptionReport({ orgId: "org-nest" }, "p1")
    await service.vendorCostReport({ orgId: "org-nest" }, "p1")
    await service.projectPeriodReport({ orgId: "org-nest" }, "p1", "2026-08-01", "2026-09-01")

    expect(withTenantContext.mock.calls.length).toBeGreaterThan(0)
    expect(depth()).toBe(1)
  })

  test("(b2) one report opens exactly ONE transaction -- the enablement check is not a second one", async () => {
    const { service, withTenantContext } = await loadServiceWithSpies()

    await service.attendanceReport({ orgId: "org-count" }, "p1")

    expect(withTenantContext.mock.calls.length).toBe(1)
  })
})

// R67 F-14 (R-215). computeCategoryProgress is the pure half of
// categoryProgressReport, extracted so getProjectDashboard can fold the same
// breakdown into the transaction it already holds instead of PROJEXA making a
// second HTTP call (and a second pooled transaction) for it. Same reason
// computeEarnedValue was extracted: ONE arithmetic path, so the dashboard chart
// and the named report cannot disagree.
describe("computeCategoryProgress (R67 F-14)", () => {
  const CATEGORIES = [
    { id: "c1", name: "Substructure" },
    { id: "c2", name: "Superstructure" },
  ]

  test("averages the latest percent across a category's activities", () => {
    const rows = computeCategoryProgress(
      CATEGORIES,
      [
        { id: "a1", categoryId: "c1" },
        { id: "a2", categoryId: "c1" },
        { id: "a3", categoryId: "c2" },
      ],
      new Map([["a1", 80], ["a2", 20], ["a3", 55]])
    )
    expect(rows).toEqual([
      { categoryId: "c1", name: "Substructure", percentComplete: 50 },
      { categoryId: "c2", name: "Superstructure", percentComplete: 55 },
    ])
  })

  test("an activity nobody has logged against counts as 0, not as absent", () => {
    // Three activities, one at 60% -> 20%, NOT 60%. Treating the unlogged ones
    // as absent would report a category as three times more complete than it is.
    const [row] = computeCategoryProgress(
      [CATEGORIES[0]],
      [
        { id: "a1", categoryId: "c1" },
        { id: "a2", categoryId: "c1" },
        { id: "a3", categoryId: "c1" },
      ],
      new Map([["a1", 60]])
    )
    expect(row.percentComplete).toBe(20)
  })

  test("a category with no activities is 0, and is still listed", () => {
    const rows = computeCategoryProgress(CATEGORIES, [{ id: "a1", categoryId: "c1" }], new Map([["a1", 100]]))
    expect(rows).toEqual([
      { categoryId: "c1", name: "Substructure", percentComplete: 100 },
      { categoryId: "c2", name: "Superstructure", percentComplete: 0 },
    ])
  })

  test("an activity with no category is not attributed to one", () => {
    const rows = computeCategoryProgress([CATEGORIES[0]], [{ id: "a1", categoryId: null }], new Map([["a1", 90]]))
    expect(rows[0].percentComplete).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// R67 lane I (WS-I item I-05, R-177): the Category dimension of the Work
// Progress Report. rollUpLinesByCategory is pure and tested directly; the real
// workProgressReport() code path is then exercised with only the DB layer and
// the construction-enablement gate mocked, so "categoryFilter=['Civil'] returns
// only Civil rows and a Grand Total equal to their subtotal" is a proven
// behaviour of the shipped function, not of a helper it happens to call.
import {
  UNCATEGORIZED_LABEL,
  rollUpLinesByCategory,
  type CategoryLine,
} from "./construction-reports-service"

const CATEGORY_LINES: CategoryLine[] = [
  { lineItemId: "l1", code: "1", description: "Blockwork", category: "Civil", amount: 1000, parentLineItemId: null },
  { lineItemId: "l2", code: "2", description: "Plaster", category: "Civil", amount: 500, parentLineItemId: null },
  { lineItemId: "l3", code: "3", description: "Ceiling", category: "Gypsum", amount: 400, parentLineItemId: null },
  { lineItemId: "l4", code: "4", description: "Odd job", category: null, amount: 100, parentLineItemId: null },
  // A weighted sub-task of l1: its amount is a share of l1's and must never be
  // added on top (Master v5 B-3/D-3).
  { lineItemId: "l1a", code: "1.1", description: "Sub: Frame", category: "Civil", amount: 400, parentLineItemId: "l1" },
]

describe("rollUpLinesByCategory (R67 I-05)", () => {
  test("unfiltered: subtotals per category, Uncategorized last, Grand Total = sum of subtotals", () => {
    const { byCategory, grandTotal } = rollUpLinesByCategory(CATEGORY_LINES)
    expect(byCategory).toEqual([
      { category: "Civil", subtotal: 1500, lineCount: 3 },
      { category: "Gypsum", subtotal: 400, lineCount: 1 },
      { category: UNCATEGORIZED_LABEL, subtotal: 100, lineCount: 1 },
    ])
    expect(grandTotal).toBe(2000)
    expect(grandTotal).toBe(byCategory.reduce((s, c) => s + c.subtotal, 0))
  })

  test("a weighted sub-task is returned and counted but contributes no money -- never double-counted", () => {
    const civil = rollUpLinesByCategory(CATEGORY_LINES).byCategory.find((c) => c.category === "Civil")!
    expect(civil.lineCount).toBe(3) // l1, l2, l1a
    expect(civil.subtotal).toBe(1500) // l1 + l2 only; l1a's 400 is a share of l1's 1000
  })

  test("categoryFilter=['Civil'] keeps only Civil rows and the Grand Total equals their subtotal", () => {
    const { lines, byCategory, grandTotal } = rollUpLinesByCategory(CATEGORY_LINES, ["Civil"])
    expect(lines.map((l) => l.lineItemId)).toEqual(["l1", "l2", "l1a"])
    expect(byCategory).toEqual([{ category: "Civil", subtotal: 1500, lineCount: 3 }])
    expect(grandTotal).toBe(1500)
    expect(grandTotal).toBe(byCategory[0].subtotal)
  })

  test("the filter is case-insensitive -- an imported 'civil' line is not silently dropped from a 'Civil' filter", () => {
    const lines: CategoryLine[] = [
      { lineItemId: "a", code: null, description: "x", category: "civil", amount: 10, parentLineItemId: null },
      { lineItemId: "b", code: null, description: "y", category: "CIVIL", amount: 20, parentLineItemId: null },
    ]
    const { grandTotal, byCategory } = rollUpLinesByCategory(lines, ["Civil"])
    expect(grandTotal).toBe(30)
    expect(byCategory.length).toBe(1) // one bucket, not two spellings
  })

  test("Uncategorized is selectable by name, and matches only lines that truly have none", () => {
    const { lines, grandTotal } = rollUpLinesByCategory(CATEGORY_LINES, [UNCATEGORIZED_LABEL])
    expect(lines.map((l) => l.lineItemId)).toEqual(["l4"])
    expect(grandTotal).toBe(100)
  })

  test("an empty or all-blank filter means every category, not none", () => {
    expect(rollUpLinesByCategory(CATEGORY_LINES, []).grandTotal).toBe(2000)
    expect(rollUpLinesByCategory(CATEGORY_LINES, ["  "]).grandTotal).toBe(2000)
  })

  test("a filter naming a category nobody uses returns nothing and a Grand Total of 0 -- never the unfiltered total", () => {
    const { lines, byCategory, grandTotal } = rollUpLinesByCategory(CATEGORY_LINES, ["Joinery"])
    expect(lines).toEqual([])
    expect(byCategory).toEqual([])
    expect(grandTotal).toBe(0)
  })
})

describe("workProgressReport with categoryFilter (R67 I-05, real code path)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  async function runWorkProgressReport(categoryFilter?: string[]) {
    const fakeDb = {
      query: {
        constructionActivities: { findMany: mock(async () => []) },
        constructionBoqs: { findMany: mock(async () => [{ id: "boq-1", status: "approved", version: 2 }]) },
        constructionBoqLineItems: {
          findMany: mock(async () =>
            CATEGORY_LINES.map((l) => ({
              id: l.lineItemId,
              itemCode: l.code,
              description: l.description,
              category: l.category,
              amount: String(l.amount),
              parentLineItemId: l.parentLineItemId,
            }))
          ),
        },
      },
      select: () => ({ from: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }) }),
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablementService,
      requireConstructionEnabled: mock(async () => {}),
    }))
    const { workProgressReport } = await import("./construction-reports-service")
    return workProgressReport({ orgId: "org-wpr-test" }, "proj-1", categoryFilter ? { categoryFilter } : {})
  }

  test("categoryFilter=['Civil'] returns only Civil rows and a Grand Total equal to their subtotal", async () => {
    const result = await runWorkProgressReport(["Civil"])
    expect(result.lines.map((l) => l.lineItemId)).toEqual(["l1", "l2", "l1a"])
    expect(result.byCategory).toEqual([{ category: "Civil", subtotal: 1500, lineCount: 3 }])
    expect(result.grandTotal).toBe(1500)
    expect(result.grandTotal).toBe(result.byCategory[0].subtotal)
  })

  test("no filter returns every category, and the report still names the BOQ it categorised", async () => {
    const result = await runWorkProgressReport()
    expect(result.boqId).toBe("boq-1")
    expect(result.byCategory.map((c) => c.category)).toEqual(["Civil", "Gypsum", UNCATEGORIZED_LABEL])
    expect(result.grandTotal).toBe(2000)
  })

  test("the pre-existing `activities` key is still present and still its own shape", async () => {
    const result = await runWorkProgressReport()
    expect(Array.isArray(result.activities)).toBe(true)
    expect(result.activities).toEqual([])
  })
})

// R67 E-02 (R-012). The project dashboard's category panel becomes
// "Completed AED n / Total AED n" instead of a bare percentage, which means
// the percentage (from the ACTIVITY hierarchy) and the money (from the BOQ
// LINES) must meet on one set of buckets. These two pure functions are that
// join; both are DB-free, tested here directly per this file's own convention.
describe("attributeBoqAmountsByCategory (R67 E-02)", () => {
  const CATEGORIES = [{ id: "cat-civil", name: "Civil" }, { id: "cat-mep", name: "MEP" }]
  const ACTIVITIES = [{ id: "act-1", categoryId: "cat-mep" }]

  test("the line's own category TEXT wins, and matches an existing project category case-insensitively", () => {
    const out = attributeBoqAmountsByCategory(
      [{ activityId: null, amount: 1000, category: "civil" }],
      CATEGORIES,
      ACTIVITIES
    )
    expect(out.categories.find((c) => c.categoryId === "cat-civil")?.totalAmount).toBe(1000)
    // NOT a second "civil" bucket beside the real "Civil" one -- that is the
    // duplicate-slice defect this convergence rule exists to prevent.
    expect(out.categories.filter((c) => c.totalAmount > 0)).toHaveLength(1)
  })

  test("no category text falls back to the activity's category, exactly as before", () => {
    const out = attributeBoqAmountsByCategory(
      [{ activityId: "act-1", amount: 500, category: null }],
      CATEGORIES,
      ACTIVITIES
    )
    expect(out.categories.find((c) => c.categoryId === "cat-mep")?.totalAmount).toBe(500)
    expect(out.uncategorizedAmount).toBe(0)
  })

  test("a category text matching no project row gets a stable synthetic id, never a collision with a real cuid", () => {
    const out = attributeBoqAmountsByCategory(
      [{ activityId: null, amount: 250, category: "Joinery" }],
      CATEGORIES,
      ACTIVITIES
    )
    const synthetic = out.categories.find((c) => c.name === "Joinery")
    expect(synthetic?.categoryId).toBe("text:joinery")
    expect(synthetic?.totalAmount).toBe(250)
  })

  test("neither path resolves: the amount lands in uncategorized, and the totals still tie", () => {
    const out = attributeBoqAmountsByCategory(
      [
        { activityId: null, amount: 1000, category: "Civil" },
        { activityId: null, amount: 300, category: null },
      ],
      CATEGORIES,
      ACTIVITIES
    )
    expect(out.uncategorizedAmount).toBe(300)
    // The identity the pie depends on: every line's amount is in the total
    // exactly once, whichever bucket it landed in.
    expect(out.totalAmount).toBe(1300)
    expect(out.categories.reduce((s, c) => s + c.totalAmount, 0) + out.uncategorizedAmount).toBe(out.totalAmount)
  })

  test("drizzle numeric columns arrive as strings and are summed as numbers, not concatenated", () => {
    const out = attributeBoqAmountsByCategory(
      [
        { activityId: null, amount: "1000.50", category: "Civil" },
        { activityId: null, amount: "2000.25", category: "Civil" },
      ],
      CATEGORIES,
      ACTIVITIES
    )
    expect(out.categories.find((c) => c.categoryId === "cat-civil")?.totalAmount).toBe(3000.75)
  })
})

describe("mergeCategoryProgressWithAmounts (R67 E-02)", () => {
  const AMOUNTS = {
    categories: [
      { categoryId: "cat-civil", name: "Civil", totalAmount: 750 },
      { categoryId: "cat-mep", name: "MEP", totalAmount: 250 },
    ],
    uncategorizedAmount: 0,
    totalAmount: 1000,
  }
  const NAMES = new Map([["cat-civil", "Civil"], ["cat-mep", "MEP"]])

  test("completedAmount is the category's own money times its own percentage", () => {
    const rows = mergeCategoryProgressWithAmounts(new Map([["cat-civil", 40]]), AMOUNTS, NAMES)
    const civil = rows.find((r) => r.categoryId === "cat-civil")!
    expect(civil.totalAmount).toBe(750)
    expect(civil.percentComplete).toBe(40)
    expect(civil.completedAmount).toBe(300)
  })

  test("sharePercent is the slice of the BOQ, to one decimal, and the slices sum to 100", () => {
    const rows = mergeCategoryProgressWithAmounts(new Map(), AMOUNTS, NAMES)
    expect(rows.find((r) => r.categoryId === "cat-civil")!.sharePercent).toBe(75)
    expect(rows.find((r) => r.categoryId === "cat-mep")!.sharePercent).toBe(25)
    expect(rows.reduce((s, r) => s + r.sharePercent, 0)).toBe(100)
  })

  test("a money bucket with no progress hierarchy behind it is 0%, not dropped", () => {
    const withText = { ...AMOUNTS, categories: [...AMOUNTS.categories, { categoryId: "text:joinery", name: "Joinery", totalAmount: 0 }] }
    const rows = mergeCategoryProgressWithAmounts(new Map([["cat-civil", 40]]), withText, NAMES)
    const joinery = rows.find((r) => r.categoryId === "text:joinery")!
    expect(joinery.percentComplete).toBe(0)
    expect(rows).toHaveLength(3)
  })

  test("a progress bucket with no BOQ money behind it keeps its NAME and reports 0 money", () => {
    const rows = mergeCategoryProgressWithAmounts(new Map([["cat-finishes", 20]]), AMOUNTS, new Map([["cat-finishes", "Finishes"]]))
    const finishes = rows.find((r) => r.categoryId === "cat-finishes")!
    expect(finishes.name).toBe("Finishes")
    expect(finishes.totalAmount).toBe(0)
    expect(finishes.completedAmount).toBe(0)
  })

  test("a BOQ worth nothing produces 0 shares, never NaN", () => {
    const empty = { categories: [{ categoryId: "cat-civil", name: "Civil", totalAmount: 0 }], uncategorizedAmount: 0, totalAmount: 0 }
    const rows = mergeCategoryProgressWithAmounts(new Map([["cat-civil", 50]]), empty, NAMES)
    expect(rows[0].sharePercent).toBe(0)
    expect(Number.isNaN(rows[0].sharePercent)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// R67 E-06 (R-108) -- ONE BUDGET NUMBER
//
// Three screens disagreed: the dashboard tile read "TOTAL BUDGET AED 0", the
// Project Status report read "Budget 0", and Cost Variance read 2,193.75. The
// acceptance for this item is precisely that they now agree, so the fixture
// below is the item's own 2,193.75 and the assertions compare the three
// figures to each other rather than to three separately-typed constants.
// ---------------------------------------------------------------------------
describe("sumRootLineBudgets (R67 E-06)", () => {
  test("sums amount x budgetPercentage / 100 over the ROOT lines -- the item's own 2,193.75", () => {
    expect(sumRootLineBudgets([
      { parentLineItemId: null, amount: 5400, budgetPercentage: 25 },  // 1350
      { parentLineItemId: null, amount: 3375, budgetPercentage: 25 },  //  843.75
    ])).toBe(2193.75)
  })

  test("a weighted sub-task is NOT added again -- its amount is already inside its parent's", () => {
    const withChildren = sumRootLineBudgets([
      { parentLineItemId: null, amount: 5400, budgetPercentage: 25 },
      { parentLineItemId: "root-1", amount: 2700, budgetPercentage: 25 },
      { parentLineItemId: "root-1", amount: 2700, budgetPercentage: 25 },
    ])
    expect(withChildren).toBe(1350)
  })

  test("no lines at all is null, NEVER 0 -- 'no BOQ' is not 'a budget of nothing'", () => {
    expect(sumRootLineBudgets([])).toBeNull()
    expect(sumRootLineBudgets([{ parentLineItemId: "root-1", amount: 100, budgetPercentage: 25 }])).toBeNull()
  })

  test("a real BOQ worth zero still reports 0 -- absent and zero stay distinguishable in both directions", () => {
    expect(sumRootLineBudgets([{ parentLineItemId: null, amount: 0, budgetPercentage: 25 }])).toBe(0)
  })

  test("rounds ONCE at the end, so the total reconciles to a raw SQL sum over the same rows", () => {
    // Three lines whose individual budgets are 33.333..., summed then rounded.
    expect(sumRootLineBudgets([
      { parentLineItemId: null, amount: 100, budgetPercentage: 33.3333 },
      { parentLineItemId: null, amount: 100, budgetPercentage: 33.3333 },
      { parentLineItemId: null, amount: 100, budgetPercentage: 33.3334 },
    ])).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// R67 E-08 (R-115) -- Revenue / Budget / Actual, scope-wise and category-wise
// ---------------------------------------------------------------------------
describe("aggregateRevenueBudgetActual (R67 E-08)", () => {
  const LINES = [
    { lineItemId: "l1", code: "C-01", description: "Blockwork", category: "Civil", revenue: 5400, budget: 1350, vendorAmount: 1500, materialAmount: null, manpowerAmount: null },
    { lineItemId: "l2", code: "C-02", description: "Plaster", category: "Civil", revenue: 3375, budget: 843.75, vendorAmount: null, materialAmount: 400, manpowerAmount: 200 },
    { lineItemId: "l3", code: "J-01", description: "Wardrobes", category: "Joinery", revenue: 2000, budget: 500, vendorAmount: null, materialAmount: null, manpowerAmount: null },
  ]

  test("scope-wise returns one row per BOQ line, keyed so a row can link back to it", () => {
    const { rows } = aggregateRevenueBudgetActual(LINES, "scope")
    expect(rows.map((r) => r.item)).toEqual(["C-01", "C-02", "J-01"])
    expect(rows[0].lineItemId).toBe("l1")
  })

  test("ACCEPTANCE: the category-wise rows' budget sums to the scope-wise total budget", () => {
    const scope = aggregateRevenueBudgetActual(LINES, "scope")
    const category = aggregateRevenueBudgetActual(LINES, "category")
    expect(category.rows.reduce((s, r) => s + r.budget, 0)).toBe(scope.totals.budget)
  })

  test("ACCEPTANCE: the category-wise rows' revenue sums to the BOQ contract total", () => {
    const category = aggregateRevenueBudgetActual(LINES, "category")
    expect(category.rows.reduce((s, r) => s + r.revenue, 0)).toBe(5400 + 3375 + 2000)
  })

  test("ACCEPTANCE: a row with budget 0 returns percentUsed null -- never a divide-by-zero 0%", () => {
    const { rows } = aggregateRevenueBudgetActual(
      [{ lineItemId: "l9", code: "X", description: "Provisional sum", category: null, revenue: 1000, budget: 0, vendorAmount: 250, materialAmount: null, manpowerAmount: null }],
      "scope"
    )
    expect(rows[0].budget).toBe(0)
    expect(rows[0].percentUsed).toBeNull()
  })

  test("actual is vendor + material + manpower, counting only the figures that exist", () => {
    const { rows } = aggregateRevenueBudgetActual(LINES, "scope")
    expect(rows[0].actual).toBe(1500)      // vendor only
    expect(rows[1].actual).toBe(600)       // material + manpower
    expect(rows[2].actual).toBeNull()      // nothing costed yet -- null, not 0
  })

  // R67 merge (2026-09-03): lane D's item D-26 flipped what `variance` means on
  // the per-line budget report -- budget MINUS committed, so a positive figure
  // is budget remaining and a negative one is the overrun -- and landed on main
  // first. E-08's fold follows that convention rather than shipping the
  // opposite reading of the same word on the same screen. Line 0 is over
  // budget (1500 spent against 1350) and now reads -150, not +150.
  test("variance is budget - actual, POSITIVE meaning budget remaining, and null while nothing is costed", () => {
    const { rows } = aggregateRevenueBudgetActual(LINES, "scope")
    expect(rows[0].variance).toBe(-150)     // 1350 budget, 1500 committed -- over
    expect(rows[1].variance).toBe(243.75)   // 843.75 budget, 600 committed -- under
    expect(rows[2].variance).toBeNull()
  })

  // The one predicate that answers "is this over budget", so no screen has to
  // re-derive it from the sign by hand and get it backwards.
  test("isLineOverBudget agrees with the sign, and a line nobody has costed is neither over nor under", () => {
    const { rows } = aggregateRevenueBudgetActual(LINES, "scope")
    expect(isLineOverBudget(rows[0].variance)).toBe(true)
    expect(isLineOverBudget(rows[1].variance)).toBe(false)
    expect(isLineOverBudget(rows[2].variance)).toBe(false)
  })

  test("percentUsed is one decimal", () => {
    const { rows } = aggregateRevenueBudgetActual(LINES, "scope")
    expect(rows[0].percentUsed).toBe(111.1)
  })

  test("an uncategorised line falls into ONE named bucket, not an empty label", () => {
    const { rows } = aggregateRevenueBudgetActual(
      [{ lineItemId: "l4", code: "Z", description: "Misc", category: null, revenue: 100, budget: 25, vendorAmount: null, materialAmount: null, manpowerAmount: null }],
      "category"
    )
    expect(rows[0].item).toBe(UNCATEGORIZED_LABEL)
    expect(rows[0].lineCount).toBe(1)
  })

  test("both foldings report the SAME totals -- one fold, two views", () => {
    const scope = aggregateRevenueBudgetActual(LINES, "scope")
    const category = aggregateRevenueBudgetActual(LINES, "category")
    expect(category.totals).toEqual(scope.totals)
  })

  test("no lines produces empty rows and null actual/variance, never a crash or a zero", () => {
    const empty = aggregateRevenueBudgetActual([], "category")
    expect(empty.rows).toEqual([])
    expect(empty.totals.budget).toBe(0)
    expect(empty.totals.actual).toBeNull()
    expect(empty.totals.percentUsed).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R67 E-06 ACCEPTANCE, run for real against the actual service functions with
// only the DB layer mocked -- the same "capture real modules, restore in
// afterEach" pattern as the designerTimesheetReport block above.
//
// This is the assertion the item is written around: the Project Status
// report's budget field and the budget-variance report's totalBudget are ONE
// number, and a project with no BOQ reports null rather than 0.
// ---------------------------------------------------------------------------
const BOQ_ROW = { id: "boq-1", orgId: "org-e06", projectId: "proj-e06", version: 2, status: "draft", title: "Main BOQ", createdAt: new Date("2026-01-05") }

function boqLine(over: Record<string, unknown>) {
  return {
    id: "l?", orgId: "org-e06", boqId: "boq-1", activityId: null, itemCode: null, description: "line",
    unit: "m2", quantity: "1", rate: "1", amount: "0", parentLineItemId: null, breakdownPercentage: null,
    materialCost: null, labourCost: null, equipmentCost: null, overheadPercent: null, profitPercent: null,
    budgetPercentage: "25", vendorId: null, vendorAmount: null, materialAmount: null, manpowerAmount: null,
    category: null, createdAt: new Date("2026-01-06"),
    ...over,
  }
}

// 5400 x 25% = 1350, 3375 x 25% = 843.75 -> 2193.75, the item's own figure.
// The child line would add another 675 if this code ever went back to summing
// every line instead of the root lines.
const E06_LINES = [
  boqLine({ id: "l1", itemCode: "C-01", description: "Blockwork", quantity: "120", rate: "45", amount: "5400", category: "Civil", vendorId: "sup-1", vendorAmount: "1500" }),
  boqLine({ id: "l2", itemCode: "C-02", description: "Site clearance", quantity: "1", rate: "3375", amount: "3375" }),
  boqLine({ id: "l3", itemCode: "C-01.1", description: "Blockwork - first lift", parentLineItemId: "l1", quantity: "60", rate: "45", amount: "2700", category: "Civil" }),
]

function fakeDbFor(lines: ReturnType<typeof boqLine>[], hasBoq: boolean) {
  // One canned row satisfies every aggregate this pair of functions runs
  // (ledger budget / revenue / expenses / task counts / photos / PO sum) and
  // the supplier-name lookup, because each reads only the keys it asked for.
  const ROW = { total: 0, count: 0, delayed: 0, id: "sup-1", name: "Alpha Contracting LLC" }
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  // R67 lane D22 (D-54, second-merge fold-in): boqBudgetVarianceReport's
  // interim-bill revenue rollup chains .where(...).groupBy(...) rather than
  // awaiting .where() directly (every other reader here does). where() has to
  // be BOTH awaitable (the aggregates that end there) and chainable into
  // groupBy() (this one) -- a promise carrying the extra method is the
  // smallest fake that is honest about both, same pattern the D-41 describe
  // block's own selectStub below already uses.
  chain.where = () => Object.assign(Promise.resolve([ROW]), { groupBy: async () => [ROW] })
  chain.groupBy = async () => [ROW]
  return {
    query: {
      projects: { findFirst: async () => ({ id: "proj-e06", name: "Cedar Heights Villa - Phase 1", projectValue: null }) },
      constructionActivities: { findMany: async () => [] },
      constructionBoqs: {
        findMany: async () => (hasBoq ? [BOQ_ROW] : []),
        findFirst: async () => (hasBoq ? BOQ_ROW : undefined),
      },
      constructionBoqLineItems: { findMany: async () => lines },
    },
    select: () => chain,
    // R67 merge (2026-09-03): getProjectDashboard no longer runs its own
    // per-project reads -- lane F2 moved them into getProjectDashboards, ONE
    // statement whose result this execute() stands in for. Serving it from the
    // SAME `lines` the BOQ reads above use is the point: E-06's acceptance is
    // that the dashboard and the budget-variance report state one number, so
    // both sides of that claim have to come from one set of line items. A row
    // is returned only when the project really has a BOQ, because that is what
    // the real statement does (LEFT JOIN ev, null items) and it is what makes
    // the "no BOQ -> budget null" case below a real assertion rather than a
    // 404 dressed up as one.
    execute: async () => [{
      project_id: "proj-e06",
      project_name: "Cedar Heights Villa - Phase 1",
      // The ERP annual ledger sum -- 0 here, which is exactly the figure that
      // used to be printed as "TOTAL BUDGET AED 0" and is why E-06 exists.
      budget: 0,
      // R67 D-02 (second-merge fold-in): how many erp_budget_line_items rows
      // the budget CTE matched -- a REAL row that happens to sum to zero, so
      // ledgerBudget reads 0 (not null, which would mean "no row at all").
      budget_lines: 1,
      revenue: 0,
      expenses: 0,
      progress_percent: null,
      task_count: 0,
      delayed_task_count: 0,
      photo_count: 0,
      permits_expiring: 0,
      permits_expired: 0,
      project_value: null,
      po_total: null,
      ev_items: hasBoq
        ? lines.map((l) => ({
            id: l.id,
            boqId: l.boqId,
            parentLineItemId: l.parentLineItemId,
            rate: l.rate,
            amount: l.amount,
            breakdownPercentage: l.breakdownPercentage,
            budgetPercentage: l.budgetPercentage,
            qty: null,
            percent: null,
          }))
        : null,
    }],
  }
}

describe("R67 E-06: the Project Status report and the budget-variance report state ONE budget", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  async function withFakeDb(lines: ReturnType<typeof boqLine>[], hasBoq: boolean) {
    // R67 F-27 added a 60 s per-project dashboard cache keyed on org+project.
    // Every test here uses the SAME org and project id, so without this reset
    // the "no BOQ" case would be served the previous test's "has BOQ" answer
    // and would pass for the wrong reason.
    const { resetDashboardCache } = await import("./project-dashboard-cache")
    resetDashboardCache()
    const fakeDb = fakeDbFor(lines, hasBoq)
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablementService,
      requireConstructionEnabled: mock(async () => {}),
      isConstructionEnabledForOrg: mock(async () => true),
    }))
    return import("./construction-reports-service")
  }

  test("ACCEPTANCE: a BOQ whose root lines carry computedBudget totalling 2193.75 gives the project-status report that figure, and the budget-variance report the same one", async () => {
    const { projectStatusReport, boqBudgetVarianceReport } = await withFakeDb(E06_LINES, true)
    const status = await projectStatusReport({ orgId: "org-e06" }, "proj-e06")
    const variance = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06")

    expect(status.budget).toBe(2193.75)
    expect(variance.totalBudget).toBe(2193.75)
    expect(status.budget).toBe(variance.totalBudget)
  })

  test("the ERP annual ledger figure is still returned, under its own name, so nothing that wants it has lost it", async () => {
    const { projectStatusReport } = await withFakeDb(E06_LINES, true)
    const status = await projectStatusReport({ orgId: "org-e06" }, "proj-e06")
    expect(status.ledgerBudget).toBe(0)
    expect(status.budget).not.toBe(status.ledgerBudget)
  })

  test("ACCEPTANCE: a project with no BOQ reports budget null -- rendered as an en dash, never 0", async () => {
    const { projectStatusReport, boqBudgetVarianceReport } = await withFakeDb([], false)
    const status = await projectStatusReport({ orgId: "org-e06" }, "proj-e06")
    const variance = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06")

    expect(status.budget).toBeNull()
    expect(variance.totalBudget).toBeNull()
  })

  test("R67 E-07: the report carries the S.No / Qty / Rate columns Sumeet's spec asks for, numbered over the contract lines only", async () => {
    const { boqBudgetVarianceReport } = await withFakeDb(E06_LINES, true)
    const report = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06")
    const roots = report.lines.filter((l) => l.isRootLine)
    expect(roots.map((l) => l.sNo)).toEqual([1, 2])
    expect(report.lines.find((l) => !l.isRootLine)!.sNo).toBeNull()
    expect(roots[0].quantity).toBe(120)
    expect(roots[0].rate).toBe(45)
    expect(report.subTaskLineCount).toBe(1)
  })

  test("R67 E-07: a Category filter narrows the report to that category AND takes its weighted sub-tasks with it", async () => {
    const { boqBudgetVarianceReport } = await withFakeDb(E06_LINES, true)
    const report = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06", { categories: ["Civil"] })
    expect(report.lines.map((l) => l.lineItemId)).toEqual(["l1", "l3"])
    expect(report.totalBudget).toBe(1350)
    expect(report.availableCategories).toEqual(["Civil"])
  })

  test("R67 E-07: a Vendor filter narrows to that vendor's lines, and the vendor list offers only vendors this BOQ actually uses", async () => {
    const { boqBudgetVarianceReport } = await withFakeDb(E06_LINES, true)
    const report = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06", { vendorId: "sup-1" })
    expect(report.lines.filter((l) => l.isRootLine).map((l) => l.lineItemId)).toEqual(["l1"])
    expect(report.availableVendors).toEqual([{ id: "sup-1", name: "Alpha Contracting LLC" }])
  })

  test("R67 E-07: a filter that matches nothing returns no lines and a null budget, not a crash", async () => {
    const { boqBudgetVarianceReport } = await withFakeDb(E06_LINES, true)
    const report = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06", { categories: ["Joinery"] })
    expect(report.lines).toEqual([])
    expect(report.totalBudget).toBeNull()
    expect(report.revenueBudgetActual.rows).toEqual([])
  })

  test("R67 E-08: the Revenue/Budget/Actual fold rides on the same read, and its scope-wise total budget is the report's own total", async () => {
    const { boqBudgetVarianceReport } = await withFakeDb(E06_LINES, true)
    const scope = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06")
    const byCategory = await boqBudgetVarianceReport({ orgId: "org-e06" }, "proj-e06", { groupBy: "category" })

    expect(scope.revenueBudgetActual.groupBy).toBe("scope")
    expect(scope.revenueBudgetActual.totals.budget).toBe(scope.totalBudget)
    expect(scope.revenueBudgetActual.totals.revenue).toBe(5400 + 3375)
    expect(byCategory.revenueBudgetActual.rows.map((r) => r.item)).toEqual(["Civil", UNCATEGORIZED_LABEL])
    expect(byCategory.revenueBudgetActual.totals).toEqual(scope.revenueBudgetActual.totals)
  })
})

// R75 Phase 3 (R74-RULING-03 closure for R-52 -- "Only the LATEST revision is
// counted"): R38 (23 Aug, TC-11/TC-43, cited in platform.sumeet_requirements)
// found and fixed a real bug live -- scopeReport()/categoryBoqAmountsReport()
// picked "latest" via version DESC with no tiebreaker, so 2+ independent BOQs
// sharing a version number could resolve to an arbitrary one. The fix added a
// createdAt DESC tiebreaker to the SQL orderBy (trusted here, not
// re-verified -- Postgres's own ORDER BY is not this test's concern) AND kept
// the existing `.find(b => b.status !== "superseded") ?? boqs[0]` fallback,
// which IS this test's concern: given boqs already in DB-sorted order, does
// the app correctly skip a superseded row instead of blindly trusting
// position 0? No existing test constructs a multi-BOQ scenario to check this
// -- every other scopeReport-adjacent test here uses exactly one BOQ. This is
// deliberately scoped to SELECTION only (which BOQ counts), not summation
// (R-33's already-covered concern, sumRootLineBudgets above) -- the fake
// select-chain returns a fixed canned value regardless of which boqId it was
// called with, same convention as fakeDbFor's ROW above, so this test's own
// assertions are on report.boq/report.revisions, never report.totalValue.
describe("scopeReport (R75 Phase 3 / R-52): the DB-sorted-first-non-superseded BOQ wins, not array position 0 blindly", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  const SUPERSEDED_NEWEST = { id: "boq-superseded", orgId: "org-r52", projectId: "proj-r52", version: 2, status: "superseded", title: "Superseded rev", createdAt: new Date("2026-02-01") }
  const ACTIVE_OLDER = { id: "boq-active", orgId: "org-r52", projectId: "proj-r52", version: 1, status: "approved", title: "Still-active v1", createdAt: new Date("2026-01-01") }

  function fakeDbMultiBoq(boqsInDbSortOrder: typeof SUPERSEDED_NEWEST[]) {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    // Canned, boqId-independent -- see this block's own header on why.
    chain.where = async () => [{ total: 999, count: 1 }]
    return {
      query: {
        constructionBoqs: { findMany: async () => boqsInDbSortOrder },
        constructionBoqLineItems: { findMany: async () => [] },
      },
      select: () => chain,
    }
  }

  async function withMultiBoqFakeDb(boqsInDbSortOrder: typeof SUPERSEDED_NEWEST[]) {
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDbMultiBoq(boqsInDbSortOrder))),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablementService,
      requireConstructionEnabled: mock(async () => {}),
      isConstructionEnabledForOrg: mock(async () => true),
    }))
    return import("./construction-reports-service")
  }

  test("a superseded row sorted first (higher version) is skipped -- the older but still-active row is the one that counts", async () => {
    const { scopeReport } = await withMultiBoqFakeDb([SUPERSEDED_NEWEST, ACTIVE_OLDER])
    const report = await scopeReport({ orgId: "org-r52" }, "proj-r52")

    expect(report.boq).not.toBeNull()
    expect(report.boq!.id).toBe(ACTIVE_OLDER.id)
    expect(report.boq!.id).not.toBe(SUPERSEDED_NEWEST.id)
    // Both still surface in the revisions list -- R-52 is about what COUNTS,
    // not about hiding the history.
    expect(report.revisions.map((r) => r.id).sort()).toEqual([ACTIVE_OLDER.id, SUPERSEDED_NEWEST.id].sort())
  })

  test("when NEITHER row is superseded, DB sort order (position 0, already version+createdAt DESC) wins -- the app trusts Postgres's own ORDER BY, it does not re-sort", async () => {
    const bothActive = { ...SUPERSEDED_NEWEST, id: "boq-both-active", status: "approved" }
    const { scopeReport } = await withMultiBoqFakeDb([bothActive, ACTIVE_OLDER])
    const report = await scopeReport({ orgId: "org-r52" }, "proj-r52")
    expect(report.boq!.id).toBe(bothActive.id)
  })

  test("no BOQ at all reports null, not a crash", async () => {
    const { scopeReport } = await withMultiBoqFakeDb([])
    const report = await scopeReport({ orgId: "org-r52" }, "proj-r52")
    expect(report.boq).toBeNull()
    expect(report.totalValue).toBe(0)
    expect(report.revisions).toEqual([])
  })
})

// R67 lane D22 (item D-41): the Budget screen PROJEXA now renders at /budgets
// prints Sumeet's own columns -- S.No | Category | Code | Description | Qty |
// Rate | Amount | Budget % | Budget | Vendor | Vendor Amt | Material |
// Manpower -- and deep-links each row back to /scope/{boqId}#line-{id}. Qty,
// Rate, Unit and the BOQ's own identity were the parts this report could not
// answer, so the screen would have had to load the whole BOQ a second time.
// Exercised through the real boqBudgetVarianceReport() code path with only the
// DB layer and the construction-enablement gate mocked, the same convention
// the workProgressReport block above uses.
describe("boqBudgetVarianceReport widened for the project Budget screen (R67 D-41)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  const BOQ = { id: "boq-9", projectId: "proj-1", title: "Fit-out BOQ", version: 2, status: "approved", createdAt: new Date("2026-08-01") }
  const LINE_ITEMS = [
    {
      id: "li-1", itemCode: "R60SK", description: "R60 skiphop sub", category: "Civil",
      quantity: "10", unit: "m2", rate: "650", amount: "6500", parentLineItemId: null,
      budgetPercentage: "25", materialAmount: "900", manpowerAmount: "600",
      vendorId: "sup-1", vendorAmount: "1700",
    },
    {
      id: "li-2", itemCode: "GYP-1", description: "Ceiling grid", category: "Gypsum",
      quantity: "4", unit: "m2", rate: "100", amount: "400", parentLineItemId: null,
      budgetPercentage: "25", materialAmount: null, manpowerAmount: null,
      vendorId: null, vendorAmount: null,
    },
  ]

  // R67 lane D22 (item D-54): boqBudgetVarianceReport now runs TWO db.select()
  // chains -- the supplier-name lookup (.from().where()) and the interim-bill
  // revenue rollup (.from().innerJoin().where().groupBy()). One thenable
  // builder answers both shapes, handing back the next queued result set in
  // call order, so a test can say what each query returns without pretending
  // to be Drizzle.
  function selectStub(resultsInCallOrder: unknown[][]) {
    let call = -1
    return () => {
      call += 1
      const rows = resultsInCallOrder[call] ?? []
      const builder: Record<string, unknown> = {}
      const step = () => builder
      builder.from = step
      builder.innerJoin = step
      builder.where = step
      builder.groupBy = step
      builder.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => Promise.resolve(rows).then(onOk, onErr)
      return builder
    }
  }

  async function runBudgetVariance(boqs: unknown[] = [BOQ], lineItems: unknown[] = LINE_ITEMS, billedRows: unknown[] = []) {
    const fakeDb = {
      query: {
        constructionBoqs: { findMany: mock(async () => boqs) },
        constructionBoqLineItems: { findMany: mock(async () => lineItems) },
      },
      select: selectStub([[{ id: "sup-1", name: "Skiphop Interiors" }], billedRows]),
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    await mock.module("./construction-enablement-service", () => ({
      ...realEnablementService,
      requireConstructionEnabled: mock(async () => {}),
    }))
    const { boqBudgetVarianceReport } = await import("./construction-reports-service")
    return boqBudgetVarianceReport({ orgId: "org-budget-test" }, "proj-1")
  }

  test("every line carries the Sumeet columns the Budget screen prints -- quantity, unit, rate, category and the material/manpower split", async () => {
    const result = await runBudgetVariance()
    expect(result.lines[0]).toMatchObject({
      lineItemId: "li-1", code: "R60SK", description: "R60 skiphop sub", category: "Civil",
      quantity: 10, unit: "m2", rate: 650, amount: 6500,
      budgetPercentage: 25, budget: 1625,
      materialAmount: 900, manpowerAmount: 600,
      // R67 integration: `variance` follows D-26's contract change -- it is
      // BUDGET REMAINING (budget 1625 - committed 3200), not the original
      // overspend figure (vendorAmount - budget) this lane was written against.
      vendorName: "Skiphop Interiors", vendorAmount: 1700, variance: -1575,
    })
    // Numbers, not the numeric-as-string Drizzle hands back -- a screen that
    // does arithmetic on these must never get "10" + "4" = "104".
    expect(typeof result.lines[0].quantity).toBe("number")
    expect(typeof result.lines[0].rate).toBe("number")
  })

  test("a line the QS has not split reads null for material/manpower, never a fabricated 0", async () => {
    const result = await runBudgetVariance()
    expect(result.lines[1].materialAmount).toBeNull()
    expect(result.lines[1].manpowerAmount).toBeNull()
  })

  test("the report names the BOQ its lines came from, so each row can deep-link to /scope/{boqId}#line-{id}", async () => {
    const result = await runBudgetVariance()
    expect(result.boqId).toBe("boq-9")
    expect(result.boqTitle).toBe("Fit-out BOQ")
    expect(result.boqVersion).toBe(2)
  })

  // R67 second-merge fix: restated against the actual merged empty shape.
  // This lane's own key list predates E-06/E-07/E-08 landing on the same
  // function (subTaskLineCount, availableCategories, availableVendors,
  // filters, revenueBudgetActual, categorySubtotals) -- those are real keys
  // the populated branch also returns (see boqBudgetVarianceReport's own
  // comment on why every key must match), so the exact list here now
  // includes them too, and totalBudget is null (E-06's "no BOQ is not a
  // budget of nothing" rule), not the 0 this test predates.
  test("a project with no BOQ answers the SAME keys, so the screen renders zeroes rather than NaN", async () => {
    const result = await runBudgetVariance([], [])
    // R67 integration: the empty shape is the union of what every lane's
    // screen reads. Listed exactly rather than as a subset, because the whole
    // point of this test is that a key present in the populated shape and
    // missing here renders "NaN" on a project that has no BOQ yet.
    expect(Object.keys(result).sort()).toEqual(
      [
        "boqId", "boqTitle", "boqVersion", "lines", "subTaskLineCount",
        "totalBudget", "totalVendorAmount", "totalMaterialAmount", "totalManpowerAmount",
        "totalCommitted", "totalVariance", "budgetRemaining",
        "totalActual", "totalRevenue", "linesOverBudget", "lineCount",
        "availableCategories", "availableVendors", "filters", "revenueBudgetActual", "categorySubtotals", "note",
      ].sort()
    )
    expect(result.boqId).toBeNull()
    expect(result.lines).toEqual([])
    expect(result.totalBudget).toBeNull()
  })

  test("the grand total ties to the per-line budgets, and moving one line's Budget % moves it by exactly that line's delta", async () => {
    const before = await runBudgetVariance()
    expect(before.totalBudget).toBe(1625 + 100)
    expect(before.totalBudget).toBe(before.lines.reduce((s, l) => s + l.budget, 0))

    mock.restore()
    const at30 = await runBudgetVariance([BOQ], [{ ...LINE_ITEMS[0], budgetPercentage: "30" }, LINE_ITEMS[1]])
    expect(at30.lines[0].budget).toBe(1950)
    expect(at30.totalBudget - before.totalBudget).toBe(325)
  })

  // R67 lane D22 (item D-54, rec R-183): the Scope > Budget tab prints
  // ... | Vendor Amt | Material | Manpower | Actual | Revenue | Variance, and
  // Actual/Revenue are the two the report could not answer. Actual is the
  // vendor+material+manpower sum; Revenue is what the interim/RA bills raised
  // on this BOQ have already billed against the line.
  test("Actual is vendor + material + manpower, per line and in the total", async () => {
    const result = await runBudgetVariance()
    expect(result.lines[0].actual).toBe(1700 + 900 + 600)
    expect(result.totalActual).toBe(3200)
  })

  test("a line nobody has costed reads Actual null, never a fabricated 0", async () => {
    const result = await runBudgetVariance()
    expect(result.lines[1].actual).toBeNull()
    // ...and an uncosted line contributes nothing to the total rather than
    // dragging it toward zero.
    expect(result.totalActual).toBe(result.lines[0].actual)
  })

  test("Revenue is what the interim bills have billed against the line, summed across every bill", async () => {
    const result = await runBudgetVariance([BOQ], LINE_ITEMS, [
      { boqLineItemId: "li-1", total: "1200.50" },
    ])
    expect(result.lines[0].revenue).toBe(1200.5)
    expect(result.totalRevenue).toBe(1200.5)
  })

  test("a line that has never been billed reads Revenue null -- 'not yet billed' is not 'billed nothing'", async () => {
    const result = await runBudgetVariance([BOQ], LINE_ITEMS, [{ boqLineItemId: "li-1", total: "1200" }])
    expect(result.lines[1].revenue).toBeNull()
  })

  // R67 integration, replacing this lane's "the original vendor-vs-budget
  // `variance` is unchanged" test. It is NOT unchanged: D-26 (already on main)
  // redefined `variance` as BUDGET REMAINING -- same name, opposite sign. The
  // assertion is corrected to the merged contract rather than deleted, and the
  // alias relationship both lanes' screens depend on is pinned with it.
  test("`variance` is budget remaining (D-26's contract), and `actual` is exactly `committed` under Sumeet's name", async () => {
    const result = await runBudgetVariance()
    // budget 1625 - committed (1700 + 900 + 600) = -1575
    expect(result.lines[0].variance).toBe(-1575)
    expect(result.lines[0].budgetRemaining).toBe(result.lines[0].variance)
    expect(result.lines[0].actual).toBe(result.lines[0].committed)
    expect(result.totalActual).toBe(result.totalCommitted)
    // A line nobody has costed is neither over nor under budget, on every name.
    expect(result.lines[1].variance).toBeNull()
    expect(result.lines[1].committed).toBeNull()
    expect(result.lines[1].actual).toBeNull()
  })
})

// R67 D-02 (audit R-004/R-009). budgetVsActual() reads
// getProjectDashboard().budget, which is now `number | null` -- null when no
// erp_budget_line_items row exists for the project's scope. `budget - actual`
// on a null budget would have reported every unbudgeted project as overspent
// by exactly its own spend; the rule now lives in one pure function.
describe("budgetVariance (R67 D-02: no budget means no variance)", () => {
  test("returns null when no budget has been set, rather than 0 - actual", async () => {
    const { budgetVariance } = await import("./construction-reports-service")
    expect(budgetVariance(null, 185_000)).toBeNull()
  })

  test("returns the real signed variance when a budget exists", async () => {
    const { budgetVariance } = await import("./construction-reports-service")
    expect(budgetVariance(500_000, 185_000)).toBe(315_000)
    expect(budgetVariance(100_000, 185_000)).toBe(-85_000)
  })

  test("a genuine zero budget still produces a real variance, not null", async () => {
    const { budgetVariance } = await import("./construction-reports-service")
    expect(budgetVariance(0, 185_000)).toBe(-185_000)
  })
})

// --- R67 D-62: the Budget tab's own line -----------------------------------
//
// toBudgetLine() is the pure half of boqBudgetVarianceReport(), extracted so the
// arithmetic and -- more importantly -- the null rules can be checked without a
// database. Everything it reads is an EXISTING column: budgetPercentage (NOT
// NULL DEFAULT 25), vendorId, vendorAmount, materialAmount, manpowerAmount and
// the line's own category. D-62 asks for a migration only if they were missing;
// they are not.
//
// materialAmount/manpowerAmount, NOT materialCost/labourCost: settled at the
// R67 lane I merge (2026-09-03). The cost pair is Wave 125's PER-UNIT rate
// analysis; the amount pair is the budget-side split for the whole line, which
// is what this report projects. schema.ts states the distinction at both
// columns. The first draft of D-62 read the cost pair, and this test file now
// asserts the corrected pair so the swap cannot come back unnoticed.
describe("R67 D-62 toBudgetLine", () => {
  const vendors = new Map([["sup_1", "Al Noor Trading"]])
  const base = {
    id: "li_1",
    itemCode: "1.2",
    description: "Blockwork",
    amount: "100000",
    budgetPercentage: "25",
    materialAmount: null,
    manpowerAmount: null,
    vendorId: null,
    vendorAmount: null,
    category: null,
  }

  test("the 25% default budget is the column's default, applied per line", () => {
    expect(toBudgetLine(base, vendors).budget).toBe(25_000)
    expect(toBudgetLine(base, vendors).budgetPercentage).toBe(25)
  })

  test("a per-line override recomputes the budget from that line's own percent", () => {
    expect(toBudgetLine({ ...base, budgetPercentage: "40" }, vendors).budget).toBe(40_000)
  })

  // R67 MERGE (D-11, lane D1 x lane D21, 2026-09-03). RESTATED, NOT DELETED.
  // D1 wrote these three assertions against its own sign (variance =
  // vendorAmount - budget, so 30,000 committed against a 25,000 budget read
  // +5,000 "overspent"). D21's computeBudgetVarianceLine, which toBudgetLine now
  // computes through, defines variance as BUDGET REMAINING (budget - committed),
  // so the same facts read -5,000. The FACTS each assertion pins down are
  // unchanged and all three still bite:
  //   - nothing costed at all  -> null, never 0
  //   - a real quote above the budget -> a real, signed variance
  //   - a genuine quote of ZERO is a quote, and is not "not yet costed"
  test("variance is null -- not 0 -- until a cost has actually been entered", () => {
    expect(toBudgetLine(base, vendors).variance).toBeNull()
    // 25,000 budget, 30,000 committed -> 5,000 OVER, i.e. -5,000 remaining.
    expect(toBudgetLine({ ...base, vendorAmount: "30000" }, vendors).variance).toBe(-5_000)
    // A real quote of zero is a real quote, and does produce a variance:
    // nothing has been committed, so the whole 25,000 budget remains.
    expect(toBudgetLine({ ...base, vendorAmount: "0" }, vendors).variance).toBe(25_000)
  })

  // R67 D-26, asserted from D1's own fixture: "committed" is vendor PLUS
  // material PLUS manpower, not the subcontract alone. Under D1's original
  // vendor-only formula a line costed entirely through material and manpower
  // reported no variance at all.
  test("material and manpower are committed cost too, not just the vendor amount", () => {
    const line = toBudgetLine({ ...base, materialAmount: "60000", manpowerAmount: "15000" }, vendors)
    expect(line.committed).toBe(75_000)
    expect(line.variance).toBe(-50_000)
    expect(isLineOverBudget(line.variance)).toBe(true)
  })

  test("Material and Manpower come from the line's own budget-side columns, null when unset", () => {
    const line = toBudgetLine({ ...base, materialAmount: "60000", manpowerAmount: "15000" }, vendors)
    expect(line.materialAmount).toBe(60_000)
    expect(line.manpowerAmount).toBe(15_000)
    const bare = toBudgetLine(base, vendors)
    expect(bare.materialAmount).toBeNull()
    expect(bare.manpowerAmount).toBeNull()
  })

  test("a line split as 0/0 stays distinguishable from a line nobody has split", () => {
    const split = toBudgetLine({ ...base, materialAmount: "0", manpowerAmount: "0" }, vendors)
    expect(split.materialAmount).toBe(0)
    expect(split.manpowerAmount).toBe(0)
    expect(toBudgetLine(base, vendors).materialAmount).toBeNull()
  })

  test("the vendor is named, not shown as an id, and is null when the line has no vendor", () => {
    expect(toBudgetLine({ ...base, vendorId: "sup_1" }, vendors).vendorName).toBe("Al Noor Trading")
    expect(toBudgetLine(base, vendors).vendorName).toBeNull()
    // A vendor id whose supplier row is gone must not render as the raw id.
    expect(toBudgetLine({ ...base, vendorId: "sup_missing" }, vendors).vendorName).toBeNull()
  })

  test("Category is the line's own column and is null -- never \"\" -- when it has none", () => {
    expect(toBudgetLine({ ...base, category: "Civil" }, vendors).category).toBe("Civil")
    expect(toBudgetLine(base, vendors).category).toBeNull()
  })

  test("totals are summed from the RAW figures, so per-line rounding cannot drift them", () => {
    const items = ["a", "b", "c"].map((id) => ({ ...base, id, amount: "10", budgetPercentage: "33.333" }))
    const lines = items.map((i) => toBudgetLine(i, vendors))
    // Each line displays 3.33 (3.3333 rounded); the true total is 9.9999.
    expect(lines[0].budget).toBe(3.33)
    const rawTotal = Math.round(lines.reduce((s, l) => s + l._rawBudget, 0) * 100) / 100
    const roundedTotal = Math.round(lines.reduce((s, l) => s + l.budget, 0) * 100) / 100
    expect(rawTotal).toBe(10)
    expect(roundedTotal).toBe(9.99)
    expect(roundedTotal).not.toBe(rawTotal)
  })
})

// ---------------------------------------------------------------------------
// R67 D-53: the Manpower Daily Summary aggregator.
//
// aggregateManpowerDailySummary() is the whole arithmetic of the tab -- the DB
// half around it is one joined SELECT and one vendor-name lookup -- so the row
// oracle the item states ("the totals row Daily cost equals the sum of the two
// trade rows" and "expanding a trade lists the same headcount as its Present +
// Absent + Half-day") is asserted here directly.
// ---------------------------------------------------------------------------
import {
  aggregateManpowerDailySummary,
  UNCATEGORISED_TRADE_LABEL,
  type ManpowerDailyPerson,
} from "./construction-reports-service"

function person(over: Partial<ManpowerDailyPerson> & Pick<ManpowerDailyPerson, "id" | "name" | "status">): ManpowerDailyPerson {
  return {
    employeeCode: null,
    trade: null,
    company: null,
    dailyRate: 100,
    cost: 0,
    ...over,
  }
}

describe("aggregateManpowerDailySummary", () => {
  // Two trades on one date, exactly the acceptance fixture.
  const people: ManpowerDailyPerson[] = [
    person({ id: "r1", name: "Ali Hassan", trade: "Civil", status: "present", dailyRate: 120, cost: 120 }),
    person({ id: "r2", name: "Bilal Khan", trade: "Civil", status: "half_day", dailyRate: 120, cost: 60 }),
    person({ id: "r3", name: "Chandra Rao", trade: "Civil", status: "absent", dailyRate: 120, cost: 0 }),
    person({ id: "r4", name: "Dinesh Kumar", trade: "Paint", status: "present", dailyRate: 90, cost: 90 }),
    person({ id: "r5", name: "Ehsan Ali", trade: "Paint", status: "present", dailyRate: 90, cost: 90 }),
  ]

  const { rows, totals } = aggregateManpowerDailySummary(people)

  test("one row per trade with the present/absent/half-day split", () => {
    expect(rows).toEqual([
      { trade: "Civil", present: 1, absent: 1, halfDay: 1, headcount: 3, cost: 180 },
      { trade: "Paint", present: 2, absent: 0, halfDay: 0, headcount: 2, cost: 180 },
    ])
  })

  test("headcount is exactly present + absent + half-day, so an expanded trade lists that many people", () => {
    for (const row of rows) {
      expect(row.headcount).toBe(row.present + row.absent + row.halfDay)
      expect(people.filter((p) => p.trade === row.trade)).toHaveLength(row.headcount)
    }
  })

  test("the totals row Daily cost equals the sum of the trade rows", () => {
    expect(totals.cost).toBe(360)
    expect(totals.cost).toBe(rows.reduce((sum, row) => sum + row.cost, 0))
    expect(totals.headcount).toBe(5)
  })

  test("a worker with no trade groups under 'Uncategorised trade', and it sorts LAST", () => {
    const { rows: mixed } = aggregateManpowerDailySummary([
      person({ id: "r6", name: "Zia", trade: null, status: "present", cost: 100 }),
      person({ id: "r7", name: "Adnan", trade: "  ", status: "present", cost: 100 }),
      person({ id: "r8", name: "Yusuf", trade: "Civil", status: "present", cost: 100 }),
    ])
    expect(mixed.map((r) => r.trade)).toEqual(["Civil", UNCATEGORISED_TRADE_LABEL])
    expect(mixed[1]).toMatchObject({ present: 2, headcount: 2, cost: 200 })
  })

  test("an unmarked day aggregates to no rows and a zeroed totals row, never to NaN", () => {
    const { rows: none, totals: zero } = aggregateManpowerDailySummary([])
    expect(none).toEqual([])
    expect(zero).toEqual({ trade: "Total", present: 0, absent: 0, halfDay: 0, headcount: 0, cost: 0 })
  })

  test("money adds without binary-float drift (0.1 + 0.2 must not become 0.30000000000000004)", () => {
    const { totals: drift } = aggregateManpowerDailySummary([
      person({ id: "r9", name: "A", trade: "Civil", status: "present", cost: 0.1 }),
      person({ id: "r10", name: "B", trade: "Civil", status: "present", cost: 0.2 }),
    ])
    expect(drift.cost).toBe(0.3)
  })
})

// R67 D-26 (R-066) -- the Cost Variance tab's real arithmetic. Sumeet's budget
// model against a scope line is vendor, MATERIAL and MANPOWER; only vendor
// existed, so "committed" could never be more than the subcontract. The sign
// also changed: variance now reads as HOW MUCH BUDGET IS LEFT
// (budget - vendor - material - manpower), so positive is under budget.
describe("computeBudgetVarianceLine (D-26)", () => {
  const line = (over: Partial<Parameters<typeof computeBudgetVarianceLine>[0]> = {}) => ({
    amount: 100, budgetPercentage: 100, vendorAmount: null, materialAmount: null, manpowerAmount: null, ...over,
  })

  // The item's own acceptance, both halves.
  test("budget 100 with null vendor, material AND manpower returns variance null -- never a fabricated 0", () => {
    const result = computeBudgetVarianceLine(line())
    expect(result.budget).toBe(100)
    expect(result.committed).toBeNull()
    expect(result.variance).toBeNull()
  })

  test("the same line with material 30 and manpower 20 returns variance 50", () => {
    const result = computeBudgetVarianceLine(line({ materialAmount: 30, manpowerAmount: 20 }))
    expect(result.committed).toBe(50)
    expect(result.variance).toBe(50)
  })

  test("all three components are counted, not just the vendor", () => {
    const result = computeBudgetVarianceLine(line({ vendorAmount: 40, materialAmount: 30, manpowerAmount: 20 }))
    expect(result.committed).toBe(90)
    expect(result.variance).toBe(10)
  })

  test("a REAL zero on one component is not the same as no data -- variance becomes a real number", () => {
    const result = computeBudgetVarianceLine(line({ materialAmount: 0 }))
    expect(result.committed).toBe(0)
    expect(result.variance).toBe(100)
  })

  test("committed cost above budget gives a NEGATIVE variance -- that is what 'over budget' now means", () => {
    expect(computeBudgetVarianceLine(line({ vendorAmount: 130 })).variance).toBe(-30)
  })

  test("budget is still amount x budgetPercentage / 100, unchanged from Point 154", () => {
    expect(computeBudgetVarianceLine(line({ amount: 400, budgetPercentage: 25 })).budget).toBe(100)
  })
})

describe("isLineOverBudget (D-26)", () => {
  test("a negative variance is over budget", () => {
    expect(isLineOverBudget(-0.01)).toBe(true)
  })

  test("exactly on budget is NOT over budget", () => {
    expect(isLineOverBudget(0)).toBe(false)
  })

  test("a line with no committed cost is neither over nor under -- it is uncosted", () => {
    expect(isLineOverBudget(null)).toBe(false)
  })
})

// R67 D-31 (R-090): the trade-wise attendance summary the Manpower screen
// renders. These test the pure builders that turn the two EXISTING aggregates
// (attendanceReport's (trade, status) grouping and manpowerCostReport's
// per-trade one) into the rows, the grand total and the honesty check the
// screen shows -- no new SQL grouping exists to test.
describe("attendance summary builders (R67 D-31)", () => {
  const STATUS_ROWS = [
    { trade: "Mason", status: "present", count: 12, cost: 1440 },
    { trade: "Mason", status: "absent", count: 1, cost: 0 },
    { trade: "Electrician", status: "present", count: 4, cost: 600 },
    { trade: "Electrician", status: "half_day", count: 2, cost: 150 },
    { trade: null, status: "present", count: 1, cost: 90 },
  ]

  test("folds (trade, status) rows into one row per trade, alphabetically, with the unnamed trade last", () => {
    const rows = buildAttendanceSummaryRows(STATUS_ROWS)
    expect(rows.map((r) => r.trade)).toEqual(["Electrician", "Mason", UNSPECIFIED_TRADE_LABEL])
  })

  test("a blank trade is NAMED, never dropped -- dropping it would break the totals", () => {
    const rows = buildAttendanceSummaryRows(STATUS_ROWS)
    const unspecified = rows.find((r) => r.trade === UNSPECIFIED_TRADE_LABEL)!
    expect(unspecified.present).toBe(1)
    expect(unspecified.cost).toBe(90)
  })

  test("worker-days weight a half day as half and an absence as none", () => {
    const rows = buildAttendanceSummaryRows(STATUS_ROWS)
    const mason = rows.find((r) => r.trade === "Mason")!
    const electrician = rows.find((r) => r.trade === "Electrician")!
    expect(mason.workerDays).toBe(12) // 12 present, 1 absent -> the absence adds nothing
    expect(electrician.workerDays).toBe(5) // 4 present + 2 half days
    expect(WORKER_DAY_WEIGHT.half_day).toBe(0.5)
    expect(WORKER_DAY_WEIGHT.absent).toBe(0)
  })

  test("counts come back split by status, so 'Absent 1' is visible rather than folded into a single number", () => {
    const rows = buildAttendanceSummaryRows(STATUS_ROWS)
    const mason = rows.find((r) => r.trade === "Mason")!
    expect(mason).toMatchObject({ present: 12, halfDay: 0, absent: 1, cost: 1440 })
  })

  test("the grand total is the sum of the rows on screen, in every column", () => {
    const rows = buildAttendanceSummaryRows(STATUS_ROWS)
    expect(totalAttendanceSummary(rows)).toEqual({ present: 17, halfDay: 2, absent: 1, workerDays: 18, cost: 2280 })
  })

  test("the headline count is bodies on site -- present plus half day, never absences", () => {
    expect(headcountOnSite(buildAttendanceSummaryRows(STATUS_ROWS))).toBe(19)
  })

  test("numeric strings from the driver are read as numbers, not concatenated", () => {
    const rows = buildAttendanceSummaryRows([{ trade: "Mason", status: "present", count: "3", cost: "360.50" }])
    expect(rows[0].present).toBe(3)
    expect(rows[0].cost).toBe(360.5)
  })

  test("the reconciliation TIES when both aggregates saw the same attendance rows and money", () => {
    const rows = buildAttendanceSummaryRows(STATUS_ROWS)
    // manpowerCostReport counts every attendance row, absences included:
    // Mason 13, Electrician 6, unnamed 1 = 20.
    const byTrade = [
      { totalCost: 1440, workerDays: 13 },
      { totalCost: 750, workerDays: 6 },
      { totalCost: 90, workerDays: 1 },
    ]
    const result = reconcileAttendanceSummary(rows, byTrade)
    expect(result.ties).toBe(true)
    expect(result.rowCountFromStatuses).toBe(20)
    expect(result.rowCountFromTrades).toBe(20)
  })

  test("the reconciliation FAILS when the second aggregate saw rows the first did not -- the screen must not print a total nobody can reproduce", () => {
    const rows = buildAttendanceSummaryRows(STATUS_ROWS)
    const byTrade = [
      { totalCost: 1440, workerDays: 13 },
      { totalCost: 750, workerDays: 6 },
      // the unnamed-trade row is missing here
    ]
    expect(reconcileAttendanceSummary(rows, byTrade).ties).toBe(false)
  })

  test("a sub-cent float difference in money is NOT reported as a disagreement", () => {
    const rows = buildAttendanceSummaryRows([{ trade: "Mason", status: "present", count: 1, cost: 100.001 }])
    expect(reconcileAttendanceSummary(rows, [{ totalCost: 100, workerDays: 1 }]).ties).toBe(true)
  })

  test("a real money difference IS reported", () => {
    const rows = buildAttendanceSummaryRows([{ trade: "Mason", status: "present", count: 1, cost: 100 }])
    expect(reconcileAttendanceSummary(rows, [{ totalCost: 120, workerDays: 1 }]).ties).toBe(false)
  })

  test("no attendance at all is an empty summary, not a crash", () => {
    const rows = buildAttendanceSummaryRows([])
    expect(rows).toEqual([])
    expect(totalAttendanceSummary(rows)).toEqual({ present: 0, halfDay: 0, absent: 0, workerDays: 0, cost: 0 })
    expect(headcountOnSite(rows)).toBe(0)
    expect(reconcileAttendanceSummary(rows, []).ties).toBe(true)
  })
})

// R67 E-22 (R-199 / R-207). Sumeet's two named sheets that the previous
// report shapes could not produce: Weekly Project is day columns over
// category rows, and Attendance is one row per worker with a trade subtotal.
describe("buildPeriodDays -- Weekly Project's day columns (E-22)", () => {
  const EMPTY = { attendance: [], expenses: [], progress: [], diaries: [] }

  test("emits one row per calendar day in the window, including the empty ones", () => {
    const days = buildPeriodDays("2026-08-24", "2026-08-31", EMPTY)
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30",
    ])
    // A day with nothing on it is a fact, and it reads 0 -- not a missing column.
    expect(days.every((d) => d.labourCost === 0 && d.expenseTotal === 0 && d.progressEntriesLogged === 0 && d.diaryEntries === 0)).toBe(true)
  })

  test("the end of the window is exclusive, matching the >= / < predicates the queries use", () => {
    const days = buildPeriodDays("2026-08-24", "2026-08-25", EMPTY)
    expect(days.map((d) => d.date)).toEqual(["2026-08-24"])
  })

  test("each measure lands on its own day, and the week total is the sum of the days", () => {
    const days = buildPeriodDays("2026-08-24", "2026-08-27", {
      attendance: [
        { date: "2026-08-24", cost: 1200, presentCount: 4 },
        { date: "2026-08-26", cost: 900, presentCount: 3 },
      ],
      expenses: [{ date: "2026-08-25", total: 4500 }],
      progress: [{ date: "2026-08-26", count: 2 }],
      diaries: [{ date: "2026-08-24" }, { date: "2026-08-24" }],
    })
    expect(days.map((d) => d.labourCost)).toEqual([1200, 0, 900])
    expect(days.map((d) => d.expenseTotal)).toEqual([0, 4500, 0])
    expect(days.map((d) => d.progressEntriesLogged)).toEqual([0, 0, 2])
    expect(days.map((d) => d.diaryEntries)).toEqual([2, 0, 0])
    expect(days.reduce((s, d) => s + d.labourCost, 0)).toBe(2100)
    expect(days.reduce((s, d) => s + d.workersPresent, 0)).toBe(7)
  })

  test("an unparseable window yields no rows rather than looping", () => {
    expect(buildPeriodDays("not-a-date", "2026-08-27", EMPTY)).toEqual([])
    expect(buildPeriodDays("2026-08-27", "2026-08-24", EMPTY)).toEqual([])
  })
})

describe("rollUpAttendanceByTrade -- Sumeet's trade subtotals (E-22)", () => {
  function worker(over: Partial<AttendanceWorkerRow> = {}): AttendanceWorkerRow {
    return {
      rosterId: "r1", employeeCode: "W-0001", name: "Ravi", company: null, trade: "Civil",
      daysPresent: 5, daysHalf: 0, daysAbsent: 0, salary: 1500, ...over,
    }
  }

  test("one subtotal per trade, summing workers, days present and salary", () => {
    const subtotals = rollUpAttendanceByTrade([
      worker({ rosterId: "r1", trade: "Civil", daysPresent: 5, salary: 1500 }),
      worker({ rosterId: "r2", trade: "Civil", daysPresent: 4, salary: 1200 }),
      worker({ rosterId: "r3", trade: "Electrical", daysPresent: 6, salary: 2100 }),
    ])
    expect(subtotals).toEqual([
      { trade: "Civil", workers: 2, daysPresent: 9, salary: 2700 },
      { trade: "Electrical", workers: 1, daysPresent: 6, salary: 2100 },
    ])
  })

  test("a worker with no trade is bucketed under a named subtotal, never dropped", () => {
    const subtotals = rollUpAttendanceByTrade([
      worker({ rosterId: "r1", trade: null, salary: 800, daysPresent: 2 }),
      worker({ rosterId: "r2", trade: "   ", salary: 700, daysPresent: 1 }),
    ])
    expect(subtotals).toEqual([{ trade: "Not set", workers: 2, daysPresent: 3, salary: 1500 }])
  })

  test("the subtotals add up to the table -- that is the only reason they are on it", () => {
    const workers = [
      worker({ rosterId: "r1", trade: "Civil", salary: 1500 }),
      worker({ rosterId: "r2", trade: "Paint", salary: 900 }),
      worker({ rosterId: "r3", trade: null, salary: 400 }),
    ]
    const subtotalSalary = rollUpAttendanceByTrade(workers).reduce((s, r) => s + r.salary, 0)
    expect(subtotalSalary).toBe(workers.reduce((s, w) => s + w.salary, 0))
  })
})

// R67 E-26 (R-212). The acceptance case, stated in the item's own numbers: a
// 6,500 root line at 25% with one derived child of 2,275 must total 1,625 and
// not 2,193.75 -- 1,625 is the root's own budget, 2,193.75 is that budget plus
// the child's 568.75, which is a slice of the very same 1,625 counted twice.
describe("summariseBudgetLines -- roots only, children kept (E-26)", () => {
  // R67 E-26 MERGE NOTE (rebase onto main, 2026-09-03). This block was written
  // against a pure computeBoqBudgetVariance() this lane added. While it sat on
  // the branch, lanes D1 and D21 landed toBudgetLine() + computeBudgetVarianceLine()
  // in this file and INVERTED the meaning of `variance`: it used to be
  // vendorAmount - budget (overspend) and is now budget - vendor - material -
  // manpower (budget remaining). Keeping this lane's function would have left
  // the file with two exported implementations of one arithmetic, with opposite
  // signs -- exactly the defect that file's own D-11 merge note forbids.
  //
  // So the FUNCTION was dropped and the RULE was folded into the merged code:
  // summariseBudgetLines() totals over root lines only, summing the `_raw`
  // figures toBudgetLine() already computed. The assertions below are restated
  // against that, not deleted -- and the ones that name a variance are restated
  // under the NEW sign, which is why "375" became "-375" and is called out.
  function boqLine(over: Partial<BudgetLineInput> = {}): BudgetLineInput {
    return {
      id: "l1", itemCode: "1", description: "Root line", category: null,
      unit: null, quantity: null, rate: null,
      amount: 6500, budgetPercentage: 25, materialAmount: null, manpowerAmount: null,
      vendorId: null, vendorAmount: null, parentLineItemId: null, ...over,
    }
  }

  function summarise(items: BudgetLineInput[], suppliers = new Map<string, string>()) {
    return summariseBudgetLines(items.map((item, i) => toBudgetLine(item, suppliers, i)))
  }

  const root = boqLine({ id: "root", itemCode: "1", amount: 6500, budgetPercentage: 25 })
  // AMOUNT_child = AMOUNT_root x breakdownPercentage/100 -> 6500 x 35% = 2275.
  const child = boqLine({ id: "child", itemCode: "1.1", description: "Sub-task", amount: 2275, budgetPercentage: 25, parentLineItemId: "root" })

  test("totalBudget is the root's 1625, not root + derived child", () => {
    const report = summarise([root, child])
    expect(report.totalBudget).toBe(1625)
    expect(report.totalBudget).not.toBe(2193.75)
  })

  test("the child row is still returned, flagged budgetIsDerived with its % of parent", () => {
    const report = summarise([root, child])
    expect(report.lines).toHaveLength(2)
    const childRow = report.lines.find((l) => l.lineItemId === "child")!
    expect(childRow.budgetIsDerived).toBe(true)
    expect(childRow.budget).toBe(568.75)
    expect(childRow.percentOfParent).toBe(35)
    expect(report.lines.find((l) => l.lineItemId === "root")!.budgetIsDerived).toBe(false)
    expect(report.lines.find((l) => l.lineItemId === "root")!.percentOfParent).toBeNull()
  })

  test("vendor amounts and variance also total over roots only", () => {
    const report = summarise([
      { ...root, vendorAmount: 2000 },
      { ...child, vendorAmount: 700 },
    ])
    expect(report.totalVendorAmount).toBe(2000)
    // Under D-26's sign this is budget - committed = 1625 - 2000 = -375
    // (over budget by 375). The child's own 700 is NOT in it.
    expect(report.totalVariance).toBe(-375)
    expect(report.budgetRemaining).toBe(-375)
  })

  test("the material/manpower split totals over roots only for the same reason", () => {
    const report = summarise([
      { ...root, materialAmount: 1000, manpowerAmount: 625 },
      { ...child, materialAmount: 350, manpowerAmount: 218.75 },
    ])
    expect(report.totalMaterialAmount).toBe(1000)
    expect(report.totalManpowerAmount).toBe(625)
  })

  test("a line that was never costed stays null -- not a fabricated zero variance", () => {
    const report = summarise([root])
    expect(report.lines[0].vendorAmount).toBeNull()
    expect(report.lines[0].variance).toBeNull()
    expect(report.totalCommitted).toBeNull()
    expect(report.totalVariance).toBeNull()
  })

  test("the empty BOQ carries every key the populated one does, and the rule in words", () => {
    const empty = summariseBudgetLines([])
    const populated = summarise([root])
    expect(Object.keys(empty).sort()).toEqual(Object.keys(populated).sort())
    expect(empty.lines).toEqual([])
    expect(empty.totalBudget).toBe(0)
    expect(empty.totalCommitted).toBeNull()
    expect(empty.note).toBe(DERIVED_BUDGET_NOTE)
  })

  test("the note states the rule the totals actually follow", () => {
    expect(DERIVED_BUDGET_NOTE).toContain("root BOQ lines only")
    expect(DERIVED_BUDGET_NOTE).toContain("never added into a total")
  })

  test("the vendor name comes from the supplier map, and an unknown vendor id reads null", () => {
    const report = summarise(
      [boqLine({ id: "a", vendorId: "v1" }), boqLine({ id: "b", vendorId: "v-missing" })],
      new Map([["v1", "Al Noor Contracting"]])
    )
    expect(report.lines[0].vendorName).toBe("Al Noor Contracting")
    expect(report.lines[1].vendorName).toBeNull()
  })

  test("the counts describe the ROWS shown, so a child is counted as a row but not as money", () => {
    const report = summarise([root, child])
    expect(report.lineCount).toBe(2)
    expect(report.totalBudget).toBe(1625)
  })

  test("summing is the ONLY thing this does -- the per-line arithmetic stays in computeBudgetVarianceLine", () => {
    // Guards the merge: if someone re-adds a private budget/variance formula
    // here, the file is back to two implementations with two signs.
    const line = toBudgetLine(boqLine({ vendorAmount: 2000 }), new Map(), 0)
    const direct = computeBudgetVarianceLine({
      amount: 6500, budgetPercentage: 25, vendorAmount: 2000,
      materialAmount: null, manpowerAmount: null,
    })
    expect(line.budget).toBe(Math.round(direct.budget * 100) / 100)
    expect(line.variance).toBe(Math.round(direct.variance! * 100) / 100)
    expect(summariseBudgetLines([line]).totalBudget).toBe(line.budget)
  })
})

// ---------------------------------------------------------------------------
// R67 E-32 (R-265): every report is a table
// ---------------------------------------------------------------------------
//
// One test per registry entry, asserting THE COLUMN LIST AND ONE ROW -- the
// item's own words. These are pure: buildReportTable takes a payload the
// handler already produced and turns it into the shape PROJEXA renders, so the
// column set, the units, and which columns legitimately total are all testable
// without a database. A wrong unit here is a currency printed as a percentage
// on a customer's report, which is precisely the class of defect that has no
// other cheap test.
describe("R67 E-32: buildReportTable -- the {columns, rows} contract", () => {
  const labels = (t: ReportTable) => t.columns.map((c) => c.label)
  const unitOf = (t: ReportTable, key: string) => t.columns.find((c) => c.key === key)?.unit

  test("project-status: one row, the project NAME first, money typed as currency, and no fabricated total", () => {
    const table = buildReportTable("project-status", {
      projectId: "g555imnoq4wihavpwc7t64um",
      projectName: "Cedar Heights Villa - Phase 1",
      budget: 0, revenue: 0, expenses: 185_000,
      progressPercent: 60, delayedTaskCount: 1, photoCount: 0, taskCount: 4,
      projectValue: null, earnedValue: 118_750, percentByValue: 25, contractValue: 475_000,
    }, "AED")

    expect(labels(table)).toEqual([
      "Project", "Contract value", "Earned value", "% complete by value", "% logged",
      "Revenue", "Budget", "Expenses", "Tasks", "Late",
    ])
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0].projectName).toBe("Cedar Heights Villa - Phase 1")
    // The raw cuid never becomes a cell.
    expect(Object.values(table.rows[0])).not.toContain("g555imnoq4wihavpwc7t64um")
    expect(table.currency).toBe("AED")
    expect(unitOf(table, "contractValue")).toBe("currency")
    expect(unitOf(table, "percentByValue")).toBe("percent")
    // Summing a revenue, a budget and an expense is not a statement about
    // anything -- so there is no totals row to print one.
    expect(table.totals).toBeUndefined()
  })

  test("project-status: the acceptance's own shape -- at least one currency column and a row", () => {
    const table = buildReportTable("project-status", {
      projectId: "p1", projectName: "Cedar Heights Villa - Phase 1",
      budget: 6500, revenue: 0, expenses: 0, progressPercent: 0, delayedTaskCount: 0,
      photoCount: 0, taskCount: 0, projectValue: null, earnedValue: null,
      percentByValue: null, contractValue: null,
    }, "AED")
    expect(table.columns.some((c) => c.unit === "currency")).toBe(true)
    expect(table.rows.length).toBeGreaterThanOrEqual(1)
  })

  test("attendance: one row per WORKER, with a real salary total", () => {
    const table = buildReportTable("attendance", {
      rows: [],
      workers: [
        { rosterId: "r1", employeeCode: "W-01", name: "Ravi", company: "Al Noor", trade: "Mason", daysPresent: 20, daysHalf: 1, daysAbsent: 0, salary: 6500 },
        { rosterId: "r2", employeeCode: null, name: "Suresh", company: null, trade: "Mason", daysPresent: 18, daysHalf: 0, daysAbsent: 2, salary: 5400 },
      ],
      tradeSubtotals: [],
    }, "AED")

    expect(labels(table)).toEqual(["ID", "Name", "Company", "Trade", "Present", "Half day", "Absent", "Salary"])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toEqual({
      employeeCode: "W-01", name: "Ravi", company: "Al Noor", trade: "Mason",
      daysPresent: 20, daysHalf: 1, daysAbsent: 0, salary: 6500,
    })
    expect(table.totals?.salary).toBe(11_900)
    // A worker with no employee code and no company keeps his row; the two
    // unknown cells are null, which the screen renders as an en-dash.
    expect(table.rows[1].employeeCode).toBeNull()
    expect(table.rows[1].company).toBeNull()
  })

  test("scope: the live BOQ, one row, contract value as currency", () => {
    const table = buildReportTable("scope", {
      boq: { id: "b1", title: "Main BOQ", version: 3, status: "approved" },
      totalValue: 475_000, lineItemCount: 42,
      revisions: [{ id: "b1", version: 3, status: "approved" }, { id: "b0", version: 2, status: "superseded" }],
    }, "AED")

    expect(labels(table)).toEqual(["BOQ", "Version", "Status", "Line items", "Contract value"])
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toEqual({ title: "Main BOQ", version: 3, status: "approved", lineItemCount: 42, totalValue: 475_000 })
  })

  test("scope: a project with no BOQ is ZERO rows, not one row of zeros", () => {
    const table = buildReportTable("scope", { boq: null, totalValue: 0, lineItemCount: 0, revisions: [] }, "AED")
    expect(table.rows).toEqual([])
  })

  test("budget-vs-actual: a per-head budget is NULL, and the real comparison is the total row", () => {
    const table = buildReportTable("budget-vs-actual", {
      budget: 200_000, actual: 185_000, variance: 15_000,
      byHead: [{ expenseHead: "Material", total: 120_000 }, { expenseHead: "Labour", total: 65_000 }],
    }, "AED")

    expect(labels(table)).toEqual(["Expense head", "Budget", "Actual", "Variance"])
    expect(table.rows[0]).toEqual({ head: "Material", budget: null, actual: 120_000, variance: null })
    // Not 0: there IS no per-head budget in the ERP model, and a zero there
    // would read as "this head was allocated nothing".
    expect(table.rows[0].budget).toBeNull()
    expect(table.totals).toEqual({ budget: 200_000, actual: 185_000, variance: 15_000 })
  })

  test("vendor-cost: the vendor's NAME, never the raw id, and the id only as a last resort", () => {
    const table = buildReportTable("vendor-cost", {
      labourVendorCosts: [
        { vendorId: "v1", vendorName: "Al Noor Contracting", total: 3600 },
        { vendorId: "v2", vendorName: null, total: 1600 },
      ],
      note: "Purchase-invoice-based vendor cost not included -- erp_purchase_invoices has no project_id yet.",
    }, "AED")

    expect(labels(table)).toEqual(["Vendor", "Labour cost"])
    expect(table.rows[0].vendorName).toBe("Al Noor Contracting")
    // A supplier row that has since been removed still shows its cost.
    expect(table.rows[1].vendorName).toBe("v2")
    expect(table.totals?.total).toBe(5200)
    expect(table.note).toContain("erp_purchase_invoices")
  })

  test("work-progress: a sub-task's amount is shown on its row and NOT counted in the total", () => {
    const table = buildReportTable("work-progress", {
      activities: [], boqId: "b1",
      lines: [
        { lineItemId: "l1", code: "1.1", description: "Blockwork", category: "Civil", amount: 6500, parentLineItemId: null },
        { lineItemId: "l2", code: "1.1.1", description: "Frame", category: "Civil", amount: 4000, parentLineItemId: "l1" },
        { lineItemId: "l3", code: "2.1", description: "Painting", category: null, amount: 250, parentLineItemId: null },
      ],
      byCategory: [{ category: "Civil", subtotal: 6500, lineCount: 2 }, { category: "Uncategorized", subtotal: 250, lineCount: 1 }],
      grandTotal: 6750,
    }, "AED")

    expect(labels(table)).toEqual(["Code", "Description", "Category", "Amount"])
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0].amount).toBe(6500)
    // The child keeps its row -- a QS needs to see it -- with no money on it.
    expect(table.rows[1].amount).toBeNull()
    expect(table.rows[2].category).toBe("Uncategorized")
    expect(table.totals?.amount).toBe(6750)
    expect(table.note).toBe(DERIVED_BUDGET_NOTE)
  })

  test("weekly-project: one row per DAY, and the week total is the sum of the days", () => {
    const table = buildReportTable("weekly-project", {
      weekStart: "2026-09-01", weekEnd: "2026-09-08",
      progressEntriesLogged: 5, labourCost: 9000, workersPresent: 24, diaryEntries: 2, expenseTotal: 1200,
      byDay: [
        { date: "2026-09-01", labourCost: 5000, workersPresent: 14, expenseTotal: 700, progressEntriesLogged: 3, diaryEntries: 1 },
        { date: "2026-09-02", labourCost: 4000, workersPresent: 10, expenseTotal: 500, progressEntriesLogged: 2, diaryEntries: 1 },
      ],
    }, "AED")

    expect(labels(table)).toEqual(["Date", "Labour cost", "Workers", "Expenses", "Progress entries", "Diary entries"])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0].date).toBe("2026-09-01")
    expect(unitOf(table, "date")).toBe("date")
    expect(table.totals?.labourCost).toBe(9000)
    expect((table.rows[0].labourCost as number) + (table.rows[1].labourCost as number)).toBe(table.totals?.labourCost)
  })

  test("budget-variance: the E-26 roots-only totals survive into the table", () => {
    const table = buildReportTable("budget-variance", {
      lines: [
        { lineItemId: "l1", code: "1.1", description: "Blockwork", category: "Civil", amount: 6500, budgetPercentage: 25, budget: 1625, materialAmount: null, manpowerAmount: null, vendorId: "v1", vendorName: "Al Noor", vendorAmount: 1800, variance: 175, parentLineItemId: null, budgetIsDerived: false, percentOfParent: null },
        { lineItemId: "l2", code: "1.1.1", description: "Frame", category: "Civil", amount: 4000, budgetPercentage: 25, budget: 1000, materialAmount: null, manpowerAmount: null, vendorId: null, vendorName: null, vendorAmount: null, variance: null, parentLineItemId: "l1", budgetIsDerived: true, percentOfParent: 61.54 },
      ],
      totalBudget: 1625, totalVendorAmount: 1800, totalVariance: 175,
      totalMaterialAmount: 0, totalManpowerAmount: 0, note: DERIVED_BUDGET_NOTE,
    }, "AED")

    expect(labels(table)).toEqual([
      "Code", "Description", "Category", "BOQ amount", "Budget %", "Budget", "Vendor", "Vendor amount", "Variance",
    ])
    // The root's 1625, not root + derived child.
    expect(table.totals).toEqual({ budget: 1625, vendorAmount: 1800, variance: 175 })
    // A line with no vendor amount yet reads as missing, never as a zero variance.
    expect(table.rows[1].vendorAmount).toBeNull()
    expect(table.rows[1].variance).toBeNull()
  })

  test("revenue: invoices, with the invoice total as the table total", () => {
    const table = buildReportTable("revenue", {
      invoices: [
        { invoiceNumber: "INV-001", postingDate: "2026-08-01", status: "posted", grandTotal: "120000" },
        { invoiceNumber: "INV-002", postingDate: "2026-08-20", status: "draft", grandTotal: "65000" },
      ],
      total: 185_000,
    }, "AED")
    expect(labels(table)).toEqual(["Invoice", "Posted", "Status", "Amount"])
    expect(table.rows[0]).toEqual({ invoiceNumber: "INV-001", postingDate: "2026-08-01", status: "posted", grandTotal: 120_000 })
    expect(table.totals?.grandTotal).toBe(185_000)
  })

  test("expense: expense heads and their total", () => {
    const table = buildReportTable("expense", {
      byHead: [{ expenseHead: "Material", total: 120_000 }],
      total: 120_000,
    }, "AED")
    expect(labels(table)).toEqual(["Expense head", "Amount"])
    expect(table.rows[0]).toEqual({ expenseHead: "Material", total: 120_000 })
    expect(table.totals?.total).toBe(120_000)
  })

  test("budget-summary: accounts and their budget total", () => {
    const table = buildReportTable("budget-summary", {
      byAccount: [{ accountId: "a1", total: 200_000 }], total: 200_000,
    }, "AED")
    expect(labels(table)).toEqual(["Account", "Budget"])
    expect(table.totals?.total).toBe(200_000)
  })

  test("material-consumption: items, quantity and value", () => {
    const table = buildReportTable("material-consumption", {
      items: [{ itemId: "i1", itemName: "Cement", uom: "Bag", netQuantity: -120, totalValue: -2400 }],
    }, "AED")
    expect(labels(table)).toEqual(["Item", "UoM", "Net quantity", "Value"])
    expect(table.rows[0]).toEqual({ itemName: "Cement", uom: "Bag", netQuantity: -120, totalValue: -2400 })
    expect(table.totals?.totalValue).toBe(-2400)
  })

  test("manpower-cost: one row per trade, worker-days and cost both totalled", () => {
    const table = buildReportTable("manpower-cost", {
      byTrade: [{ trade: "Mason", totalCost: 3600, workerDays: 12 }, { trade: "Carpenter", totalCost: 1600, workerDays: 4 }],
      date: null,
    }, "AED")
    expect(labels(table)).toEqual(["Trade", "Worker-days", "Cost"])
    expect(table.totals).toEqual({ workerDays: 16, totalCost: 5200 })
  })

  test("category-progress: percentages of different categories are NOT totalled", () => {
    const table = buildReportTable("category-progress", {
      categories: [{ categoryId: "c1", name: "Civil", percentComplete: 40 }, { categoryId: "c2", name: "Paint", percentComplete: 100 }],
    }, "AED")
    expect(labels(table)).toEqual(["Category", "% complete"])
    expect(unitOf(table, "percentComplete")).toBe("percent")
    expect(table.totals).toBeUndefined()
  })

  test("project-completion: the overall figure is the note, the categories are the rows", () => {
    const table = buildReportTable("project-completion", {
      overallPercentComplete: 60,
      byCategory: [{ categoryId: "c1", name: "Civil", percentComplete: 40 }],
    }, "AED")
    expect(table.rows[0]).toEqual({ name: "Civil", percentComplete: 40 })
    expect(table.note).toContain("60%")
  })

  // Fixtures corrected to the handler's REAL row (R67 E-36..E-40 group):
  // categoryBoqAmountsReport returns { categoryId, name, totalAmount } and no
  // completion figure at all -- that lives in "category-progress", a different
  // report. The old "% complete" column named a field that never arrives.
  test("category-boq-amounts: amounts total, and there is no completion figure here to show", () => {
    const table = buildReportTable("category-boq-amounts", {
      categories: [
        { categoryId: "c1", name: "Civil", totalAmount: 4_000_000 },
        { categoryId: "text:paint", name: "Paint", totalAmount: 4000 },
      ],
      uncategorizedAmount: 0, totalAmount: 4_004_000,
    }, "AED")
    expect(labels(table)).toEqual(["Category", "BOQ amount"])
    expect(table.totals).toEqual({ totalAmount: 4_004_000 })
    expect(table.note).toBeUndefined()
  })

  test("category-boq-amounts: BOQ value on uncategorised lines is stated, not dropped", () => {
    const table = buildReportTable("category-boq-amounts", {
      categories: [{ categoryId: "c1", name: "Civil", totalAmount: 4_000_000 }],
      uncategorizedAmount: 4000, totalAmount: 4_004_000,
    }, "AED")
    // The rows sum to less than the total, and the reader is told why rather
    // than left to find a 4,000 discrepancy.
    expect(table.note).toContain("no category")
  })

  test("earned-value: one row, three typed figures", () => {
    const table = buildReportTable("earned-value", { earnedValue: 118_750, contractValue: 475_000, percentByValue: 25 }, "AED")
    expect(labels(table)).toEqual(["Contract value", "Earned value", "% by value"])
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0].percentByValue).toBe(25)
  })

  test("site-picture: photos by name and upload date, no money at all", () => {
    const table = buildReportTable("site-picture", {
      photos: [{ id: "d1", name: "Level 3 slab.jpg", createdAt: "2026-08-25T09:00:00.000Z", metadata: null }],
    }, "AED")
    expect(labels(table)).toEqual(["Photo", "Uploaded"])
    expect(table.rows[0]).toEqual({ name: "Level 3 slab.jpg", createdAt: "2026-08-25" })
    expect(table.columns.some((c) => c.unit === "currency")).toBe(false)
  })

  test("kpi: one row per definition, carrying how many readings it has", () => {
    // The column on constructionKpiDefinitions is `metricName`; there is no
    // `name`, so the old fixture described a row the handler cannot return.
    const table = buildReportTable("kpi", {
      definitions: [
        { id: "k1", metricName: "Safety incidents", unit: "count" },
        { id: "k2", metricName: "Rework", unit: null },
      ],
      entries: [{ id: "e1", kpiDefinitionId: "k1" }, { id: "e2", kpiDefinitionId: "k1" }],
    }, "AED")
    expect(labels(table)).toEqual(["KPI", "Unit", "Readings"])
    expect(table.rows[0]).toEqual({ metricName: "Safety incidents", unit: "count", entryCount: 2 })
    expect(table.rows[1]).toEqual({ metricName: "Rework", unit: null, entryCount: 0 })
  })

  test("designer-timesheet: project-scoped hours per designer, and it says where the rest is", () => {
    const table = buildReportTable("designer-timesheet", {
      projectScoped: {
        byUser: [{ userId: "u1", userName: "Asha", totalHours: 12 }, { userId: "u2", userName: "Bilal", totalHours: 7.5 }],
        byCategory: [], byDesignerStatus: [], overallBudget: 0, overallActual: 0, overallVariance: 0,
      },
      orgWide: { byDesigner: [], byProject: [] },
    }, "AED")
    expect(labels(table)).toEqual(["Designer", "Hours"])
    expect(table.totals?.totalHours).toBe(19.5)
    expect(table.note).toContain("format=legacy")
  })

  test("designer-approval-status: one column per approval state, each totalled", () => {
    // The handler's key is `byDesigner`, and pms_time_entries.approval_status
    // has four values -- draft | submitted | approved | REJECTED. "sent_back"
    // is not one this system stores, so the old column could never fill.
    const table = buildReportTable("designer-approval-status", {
      byDesigner: [{
        userId: "u1", userName: "Asha",
        draft: { hours: 2, entries: 1 }, submitted: { hours: 4, entries: 2 },
        approved: { hours: 6, entries: 3 }, rejected: { hours: 0, entries: 0 },
      }],
    }, "AED")
    expect(labels(table)).toEqual(["Designer", "Draft (h)", "Submitted (h)", "Approved (h)", "Rejected (h)"])
    expect(table.totals).toEqual({ draft: 2, submitted: 4, approved: 6, rejected: 0 })
  })

  test("work-analysis: hours and how many tasks each person touched", () => {
    // The handler's key is `byDesigner` (workAnalysisReport returns
    // { byDesigner: [...] }, including on its empty-project early return). The
    // old fixture said `byUser`, which is the name of a LOCAL inside
    // aggregateWorkAnalysis and never reaches the payload -- so this described
    // a row the report cannot produce.
    const table = buildReportTable("work-analysis", {
      byDesigner: [{
        userId: "u1", userName: "Asha", totalHours: 12,
        byTask: [{ taskId: "t1", taskName: "Layout", hours: 8 }, { taskId: "t2", taskName: "Detailing", hours: 4 }],
        byCategory: [],
      }],
    }, "AED")
    expect(labels(table)).toEqual(["Person", "Hours", "Tasks worked"])
    expect(table.rows[0]).toEqual({ userName: "Asha", totalHours: 12, taskCount: 2 })
  })

  test("certified-payroll: one row per worker, and the disclosed data gap travels with it", () => {
    const table = buildReportTable("certified-payroll", {
      projectId: "p1", projectName: "Cedar", weekStart: "2026-09-01", weekEnd: "2026-09-07",
      workers: [{
        rosterId: "r1", workerName: "Ravi", trade: "Mason", dailyHours: [8, 8, 8, 8, 8, 0, 0], totalHours: 40,
        ratePaid: 25, prevailingHourlyRate: 28, fringeBenefitRateRequired: null,
        grossWages: 1000, totalDeductions: 0, netWages: 1000, complianceStatus: "rate_below_prevailing",
      }],
      workerCount: 1, totalHours: 40, totalGrossWages: 1000,
      statementOfCompliance: { allWorkersCompliant: false, exceptions: [] },
      dataGapNotes: ["Deductions are not tracked for this site-labour workforce."],
    }, "AED")
    expect(labels(table)).toEqual(["Worker", "Trade", "Hours", "Rate paid", "Prevailing rate", "Gross wages", "Status"])
    expect(table.totals).toEqual({ totalHours: 40, grossWages: 1000 })
    expect(table.note).toContain("Deductions are not tracked")
  })

  test("manpower-daily-summary totals come from the handler, not a second summation", () => {
    // Added on rebase with the builder itself: manpowerDailySummary reached main
    // from lane D3 after E-32's map was written, and the guard below caught the
    // gap. The point of interest is the footer -- it must be the handler's own
    // `totals`, because re-summing the rows here is how a footer starts
    // disagreeing with the column above it.
    const table = buildReportTable("manpower-daily-summary", {
      date: "2026-09-03",
      rows: [
        { trade: "Carpenter", present: 3, absent: 1, halfDay: 0, headcount: 4, cost: 900 },
        { trade: "Mason", present: 2, absent: 0, halfDay: 1, headcount: 3, cost: 610.5 },
      ],
      totals: { trade: "Total", present: 5, absent: 1, halfDay: 1, headcount: 7, cost: 1510.5 },
      people: [],
    }, "AED")

    expect(labels(table)).toEqual(["Trade", "Present", "Absent", "Half day", "Headcount", "Cost"])
    expect(unitOf(table, "cost")).toBe("currency")
    expect(unitOf(table, "present")).toBe("number")
    expect(table.rows).toHaveLength(2)
    expect(table.totals).toEqual({ present: 5, absent: 1, halfDay: 1, headcount: 7, cost: 1510.5 })
    // `date` describes the table, not a cell -- it must not become a column.
    expect(labels(table)).not.toContain("Date")
    expect(table.currency).toBe("AED")
    expect(table.note).toContain("marked on this date")
  })

  test("every registry report has a builder, so no report can fall back to a JSON dump", () => {
    // The builder map is typed against ReportName, so this is a runtime
    // restatement of a compile-time promise -- kept because "nothing renders as
    // key-value JSON any more" is the whole point of E-32 and deserves an
    // assertion that survives a refactor of the types.
    for (const name of Object.keys(REPORT_REGISTRY) as ReportName[]) {
      expect(REPORT_TABLE_BUILDER_NAMES).toContain(name)
    }
    expect(REPORT_TABLE_BUILDER_NAMES).toHaveLength(Object.keys(REPORT_REGISTRY).length)
  })

  test("a null org currency is REPORTED, never guessed into AED", () => {
    const table = buildReportTable("expense", { byHead: [{ expenseHead: "Material", total: 1 }], total: 1 }, null)
    expect(table.currency).toBeNull()
  })
})

// R67 E-33 (R-265): the portfolio chart's own row shape.
//
// The item's acceptance is "budget-vs-actual handler returns rows with keys
// revenue, budget, actual, progressPct". That is asserted here on the pure
// builder rather than against a live org, because the DB half is one call to
// getOrgDashboard, which has its own tests -- what this function decides, and
// what can silently go wrong, is WHICH budget a row shows and whether a
// missing figure becomes a zero.
describe("R67 E-33: buildBudgetVsActualByProject", () => {
  // R67 E-06/E-23 second-merge fix: PortfolioProjectRow's fields renamed to
  // match OrgDashboardProjectSummary's own convention -- `budget` is now the
  // BOQ-derived figure (was `boqBudget`) and `ledgerBudget` is the ERP
  // cost-centre fallback (was `budget`). Same two facts, canonical names.
  const project = (over: Partial<PortfolioProjectRow> = {}): PortfolioProjectRow => ({
    id: "p1", name: "Cedar Heights Villa - Phase 1",
    revenue: 475_000, budget: 200_000, ledgerBudget: 150_000,
    spent: 185_000, earnedValue: 118_750, progressPercent: 60,
    ...over,
  })

  test("rows carry the keys the chart reads: revenue, budget, actual, progressPct", () => {
    const table = buildBudgetVsActualByProject([project()], "AED")
    expect(table.rows).toHaveLength(1)
    for (const key of ["revenue", "budget", "actual", "progressPct"]) {
      expect(Object.keys(table.rows[0])).toContain(key)
    }
    expect(table.rows[0].revenue).toBe(475_000)
    expect(table.rows[0].actual).toBe(185_000)
    expect(table.rows[0].progressPct).toBe(60)
  })

  test("the BOQ-derived budget wins when the BOQ carries percentages", () => {
    const table = buildBudgetVsActualByProject([project()], "AED")
    expect(table.rows[0].budget).toBe(200_000)
  })

  test("the ERP cost-centre budget stands in when the BOQ carries none", () => {
    expect(buildBudgetVsActualByProject([project({ budget: null })], "AED").rows[0].budget).toBe(150_000)
    // A BOQ that exists but budgets nothing is not a budget either.
    expect(buildBudgetVsActualByProject([project({ budget: 0 })], "AED").rows[0].budget).toBe(150_000)
  })

  test("no budget anywhere is NULL, never 0 -- 'not set' and 'budgeted at zero' are different facts", () => {
    const table = buildBudgetVsActualByProject([project({ budget: null, ledgerBudget: null })], "AED")
    expect(table.rows[0].budget).toBeNull()
  })

  test("the row says WHICH budget it landed on, so the caption cannot disagree with the bar", () => {
    expect(buildBudgetVsActualByProject([project()], "AED").rows[0].budgetSource).toBe("boq")
    expect(buildBudgetVsActualByProject([project({ budget: null })], "AED").rows[0].budgetSource).toBe("erp")
    expect(buildBudgetVsActualByProject([project({ budget: null, ledgerBudget: null })], "AED").rows[0].budgetSource).toBe("none")
    expect(buildBudgetVsActualByProject([project()], "AED").columns.map((c) => c.key)).not.toContain("budgetSource")
  })

  test("the project NAME is the cell; the id travels for the link and is not a column", () => {
    const table = buildBudgetVsActualByProject([project()], "AED")
    expect(table.rows[0].project).toBe("Cedar Heights Villa - Phase 1")
    expect(table.rows[0].projectId).toBe("p1")
    expect(table.columns.map((c) => c.key)).not.toContain("projectId")
  })

  test("progress is money as well as a percentage, because a % cannot share a money axis", () => {
    const table = buildBudgetVsActualByProject([project()], "AED")
    expect(table.rows[0].earnedValue).toBe(118_750)
    expect(table.columns.find((c) => c.key === "earnedValue")?.unit).toBe("currency")
    expect(table.columns.find((c) => c.key === "progressPct")?.unit).toBe("percent")
  })

  test("the money columns total across the portfolio; the percentage does not", () => {
    const table = buildBudgetVsActualByProject(
      [project(), project({ id: "p2", name: "Oakwood", revenue: 100_000, budget: 50_000, spent: 25_000, earnedValue: 10_000, progressPercent: 20 })],
      "AED"
    )
    expect(table.totals).toEqual({ revenue: 575_000, budget: 250_000, actual: 210_000, earnedValue: 128_750 })
    expect(table.totals?.progressPct).toBeUndefined()
  })

  test("a project with no earned value contributes nothing rather than dragging the total to NaN", () => {
    const table = buildBudgetVsActualByProject([project({ earnedValue: null })], "AED")
    expect(table.rows[0].earnedValue).toBeNull()
    expect(table.totals?.earnedValue).toBe(0)
  })

  test("no projects at all is an empty table, not a table of zeros", () => {
    const table = buildBudgetVsActualByProject([], null)
    expect(table.rows).toEqual([])
    expect(table.currency).toBeNull()
  })

  test("the table says which budget it is showing", () => {
    expect(buildBudgetVsActualByProject([project()], "AED").note).toContain("BOQ-derived")
  })
})
