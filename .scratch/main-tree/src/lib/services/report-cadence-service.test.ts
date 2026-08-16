/// <reference types="bun-types" />
// Tests the pure assembly/aggregation functions only -- the DB-touching
// generate*Report() wrappers are not unit-tested here, matching this
// file's own sibling ai-performance-report-service.test.ts and
// task-service.test.ts's documented pure/DB-touching split.
import { describe, expect, test } from "bun:test"
import {
  parseEscalationEvent,
  summarizeEscalationsByRung,
  summarizeRecommendationsByType,
  summarizeRecommendationsByTarget,
  selectOpenRecommendations,
  buildRiskTrendSeries,
  summarizeRiskTotals,
  type LoopImprovementRow,
  type RiskEventRow,
} from "./report-cadence-service"

describe("parseEscalationEvent", () => {
  test("parses the exact suffix every nextEscalationRung() call site writes", () => {
    const event = parseEscalationEvent("Calculation failed: boom -- escalated to Chief Software Engineering Officer (CSEO) (Coding, Implementation, Code generation, Bug fixes, Testing, Refactoring).")
    expect(event).toEqual({
      title: "Chief Software Engineering Officer (CSEO)",
      authority: "Coding, Implementation, Code generation, Bug fixes, Testing, Refactoring",
    })
  })

  test("parses the monitoring-rule-violation shape", () => {
    const event = parseEscalationEvent("Monitoring rule violated (durationMs = 999999) -- escalated to Chief Operating Officer (COO) (Cross-Agent Decisions, Policy Interpretation).")
    expect(event?.title).toBe("Chief Operating Officer (COO)")
  })

  test("a plain system message with no escalation suffix returns null, not a guessed event", () => {
    expect(parseEscalationEvent("Result: {\"ok\":true}")).toBeNull()
  })

  test("an assistant-style message that merely mentions 'escalated' without the fixed suffix returns null", () => {
    expect(parseEscalationEvent("This task was previously escalated but is now resolved.")).toBeNull()
  })

  test("empty string returns null", () => {
    expect(parseEscalationEvent("")).toBeNull()
  })
})

describe("summarizeEscalationsByRung", () => {
  test("empty list produces an empty map", () => {
    expect(summarizeEscalationsByRung([])).toEqual({})
  })

  test("groups and counts by rung title", () => {
    const events = [
      { title: "Chief Software Engineering Officer (CSEO)", authority: "a" },
      { title: "Chief Software Engineering Officer (CSEO)", authority: "a" },
      { title: "Chief Operating Officer (COO)", authority: "b" },
    ]
    expect(summarizeEscalationsByRung(events)).toEqual({
      "Chief Software Engineering Officer (CSEO)": 2,
      "Chief Operating Officer (COO)": 1,
    })
  })
})

function makeRow(overrides: Partial<LoopImprovementRow> = {}): LoopImprovementRow {
  return {
    id: "id1", loopId: "loop1", improvementType: "prompt_tuning", targetType: "worker_agent",
    targetId: "agent1", isDeployed: false, rollbackTriggered: false,
    ...overrides,
  }
}

describe("summarizeRecommendationsByType", () => {
  test("empty list produces an empty map", () => {
    expect(summarizeRecommendationsByType([])).toEqual({})
  })

  test("groups and counts by improvementType", () => {
    const rows = [makeRow({ improvementType: "prompt_tuning" }), makeRow({ improvementType: "prompt_tuning" }), makeRow({ improvementType: "routing_change" })]
    expect(summarizeRecommendationsByType(rows)).toEqual({ prompt_tuning: 2, routing_change: 1 })
  })
})

describe("summarizeRecommendationsByTarget", () => {
  test("groups and counts by targetType", () => {
    const rows = [makeRow({ targetType: "worker_agent" }), makeRow({ targetType: "orchestra_layer" })]
    expect(summarizeRecommendationsByTarget(rows)).toEqual({ worker_agent: 1, orchestra_layer: 1 })
  })
})

describe("selectOpenRecommendations", () => {
  test("includes rows that are neither deployed nor rolled back", () => {
    const pending = makeRow({ id: "pending", isDeployed: false, rollbackTriggered: false })
    const rows = [pending]
    expect(selectOpenRecommendations(rows)).toEqual([pending])
  })

  test("excludes deployed rows", () => {
    const rows = [makeRow({ isDeployed: true, rollbackTriggered: false })]
    expect(selectOpenRecommendations(rows)).toEqual([])
  })

  test("excludes rolled-back rows", () => {
    const rows = [makeRow({ isDeployed: false, rollbackTriggered: true })]
    expect(selectOpenRecommendations(rows)).toEqual([])
  })

  test("a deployed-then-rolled-back row is still excluded (it was decided, just reversed -- not open)", () => {
    const rows = [makeRow({ isDeployed: true, rollbackTriggered: true })]
    expect(selectOpenRecommendations(rows)).toEqual([])
  })
})

describe("buildRiskTrendSeries", () => {
  test("empty rows produce an empty series", () => {
    expect(buildRiskTrendSeries([])).toEqual([])
  })

  test("null riskLevel rows are excluded, not counted as a zero-risk bucket", () => {
    const rows: RiskEventRow[] = [{ riskLevel: null, createdAt: new Date("2026-07-10T10:00:00Z") }]
    expect(buildRiskTrendSeries(rows)).toEqual([])
  })

  test("buckets by UTC calendar day and risk level", () => {
    const rows: RiskEventRow[] = [
      { riskLevel: "high", createdAt: new Date("2026-07-10T01:00:00Z") },
      { riskLevel: "high", createdAt: new Date("2026-07-10T23:00:00Z") },
      { riskLevel: "critical", createdAt: new Date("2026-07-11T05:00:00Z") },
    ]
    const series = buildRiskTrendSeries(rows)
    expect(series).toEqual([
      { date: "2026-07-10", counts: { low: 0, medium: 0, high: 2, critical: 0 }, total: 2 },
      { date: "2026-07-11", counts: { low: 0, medium: 0, high: 0, critical: 1 }, total: 1 },
    ])
  })

  test("days are sorted chronologically regardless of input row order", () => {
    const rows: RiskEventRow[] = [
      { riskLevel: "low", createdAt: new Date("2026-07-12T00:00:00Z") },
      { riskLevel: "low", createdAt: new Date("2026-07-09T00:00:00Z") },
    ]
    expect(buildRiskTrendSeries(rows).map((p) => p.date)).toEqual(["2026-07-09", "2026-07-12"])
  })

  test("an unrecognized riskLevel string is excluded, not silently miscounted", () => {
    const rows: RiskEventRow[] = [{ riskLevel: "extreme", createdAt: new Date("2026-07-10T00:00:00Z") }]
    expect(buildRiskTrendSeries(rows)).toEqual([])
  })
})

describe("summarizeRiskTotals", () => {
  test("empty rows produce all-zero totals", () => {
    expect(summarizeRiskTotals([])).toEqual({ low: 0, medium: 0, high: 0, critical: 0 })
  })

  test("counts across all days, ignoring nulls and unrecognized values", () => {
    const rows: RiskEventRow[] = [
      { riskLevel: "critical", createdAt: new Date("2026-07-10T00:00:00Z") },
      { riskLevel: "critical", createdAt: new Date("2026-07-11T00:00:00Z") },
      { riskLevel: "low", createdAt: new Date("2026-07-11T00:00:00Z") },
      { riskLevel: null, createdAt: new Date("2026-07-11T00:00:00Z") },
      { riskLevel: "not-a-level", createdAt: new Date("2026-07-11T00:00:00Z") },
    ]
    expect(summarizeRiskTotals(rows)).toEqual({ low: 1, medium: 0, high: 0, critical: 2 })
  })
})
