// tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 original
// item (f): "QA pre-completion gate distinct from GOV-08." GOV-08
// (HANDOVER_PROTOCOL_LEAF / validateHandoverFields, handover-protocol.ts)
// checks that a submitted handover's 9 fields are PRESENT, real, and
// unambiguous. It has no opinion at all on what the handover actually
// SAYS -- a perfectly well-formed submission can honestly report
// validationPassed: "no" or "partial", and GOV-08 passes it regardless.
// This module is the gate GOV-08 deliberately isn't: it reads that
// reported value back and decides whether the underlying work may
// actually be marked terminal-complete, or must stay open pending an
// explicit, permanently-recorded override.
//
// Two prior investigations (04-implementation-log.yaml, 2026-07-11 x2)
// found this genuinely not closeable: handover-protocol.ts's
// submitHandover()/acceptHandover() (PR #170) had ZERO live callers
// anywhere in the codebase -- building a completion-blocking check on top
// of a service nothing called would itself be dead code, and the one
// real, LIVE closure path (activity_log's recordPeerReview/
// closureReviewCheck) had no structured self-assessment shape to check
// against (self_assessment was an arbitrary Record<string, unknown>,
// never populated by the dispatch route itself -- only ever set from a
// reviewer's own request body at closure time, confirmed by grep).
//
// Wired for real this pass: schema.ts's activity_log.self_assessment
// column already documented the intended shape ("the executing role's own
// structured self-report: {taskStatus, outputProduced, validationPassed,
// knownRisks, confidence}", Wave 165) but nothing had ever written it from
// the dispatch side. buildDispatchSelfAssessment below populates the
// FULL 9-field HandoverFields shape (a strict superset of that comment's
// sketch, reusing the already-built/tested type rather than inventing a
// narrower one) at dispatch time in
// src/app/api/ai/team/dispatch/route.ts, deriving every field from
// signals that route had ALREADY computed for its own requiresAudit
// decision (Wave 165/171: detectLowConfidenceResponse, classifyRisk) --
// never an LLM call, never fabricated narrative. checkQaPreCompletionGate
// is then the actual completion-blocking check, evaluated both at
// dispatch time (via the QA_PRECOMPLETION_GATE_LEAF guardrail,
// guardrail-registrations.ts) and at closure time in
// src/app/api/ai/team/review/route.ts, before an 'approved' decision is
// allowed to flip activity_log.lifecycle_stage to 'completed'.
import type { HandoverFields } from "@/lib/handover-protocol"

const MIN_OVERRIDE_REASON_LENGTH = 10

export type QaGateInput = {
  /** activity_log.self_assessment.validationPassed ('yes' | 'no' | 'partial'), or null/undefined when no handover was ever submitted. */
  handoverValidationPassed: string | null | undefined
  /** A real, substantive justification for closing this out despite validationPassed !== 'yes' -- permanently recorded on the row when supplied, never silently accepted. */
  overrideReason?: string | null
}

export type QaGateResult =
  | { passed: true; overridden: boolean }
  | { passed: false; reason: string; guidance: string }

/**
 * The actual QA pre-completion gate: a task/dispatch cannot be marked
 * terminal-complete unless its handover's Validation Passed field is
 * "yes", or an explicit, substantive override reason is recorded. Pure
 * and deterministic -- no LLM call, matching every other gate in this
 * codebase.
 */
export function checkQaPreCompletionGate(input: QaGateInput): QaGateResult {
  const validation = (input.handoverValidationPassed ?? "").trim().toLowerCase()
  const overrideReason = (input.overrideReason ?? "").trim()

  if (validation === "yes") return { passed: true, overridden: false }
  if (overrideReason.length >= MIN_OVERRIDE_REASON_LENGTH) return { passed: true, overridden: true }

  if (!validation) {
    return {
      passed: false,
      reason: "handover_not_submitted",
      guidance: `No structured handover has been recorded for this dispatch yet -- Validation Passed must be confirmed before it can be marked complete, or an explicit override reason (at least ${MIN_OVERRIDE_REASON_LENGTH} characters) must be given.`,
    }
  }

  return {
    passed: false,
    reason: `handover_validation_not_passed:${validation}`,
    guidance: `The submitted handover reports Validation Passed = "${validation}", not "yes" -- this cannot be marked complete without an explicit override reason (at least ${MIN_OVERRIDE_REASON_LENGTH} characters) explaining why completion is justified anyway.`,
  }
}

export type DispatchHandoverInput = {
  requiresAudit: boolean
  riskLevel: string
  lowConfidenceDetected: boolean
  lowConfidenceMatchedPhrase: string | null
  /** GP-06 gap-closure (2026-07-18, knowledge-sufficiency-gate.ts): an explicit admission the executing role lacked the knowledge/access to do the task, distinct from generic hedging. */
  knowledgeGapDetected: boolean
  knowledgeGapMatchedPhrase: string | null
  /**
   * A real, factual descriptor of what was produced (e.g. character count
   * + role) -- deliberately NOT the raw LLM response text embedded
   * verbatim. Arbitrary model prose could coincidentally contain one of
   * task-tightening.ts's AMBIGUITY_PHRASES (a real string, "as needed" and
   * similar -- entirely plausible in ordinary written output) and trip
   * GOV-08's own ambiguity check for a reason that has nothing to do with
   * the handover being vague. A code-controlled descriptor sidesteps that
   * false-positive risk entirely while still being true and specific.
   */
  outputSummary: string
}

/**
 * Pure, derived-from-real-signals builder for the AI Team dispatch
 * route's self_assessment write. Every field is computed from data the
 * route already had for its own requiresAudit decision -- no LLM call, no
 * invented narrative, same discipline monitoring-engine.ts/audit-cadence.ts
 * already follow (reuse an already-real signal, never fabricate a new
 * one). validationPassed intentionally mirrors requiresAudit exactly
 * (partial when a review is required, yes when it isn't) -- the point of
 * wiring this gate is that a FUTURE caller with a different, more granular
 * signal for validationPassed is honored automatically by
 * checkQaPreCompletionGate, not that this dispatch is inventing new
 * distinctions.
 */
export function buildDispatchSelfAssessment(input: DispatchHandoverInput): HandoverFields {
  const { requiresAudit, riskLevel, lowConfidenceDetected, lowConfidenceMatchedPhrase, knowledgeGapDetected, knowledgeGapMatchedPhrase, outputSummary } = input

  const validationPassed = requiresAudit ? "partial" : "yes"
  const confidence = lowConfidenceDetected || knowledgeGapDetected ? "low" : riskLevel === "high" || riskLevel === "critical" ? "medium" : "high"
  const riskReason = knowledgeGapDetected
    ? `insufficient knowledge admitted ("${knowledgeGapMatchedPhrase}")`
    : lowConfidenceDetected
    ? `low-confidence output ("${lowConfidenceMatchedPhrase}")`
    : `risk level: ${riskLevel}`

  return {
    taskStatus: requiresAudit
      ? `Completed -- flagged for independent review (${riskReason})`
      : "Completed -- guardrails, confidence, and risk checks all passed, no review required",
    outputProduced: outputSummary,
    validationPassed,
    knownRisks: requiresAudit
      ? knowledgeGapDetected
        ? `Executing role admitted insufficient knowledge ("${knowledgeGapMatchedPhrase}")`
        : lowConfidenceDetected
        ? `Executing role's own output hedged ("${lowConfidenceMatchedPhrase}")`
        : `Classified risk level: ${riskLevel}`
      : "None identified -- guardrails, confidence, and risk checks all passed",
    pendingItems: requiresAudit
      ? "Awaiting an independent reviewer's explicit approve or reject decision via POST /api/ai/team/review"
      : "None -- dispatch auto-completed, no review required",
    confidence,
    nextResponsibleAi: requiresAudit
      ? "An independent veridian_admin reviewer (self-review not allowed)"
      : "None -- no further action required",
    requiredAction: requiresAudit
      ? "Review the output and record an explicit approve or reject decision"
      : "No further action required -- dispatch auto-completed",
    escalationRequired: riskLevel === "critical" ? "yes" : "no",
  }
}
