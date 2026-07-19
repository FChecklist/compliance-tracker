/// <reference types="bun-types" />
// UMR-03 gap closure. Tests the pure part of instruction-execution-cache-
// service.ts -- isHighConfidenceExecutionMatch()'s threshold decision --
// rather than findPriorExecutionPath()/recordExecutionPath() themselves,
// which touch a live database and are deliberately left untested here,
// matching this repo's established pattern (see capability-registry-
// service.test.ts's and task-service.test.ts's own notes on this).
import { describe, expect, test } from "bun:test"
import { isHighConfidenceExecutionMatch } from "./instruction-execution-cache-service"

describe("isHighConfidenceExecutionMatch -- UMR-03 no-re-derivation gate", () => {
  test("a near-identical instruction (score >= 0.95) is confident enough to reuse", () => {
    expect(isHighConfidenceExecutionMatch(0.95)).toBe(true)
    expect(isHighConfidenceExecutionMatch(0.99)).toBe(true)
    expect(isHighConfidenceExecutionMatch(1)).toBe(true)
  })

  test("a merely similar instruction (score < 0.95) is not confident enough -- falls through to full resolution", () => {
    expect(isHighConfidenceExecutionMatch(0.94)).toBe(false)
    expect(isHighConfidenceExecutionMatch(0.5)).toBe(false)
    expect(isHighConfidenceExecutionMatch(0)).toBe(false)
  })
})
