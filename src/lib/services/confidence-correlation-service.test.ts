/// <reference types="bun-types" />
// VERIDIAN Review Framework gap-closure, "AI Confidence Before Code
// Changes": tests mergeConfidenceCorrelationGroups() directly -- the pure
// aggregation core getConfidenceOutcomeCorrelation() delegates to, matching
// this repo's established pattern of not touching a live DB from a
// .test.ts file (see model-scorecard-service.test.ts).
import { describe, expect, test } from "bun:test"
import { mergeConfidenceCorrelationGroups, type ConfidenceCorrelationGroupRow } from "./confidence-correlation-service"

function row(overrides: Partial<ConfidenceCorrelationGroupRow>): ConfidenceCorrelationGroupRow {
  return {
    confidenceBand: null,
    sampleCount: 0,
    reviewedCount: 0,
    rejectedCount: 0,
    reAuditCount: 0,
    ...overrides,
  }
}

describe("mergeConfidenceCorrelationGroups -- basic shape", () => {
  test("empty input produces an empty report with no miscalibration", () => {
    const report = mergeConfidenceCorrelationGroups([])
    expect(report.bands).toEqual([])
    expect(report.miscalibrationDetected).toBe(false)
    expect(report.miscalibrationNotes).toEqual([])
  })

  test("a null or unrecognized confidence_band is dropped, not crashed on or fabricated into a band", () => {
    const report = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: null, sampleCount: 5 }),
      row({ confidenceBand: "not_a_real_band", sampleCount: 3 }),
    ])
    expect(report.bands).toEqual([])
  })

  test("bands are returned best-confidence-first", () => {
    const report = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: "escalation_required", sampleCount: 2 }),
      row({ confidenceBand: "auto_proceed", sampleCount: 4 }),
      row({ confidenceBand: "peer_review_required", sampleCount: 1 }),
    ])
    expect(report.bands.map((b) => b.confidenceBand)).toEqual(["auto_proceed", "peer_review_required", "escalation_required"])
  })

  test("multiple raw rows for the same band merge additively (not overwritten)", () => {
    const report = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: "auto_proceed", sampleCount: 10, reAuditCount: 1 }),
      row({ confidenceBand: "auto_proceed", sampleCount: 5, reAuditCount: 1 }),
    ])
    expect(report.bands).toHaveLength(1)
    expect(report.bands[0].sampleCount).toBe(15)
    expect(report.bands[0].reAuditCount).toBe(2)
  })
})

describe("mergeConfidenceCorrelationGroups -- rates use null-for-no-signal, not 0", () => {
  test("rejectionRate is null when nothing in the band was reviewed (expected for auto_proceed, which skips review by design)", () => {
    const [entry] = mergeConfidenceCorrelationGroups([row({ confidenceBand: "auto_proceed", sampleCount: 20, reviewedCount: 0 })]).bands
    expect(entry.rejectionRate).toBeNull()
  })

  test("rejectionRate is rejectedCount / reviewedCount when there is signal", () => {
    const [entry] = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: "peer_review_required", sampleCount: 10, reviewedCount: 8, rejectedCount: 2 }),
    ]).bands
    expect(entry.rejectionRate).toBeCloseTo(0.25)
  })

  test("reAuditRate is reAuditCount / sampleCount and is comparable across every band", () => {
    const [entry] = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: "auto_proceed", sampleCount: 100, reAuditCount: 5 }),
    ]).bands
    expect(entry.reAuditRate).toBeCloseTo(0.05)
  })
})

describe("mergeConfidenceCorrelationGroups -- miscalibration detection (the actual finding)", () => {
  test("no miscalibration when higher-confidence bands have equal-or-lower re-audit rates than lower-confidence bands", () => {
    const report = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: "auto_proceed", sampleCount: 100, reAuditCount: 1 }), // 1%
      row({ confidenceBand: "self_review_required", sampleCount: 100, reAuditCount: 3 }), // 3%
      row({ confidenceBand: "peer_review_required", sampleCount: 100, reAuditCount: 6 }), // 6%
      row({ confidenceBand: "escalation_required", sampleCount: 100, reAuditCount: 10 }), // 10%
    ])
    expect(report.miscalibrationDetected).toBe(false)
    expect(report.miscalibrationNotes).toEqual([])
  })

  test("flags miscalibration when auto_proceed's re-audit rate is worse than escalation_required's", () => {
    const report = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: "auto_proceed", sampleCount: 100, reAuditCount: 20 }), // 20% -- supposedly the SAFEST band
      row({ confidenceBand: "escalation_required", sampleCount: 100, reAuditCount: 5 }), // 5% -- supposedly the RISKIEST band
    ])
    expect(report.miscalibrationDetected).toBe(true)
    expect(report.miscalibrationNotes).toHaveLength(1)
    expect(report.miscalibrationNotes[0]).toContain("auto_proceed")
    expect(report.miscalibrationNotes[0]).toContain("escalation_required")
  })

  test("a band with no reAuditRate signal (0 samples) is excluded from comparison, not treated as 0", () => {
    const report = mergeConfidenceCorrelationGroups([
      row({ confidenceBand: "auto_proceed", sampleCount: 0, reAuditCount: 0 }),
      row({ confidenceBand: "escalation_required", sampleCount: 50, reAuditCount: 10 }),
    ])
    // auto_proceed has sampleCount 0 -> reAuditRate null -> excluded from byBand entirely
    // (rate() returns null and the row itself still surfaces with sampleCount 0)
    expect(report.bands.find((b) => b.confidenceBand === "auto_proceed")?.reAuditRate).toBeNull()
    expect(report.miscalibrationDetected).toBe(false)
  })
})
