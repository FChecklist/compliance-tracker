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
  buildPeriodDays,
  computeCategoryProgress,
  computeCertifiedPayroll,
  computeEarnedValue,
  toBudgetLine,
  computeBudgetVarianceLine,
  isLineOverBudget,
  buildAttendanceSummaryRows,
  totalAttendanceSummary,
  reconcileAttendanceSummary,
  headcountOnSite,
  rollUpAttendanceByTrade,
  UNSPECIFIED_TRADE_LABEL,
  WORKER_DAY_WEIGHT,
  WH347_DAY_LABELS,
  type AttendanceWorkerRow,
  type DesignerTimesheetBudgetLine,
  type DesignerTimesheetEntry,
  type DesignerTimesheetRosterUser,
  type TimesheetStatusEntry,
  type WorkAnalysisEntry,
  type CertifiedPayrollAttendanceRow,
  type CertifiedPayrollWageRate,
  type EvLineItem,
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
    expect(Object.keys(result).sort()).toEqual(["orgWide", "projectScoped"])
    expect(Object.keys(result.projectScoped).sort()).toEqual(
      ["byCategory", "byDesignerStatus", "byUser", "overallActual", "overallBudget", "overallVariance"].sort()
    )
    expect(Object.keys(result.orgWide).sort()).toEqual(["byDesigner", "byProject"])
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
