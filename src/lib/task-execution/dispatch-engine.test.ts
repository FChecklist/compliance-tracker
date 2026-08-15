/// <reference types="bun-types" />
// AI Engineering Quality gap-closure, 2026-08-15: dispatch-engine.ts's two
// pure decision points, newly exported so they're directly testable --
// matches task-execution-engine.test.ts's own established convention (see
// its header) of only unit-testing pure functions in this module family,
// never the DB/LLM-touching dispatchEngine() switch itself (that stays
// untested here, same as it was before the split).
import { describe, test, expect } from "bun:test"
import { truthy, parseNumberList } from "./dispatch-engine"

describe("truthy", () => {
  test("recognizes the three truthy string forms, case-insensitively", () => {
    expect(truthy("yes")).toBe(true)
    expect(truthy("YES")).toBe(true)
    expect(truthy("true")).toBe(true)
    expect(truthy("True")).toBe(true)
    expect(truthy("1")).toBe(true)
  })

  test("trims surrounding whitespace before comparing", () => {
    expect(truthy("  yes  ")).toBe(true)
  })

  test("treats anything else as false, including falsy-looking values", () => {
    expect(truthy("no")).toBe(false)
    expect(truthy("false")).toBe(false)
    expect(truthy("0")).toBe(false)
    expect(truthy("")).toBe(false)
  })

  test("handles null/undefined without throwing", () => {
    expect(truthy(null)).toBe(false)
    expect(truthy(undefined)).toBe(false)
  })

  test("coerces a non-string input via String() rather than throwing", () => {
    expect(truthy(1)).toBe(true)
    expect(truthy(true)).toBe(true)
    expect(truthy(0)).toBe(false)
  })
})

describe("parseNumberList", () => {
  test("parses a comma-separated list into real numbers", () => {
    expect(parseNumberList("1,2,3")).toEqual([1, 2, 3])
  })

  test("trims whitespace around each entry", () => {
    expect(parseNumberList(" 1 , 2 ,3 ")).toEqual([1, 2, 3])
  })

  test("parses negative numbers and decimals", () => {
    expect(parseNumberList("-1.5,0,2.25")).toEqual([-1.5, 0, 2.25])
  })

  test("returns an empty array for empty/whitespace-only input", () => {
    expect(parseNumberList("")).toEqual([])
    expect(parseNumberList("   ")).toEqual([])
    expect(parseNumberList(null)).toEqual([])
    expect(parseNumberList(undefined)).toEqual([])
  })

  test("throws a clear error naming the malformed entry, rather than silently coercing to NaN", () => {
    expect(() => parseNumberList("1,abc,3")).toThrow('"abc" is not a valid number')
  })

  test("handles a single value with no commas", () => {
    expect(parseNumberList("42")).toEqual([42])
  })
})
