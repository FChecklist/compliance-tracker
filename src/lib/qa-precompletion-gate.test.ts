/// <reference types="bun-types" />
// tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 original
// item (f). Mirrors handover-protocol.test.ts's pattern: exercises the
// pure decision logic directly (no live DB connection needed), plus the
// real Guardrail Engine wiring via evaluateGuardrails(QA_PRECOMPLETION_GATE_LEAF, ...).
import { describe, expect, test } from "bun:test"
import { evaluateGuardrails } from "./guardrail-engine"
import { registerAllGuardrails, QA_PRECOMPLETION_GATE_LEAF } from "./guardrail-registrations"
import { validateHandoverFields } from "./handover-protocol"
import { checkQaPreCompletionGate, buildDispatchSelfAssessment } from "./qa-precompletion-gate"

registerAllGuardrails()

describe("checkQaPreCompletionGate -- PLAN-16 item (f), the actual completion-blocking gate", () => {
  test("passes when Validation Passed is 'yes'", () => {
    expect(checkQaPreCompletionGate({ handoverValidationPassed: "yes" })).toEqual({ passed: true, overridden: false })
  })

  test("passes case-insensitively/whitespace-padded", () => {
    expect(checkQaPreCompletionGate({ handoverValidationPassed: " Yes " })).toEqual({ passed: true, overridden: false })
  })

  test("blocks when no handover was ever submitted", () => {
    const result = checkQaPreCompletionGate({ handoverValidationPassed: null })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("handover_not_submitted")
  })

  test("blocks when Validation Passed is 'no', with no override supplied", () => {
    const result = checkQaPreCompletionGate({ handoverValidationPassed: "no" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("handover_validation_not_passed:no")
  })

  test("blocks when Validation Passed is 'partial', with no override supplied", () => {
    const result = checkQaPreCompletionGate({ handoverValidationPassed: "partial" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("handover_validation_not_passed:partial")
  })

  test("blocks when the override reason is too short to be substantive", () => {
    const result = checkQaPreCompletionGate({ handoverValidationPassed: "partial", overrideReason: "ok" })
    expect(result.passed).toBe(false)
  })

  test("passes with overridden:true when a real, substantive override reason is given", () => {
    const result = checkQaPreCompletionGate({ handoverValidationPassed: "partial", overrideReason: "Reviewed manually -- the flagged risk doesn't apply here." })
    expect(result).toEqual({ passed: true, overridden: true })
  })

  test("an override reason cannot rescue a completely missing handover into looking normal -- but it still permits completion (the override IS the point)", () => {
    const result = checkQaPreCompletionGate({ handoverValidationPassed: null, overrideReason: "Approved without a handover -- emergency hotfix, see incident #42." })
    expect(result).toEqual({ passed: true, overridden: true })
  })
})

describe("QA_PRECOMPLETION_GATE_LEAF -- real Guardrail Engine wiring", () => {
  test("only applies to an 'approved' decision -- a rejection has nothing to gate", () => {
    const result = evaluateGuardrails(QA_PRECOMPLETION_GATE_LEAF, "input", { reviewDecision: "rejected", handoverValidationPassed: "partial" })
    expect(result).toEqual({ passed: true })
  })

  test("blocks an approval when the handover's Validation Passed isn't 'yes' and no override was given", () => {
    const result = evaluateGuardrails(QA_PRECOMPLETION_GATE_LEAF, "input", { reviewDecision: "approved", handoverValidationPassed: "partial" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("handover_validation_not_passed:partial")
  })

  test("allows an approval when Validation Passed is 'yes'", () => {
    const result = evaluateGuardrails(QA_PRECOMPLETION_GATE_LEAF, "input", { reviewDecision: "approved", handoverValidationPassed: "yes" })
    expect(result).toEqual({ passed: true })
  })

  test("allows an approval below 'yes' when a real override reason is supplied", () => {
    const result = evaluateGuardrails(QA_PRECOMPLETION_GATE_LEAF, "input", { reviewDecision: "approved", handoverValidationPassed: "no", overrideReason: "Confirmed with the requester this is acceptable as-is." })
    expect(result).toEqual({ passed: true })
  })
})

describe("buildDispatchSelfAssessment -- derives a real HandoverFields object from already-computed dispatch signals", () => {
  const BASE = { requiresAudit: false, riskLevel: "low", lowConfidenceDetected: false, lowConfidenceMatchedPhrase: null, outputSummary: "120-character response from Senior Backend Engineer (senior_backend_engineer)" }

  test("a clean, low-risk, high-confidence dispatch gets validationPassed 'yes' and passes GOV-08's own field validation", () => {
    const fields = buildDispatchSelfAssessment(BASE)
    expect(fields.validationPassed).toBe("yes")
    expect(fields.confidence).toBe("high")
    expect(fields.escalationRequired).toBe("no")
    expect(validateHandoverFields(fields)).toEqual({ valid: true })
  })

  test("a dispatch flagged for review (low confidence) gets validationPassed 'partial' and still passes GOV-08's field validation", () => {
    const fields = buildDispatchSelfAssessment({ ...BASE, requiresAudit: true, lowConfidenceDetected: true, lowConfidenceMatchedPhrase: "i think" })
    expect(fields.validationPassed).toBe("partial")
    expect(fields.confidence).toBe("low")
    expect(fields.knownRisks).toContain("i think")
    expect(validateHandoverFields(fields)).toEqual({ valid: true })
  })

  test("a dispatch flagged for review on risk level (not low confidence) still produces a real, distinct Known Risks narrative", () => {
    const fields = buildDispatchSelfAssessment({ ...BASE, requiresAudit: true, riskLevel: "high" })
    expect(fields.validationPassed).toBe("partial")
    expect(fields.confidence).toBe("medium")
    expect(fields.knownRisks).toContain("high")
    expect(validateHandoverFields(fields)).toEqual({ valid: true })
  })

  test("critical risk sets escalationRequired to 'yes' regardless of confidence", () => {
    const fields = buildDispatchSelfAssessment({ ...BASE, requiresAudit: true, riskLevel: "critical" })
    expect(fields.escalationRequired).toBe("yes")
    expect(validateHandoverFields(fields)).toEqual({ valid: true })
  })

  test("checkQaPreCompletionGate accepts the auto-complete case unconditionally", () => {
    const fields = buildDispatchSelfAssessment(BASE)
    expect(checkQaPreCompletionGate({ handoverValidationPassed: fields.validationPassed })).toEqual({ passed: true, overridden: false })
  })

  test("checkQaPreCompletionGate blocks the flagged-for-review case until an override is given", () => {
    const fields = buildDispatchSelfAssessment({ ...BASE, requiresAudit: true, lowConfidenceDetected: true, lowConfidenceMatchedPhrase: "might be" })
    const result = checkQaPreCompletionGate({ handoverValidationPassed: fields.validationPassed })
    expect(result.passed).toBe(false)
  })
})
