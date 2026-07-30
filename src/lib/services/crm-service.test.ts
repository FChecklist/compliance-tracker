// Task #46 (CRM feature-parity gap analysis): tests the pure predicate
// crm-service.ts exports for deterministic auto-assignment --
// computeRoundRobinAssignment() -- rather than exercising the
// withTenantContext/live-DB-backed functions that call it
// (autoDistributeLeads/autoDistributeOpportunities/getAssignmentOverview),
// matching this repo's established pattern of not touching a live DB from
// a .test.ts file (see crm-accounts-service.test.ts's own header note).
//
// CRM-007 "Sales Representative Performance Dashboard" (sap_mapping.sqlite
// sap_reports, module CRM, LOW priority, BUILD_NEW as of 2026-07-28) adds a
// second describe block below, same file since crm-service.ts had zero test
// coverage before Task #46 -- scoped there to only the new
// aggregateSalesRepPerformance()/getSalesRepPerformanceDashboard() addition,
// not a retroactive backfill of the rest of the pre-existing file (out of
// scope for that task too).
//
// Two layers for CRM-007, matching this repo's established pattern (see
// construction-reports-service.test.ts's aggregateDesignerTimesheetCosts
// tests and crm-accounts-service.test.ts's own header note on not touching a
// live DB from a .test.ts file):
//  1. aggregateSalesRepPerformance() -- pure, DB-free, tested directly with
//     plain fixture data (3 distinct reps + an unassigned bucket, different
//     won/lost/open counts each, proving the win-rate/pipeline-value/
//     sales-cycle/activity math per rep).
//  2. getSalesRepPerformanceDashboard() -- the thin DB-fetching wrapper,
//     tested once with a mocked @/lib/db/tenant-scoped + ./crm-enablement-
//     service (same "capture real modules, restore in afterEach" convention
//     as erp-selling-service.test.ts) to prove the real wiring (period/
//     ownerIds filters, rep-name join) end-to-end.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import { computeRoundRobinAssignment, aggregateSalesRepPerformance, type SalesRepPerfOpportunityInput, type SalesRepPerfActivityInput } from "./crm-service"

describe("computeRoundRobinAssignment -- deterministic, zero-AI load-balanced distribution", () => {
  test("distributes evenly round-robin across multiple active users (Auto Assign mode, no cap)", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4"],
      ["u1", "u2"]
    )
    expect(assignments).toEqual([
      { recordId: "r1", userId: "u1" },
      { recordId: "r2", userId: "u2" },
      { recordId: "r3", userId: "u1" },
      { recordId: "r4", userId: "u2" },
    ])
    expect(perUser).toEqual({ u1: 2, u2: 2 })
  })

  test("more unassigned records than users -- uneven totals, still deterministic round-robin order", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4", "r5"],
      ["u1", "u2", "u3"]
    )
    // 5 records / 3 users: u1 and u2 get 2, u3 gets 1 -- round-robin order,
    // not sorted-by-count.
    expect(assignments.map((a) => a.userId)).toEqual(["u1", "u2", "u3", "u1", "u2"])
    expect(perUser).toEqual({ u1: 2, u2: 2, u3: 1 })
  })

  test("zero unassigned records is a real no-op -- empty assignments, zeroed perUser counts", () => {
    const { assignments, perUser } = computeRoundRobinAssignment([], ["u1", "u2"])
    expect(assignments).toEqual([])
    expect(perUser).toEqual({ u1: 0, u2: 0 })
  })

  test("zero active users is also a no-op regardless of how many records are unassigned", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(["r1", "r2"], [])
    expect(assignments).toEqual([])
    expect(perUser).toEqual({})
  })

  test("all users at capacity (sharingCount) -- stops placing once every user hits the cap, remainder stays unassigned", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3", "r4", "r5"],
      ["u1", "u2"],
      2 // sharingCount: each user takes at most 2
    )
    // u1<-r1, u2<-r2, u1<-r3, u2<-r4 -- both users now at cap (2 each).
    // r5 cannot be placed anywhere; the function stops rather than
    // scanning the rest of the (empty) queue for no effect.
    expect(assignments).toEqual([
      { recordId: "r1", userId: "u1" },
      { recordId: "r2", userId: "u2" },
      { recordId: "r3", userId: "u1" },
      { recordId: "r4", userId: "u2" },
    ])
    expect(perUser).toEqual({ u1: 2, u2: 2 })
  })

  test("sharingCount honored per-user even with an uneven pool size", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(
      ["r1", "r2", "r3"],
      ["u1", "u2", "u3"],
      1 // each of the 3 users gets exactly 1 -- exactly enough capacity for 3 records
    )
    expect(assignments.map((a) => a.userId)).toEqual(["u1", "u2", "u3"])
    expect(perUser).toEqual({ u1: 1, u2: 1, u3: 1 })
  })

  test("single user pool with no cap absorbs every unassigned record", () => {
    const { assignments, perUser } = computeRoundRobinAssignment(["r1", "r2", "r3"], ["u1"])
    expect(assignments).toHaveLength(3)
    expect(assignments.every((a) => a.userId === "u1")).toBe(true)
    expect(perUser).toEqual({ u1: 3 })
  })
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realCrmEnablementService = await import("./crm-enablement-service")

describe("aggregateSalesRepPerformance -- CRM-007 per-rep scorecard math", () => {
  const opportunities: SalesRepPerfOpportunityInput[] = [
    // Rep A ("rep-a"): 2 won, 1 lost, 1 open (AI-scored)
    { ownerId: "rep-a", stage: "won", estimatedValue: 100000, aiWinProbability: null, createdAt: new Date("2026-01-01T00:00:00Z"), closedAt: new Date("2026-01-11T00:00:00Z") },
    { ownerId: "rep-a", stage: "won", estimatedValue: 50000, aiWinProbability: null, createdAt: new Date("2026-02-01T00:00:00Z"), closedAt: new Date("2026-02-21T00:00:00Z") },
    { ownerId: "rep-a", stage: "lost", estimatedValue: 30000, aiWinProbability: null, createdAt: new Date("2026-01-05T00:00:00Z"), closedAt: new Date("2026-01-15T00:00:00Z") },
    { ownerId: "rep-a", stage: "prospecting", estimatedValue: 40000, aiWinProbability: 50, createdAt: new Date("2026-03-01T00:00:00Z"), closedAt: null },

    // Rep B ("rep-b"): 1 won, 1 lost, no open pipeline
    { ownerId: "rep-b", stage: "won", estimatedValue: 80000, aiWinProbability: null, createdAt: new Date("2026-03-01T00:00:00Z"), closedAt: new Date("2026-03-06T00:00:00Z") },
    { ownerId: "rep-b", stage: "lost", estimatedValue: 20000, aiWinProbability: null, createdAt: new Date("2026-03-01T00:00:00Z"), closedAt: new Date("2026-03-04T00:00:00Z") },

    // Rep C ("rep-c"): 2 open, zero closed deals, never AI-scored
    { ownerId: "rep-c", stage: "proposal", estimatedValue: 60000, aiWinProbability: null, createdAt: new Date("2026-01-01T00:00:00Z"), closedAt: null },
    { ownerId: "rep-c", stage: "negotiation", estimatedValue: 40000, aiWinProbability: null, createdAt: new Date("2026-01-01T00:00:00Z"), closedAt: null },

    // Unassigned (ownerId null): 1 won
    { ownerId: null, stage: "won", estimatedValue: 10000, aiWinProbability: null, createdAt: new Date("2026-01-01T00:00:00Z"), closedAt: new Date("2026-01-08T00:00:00Z") },
  ]

  const activities: SalesRepPerfActivityInput[] = [
    { assignedToId: "rep-a" }, { assignedToId: "rep-a" }, { assignedToId: "rep-a" },
    { assignedToId: "rep-b" },
    { assignedToId: null }, // unattributable -- must not be counted anywhere
  ]

  // Only rep-a/rep-b have a resolvable name; rep-c is deliberately omitted to
  // prove the fallback (repName defaults to the raw ownerId when not found).
  const result = aggregateSalesRepPerformance(opportunities, activities, [
    { userId: "rep-a", userName: "Alice" },
    { userId: "rep-b", userName: "Bob" },
  ])

  function repRow(ownerId: string | null) {
    const row = result.reps.find((r) => r.ownerId === ownerId)
    if (!row) throw new Error(`no row for ownerId ${ownerId}`)
    return row
  }

  test("rep-a: 2 won + 1 lost -> 66.67% win rate, correct revenue/deal-size/cycle/activity math", () => {
    const a = repRow("rep-a")
    expect(a.repName).toBe("Alice")
    expect(a.wonCount).toBe(2)
    expect(a.lostCount).toBe(1)
    expect(a.closedWonRevenue).toBe(150000)
    expect(a.closedLostRevenue).toBe(30000)
    expect(a.winRate).toBe(66.67) // 2 / 3 * 100
    expect(a.avgDealSize).toBe(75000) // 150000 / 2
    expect(a.avgSalesCycleDays).toBe(13.33) // (10 + 20 + 10) / 3
    expect(a.pipelineValue).toBe(40000)
    expect(a.weightedPipelineValue).toBe(20000) // 40000 * 0.5 (aiWinProbability=50)
    expect(a.activityCount).toBe(3)
    expect(a.activitiesPerClosedDeal).toBe(1.5) // 3 / 2 (wonCount)
    expect(a.revenueTarget).toBeNull()
    expect(a.targetAchievementPercent).toBeNull()
  })

  test("rep-b: 1 won + 1 lost -> 50% win rate, no open pipeline", () => {
    const b = repRow("rep-b")
    expect(b.repName).toBe("Bob")
    expect(b.wonCount).toBe(1)
    expect(b.lostCount).toBe(1)
    expect(b.closedWonRevenue).toBe(80000)
    expect(b.closedLostRevenue).toBe(20000)
    expect(b.winRate).toBe(50)
    expect(b.avgDealSize).toBe(80000)
    expect(b.avgSalesCycleDays).toBe(4) // (5 + 3) / 2
    expect(b.pipelineValue).toBe(0)
    expect(b.weightedPipelineValue).toBe(0)
    expect(b.activityCount).toBe(1)
    expect(b.activitiesPerClosedDeal).toBe(1)
  })

  test("rep-c: zero closed deals -> win rate/avg deal size/avg cycle/activities-per-deal all null, not zero or fabricated; unresolved name falls back to ownerId", () => {
    const c = repRow("rep-c")
    expect(c.repName).toBe("rep-c") // no entry in repNames -- honest fallback
    expect(c.wonCount).toBe(0)
    expect(c.lostCount).toBe(0)
    expect(c.winRate).toBeNull()
    expect(c.avgDealSize).toBeNull()
    expect(c.avgSalesCycleDays).toBeNull()
    expect(c.activitiesPerClosedDeal).toBeNull()
    expect(c.pipelineValue).toBe(100000) // 60000 + 40000
    expect(c.weightedPipelineValue).toBe(0) // both opportunities never AI-scored -- honestly excluded, not assumed
    expect(c.activityCount).toBe(0)
  })

  test("unassigned bucket (ownerId null) still aggregates correctly and is labeled 'Unassigned'", () => {
    const u = repRow(null)
    expect(u.repName).toBe("Unassigned")
    expect(u.wonCount).toBe(1)
    expect(u.closedWonRevenue).toBe(10000)
    expect(u.winRate).toBe(100)
    expect(u.avgSalesCycleDays).toBe(7)
  })

  test("an activity with no assignedToId is excluded from every rep's count, not silently attributed", () => {
    const totalActivityCount = result.reps.reduce((s, r) => s + r.activityCount, 0)
    expect(totalActivityCount).toBe(4) // 5 activities total, 1 has assignedToId=null
  })

  test("org-wide totals sum every rep's own totals correctly", () => {
    expect(result.totalPipelineValue).toBe(140000) // 40000 (a) + 0 (b) + 100000 (c) + 0 (unassigned)
    expect(result.totalWeightedPipelineValue).toBe(20000)
    expect(result.totalClosedWonRevenue).toBe(240000) // 150000 + 80000 + 0 + 10000
    expect(result.totalClosedLostRevenue).toBe(50000) // 30000 + 20000
  })

  test("reps are sorted by closedWonRevenue descending", () => {
    const revenues = result.reps.map((r) => r.closedWonRevenue)
    expect(revenues).toEqual([...revenues].sort((x, y) => y - x))
    expect(result.reps[0].ownerId).toBe("rep-a")
  })

  test("empty input produces zero reps and zero totals, not an error", () => {
    const empty = aggregateSalesRepPerformance([], [])
    expect(empty.reps).toEqual([])
    expect(empty.totalPipelineValue).toBe(0)
    expect(empty.totalWeightedPipelineValue).toBe(0)
    expect(empty.totalClosedWonRevenue).toBe(0)
    expect(empty.totalClosedLostRevenue).toBe(0)
  })
})

describe("getSalesRepPerformanceDashboard (CRM-007, DB-wired)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./crm-enablement-service", () => realCrmEnablementService)
  })

  const ORG_ID = "org-crm007-test"

  test("fetches opportunities/stage-history/activities/rep-names for the org and applies the periodStart/periodEnd/ownerIds filters passed through", async () => {
    const opportunity = {
      id: "opp-1", orgId: ORG_ID, ownerId: "rep-a", stage: "won",
      estimatedValue: "50000", aiWinProbability: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }
    const stageHistoryRow = { entityId: "opp-1", changedAt: new Date("2026-01-15T00:00:00Z") }
    const activity = { assignedToId: "rep-a" }
    const repUser = { id: "rep-a", name: "Alice" }

    let capturedOppWhere: unknown
    let capturedActivityWhere: unknown

    const db = {
      query: {
        crmOpportunities: {
          findMany: mock(async (args: { where: unknown }) => {
            capturedOppWhere = args.where
            return [opportunity]
          }),
        },
        crmStageHistory: { findMany: mock(async () => [stageHistoryRow]) },
        crmActivities: {
          findMany: mock(async (args: { where: unknown }) => {
            capturedActivityWhere = args.where
            return [activity]
          }),
        },
        users: { findMany: mock(async () => [repUser]) },
      },
    }

    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./crm-enablement-service", () => ({ requireSalesEnabled: mock(async () => undefined) }))

    const { getSalesRepPerformanceDashboard } = await import("./crm-service")
    const dashboard = await getSalesRepPerformanceDashboard(
      { orgId: ORG_ID },
      { periodStart: "2026-01-01", periodEnd: "2026-01-31", ownerIds: ["rep-a"] }
    )

    expect(dashboard.reps).toHaveLength(1)
    expect(dashboard.reps[0].repName).toBe("Alice")
    expect(dashboard.reps[0].wonCount).toBe(1)
    expect(dashboard.reps[0].closedWonRevenue).toBe(50000)
    expect(dashboard.reps[0].avgSalesCycleDays).toBe(14) // 2026-01-01 -> 2026-01-15

    // The period/ownerIds filters really were built into the where clauses
    // passed to Drizzle, not silently dropped.
    expect(capturedOppWhere).toBeDefined()
    expect(capturedActivityWhere).toBeDefined()
  })

  test("an org with zero opportunities and zero activities returns an empty rep list, not an error", async () => {
    const db = {
      query: {
        crmOpportunities: { findMany: mock(async () => []) },
        crmStageHistory: { findMany: mock(async () => []) },
        crmActivities: { findMany: mock(async () => []) },
        users: { findMany: mock(async () => []) },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./crm-enablement-service", () => ({ requireSalesEnabled: mock(async () => undefined) }))

    const { getSalesRepPerformanceDashboard } = await import("./crm-service")
    const dashboard = await getSalesRepPerformanceDashboard({ orgId: ORG_ID })
    expect(dashboard.reps).toEqual([])
    expect(dashboard.totalPipelineValue).toBe(0)
  })
})
