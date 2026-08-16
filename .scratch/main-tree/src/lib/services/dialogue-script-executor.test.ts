/// <reference types="bun-types" />
// Priority 5: unit tests for dialogue-script-executor.ts's pure functions
// (matchDialogueStep, isScriptComplete, buildDialogueScriptState/
// parseDialogueScriptState). renderDialogueQuestion is DB/LLM-touching and
// deliberately not tested here, matching capability-learning-service.ts's
// own split (pure functions tested directly, DB-touching lookups/writes
// not covered by this suite -- see that file's test precedent).
import { describe, test, expect } from "bun:test"
import {
  matchDialogueStep,
  isScriptComplete,
  buildDialogueScriptState,
  parseDialogueScriptState,
  DIALOGUE_MATCH_THRESHOLD,
  type DialogueStep,
} from "./dialogue-script-executor"

function makeStep(overrides: Partial<DialogueStep> = {}): DialogueStep {
  return {
    question: "Have you already filed your GST return this quarter?",
    expectedAnswerPatterns: ["yes", "already filed", "done"],
    onMatch: 1,
    onNoMatch: "escalate",
    ...overrides,
  }
}

describe("matchDialogueStep", () => {
  test("matches a short, clear affirmative reply", () => {
    const result = matchDialogueStep(makeStep(), "Yes, already filed")
    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.nextStepIndex).toBe(1)
      expect(result.score).toBeGreaterThanOrEqual(DIALOGUE_MATCH_THRESHOLD)
    }
  })

  test("matches a full-sentence reply carrying one of the expected patterns", () => {
    const result = matchDialogueStep(makeStep(), "Yes, we already filed it last week")
    expect(result.matched).toBe(true)
  })

  test("routes to escalate when onNoMatch is 'escalate' and nothing matches", () => {
    const result = matchDialogueStep(makeStep({ onNoMatch: "escalate" }), "What do you mean by that?")
    expect(result).toEqual({ matched: false, outcome: "escalate" })
  })

  test("routes to a specific fallback step when onNoMatch names one", () => {
    const result = matchDialogueStep(makeStep({ onNoMatch: 3 }), "I don't understand the question")
    expect(result).toEqual({ matched: false, outcome: "next_step", nextStepIndex: 3 })
  })

  test("picks the best-scoring pattern when multiple are provided", () => {
    const step = makeStep({ expectedAnswerPatterns: ["no", "not yet", "already filed"] })
    const result = matchDialogueStep(step, "already filed it")
    expect(result.matched).toBe(true)
    if (result.matched) expect(result.matchedPattern).toBe("already filed")
  })

  test("empty reply never matches", () => {
    const result = matchDialogueStep(makeStep(), "")
    expect(result.matched).toBe(false)
  })
})

describe("isScriptComplete", () => {
  const steps = [makeStep(), makeStep(), makeStep()]

  test("false for an in-range index", () => {
    expect(isScriptComplete(steps, 0)).toBe(false)
    expect(isScriptComplete(steps, 2)).toBe(false)
  })

  test("true once the index runs past the last step", () => {
    expect(isScriptComplete(steps, 3)).toBe(true)
    expect(isScriptComplete(steps, 99)).toBe(true)
  })

  test("true for a negative index", () => {
    expect(isScriptComplete(steps, -1)).toBe(true)
  })
})

describe("buildDialogueScriptState / parseDialogueScriptState round-trip", () => {
  test("round-trips a package id and step index", () => {
    const state = buildDialogueScriptState("pkg-abc123", 2)
    expect(parseDialogueScriptState(state)).toEqual({ packageId: "pkg-abc123", stepIndex: 2 })
  })

  test("null input parses to null", () => {
    expect(parseDialogueScriptState(null)).toBeNull()
  })

  test("a currentState from an unrelated feature (not this prefix) parses to null", () => {
    expect(parseDialogueScriptState("onboarding_step_3")).toBeNull()
  })

  test("a malformed dialogue_script state (non-numeric step) parses to null", () => {
    expect(parseDialogueScriptState("dialogue_script:pkg-1:not-a-number")).toBeNull()
  })
})
