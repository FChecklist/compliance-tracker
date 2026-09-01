// Unit tests for check-new-test-coverage.mjs's pure logic -- no git/fs
// access is exercised here; every case drives filterPreviouslyUntested()/
// decideGate() with plain fixture data. No AI/LLM call is exercised or
// referenced anywhere in this file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { filterPreviouslyUntested, decideGate } from "./check-new-test-coverage.mjs"

describe("filterPreviouslyUntested", () => {
  test("keeps only files whose predicate reports no sibling test", () => {
    const changed = ["a.ts", "b.ts", "c.ts"]
    const hadTest = (f) => f === "a.ts"
    expect(filterPreviouslyUntested(changed, hadTest)).toEqual(["b.ts", "c.ts"])
  })

  test("empty input yields empty output", () => {
    expect(filterPreviouslyUntested([], () => false)).toEqual([])
  })

  test("all files already tested yields empty output", () => {
    expect(filterPreviouslyUntested(["a.ts", "b.ts"], () => true)).toEqual([])
  })
})

describe("decideGate", () => {
  test("passes when nothing was previously untested", () => {
    const result = decideGate([], [])
    expect(result.ok).toBe(true)
    expect(result.message).toContain("already had a sibling test file")
  })

  test("passes when previously-untested files touched but PR also adds a test", () => {
    const result = decideGate(["src/lib/services/foo.ts"], ["src/lib/services/foo.test.ts"])
    expect(result.ok).toBe(true)
    expect(result.message).toContain("coverage-delta requirement satisfied")
  })

  test("fails when previously-untested files touched and no test was added", () => {
    const result = decideGate(["src/lib/services/foo.ts", "src/lib/services/bar.ts"], [])
    expect(result.ok).toBe(false)
    expect(result.message).toContain("src/lib/services/foo.ts")
    expect(result.message).toContain("src/lib/services/bar.ts")
    expect(result.message).toContain("without adding any test")
  })

  test("a test file changed anywhere satisfies the gate, not just a matching sibling", () => {
    const result = decideGate(["src/lib/services/foo.ts"], ["src/lib/services/unrelated.test.ts"])
    expect(result.ok).toBe(true)
  })
})
