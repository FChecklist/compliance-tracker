// Sales Pipeline Interactive Dashboard (2026-07-27). Pure-function tests,
// no live DB -- same pattern as crm-accounts-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  normalizePipelineStatus, buildPipelineDeals, filterByStatus, computeKpis,
  computeSalesLeadPerformance, computePipelineStatusOverview,
  computeMonthlyTrend, computeMonthlyTrendTable, PIPELINE_STATUSES,
  type RawOpportunity,
} from "./sales-pipeline-dashboard-service"

describe("normalizePipelineStatus -- legacy stage mapping + canonical passthrough", () => {
  test("maps all 5 legacy crmOpportunities.stage values to a mockup status", () => {
    expect(normalizePipelineStatus("prospecting")).toBe("Lead")
    expect(normalizePipelineStatus("proposal")).toBe("Pitched")
    expect(normalizePipelineStatus("negotiation")).toBe("Follow up")
    expect(normalizePipelineStatus("won")).toBe("Awarded")
    expect(normalizePipelineStatus("lost")).toBe("Lost")
  })

  test("passes through canonical mockup names unchanged", () => {
    for (const s of PIPELINE_STATUSES) expect(normalizePipelineStatus(s)).toBe(s)
  })

  test("passes through canonical names case-insensitively and with underscores/hyphens", () => {
    expect(normalizePipelineStatus("HOLD")).toBe("Hold")
    expect(normalizePipelineStatus("follow_up")).toBe("Follow up")
    expect(normalizePipelineStatus("follow-up")).toBe("Follow up")
    expect(normalizePipelineStatus("regret")).toBe("Regret")
    expect(normalizePipelineStatus("estimation")).toBe("Estimation")
  })

  test("folds an unrecognized future value into Lead rather than dropping it", () => {
    expect(normalizePipelineStatus("some_new_stage")).toBe("Lead")
  })
})

// Realistic seeded set spanning multiple stages, mirroring the task's own
// success-criteria requirement: prove KPI aggregations compute correctly
// against a multi-stage set, not a single-stage toy example.
function seedOpportunities(): RawOpportunity[] {
  return [
    { id: "o1", name: "Acme Retrofit", ownerId: "u1", estimatedValue: "100000", stage: "won", expectedCloseDate: "2026-01-15", aiWinProbability: null },
    { id: "o2", name: "Acme Phase 2", ownerId: "u1", estimatedValue: "50000", stage: "won", expectedCloseDate: "2026-02-10", aiWinProbability: null },
    { id: "o3", name: "Beta Tower", ownerId: "u2", estimatedValue: "200000", stage: "lost", expectedCloseDate: "2026-01-20", aiWinProbability: null },
    { id: "o4", name: "Gamma Mall", ownerId: "u2", estimatedValue: "75000", stage: "hold", expectedCloseDate: "2026-02-01", aiWinProbability: 40 },
    { id: "o5", name: "Delta Bridge", ownerId: "u1", estimatedValue: "30000", stage: "proposal", expectedCloseDate: "2026-02-05", aiWinProbability: 60 },
    { id: "o6", name: "Epsilon Villa", ownerId: "u2", estimatedValue: "20000", stage: "prospecting", expectedCloseDate: null, aiWinProbability: 20 },
    { id: "o7", name: "Zeta Plant", ownerId: "u1", estimatedValue: "40000", stage: "regret", expectedCloseDate: "2026-02-18", aiWinProbability: null },
    { id: "o8", name: "Eta Depot", ownerId: "u2", estimatedValue: "10000", stage: "estimation", expectedCloseDate: null, aiWinProbability: 80 },
  ]
}

const OWNER_NAMES = { u1: "Priya", u2: "Rahul" }

describe("computeKpis -- realistic multi-stage seeded set", () => {
  const deals = buildPipelineDeals(seedOpportunities(), OWNER_NAMES)

  test("computes Sales Value as the sum of every deal's value", () => {
    // 100000 + 50000 + 200000 + 75000 + 30000 + 20000 + 40000 + 10000
    expect(computeKpis(deals).salesValue).toBe(525000)
  })

  test("computes Hold %, Lost %, Regret % as counts over the full set", () => {
    const kpis = computeKpis(deals)
    expect(kpis.holdPct).toBeCloseTo((1 / 8) * 100) // o4
    expect(kpis.lostPct).toBeCloseTo((1 / 8) * 100) // o3
    expect(kpis.regretPct).toBeCloseTo((1 / 8) * 100) // o7
  })

  test("computes Success % as Awarded / (Awarded + Lost), matching crm-service.ts's existing winRate formula", () => {
    // 2 Awarded (o1, o2), 1 Lost (o3) -> 2 / 3
    expect(computeKpis(deals).successPct).toBeCloseTo((2 / 3) * 100)
  })

  test("computes Health % as the average aiWinProbability across open (non-terminal) scored deals", () => {
    // Open statuses: Hold(o4,40), Pitched(o5,60), Lead(o6,20), Estimation(o8,80) -> avg 50
    expect(computeKpis(deals).healthPct).toBeCloseTo(50)
  })

  test("returns null Health % when no open deal has been AI-scored yet", () => {
    const unscored = deals.map((d) => ({ ...d, aiWinProbability: null }))
    expect(computeKpis(unscored).healthPct).toBeNull()
  })

  test("returns all-zero KPIs for an empty set rather than dividing by zero", () => {
    const kpis = computeKpis([])
    expect(kpis).toEqual({ salesValue: 0, holdPct: 0, lostPct: 0, successPct: 0, healthPct: null, regretPct: 0 })
  })
})

describe("cross-filter interaction -- selecting a status recomputes KPIs/charts over only that subset", () => {
  const deals = buildPipelineDeals(seedOpportunities(), OWNER_NAMES)

  test("filtering to 'Awarded' narrows Sales Value to just the awarded deals", () => {
    const filtered = filterByStatus(deals, "Awarded")
    expect(filtered).toHaveLength(2)
    expect(computeKpis(filtered).salesValue).toBe(150000) // 100000 + 50000
  })

  test("filtering to 'Awarded' makes Success % 100% and Hold %/Lost % 0%, not the unfiltered global rate", () => {
    const kpis = computeKpis(filterByStatus(deals, "Awarded"))
    expect(kpis.successPct).toBe(100)
    expect(kpis.holdPct).toBe(0)
    expect(kpis.lostPct).toBe(0)
  })

  test("filtering also narrows the Sales Lead Performance and Pipeline Status bar data", () => {
    const filtered = filterByStatus(deals, "Awarded")
    expect(computeSalesLeadPerformance(filtered)).toEqual([{ label: "Priya", value: 150000 }])
    const statusBars = computePipelineStatusOverview(filtered)
    expect(statusBars.find((b) => b.label === "Awarded")?.value).toBe(2)
    expect(statusBars.find((b) => b.label === "Lost")?.value).toBe(0)
  })

  test("null filter (Clear) returns the full unfiltered set", () => {
    expect(filterByStatus(deals, null)).toHaveLength(deals.length)
  })
})

describe("computeSalesLeadPerformance -- count of value by salesperson", () => {
  test("sums deal value per salesperson, sorted descending", () => {
    const deals = buildPipelineDeals(seedOpportunities(), OWNER_NAMES)
    const bars = computeSalesLeadPerformance(deals)
    // Priya: o1+o2+o5+o7 = 100000+50000+30000+40000 = 220000
    // Rahul: o3+o4+o6+o8 = 200000+75000+20000+10000 = 305000
    expect(bars).toEqual([{ label: "Rahul", value: 305000 }, { label: "Priya", value: 220000 }])
  })

  test("attributes an unassigned deal to 'Unassigned'", () => {
    const deals = buildPipelineDeals(
      [{ id: "o9", name: "Orphan Deal", ownerId: null, estimatedValue: "5000", stage: "won", expectedCloseDate: null, aiWinProbability: null }],
      OWNER_NAMES
    )
    expect(computeSalesLeadPerformance(deals)).toEqual([{ label: "Unassigned", value: 5000 }])
  })
})

describe("computePipelineStatusOverview -- count by stage, all 8 statuses always present", () => {
  test("returns a 0 count for statuses with no deals, in the mockup's fixed order", () => {
    const deals = buildPipelineDeals(seedOpportunities(), OWNER_NAMES)
    const bars = computePipelineStatusOverview(deals)
    expect(bars.map((b) => b.label)).toEqual([...PIPELINE_STATUSES])
    expect(bars.find((b) => b.label === "Follow up")?.value).toBe(0)
  })
})

describe("computeMonthlyTrend / computeMonthlyTrendTable -- Target/Achieved/Shortfall", () => {
  const deals = buildPipelineDeals(seedOpportunities(), OWNER_NAMES)
  const targets = [{ month: "2026-01", targetValue: 200000 }, { month: "2026-02", targetValue: 40000 }]

  test("buckets Achieved from Awarded deals by expectedCloseDate month", () => {
    const trend = computeMonthlyTrend(deals, targets)
    const jan = trend.find((t) => t.month === "2026-01")
    const feb = trend.find((t) => t.month === "2026-02")
    expect(jan?.achieved).toBe(100000) // o1
    expect(feb?.achieved).toBe(50000) // o2
  })

  test("computes Shortfall as max(target - achieved, 0), never negative", () => {
    const trend = computeMonthlyTrend(deals, targets)
    expect(trend.find((t) => t.month === "2026-01")?.shortfall).toBe(100000) // 200000 - 100000
    expect(trend.find((t) => t.month === "2026-02")?.shortfall).toBe(0) // achieved (50000) > target (40000)
  })

  test("reshapes into a 3-row table with a Total column matching the sum of each row", () => {
    const table = computeMonthlyTrendTable(computeMonthlyTrend(deals, targets))
    expect(table.rows.map((r) => r.label)).toEqual(["Target", "Achieved", "Shortfall"])
    const achievedRow = table.rows.find((r) => r.label === "Achieved")!
    expect(achievedRow.total).toBe(achievedRow.byMonth.reduce((a, b) => a + b, 0))
    expect(achievedRow.total).toBe(150000)
  })
})
