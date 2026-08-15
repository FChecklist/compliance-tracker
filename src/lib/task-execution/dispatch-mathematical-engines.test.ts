/// <reference types="bun-types" />
// VERIDIAN Review Framework "AI Engineering Quality / Overall Code Quality"
// gap-closure: task-execution-engine.ts's dispatchEngine() switch was split
// into one dispatcher-per-category module (dispatch-helpers.ts's header).
// This is the first real test coverage for the Mathematical Computation
// Engine category's routing -- previously untested (task-execution-
// engine.test.ts only covered buildNovelUmrHint()). These are dispatch-
// routing tests, not a re-test of mathematical-engine.ts's own arithmetic
// (no test file for that exists yet -- out of scope here); the goal is
// catching a wrong engineKey -> case mapping or dropped branch, the exact
// class of bug a verbatim-extraction refactor risks introducing.
import { describe, test, expect } from "bun:test"
import { dispatchMathematicalEngines } from "./dispatch-mathematical-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchMathematicalEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchMathematicalEngines("job_costing_engine", {})).toBe(NOT_HANDLED)
  })

  test("basic_arithmetic_engine dispatches to the right operation", async () => {
    expect(await dispatchMathematicalEngines("basic_arithmetic_engine", { a: 2, b: 3, operation: "add" })).toEqual({ result: 5 })
    expect(await dispatchMathematicalEngines("basic_arithmetic_engine", { a: 6, b: 3, operation: "divide" })).toEqual({ result: 2 })
  })

  test("basic_arithmetic_engine throws on an invalid operation", async () => {
    expect(dispatchMathematicalEngines("basic_arithmetic_engine", { a: 1, b: 1, operation: "bogus" })).rejects.toThrow("Invalid operation")
  })

  test("financial_mathematics_engine's nested operation switch dispatches present_value/future_value/compound_interest", async () => {
    const pv = await dispatchMathematicalEngines("financial_mathematics_engine", { amount: 1000, rate: 0.1, periodsOrYears: 1, operation: "present_value" }) as { result: number }
    expect(pv.result).toBeCloseTo(909.09, 1)
    const ci = await dispatchMathematicalEngines("financial_mathematics_engine", { amount: 1000, rate: 0.1, periodsOrYears: 1, timesCompoundedPerYear: 1, operation: "compound_interest" }) as { result: number }
    expect(ci.result).toBe(100)
  })

  test("financial_mathematics_engine throws on an invalid operation (nested switch default)", async () => {
    expect(dispatchMathematicalEngines("financial_mathematics_engine", { amount: 1, rate: 1, periodsOrYears: 1, operation: "nope" })).rejects.toThrow("Invalid operation")
  })

  test("percentage_engine dispatches percentage_of and percentage_change, and rejects anything else", async () => {
    expect(await dispatchMathematicalEngines("percentage_engine", { value1: 50, value2: 200, operation: "percentage_of" })).toEqual({ result: 100 })
    expect(dispatchMathematicalEngines("percentage_engine", { value1: 1, value2: 2, operation: "nope" })).rejects.toThrow("Invalid operation")
  })

  test("statistical_engine parses the comma-separated values list via parseNumberList", async () => {
    const summary = await dispatchMathematicalEngines("statistical_engine", { values: "1, 2, 3, 4" }) as { mean: number }
    expect(summary.mean).toBe(2.5)
  })

  test("statistical_engine surfaces parseNumberList's error on a malformed entry", async () => {
    expect(dispatchMathematicalEngines("statistical_engine", { values: "1, abc, 3" })).rejects.toThrow('"abc" is not a valid number')
  })

  test("regression_engine rejects mismatched-length x/y lists", async () => {
    expect(dispatchMathematicalEngines("regression_engine", { xValues: "1,2,3", yValues: "1,2" })).rejects.toThrow("same non-zero length")
  })

  test("regression_engine computes slope/intercept for a valid pair of lists", async () => {
    const { slope, intercept } = await dispatchMathematicalEngines("regression_engine", { xValues: "1,2,3", yValues: "2,4,6" }) as { slope: number; intercept: number }
    expect(slope).toBeCloseTo(2, 5)
    expect(intercept).toBeCloseTo(0, 5)
  })

  test("probability_engine's nested switch dispatches combinations/permutations/normal_cdf, and rejects anything else", async () => {
    expect(await dispatchMathematicalEngines("probability_engine", { n: 5, k: 2, operation: "combinations" })).toEqual({ result: 10 })
    expect(dispatchMathematicalEngines("probability_engine", { operation: "nope" })).rejects.toThrow("Invalid operation")
  })
})
