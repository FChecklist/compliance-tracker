/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeMonthlyBucketDelta, type AiReductionSnapshotRow } from "./ai-reduction-service"

function snapshot(overrides: Partial<AiReductionSnapshotRow> = {}): AiReductionSnapshotRow {
  return { snapshotDate: "2026-08-01", fullSoftwareCount: 0, packageAvailableCount: 0, novelCount: 0, totalCount: 0, ...overrides }
}

describe("computeMonthlyBucketDelta", () => {
  test("no previous snapshot (the very first one) reports the whole cumulative total as the delta", () => {
    const current = snapshot({ fullSoftwareCount: 10, packageAvailableCount: 5, novelCount: 3, totalCount: 18 })
    const result = computeMonthlyBucketDelta(current, null)
    expect(result.fullSoftwareDelta).toBe(10)
    expect(result.packageAvailableDelta).toBe(5)
    expect(result.novelDelta).toBe(3)
    expect(result.totalDelta).toBe(18)
  })

  test("diffs two consecutive snapshots into that period's real (non-cumulative) counts", () => {
    const previous = snapshot({ snapshotDate: "2026-07-01", fullSoftwareCount: 100, packageAvailableCount: 50, novelCount: 30, totalCount: 180 })
    const current = snapshot({ snapshotDate: "2026-08-01", fullSoftwareCount: 130, packageAvailableCount: 55, novelCount: 40, totalCount: 225 })
    const result = computeMonthlyBucketDelta(current, previous)
    expect(result.fullSoftwareDelta).toBe(30)
    expect(result.packageAvailableDelta).toBe(5)
    expect(result.novelDelta).toBe(10)
    expect(result.totalDelta).toBe(45)
    expect(result.periodEnd).toBe("2026-08-01")
  })

  test("softwareCoverageRatio is (fullSoftware+packageAvailable)/total for the diffed period", () => {
    const previous = snapshot({ fullSoftwareCount: 0, packageAvailableCount: 0, novelCount: 0, totalCount: 0 })
    const current = snapshot({ fullSoftwareCount: 60, packageAvailableCount: 20, novelCount: 20, totalCount: 100 })
    const result = computeMonthlyBucketDelta(current, previous)
    expect(result.softwareCoverageRatio).toBeCloseTo(0.8, 5)
  })

  test("zero total activity in the period -> ratio is null, not 0 or NaN", () => {
    const previous = snapshot({ fullSoftwareCount: 100, packageAvailableCount: 50, novelCount: 30, totalCount: 180 })
    const current = snapshot({ fullSoftwareCount: 100, packageAvailableCount: 50, novelCount: 30, totalCount: 180 })
    const result = computeMonthlyBucketDelta(current, previous)
    expect(result.totalDelta).toBe(0)
    expect(result.softwareCoverageRatio).toBeNull()
  })

  test("clamps at 0 rather than going negative if a counter somehow decreased (defensive, not an assumed real case)", () => {
    const previous = snapshot({ fullSoftwareCount: 100, packageAvailableCount: 50, novelCount: 30, totalCount: 180 })
    const current = snapshot({ fullSoftwareCount: 90, packageAvailableCount: 60, novelCount: 35, totalCount: 185 })
    const result = computeMonthlyBucketDelta(current, previous)
    expect(result.fullSoftwareDelta).toBe(0) // 90 - 100 clamped, not -10
    expect(result.packageAvailableDelta).toBe(10)
    expect(result.novelDelta).toBe(5)
  })
})
