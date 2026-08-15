/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeRoutingAccuracy, shouldRecommendPredictiveModelSelectionReview } from "./routing-accuracy-report-service"

describe("computeRoutingAccuracy", () => {
  test("zero total decisions -> rate of 1, not NaN -- no data isn't '0% accurate'", () => {
    const result = computeRoutingAccuracy({ total: 0, escalatedCount: 0, gatedCount: 0, missedEscalationCount: 0 })
    expect(result.routingAccuracyRate).toBe(1)
    expect(result.negativeSignalRate).toBe(0)
  })

  test("no negative signals at all -> 100% accuracy", () => {
    const result = computeRoutingAccuracy({ total: 50, escalatedCount: 0, gatedCount: 0, missedEscalationCount: 0 })
    expect(result.routingAccuracyRate).toBe(1)
  })

  test("blends escalated + gated + missed-escalation into one negative-signal rate", () => {
    const result = computeRoutingAccuracy({ total: 100, escalatedCount: 5, gatedCount: 3, missedEscalationCount: 2 })
    expect(result.negativeSignalRate).toBeCloseTo(0.1, 5)
    expect(result.routingAccuracyRate).toBeCloseTo(0.9, 5)
  })

  test("clamps at 0 rather than going negative when negative signals somehow exceed total (defensive)", () => {
    const result = computeRoutingAccuracy({ total: 10, escalatedCount: 8, gatedCount: 5, missedEscalationCount: 2 })
    expect(result.routingAccuracyRate).toBe(0)
  })

  test("a fully negative period reports exactly 0 accuracy", () => {
    const result = computeRoutingAccuracy({ total: 10, escalatedCount: 10, gatedCount: 0, missedEscalationCount: 0 })
    expect(result.routingAccuracyRate).toBe(0)
  })
})

describe("shouldRecommendPredictiveModelSelectionReview", () => {
  test("below the minimum volume, never recommends even at 100% negative rate -- too little data to be a real signal", () => {
    expect(shouldRecommendPredictiveModelSelectionReview(5, 1)).toBe(false)
  })

  test("enough volume but a low negative-signal rate does not recommend", () => {
    expect(shouldRecommendPredictiveModelSelectionReview(100, 0.05)).toBe(false)
  })

  test("enough volume AND negative-signal rate at/above the 0.2 threshold recommends a review", () => {
    expect(shouldRecommendPredictiveModelSelectionReview(100, 0.2)).toBe(true)
    expect(shouldRecommendPredictiveModelSelectionReview(20, 0.5)).toBe(true)
  })

  test("exactly at the volume floor (20) still counts", () => {
    expect(shouldRecommendPredictiveModelSelectionReview(20, 0.2)).toBe(true)
  })
})
