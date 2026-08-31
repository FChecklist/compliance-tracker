/// <reference types="bun-types" />
// Tests buildConfidenceCorrelationReport() directly, the pure aggregation
// core getConfidenceCorrelationReport() delegates to -- matching this
// repo's established pattern of not touching a live DB from a .test.ts
// file (model-scorecard-service.test.ts's own precedent).
import { describe, expect, test } from "bun:test"
import { buildConfidenceCorrelationReport, type ConfidenceBandGroupRow } from "./confidence-correlation-service"

function row(overrides: Partial<ConfidenceBandGroupRow>): ConfidenceBandGroupRow {
  return {
    confidenceBand: null,
    dispatchCount: 0,
    terminalCount: 0,
    successCount: 0,
    reviewedCount: 0,
    auditFindingCount: 0,
    ...overrides,
  }
}

describe("buildConfidenceCorrelationReport -- shape and rates", () => {
  test("empty input produces an empty report with no signal", () => {
    const report = buildConfidenceCorrelationReport([])
    expect(report.bands).toEqual([])
    expect(report.monotonic).toBeNull()
    expect(report.anomalies).toEqual([])
  })

  test("rows with a null confidenceBand are dropped -- they carry no signal to correlate", () => {
    const report = buildConfidenceCorrelationReport([row({ confidenceBand: null, dispatchCount: 5 })])
    expect(report.bands).toEqual([])
  })

  test("computes successRate and auditFindingRate per band", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 10, terminalCount: 10, successCount: 9, reviewedCount: 2, auditFindingCount: 0 }),
    ])
    expect(report.bands).toHaveLength(1)
    expect(report.bands[0].successRate).toBeCloseTo(0.9)
    expect(report.bands[0].auditFindingRate).toBe(0)
  })

  test("successRate/auditFindingRate are null (no signal) rather than 0 when nothing terminal/reviewed yet", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 3, terminalCount: 0, successCount: 0, reviewedCount: 0, auditFindingCount: 0 }),
    ])
    expect(report.bands[0].successRate).toBeNull()
    expect(report.bands[0].auditFindingRate).toBeNull()
  })

  test("bands are ordered highest reported confidence first, regardless of input order", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "escalation_required", dispatchCount: 1, terminalCount: 1, successCount: 1 }),
      row({ confidenceBand: "auto_proceed", dispatchCount: 1, terminalCount: 1, successCount: 1 }),
      row({ confidenceBand: "peer_review_required", dispatchCount: 1, terminalCount: 1, successCount: 1 }),
    ])
    expect(report.bands.map((b) => b.confidenceBand)).toEqual([
      "auto_proceed",
      "peer_review_required",
      "escalation_required",
    ])
  })

  test("merges duplicate rows for the same band by summing, not overwriting", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 5, terminalCount: 5, successCount: 5 }),
      row({ confidenceBand: "auto_proceed", dispatchCount: 3, terminalCount: 3, successCount: 1 }),
    ])
    expect(report.bands).toHaveLength(1)
    expect(report.bands[0].dispatchCount).toBe(8)
    expect(report.bands[0].successCount).toBe(6)
  })
})

describe("buildConfidenceCorrelationReport -- monotonicity (the actual correlation check)", () => {
  test("monotonic = true when success rate decreases as reported confidence decreases (healthy)", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 10, terminalCount: 10, successCount: 10 }), // 100%
      row({ confidenceBand: "self_review_required", dispatchCount: 10, terminalCount: 10, successCount: 8 }), // 80%
      row({ confidenceBand: "peer_review_required", dispatchCount: 10, terminalCount: 10, successCount: 6 }), // 60%
      row({ confidenceBand: "escalation_required", dispatchCount: 10, terminalCount: 10, successCount: 3 }), // 30%
    ])
    expect(report.monotonic).toBe(true)
    expect(report.anomalies).toEqual([])
  })

  test("monotonic = false and reports an anomaly when a lower-confidence band outperforms a higher-confidence one", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 10, terminalCount: 10, successCount: 6 }), // 60%
      row({ confidenceBand: "escalation_required", dispatchCount: 10, terminalCount: 10, successCount: 9 }), // 90% -- backwards!
    ])
    expect(report.monotonic).toBe(false)
    expect(report.anomalies).toHaveLength(1)
    expect(report.anomalies[0]).toContain("escalation_required")
    expect(report.anomalies[0]).toContain("auto_proceed")
  })

  test("equal success rates between adjacent bands are NOT an anomaly (non-increasing, not strictly decreasing)", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 10, terminalCount: 10, successCount: 5 }),
      row({ confidenceBand: "self_review_required", dispatchCount: 10, terminalCount: 10, successCount: 5 }),
    ])
    expect(report.monotonic).toBe(true)
  })

  test("monotonic is null (not true) when fewer than 2 bands have a success-rate signal -- no data is not a pass", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 10, terminalCount: 10, successCount: 10 }),
      row({ confidenceBand: "escalation_required", dispatchCount: 3, terminalCount: 0, successCount: 0 }), // no terminal signal yet
    ])
    expect(report.monotonic).toBeNull()
  })

  test("a gap band (no dispatches) does not break the adjacency check -- compares the nearest bands that DO have signal", () => {
    const report = buildConfidenceCorrelationReport([
      row({ confidenceBand: "auto_proceed", dispatchCount: 10, terminalCount: 10, successCount: 9 }),
      // self_review_required and peer_review_required have zero dispatches, absent entirely
      row({ confidenceBand: "escalation_required", dispatchCount: 10, terminalCount: 10, successCount: 2 }),
    ])
    expect(report.bands.map((b) => b.confidenceBand)).toEqual(["auto_proceed", "escalation_required"])
    expect(report.monotonic).toBe(true)
  })
})
