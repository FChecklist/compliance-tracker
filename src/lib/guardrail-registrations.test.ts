/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { evaluateGuardrails } from "./guardrail-engine"
import { registerAllGuardrails, AI_TEAM_CLOSURE_REVIEW_LEAF } from "./guardrail-registrations"

registerAllGuardrails()

describe("closureReviewCheck (AI_TEAM_CLOSURE_REVIEW_LEAF) -- Wave 165, U-D12.B4.S3", () => {
  test("rejects a review with no notes", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewDecision: "approved" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_notes_missing_or_too_short")
  })

  test("rejects a review with notes too short to be substantive", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "ok", reviewDecision: "approved" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_notes_missing_or_too_short")
  })

  test("rejects a review with a missing decision", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "This output correctly handles the edge case." })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_decision_missing_or_invalid")
  })

  test("rejects a review with an invalid decision value", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "This output correctly handles the edge case.", reviewDecision: "maybe" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("review_decision_missing_or_invalid")
  })

  test("passes a real review with substantive notes and a valid decision", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "Verified the calculation against the source spec -- matches.", reviewDecision: "approved" })
    expect(result).toEqual({ passed: true })
  })

  test("passes a rejection with substantive notes too -- the check validates rigor, not outcome", () => {
    const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: "This misses the edge case where the input is negative.", reviewDecision: "rejected" })
    expect(result).toEqual({ passed: true })
  })
})
