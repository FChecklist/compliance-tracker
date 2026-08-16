// ai-os/tree4-unified/10-merged-governance-layer.yaml, U-D17.B1.S1
// (confirmed_gap, not an assumption): "Mandatory structured handover -- no
// AI Agent may simply say 'Done'." Confirmed absent by direct code search:
// no registered guardrail leaf, table, or service in this codebase
// implemented this pattern before this file. task_agent_executions
// (schema.ts) already tracked worker-agent execution steps but had no
// handover-acknowledgement concept.
//
// Shape follows activity-log-service.ts's recordPeerReview() precedent
// exactly: a submit step (here, submitHandover) writes a structured
// record, and a SEPARATE, explicit accept step (acceptHandover) is the
// only thing that transitions ownership -- fail-closed the same way
// (reject not-found, reject an already-closed-out row, reject self-
// dealing). Deliberately NOT built on top of activityLog / recordPeerReview
// itself (out of scope per this task's brief) -- this is a parallel
// mechanism for task_agent_executions, which has its own row shape (one
// row per worker-agent execution step, no org_id column -- see below).
//
// Field validation reuses task-tightening.ts's exported
// detectAmbiguousLanguage() and its TightTaskValidation result shape
// directly. It does NOT reuse task-tightening.ts's isPlaceholder()/
// PLACEHOLDER_PATTERNS -- those are module-private (no `export`) and
// task-tightening.ts is out of this task's edit Scope, so literal reuse
// isn't possible. JUNK_PATTERNS below is a deliberate, narrower parallel,
// not a blind copy: two of the 9 fields (Known Risks, Pending Items) have
// a genuine real answer of "none" ("no known risks" is a complete,
// truthful handover statement), unlike every TightTask field, where "none"
// is always a placeholder. See the per-field allowNoneLike argument below.
import { eq } from "drizzle-orm"
import { db, taskAgentExecutions } from "@/lib/db"
import { detectAmbiguousLanguage, type TightTaskValidation } from "@/lib/task-tightening"
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine"

/**
 * The 9 fields ai-os/tree4-unified/10-merged-governance-layer.yaml
 * U-D17.B1.S1 requires on every structured handover. Field names mirror
 * the spec's own labels (Task Status, Output Produced, ...), not this
 * codebase's usual camelCase invention -- so a reviewer diffing this
 * against the requirement text can match each field 1:1.
 */
export type HandoverFields = {
  taskStatus: string
  outputProduced: string
  /** 'yes' | 'no' | 'partial' -- see VALID_VALIDATION_PASSED. */
  validationPassed: string
  knownRisks: string
  pendingItems: string
  /** 'high' | 'medium' | 'low' -- see VALID_CONFIDENCE. */
  confidence: string
  nextResponsibleAi: string
  requiredAction: string
  /** 'yes' | 'no' -- see VALID_ESCALATION_REQUIRED. */
  escalationRequired: string
}

export type HandoverValidation = TightTaskValidation

export const VALID_VALIDATION_PASSED = ["yes", "no", "partial"] as const
export const VALID_CONFIDENCE = ["high", "medium", "low"] as const
export const VALID_ESCALATION_REQUIRED = ["yes", "no"] as const

const MIN_FIELD_LENGTH = 8

// Deliberately narrower than task-tightening.ts's PLACEHOLDER_PATTERNS --
// see module header for why "none"/"n/a" can't be blanket-rejected here.
const JUNK_PATTERNS = [
  /^(tbd|todo|xxx+|\.\.\.|fill.?in|same as (above|status|output))$/i,
  /^\s*$/,
]
const NONE_LIKE_PATTERN = /^(n\/?a|none|null|undefined)$/i

function isJunk(value: string, allowNoneLike: boolean): boolean {
  const trimmed = value.trim()
  if (JUNK_PATTERNS.some((p) => p.test(trimmed))) return true
  if (!allowNoneLike && NONE_LIKE_PATTERN.test(trimmed)) return true
  return false
}

function checkNarrativeField(value: string | undefined, label: string, guidanceExample: string, allowNoneLike: boolean): HandoverValidation | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Add a ${label} field. Example: "${guidanceExample}"` }
  }
  if (isJunk(trimmed, allowNoneLike)) {
    return { valid: false, reason: `${label} is a placeholder, not a real value ("${trimmed}").`, guidance: `Replace it with the actual ${label.toLowerCase()}. Example: "${guidanceExample}"` }
  }
  // A genuine "none"/"n/a" answer is real, complete content for fields
  // where allowNoneLike is true (see module header) -- it must not then
  // get rejected by the length/ambiguity checks below, which exist to
  // catch padding and vagueness in fields that DO require substantive
  // content.
  if (allowNoneLike && NONE_LIKE_PATTERN.test(trimmed)) return null
  if (trimmed.length < MIN_FIELD_LENGTH) {
    return { valid: false, reason: `${label} is too short to be actionable ("${trimmed}").`, guidance: `Be specific -- name the concrete state/outcome, not just a category. Example: "${guidanceExample}"` }
  }
  const ambiguity = detectAmbiguousLanguage(trimmed)
  if (ambiguity.detected) {
    return {
      valid: false,
      reason: `${label} contains vague, unresolved language ("${ambiguity.matchedPhrase}").`,
      guidance: `Replace "${ambiguity.matchedPhrase}" with the actual decision -- a handover exists precisely so the next owner doesn't have to guess.`,
    }
  }
  return null
}

function checkEnumField(value: string | undefined, label: string, validValues: readonly string[]): HandoverValidation | null {
  const trimmed = (value ?? "").trim().toLowerCase()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Set ${label} to one of: ${validValues.join(", ")}.` }
  }
  if (!validValues.includes(trimmed)) {
    return { valid: false, reason: `${label} ("${trimmed}") is not one of the recognized values.`, guidance: `Must be one of: ${validValues.join(", ")}.` }
  }
  return null
}

/**
 * Validates all 9 required handover fields are present and non-placeholder
 * before a handover may be recorded -- the guardrail this module exists
 * to provide. Deterministic only, no LLM call, matching every other gate
 * in this codebase.
 */
export function validateHandoverFields(fields: Partial<HandoverFields>): HandoverValidation {
  const checks: Array<HandoverValidation | null> = [
    checkNarrativeField(fields.taskStatus, "Task Status", "In progress -- 3 of 5 planned files updated", false),
    checkNarrativeField(fields.outputProduced, "Output Produced", "Migration 0138 plus schema.ts columns and handover-protocol.ts service functions", false),
    checkEnumField(fields.validationPassed, "Validation Passed", VALID_VALIDATION_PASSED),
    checkNarrativeField(fields.knownRisks, "Known Risks", "None identified", true),
    checkNarrativeField(fields.pendingItems, "Pending Items", "PR still needs CI to pass before merge", true),
    checkEnumField(fields.confidence, "Confidence", VALID_CONFIDENCE),
    checkNarrativeField(fields.nextResponsibleAi, "Next Responsible AI", "Super Boss (human orchestrator) for PR review", false),
    checkNarrativeField(fields.requiredAction, "Required Action", "Review the PR diff and merge once CI passes", false),
    checkEnumField(fields.escalationRequired, "Escalation Required", VALID_ESCALATION_REQUIRED),
  ]
  for (const failure of checks) {
    if (failure) return failure
  }
  return { valid: true }
}

export type SubmitHandoverInput = HandoverFields & {
  /** The existing task_agent_executions row this handover is recorded against. */
  executionId: string
  /**
   * Identifies who is sending this handover (worker agent id, or role
   * string for non-worker-agent senders). Only backfills
   * taskAgentExecutions.workerAgentId if that column is still null on the
   * row -- never overwrites an id already recorded by the execution step
   * itself (see task-execution-engine.ts's insert call sites, out of scope
   * to change here). acceptHandover() checks this same identity to block
   * self-acceptance.
   */
  submittedBy: string
}

export type SubmitHandoverResult =
  | { recorded: true }
  | { recorded: false; reason: string; guidance?: string }

/**
 * Records a structured handover on an existing task_agent_executions row.
 * Fails closed on two independent gates: (1) the Guardrail Engine check
 * registered at HANDOVER_PROTOCOL_LEAF (all 9 fields present, real,
 * unambiguous -- see validateHandoverFields), and (2) the target row must
 * actually exist. No API route wraps this -- unlike
 * /api/ai/team/dispatch and /api/ai/team/review, which call
 * registerAllGuardrails() once at module load then evaluateGuardrails()
 * explicitly, there is no dedicated handover route (a well-typed service
 * function was judged sufficient for this task -- see this module's PR
 * description). To keep the guardrail genuinely enforced regardless of
 * caller order, this function performs both registration and evaluation
 * itself rather than depending on some other module happening to have
 * imported guardrail-registrations.ts first.
 */
export async function submitHandover(input: SubmitHandoverInput): Promise<SubmitHandoverResult> {
  // Deferred import, not a top-level one: guardrail-registrations.ts
  // imports validateHandoverFields FROM this module (to register the
  // check), so a top-level import back here would be a circular module
  // dependency. Resolved inside the function body instead of at
  // module-eval time -- safe because it only runs at call time, after both
  // modules have finished loading, same discipline recordGuardrailViolation()
  // itself uses (guardrail-engine.ts) for its own deferred import of
  // loop-improvement-proposer.ts. HANDOVER_PROTOCOL_LEAF is also read from
  // this import (its single source of truth lives in
  // guardrail-registrations.ts, alongside every other *_LEAF constant --
  // matching that file's convention) rather than duplicated here.
  const { registerAllGuardrails, HANDOVER_PROTOCOL_LEAF } = await import("@/lib/guardrail-registrations")
  registerAllGuardrails()

  const fields: HandoverFields = {
    taskStatus: input.taskStatus,
    outputProduced: input.outputProduced,
    validationPassed: input.validationPassed,
    knownRisks: input.knownRisks,
    pendingItems: input.pendingItems,
    confidence: input.confidence,
    nextResponsibleAi: input.nextResponsibleAi,
    requiredAction: input.requiredAction,
    escalationRequired: input.escalationRequired,
  }

  const check = evaluateGuardrails(HANDOVER_PROTOCOL_LEAF, "input", fields)
  if (!check.passed) {
    void recordGuardrailViolation(input.executionId, HANDOVER_PROTOCOL_LEAF, "input", check)
    return { recorded: false, reason: check.reason, guidance: check.guidance }
  }

  const existing = await db.query.taskAgentExecutions.findFirst({ where: eq(taskAgentExecutions.id, input.executionId) })
  if (!existing) {
    return { recorded: false, reason: "not_found", guidance: "No task_agent_executions row exists for this executionId -- the execution step must be recorded before a handover can be attached to it." }
  }

  await db.update(taskAgentExecutions).set({
    handoverTaskStatus: fields.taskStatus,
    handoverOutputProduced: fields.outputProduced,
    handoverValidationPassed: fields.validationPassed.trim().toLowerCase(),
    handoverKnownRisks: fields.knownRisks,
    handoverPendingItems: fields.pendingItems,
    handoverConfidence: fields.confidence.trim().toLowerCase(),
    handoverNextResponsibleAi: fields.nextResponsibleAi,
    handoverRequiredAction: fields.requiredAction,
    handoverEscalationRequired: fields.escalationRequired.trim().toLowerCase(),
    workerAgentId: existing.workerAgentId ?? input.submittedBy,
  }).where(eq(taskAgentExecutions.id, input.executionId))

  return { recorded: true }
}

export type AcceptHandoverInput = {
  executionId: string
  /** The receiving agent/role explicitly acknowledging acceptance. */
  acceptedBy: string
}

export type AcceptHandoverResult =
  | { accepted: true }
  | { accepted: false; reason: "not_found" | "not_submitted" | "already_accepted" | "self_acceptance_not_allowed" }

/** The subset of a task_agent_executions row decideAcceptance needs -- kept narrow and structural so it can be unit-tested with a plain object, no live DB connection required. */
export type ExistingHandoverRow = {
  handoverTaskStatus: string | null
  handoverAcceptedBy: string | null
  workerAgentId: string | null
} | undefined

/**
 * Pure fail-closed decision logic for acceptHandover(), extracted so it's
 * directly unit-testable (no live DB connection needed) -- the same
 * discipline task-tightening.ts's validateTightTask() and
 * guardrail-registrations.ts's check functions already follow in this
 * codebase. Mirrors activity-log-service.ts's recordPeerReview() fail-
 * closed pattern exactly: not_found / not_submitted (this module's analog
 * of recordPeerReview's not_in_review) / already_accepted / and
 * self_acceptance_not_allowed (this module's analog of
 * self_review_not_allowed). Order matters: not_found and not_submitted are
 * checked before already_accepted/self_acceptance_not_allowed since
 * neither of those can be evaluated meaningfully without a submitted
 * handover to check them against.
 */
export function decideAcceptance(existing: ExistingHandoverRow, acceptedBy: string): AcceptHandoverResult {
  if (!existing) return { accepted: false, reason: "not_found" }
  if (!existing.handoverTaskStatus) return { accepted: false, reason: "not_submitted" }
  if (existing.handoverAcceptedBy) return { accepted: false, reason: "already_accepted" }
  if (existing.workerAgentId && existing.workerAgentId === acceptedBy) return { accepted: false, reason: "self_acceptance_not_allowed" }
  return { accepted: true }
}

/**
 * Records the receiving agent's explicit acceptance of a submitted
 * handover -- the Guardrail's own words: "Ownership transfers only after
 * the receiving agent explicitly acknowledges acceptance -- a handover
 * sent but not acknowledged does not transfer ownership."
 */
export async function acceptHandover(params: AcceptHandoverInput): Promise<AcceptHandoverResult> {
  const existing = await db.query.taskAgentExecutions.findFirst({ where: eq(taskAgentExecutions.id, params.executionId) })
  const decision = decideAcceptance(existing, params.acceptedBy)
  if (!decision.accepted) return decision

  await db.update(taskAgentExecutions).set({
    handoverAcceptedBy: params.acceptedBy,
    handoverAcceptedAt: new Date(),
  }).where(eq(taskAgentExecutions.id, params.executionId))

  return { accepted: true }
}
