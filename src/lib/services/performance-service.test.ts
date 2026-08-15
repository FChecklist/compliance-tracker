// Phase 0 HR gap-closure (2026-07-27): tests the pure weighted-score
// helper directly, matching this repo's established pattern of not
// exercising withTenantContext/a live DB from a .test.ts file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeWeightedScore, ServiceError } from "./performance-service"

describe("computeWeightedScore", () => {
  test("computes a weighted average when weights sum to exactly 100", () => {
    const goals = [
      { rating: 4, weightPercent: 60 },
      { rating: 2, weightPercent: 40 },
    ]
    // (4*60 + 2*40) / 100 = 3.2
    expect(computeWeightedScore(goals)).toBe(3.2)
  })

  test("accepts string weightPercent (as stored via Drizzle numeric columns)", () => {
    const goals = [
      { rating: 5, weightPercent: "100" },
    ]
    expect(computeWeightedScore(goals)).toBe(5)
  })

  test("rejects weights that don't sum to 100", () => {
    const goals = [
      { rating: 4, weightPercent: 50 },
      { rating: 2, weightPercent: 40 },
    ]
    expect(() => computeWeightedScore(goals)).toThrow(ServiceError)
  })

  test("rejects when any goal is unrated", () => {
    const goals = [
      { rating: 4, weightPercent: 60 },
      { rating: null, weightPercent: 40 },
    ]
    expect(() => computeWeightedScore(goals)).toThrow(ServiceError)
  })
})
