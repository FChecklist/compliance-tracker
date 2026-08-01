/// <reference types="bun-types" />
// Tests the pure helpers only -- the DB-touching functions
// (estimateLedgerTotalForMonth/recordReconciliation/listReconciliations/
// getReconciliationDriftSummary) are not unit-tested here, matching this
// codebase's own established pure/DB-touching split (see
// cost-anomaly-service.test.ts).
import { describe, expect, test } from "bun:test"
import { parsePeriodMonth, computeVariance, averageAbsPct } from "./cost-reconciliation-service"

describe("parsePeriodMonth", () => {
  test("parses a valid 'YYYY-MM-01' into UTC month boundaries", () => {
    const { start, end } = parsePeriodMonth("2026-07-01")
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z")
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z")
  })

  test("December rolls over into January of the next year", () => {
    const { start, end } = parsePeriodMonth("2026-12-01")
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z")
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z")
  })

  test("rejects malformed input instead of silently misparsing", () => {
    expect(() => parsePeriodMonth("2026-07")).toThrow()
    expect(() => parsePeriodMonth("2026-07-15")).toThrow()
    expect(() => parsePeriodMonth("not-a-date")).toThrow()
  })
})

describe("computeVariance", () => {
  test("actual above estimate is a positive variance", () => {
    expect(computeVariance(120, 100)).toEqual({ varianceUsd: 20, variancePct: expect.closeTo(16.666, 2) })
  })

  test("actual below estimate is a negative variance", () => {
    const { varianceUsd, variancePct } = computeVariance(80, 100)
    expect(varianceUsd).toBe(-20)
    expect(variancePct).toBeCloseTo(-25, 2)
  })

  test("exact match is zero variance", () => {
    expect(computeVariance(50, 50)).toEqual({ varianceUsd: 0, variancePct: 0 })
  })

  test("zero actual invoice never divides by zero -- variancePct is null, not Infinity/NaN", () => {
    const { varianceUsd, variancePct } = computeVariance(0, 42)
    expect(varianceUsd).toBe(-42)
    expect(variancePct).toBeNull()
  })
})

describe("averageAbsPct", () => {
  test("averages absolute values, ignoring sign", () => {
    expect(averageAbsPct([10, -20, 30])).toBeCloseTo(20, 5)
  })

  test("nulls are excluded from the average, not treated as zero", () => {
    expect(averageAbsPct([10, null, 30])).toBeCloseTo(20, 5)
  })

  test("all-null or empty input returns null, never a fabricated 0", () => {
    expect(averageAbsPct([null, null])).toBeNull()
    expect(averageAbsPct([])).toBeNull()
  })
})
