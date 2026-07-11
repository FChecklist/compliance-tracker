/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { average, verdictFor } from "./task-reflection"

describe("average", () => {
  test("empty array is null, not 0 -- no baseline to fabricate", () => {
    expect(average([])).toBeNull()
  })

  test("computes the plain mean", () => {
    expect(average([10, 20, 30])).toBe(20)
  })
})

describe("verdictFor", () => {
  test("null/undefined value is insufficient_data regardless of history", () => {
    expect(verdictFor(null, [100, 100, 100, 100]).verdict).toBe("insufficient_data")
    expect(verdictFor(undefined, [100, 100, 100, 100]).verdict).toBe("insufficient_data")
  })

  test("fewer than 3 comparable rows is insufficient_data, even with a real value", () => {
    expect(verdictFor(100, []).verdict).toBe("insufficient_data")
    expect(verdictFor(100, [90, 110]).verdict).toBe("insufficient_data")
  })

  test("3+ comparable rows and a value well below the -15% band is faster_than_recent_avg", () => {
    const result = verdictFor(70, [100, 100, 100])
    expect(result.verdict).toBe("faster_than_recent_avg")
    expect(result.avg).toBe(100)
  })

  test("3+ comparable rows and a value well above the +15% band is slower_than_recent_avg", () => {
    const result = verdictFor(130, [100, 100, 100])
    expect(result.verdict).toBe("slower_than_recent_avg")
    expect(result.avg).toBe(100)
  })

  test("a value within the +/-15% band is in_line, not a false positive", () => {
    expect(verdictFor(105, [100, 100, 100]).verdict).toBe("in_line")
    expect(verdictFor(95, [100, 100, 100]).verdict).toBe("in_line")
  })

  test("the avg returned alongside the verdict is auditable -- not silently dropped", () => {
    const result = verdictFor(50, [40, 50, 60])
    expect(result.avg).toBe(50)
  })
})
