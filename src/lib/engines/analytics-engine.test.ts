/// <reference types="bun-types" />
// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// no test file existed for this engine before -- scoped to the new
// analyzeTrendExplained() variant this wave adds.
import { describe, expect, test } from "bun:test"
import { analyzeTrend, analyzeTrendExplained } from "./analytics-engine"

describe("analyzeTrendExplained", () => {
  test("matches the plain function's own values under `.value`", () => {
    const values = [1, 2, 3, 4, 5]
    const explained = analyzeTrendExplained(values)
    expect(explained.value).toEqual(analyzeTrend(values))
  })

  test("explains an increasing trend", () => {
    const result = analyzeTrendExplained([1, 2, 3, 4, 5])
    expect(result.value.direction).toBe("increasing")
    expect(result.explanation).toContain("upward")
  })

  test("explains a decreasing trend", () => {
    const result = analyzeTrendExplained([5, 4, 3, 2, 1])
    expect(result.value.direction).toBe("decreasing")
    expect(result.explanation).toContain("downward")
  })

  test("explains a flat trend", () => {
    const result = analyzeTrendExplained([3, 3, 3, 3])
    expect(result.value.direction).toBe("flat")
    expect(result.explanation).toContain("flat")
  })

  test("includes an assumption about even time-spacing", () => {
    const result = analyzeTrendExplained([1, 2])
    expect(result.assumptions?.[0]).toContain("evenly time-spaced")
  })
})
