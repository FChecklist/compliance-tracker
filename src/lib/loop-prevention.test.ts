/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { checkLoopBudget, shouldPromptSelfCheck } from "./loop-prevention"

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

describe("shouldPromptSelfCheck", () => {
  test("does not fire at iteration 0 -- redundant with the governance preamble already sent once", () => {
    expect(shouldPromptSelfCheck(0, 10)).toBe(false)
  })

  test("fires on exact multiples of everyN after iteration 0", () => {
    expect(shouldPromptSelfCheck(10, 10)).toBe(true)
    expect(shouldPromptSelfCheck(20, 10)).toBe(true)
    expect(shouldPromptSelfCheck(30, 10)).toBe(true)
  })

  test("does not fire on non-multiples", () => {
    expect(shouldPromptSelfCheck(1, 10)).toBe(false)
    expect(shouldPromptSelfCheck(9, 10)).toBe(false)
    expect(shouldPromptSelfCheck(11, 10)).toBe(false)
    expect(shouldPromptSelfCheck(25, 10)).toBe(false)
  })

  test("treats everyN <= 0 as never-prompt, not a divide-by-zero throw", () => {
    expect(shouldPromptSelfCheck(10, 0)).toBe(false)
    expect(shouldPromptSelfCheck(10, -5)).toBe(false)
  })

  test("is deterministic -- same input gives same result", () => {
    expect(shouldPromptSelfCheck(20, 10)).toBe(shouldPromptSelfCheck(20, 10))
  })
})
