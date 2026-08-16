/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeFailureRate, averageNumericColumn } from "./ai-performance-report-service"

describe("computeFailureRate", () => {
  test("empty status counts -> zero total, zero failed, zero failure rate (not NaN)", () => {
    const result = computeFailureRate({})
    expect(result).toEqual({ total: 0, failed: 0, failureRate: 0 })
  })

  test("all-success statuses produce a 0% failure rate", () => {
    const result = computeFailureRate({ completed: 10, pending: 5 })
    expect(result.total).toBe(15)
    expect(result.failed).toBe(0)
    expect(result.failureRate).toBe(0)
  })

  test("counts both 'failed' and 'error' statuses as failures", () => {
    const result = computeFailureRate({ completed: 6, failed: 2, error: 2 })
    expect(result.total).toBe(10)
    expect(result.failed).toBe(4)
    expect(result.failureRate).toBeCloseTo(0.4, 5)
  })

  test("a 100% failure period reports failureRate of exactly 1", () => {
    const result = computeFailureRate({ failed: 3 })
    expect(result.failureRate).toBe(1)
  })
})

describe("averageNumericColumn", () => {
  test("empty array returns null, not 0 -- 'no data' must stay distinguishable from 'zero'", () => {
    expect(averageNumericColumn([])).toBeNull()
  })

  test("an array of all nulls returns null", () => {
    expect(averageNumericColumn([null, null])).toBeNull()
  })

  test("averages parseable numeric strings, dropping nulls", () => {
    expect(averageNumericColumn(["10", null, "20", "30"])).toBeCloseTo(20, 5)
  })

  test("ignores unparseable (NaN) values rather than propagating NaN", () => {
    expect(averageNumericColumn(["10", "not-a-number", "20"])).toBeCloseTo(15, 5)
  })
})
