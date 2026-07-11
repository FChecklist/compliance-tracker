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

  describe("confidence banding (D18/PLAN-20, Guardrail 9)", () => {
    const NOTES = "Verified the calculation against the source spec -- matches."

    test("passes when no confidencePercentage is supplied at all (optional, backward compatible)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved" })
      expect(result).toEqual({ passed: true })
    })

    test("passes an approval at 95% confidence (self_review band, weaker than the peer review already happening)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 95 })
      expect(result).toEqual({ passed: true })
    })

    test("passes an approval at 92% confidence (peer_review band -- exactly what's happening)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 92 })
      expect(result).toEqual({ passed: true })
    })

    test("blocks an approval below 90% -- escalation_required band cannot be approved directly", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 75 })
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason).toBe("confidence_below_escalation_threshold")
        expect(result.guidance).toContain("Escalate to")
      }
    })

    test("allows a rejection below 90% -- rejecting isn't the same as silently approving a low-confidence result", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "rejected", confidencePercentage: 60 })
      expect(result).toEqual({ passed: true })
    })
  })

  describe("audit-cadence routing (area 9 item 1, Guardrail 10 risk level)", () => {
    const NOTES = "Verified the calculation against the source spec -- matches."

    test("blocks a critical-risk approval even at 100% confidence -- risk level determines escalation independent of confidence", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 100, riskLevel: "critical" })
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason).toBe("critical_risk_requires_escalation")
        expect(result.guidance).toContain("Escalate")
      }
    })

    test("blocks a critical-risk approval when no confidencePercentage was supplied at all", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", riskLevel: "critical" })
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe("critical_risk_requires_escalation")
    })

    test("allows a critical-risk rejection -- rejecting isn't approving, so the gate doesn't apply", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "rejected", riskLevel: "critical" })
      expect(result).toEqual({ passed: true })
    })

    test("allows a high-risk approval -- only critical forces escalation regardless of confidence, high only flags L4 visibility", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 99, riskLevel: "high" })
      expect(result).toEqual({ passed: true })
    })

    test("allows a low-risk approval with no riskLevel supplied (backward compatible)", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved" })
      expect(result).toEqual({ passed: true })
    })

    test("low-confidence escalation_required check still fires before the risk check when both apply, with its own distinct reason", () => {
      const result = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes: NOTES, reviewDecision: "approved", confidencePercentage: 50, riskLevel: "critical" })
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe("confidence_below_escalation_threshold")
    })
  })
})
