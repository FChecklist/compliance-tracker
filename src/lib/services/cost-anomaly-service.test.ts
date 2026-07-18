/// <reference types="bun-types" />
// Tests the pure ratio-based deviation check only -- the DB-touching
// detectCostAnomalies() wrapper is not unit-tested here, matching this
// codebase's own established pure/DB-touching split (see
// ai-performance-report-service.test.ts / report-cadence-service.test.ts).
import { describe, expect, test } from "bun:test"
import { classifyAnomaly } from "./cost-anomaly-service"

describe("classifyAnomaly", () => {
  test("spend below the $1 floor is never flagged, even at a huge ratio", () => {
    expect(classifyAnomaly({ groupType: "org", groupKey: "org1", recentSpendUsd: 0.1, baselineAvgDailyUsd: 0.001 })).toBeNull()
  })

  test("a ratio below the threshold is not an anomaly", () => {
    expect(classifyAnomaly({ groupType: "org", groupKey: "org1", recentSpendUsd: 10, baselineAvgDailyUsd: 5 })).toBeNull()
  })

  test("a ratio at or above the threshold (default 3x) is flagged with the real ratio", () => {
    const anomaly = classifyAnomaly({ groupType: "org", groupKey: "org1", recentSpendUsd: 30, baselineAvgDailyUsd: 10 })
    expect(anomaly).toEqual({ groupType: "org", groupKey: "org1", recentSpendUsd: 30, baselineAvgDailyUsd: 10, ratio: 3, isNewSpender: false })
  })

  test("a ratio exactly at the threshold boundary is flagged (inclusive)", () => {
    const anomaly = classifyAnomaly({ groupType: "role", groupKey: "cfo", recentSpendUsd: 9, baselineAvgDailyUsd: 3 })
    expect(anomaly?.ratio).toBe(3)
  })

  test("zero baseline spend with real recent spend above the floor is a new-spender anomaly (ratio null, not Infinity/NaN)", () => {
    const anomaly = classifyAnomaly({ groupType: "org", groupKey: "org2", recentSpendUsd: 5, baselineAvgDailyUsd: 0 })
    expect(anomaly).toEqual({ groupType: "org", groupKey: "org2", recentSpendUsd: 5, baselineAvgDailyUsd: 0, ratio: null, isNewSpender: true })
  })

  test("zero baseline AND recent spend below the floor is not flagged", () => {
    expect(classifyAnomaly({ groupType: "org", groupKey: "org3", recentSpendUsd: 0.5, baselineAvgDailyUsd: 0 })).toBeNull()
  })

  test("a custom ratioThreshold/minSpendFloorUsd is honored", () => {
    expect(classifyAnomaly({ groupType: "org", groupKey: "org1", recentSpendUsd: 4, baselineAvgDailyUsd: 2 }, { ratioThreshold: 3 })).toBeNull()
    expect(classifyAnomaly({ groupType: "org", groupKey: "org1", recentSpendUsd: 6, baselineAvgDailyUsd: 2 }, { ratioThreshold: 3 })?.ratio).toBe(3)
    expect(classifyAnomaly({ groupType: "org", groupKey: "org1", recentSpendUsd: 2, baselineAvgDailyUsd: 0 }, { minSpendFloorUsd: 5 })).toBeNull()
  })
})
