import { describe, expect, test } from "bun:test"
import { aggregateCostPerQuality, type CostPerQualityRun } from "./cost-quality-service"

function run(overrides: Partial<CostPerQualityRun>): CostPerQualityRun {
  return {
    runId: "run-1", roleKey: "senior_backend_engineer", model: "z-ai/glm-5.2",
    passRate: 1, passedCases: 5, totalCases: 5, regressionDetected: false,
    costUsd: 1, costPerPassedCase: 0.2, createdAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  }
}

describe("aggregateCostPerQuality", () => {
  test("empty input -> empty output", () => {
    expect(aggregateCostPerQuality([])).toEqual([])
  })

  test("sums cost/cases exactly across multiple runs of the same role+model (not an average-of-averages)", () => {
    const runs = [
      run({ runId: "r2", costUsd: 2, passedCases: 8, totalCases: 10, createdAt: "2026-08-15T02:00:00.000Z" }),
      run({ runId: "r1", costUsd: 1, passedCases: 5, totalCases: 5, createdAt: "2026-08-15T01:00:00.000Z" }),
    ]
    const [entry] = aggregateCostPerQuality(runs)
    expect(entry.runCount).toBe(2)
    expect(entry.totalCostUsd).toBe(3)
    expect(entry.totalPassedCases).toBe(13)
    expect(entry.totalCases).toBe(15)
    expect(entry.aggregatePassRate).toBeCloseTo(13 / 15)
    expect(entry.costPerQualityPoint).toBeCloseTo(3 / 13)
  })

  test("separates distinct (roleKey, model) pairs into distinct entries", () => {
    const runs = [
      run({ roleKey: "role_a", model: "model_a" }),
      run({ roleKey: "role_b", model: "model_b" }),
    ]
    const entries = aggregateCostPerQuality(runs)
    expect(entries).toHaveLength(2)
  })

  test("costPerQualityPoint is null when nothing has ever passed (undefined ratio, not 0 or Infinity)", () => {
    const [entry] = aggregateCostPerQuality([run({ costUsd: 5, passedCases: 0, totalCases: 5 })])
    expect(entry.costPerQualityPoint).toBeNull()
    expect(entry.aggregatePassRate).toBe(0)
  })

  test("latestRegressionDetected reflects the FIRST (most recent, per the documented ordering contract) run seen for a group, not the last", () => {
    const runs = [
      run({ runId: "recent", regressionDetected: true, createdAt: "2026-08-15T05:00:00.000Z" }),
      run({ runId: "older", regressionDetected: false, createdAt: "2026-08-15T01:00:00.000Z" }),
    ]
    const [entry] = aggregateCostPerQuality(runs)
    expect(entry.latestRegressionDetected).toBe(true)
  })

  test("sorts most expensive-per-quality-point first, no-signal entries last", () => {
    const runs = [
      run({ roleKey: "cheap", model: "cheap_model", costUsd: 1, passedCases: 10, totalCases: 10 }),
      run({ roleKey: "expensive", model: "expensive_model", costUsd: 10, passedCases: 2, totalCases: 10 }),
      run({ roleKey: "no_signal", model: "no_signal_model", costUsd: 5, passedCases: 0, totalCases: 5 }),
    ]
    const entries = aggregateCostPerQuality(runs)
    expect(entries.map((e) => e.roleKey)).toEqual(["expensive", "cheap", "no_signal"])
  })
})
