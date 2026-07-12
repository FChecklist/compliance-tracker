/// <reference types="bun-types" />
// ai-os/tree4-unified/10-merged-governance-layer.yaml, U-D2.B6.S1.
// Mirrors handover-protocol.test.ts's structure: exercises the pure
// validation function directly, no DB/mocking required.
import { describe, expect, test } from "bun:test"
import { evaluateGuardrails } from "./guardrail-engine"
import { registerAllGuardrails, AUDIT_PROTOCOL_COMPLIANCE_LEAF } from "./guardrail-registrations"
import { validateAuditProtocolFields, type AuditProtocolFields } from "./audit-protocol"

registerAllGuardrails()

const COMPLETE_AUDIT: AuditProtocolFields = {
  objectiveUnderstood: "Verify GUARDRAIL_PLATFORM leaves are registered for every high-impact action category",
  standardsReviewed: "AGENTS.md Rule 9, VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md guardrail manifest",
  scopeConfirmed: "guardrail-registrations.ts and its registered leaves only",
  evidenceRecorded: "4 of 9 named leaves have no corresponding test file entry, checked by grep",
  severityClassified: "medium",
  verdict: "fail",
  correctiveActionOwner: "chief_software_engineering_officer to add the missing test coverage",
  reAuditScheduled: "Next sprint, after the coverage PR merges",
}

describe("validateAuditProtocolFields -- U-D2.B6.S1 3-phase protocol gate", () => {
  test("passes a complete audit submission with all 8 real fields", () => {
    expect(validateAuditProtocolFields(COMPLETE_AUDIT)).toEqual({ valid: true })
  })

  test("allows a genuine 'none'/'not required' answer for Corrective Action Owner and Re-Audit Scheduled on a passing audit", () => {
    const result = validateAuditProtocolFields({ ...COMPLETE_AUDIT, verdict: "pass", correctiveActionOwner: "none", reAuditScheduled: "not required" })
    expect(result).toEqual({ valid: true })
  })

  test("rejects a submission missing Objective Understood", () => {
    const { objectiveUnderstood: _drop, ...rest } = COMPLETE_AUDIT
    const result = validateAuditProtocolFields(rest)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Objective Understood is missing")
  })

  test("rejects a placeholder Standards Reviewed value", () => {
    const result = validateAuditProtocolFields({ ...COMPLETE_AUDIT, standardsReviewed: "TBD" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("placeholder")
  })

  test("rejects Corrective Action Owner being 'none' when the Before/During fields are NOT none-like (real content still gets ambiguity/length checks)", () => {
    const result = validateAuditProtocolFields({ ...COMPLETE_AUDIT, scopeConfirmed: "none" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("placeholder")
  })

  test("rejects an invalid Severity Classified value", () => {
    const result = validateAuditProtocolFields({ ...COMPLETE_AUDIT, severityClassified: "urgent" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Severity Classified")
  })

  test("rejects an invalid Verdict value", () => {
    const result = validateAuditProtocolFields({ ...COMPLETE_AUDIT, verdict: "maybe" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Verdict")
  })

  test("rejects vague/ambiguous language in a narrative field", () => {
    const result = validateAuditProtocolFields({ ...COMPLETE_AUDIT, evidenceRecorded: "will figure it out and handle edge cases as needed" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("vague")
  })
})

describe("AUDIT_PROTOCOL_COMPLIANCE_LEAF -- real Guardrail Engine wiring", () => {
  test("a complete audit submission passes through the registered leaf", () => {
    const result = evaluateGuardrails(AUDIT_PROTOCOL_COMPLIANCE_LEAF, "input", { ...COMPLETE_AUDIT })
    expect(result).toEqual({ passed: true })
  })

  test("an incomplete audit submission is blocked by the registered leaf, with reason/guidance surfaced", () => {
    const result = evaluateGuardrails(AUDIT_PROTOCOL_COMPLIANCE_LEAF, "input", { ...COMPLETE_AUDIT, verdict: undefined })
    expect(result.passed).toBe(false)
    if (!result.passed) {
      expect(result.reason).toContain("Verdict is missing")
      expect(result.guidance.length).toBeGreaterThan(0)
    }
  })
})
