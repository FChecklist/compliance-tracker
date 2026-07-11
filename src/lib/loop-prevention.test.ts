/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { checkLoopBudget } from "./loop-prevention"

describe("checkLoopBudget", () => {
  test("passes while under budget", () => {
    expect(checkLoopBudget({ iteration: 0, maxIterations: 40 })).toEqual({ passed: true })
    expect(checkLoopBudget({ iteration: 39, maxIterations: 40 })).toEqual({ passed: true })
  })

  test("fails once the budget is exhausted", () => {
    const result = checkLoopBudget({ iteration: 40, maxIterations: 40 })
    expect(result.passed).toBe(false)
    if (!result.passed) {
      expect(result.reason).toContain("40/40")
      expect(result.guidance).toContain("split it into smaller")
    }
  })

  test("fails if iteration somehow exceeds max", () => {
    expect(checkLoopBudget({ iteration: 41, maxIterations: 40 }).passed).toBe(false)
  })

  test("is deterministic -- same input gives same result", () => {
    const a = checkLoopBudget({ iteration: 40, maxIterations: 40 })
    const b = checkLoopBudget({ iteration: 40, maxIterations: 40 })
    expect(a).toEqual(b)
  })
})
