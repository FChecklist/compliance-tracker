/// <reference types="bun-types" />
// Wave 167 (ai-os/tree4-unified/10-merged-governance-layer.yaml,
// U-D17.B1.S1). Deliberately does NOT exercise submitHandover()/
// acceptHandover() end-to-end against a live database -- no test file in
// this codebase does that today (confirmed by grep: nothing under
// src/lib/*.test.ts imports `db` or `withTenantContext`), and this repo's
// worktree has no DATABASE_URL/APP_RUNTIME_DATABASE_URL configured. What
// IS tested directly, with no mocking required, is the pure decision
// logic each of those functions delegates to: validateHandoverFields()
// (field completeness/placeholder/ambiguity checks), the real Guardrail
// Engine wiring via evaluateGuardrails(HANDOVER_PROTOCOL_LEAF, ...) (same
// pattern as guardrail-registrations.test.ts's closureReviewCheck
// coverage), and decideAcceptance() (acceptHandover()'s fail-closed
// branch logic, extracted specifically so it's testable this way).
import { describe, expect, test } from "bun:test"
import { evaluateGuardrails } from "./guardrail-engine"
import { registerAllGuardrails, HANDOVER_PROTOCOL_LEAF } from "./guardrail-registrations"
import { validateHandoverFields, decideAcceptance, type HandoverFields } from "./handover-protocol"

registerAllGuardrails()

const COMPLETE_HANDOVER: HandoverFields = {
  taskStatus: "Completed -- migration written, guardrail wired, tests passing",
  outputProduced: "Migration 0138, schema.ts columns, handover-protocol.ts",
  validationPassed: "yes",
  knownRisks: "None identified",
  pendingItems: "PR still needs human review before merge",
  confidence: "high",
  nextResponsibleAi: "Super Boss (human orchestrator) for PR review",
  requiredAction: "Review the PR diff and merge once CI passes",
  escalationRequired: "no",
}

describe("validateHandoverFields -- U-D17.B1.S1 field completeness gate", () => {
  test("passes a complete handover with all 9 real fields", () => {
    expect(validateHandoverFields(COMPLETE_HANDOVER)).toEqual({ valid: true })
  })

  test("allows a genuine 'none' answer for Known Risks and Pending Items", () => {
    const result = validateHandoverFields({ ...COMPLETE_HANDOVER, knownRisks: "none", pendingItems: "n/a" })
    expect(result).toEqual({ valid: true })
  })

  test("rejects a handover missing Task Status", () => {
    const { taskStatus: _drop, ...rest } = COMPLETE_HANDOVER
    const result = validateHandoverFields(rest)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Task Status is missing")
  })

  test("rejects a handover missing Output Produced", () => {
    const { outputProduced: _drop, ...rest } = COMPLETE_HANDOVER
    const result = validateHandoverFields(rest)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Output Produced is missing")
  })

  test("rejects Known Risks that has no meaning even though it's not blank -- pure placeholder junk", () => {
    const result = validateHandoverFields({ ...COMPLETE_HANDOVER, knownRisks: "TBD" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("placeholder")
  })

  test("rejects Next Responsible AI that is just 'none' -- unlike Known Risks, this field must name a real party", () => {
    const result = validateHandoverFields({ ...COMPLETE_HANDOVER, nextResponsibleAi: "none" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("placeholder")
  })

  test("rejects an invalid Validation Passed value", () => {
    const result = validateHandoverFields({ ...COMPLETE_HANDOVER, validationPassed: "maybe" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Validation Passed")
  })

  test("rejects a missing Confidence value", () => {
    const { confidence: _drop, ...rest } = COMPLETE_HANDOVER
    const result = validateHandoverFields(rest)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Confidence is missing")
  })

  test("rejects an invalid Escalation Required value", () => {
    const result = validateHandoverFields({ ...COMPLETE_HANDOVER, escalationRequired: "unsure" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("Escalation Required")
  })

  test("rejects vague/ambiguous language in a narrative field", () => {
    const result = validateHandoverFields({ ...COMPLETE_HANDOVER, requiredAction: "handle edge cases as appropriate" })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("vague")
  })

  test("accepts case-insensitive/whitespace-padded enum values", () => {
    const result = validateHandoverFields({ ...COMPLETE_HANDOVER, validationPassed: " YES ", confidence: "High", escalationRequired: "No" })
    expect(result).toEqual({ valid: true })
  })
})

describe("HANDOVER_PROTOCOL_LEAF -- real Guardrail Engine wiring (not just a standalone function)", () => {
  test("evaluateGuardrails passes a complete handover through the registered leaf", () => {
    const result = evaluateGuardrails(HANDOVER_PROTOCOL_LEAF, "input", COMPLETE_HANDOVER)
    expect(result).toEqual({ passed: true })
  })

  test("evaluateGuardrails blocks an incomplete handover through the registered leaf, with guidance", () => {
    const { outputProduced: _drop, ...rest } = COMPLETE_HANDOVER
    const result = evaluateGuardrails(HANDOVER_PROTOCOL_LEAF, "input", rest)
    expect(result.passed).toBe(false)
    if (!result.passed) {
      expect(result.reason).toContain("Output Produced is missing")
      expect(result.guidance.length).toBeGreaterThan(0)
    }
  })
})

describe("decideAcceptance -- acceptHandover()'s fail-closed branch logic", () => {
  test("rejects when no execution row exists", () => {
    expect(decideAcceptance(undefined, "receiving-agent-1")).toEqual({ accepted: false, reason: "not_found" })
  })

  test("rejects when no handover was ever submitted on the row", () => {
    const existing = { handoverTaskStatus: null, handoverAcceptedBy: null, workerAgentId: "sender-agent-1" }
    expect(decideAcceptance(existing, "receiving-agent-1")).toEqual({ accepted: false, reason: "not_submitted" })
  })

  test("rejects accepting an already-accepted handover", () => {
    const existing = { handoverTaskStatus: "completed", handoverAcceptedBy: "receiving-agent-1", workerAgentId: "sender-agent-1" }
    expect(decideAcceptance(existing, "receiving-agent-2")).toEqual({ accepted: false, reason: "already_accepted" })
  })

  test("rejects a sender accepting their own handover", () => {
    const existing = { handoverTaskStatus: "completed", handoverAcceptedBy: null, workerAgentId: "sender-agent-1" }
    expect(decideAcceptance(existing, "sender-agent-1")).toEqual({ accepted: false, reason: "self_acceptance_not_allowed" })
  })

  test("accepts a real, unaccepted handover from a different agent", () => {
    const existing = { handoverTaskStatus: "completed", handoverAcceptedBy: null, workerAgentId: "sender-agent-1" }
    expect(decideAcceptance(existing, "receiving-agent-1")).toEqual({ accepted: true })
  })

  test("accepts even when the row has no recorded workerAgentId -- self-acceptance can't be checked, so it isn't blocked", () => {
    const existing = { handoverTaskStatus: "completed", handoverAcceptedBy: null, workerAgentId: null }
    expect(decideAcceptance(existing, "receiving-agent-1")).toEqual({ accepted: true })
  })
})
