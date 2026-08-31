import { describe, expect, test } from "bun:test"
import { computeRegression, REGRESSION_LOOKBACK_RUNS, REGRESSION_THRESHOLD } from "./role-quality-regression-service"

describe("computeRegression", () => {
  test("no prior runs -> no baseline, never a regression", () => {
    const result = computeRegression(0.4, [])
    expect(result.baselinePassRate).toBeNull()
    expect(result.regressionDetected).toBe(false)
  })

  test("current pass rate matches baseline -> no regression", () => {
    const result = computeRegression(0.9, [0.9, 0.9, 0.9])
    expect(result.baselinePassRate).toBe(0.9)
    expect(result.regressionDetected).toBe(false)
  })

  test("current pass rate drops by exactly the threshold -> regression (inclusive boundary)", () => {
    const result = computeRegression(0.75, [0.9, 0.9])
    expect(result.baselinePassRate).toBe(0.9)
    expect(result.regressionDetected).toBe(true) // 0.9 - 0.75 = 0.15 = REGRESSION_THRESHOLD
  })

  test("current pass rate drops by just under the threshold -> not a regression", () => {
    const result = computeRegression(0.76, [0.9, 0.9])
    expect(result.regressionDetected).toBe(false)
  })

  test("current pass rate improves over baseline -> no regression", () => {
    const result = computeRegression(0.95, [0.5, 0.6])
    expect(result.regressionDetected).toBe(false)
  })

  test("only the most recent REGRESSION_LOOKBACK_RUNS prior runs form the baseline", () => {
    const manyPriorRuns = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] // first 5 are the "recent" window this fn should use
    const result = computeRegression(1, manyPriorRuns)
    expect(result.baselinePassRate).toBe(1)
    expect(manyPriorRuns.length).toBeGreaterThan(REGRESSION_LOOKBACK_RUNS)
  })

  test("single prior run forms a trivial baseline equal to itself", () => {
    const result = computeRegression(0.5, [0.8])
    expect(result.baselinePassRate).toBe(0.8)
    expect(result.regressionDetected).toBe(true) // 0.8 - 0.5 = 0.3 >= 0.15
  })

  test("REGRESSION_THRESHOLD is a real, positive, sub-1 fraction", () => {
    expect(REGRESSION_THRESHOLD).toBeGreaterThan(0)
    expect(REGRESSION_THRESHOLD).toBeLessThan(1)
  })
})
