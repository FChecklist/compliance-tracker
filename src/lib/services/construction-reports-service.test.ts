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
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import {
  aggregateDesignerTimesheetCosts,
  aggregateDesignerApprovalStatus,
  aggregateWorkAnalysis,
  computeCertifiedPayroll,
  WH347_DAY_LABELS,
  type DesignerTimesheetBudgetLine,
  type DesignerTimesheetEntry,
  type DesignerTimesheetRosterUser,
  type TimesheetStatusEntry,
  type WorkAnalysisEntry,
  type CertifiedPayrollAttendanceRow,
  type CertifiedPayrollWageRate,
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
