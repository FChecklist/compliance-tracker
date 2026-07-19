// AIROUTER-01 Phase 2 (Owner directive 2026-07-19): Software Team L0-L5
// execution ladder -- the Instruction Contract (pre-execution input) /
// Execution Report (post-execution output) JSON schema.
//
// Genuinely new, distinct from task-tightening.ts's TightTask: TightTask is
// the free-text-brief guardrail (objective/scope/successCriteria)
// validated BEFORE a task is even classified/dispatched. InstructionContract
// is the fuller, level-aware contract a Mother Router (L5) or Supervisor
// (L4) sends to a worker (L1-L3) -- it is built FROM a validated TightTask
// plus the target level's fixed ladder rules (see software-team-ladder.ts),
// carrying the Owner's own "Universal Tightened Instruction Template"
// fields verbatim: Input, Preconditions, Process, Output, Validation,
// Success Criteria, Failure Criteria, Retry Policy, Escalation Rules,
// Documentation Requirements, Evidence Required, Handover Requirements.
//
// ExecutionReport is the Owner's own literal 4-example schema
// (Single/Two/Three/Multi Step), used EXACTLY as specified -- not
// reinterpreted. Do NOT confuse either shape with platform.ai_routing_audit_log
// (that logs the Mother Router's MODEL routing decision only, never a
// task's actual input/output contract).
//
// Deterministic only -- no LLM call, matching task-tightening.ts /
// policy-enforcement-engine.ts / every other structural gate in this
// codebase. These validators check SHAPE, not whether the content is a
// good idea.

import type { ComplexityTier } from "../task-tightening"
import { SOFTWARE_TEAM_LEVELS, type SoftwareTeamLevel } from "./software-team-ladder"

export type InstructionContract = {
  taskId: string
  level: SoftwareTeamLevel
  roleKey: string | null
  objective: string
  preconditions: string[]
  input: string
  process: string[]
  constraints?: string
  expectedOutputFormat: string
  validationCriteria: string
  successCriteria: string
  failureCriteria: string
  retryPolicy: string
  escalationRule: string
  documentationRequirements: string
  evidenceRequired: string
  handoverRequirements: string
  /**
   * Audit round 1 (GLM-5.2, B1 finding) fix: how many sequential dispatch
   * calls this task_id's Execution Report expects to accumulate before the
   * task register row may be marked "completed" -- an L2 (sequential
   * workflow) or L3 (multi-file feature) task declares this once, on its
   * FIRST dispatch call, so a single passing step is never mistaken for a
   * finished multi-step workflow. Defaults to 1 for an ordinary single-step
   * L1/L4 dispatch (existing behavior, unchanged).
   */
  expectedSteps: number
}

export type InstructionContractValidation =
  | { valid: true }
  | { valid: false; reason: string; guidance: string }

const MIN_FIELD_LENGTH = 5

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length < MIN_FIELD_LENGTH
}

/**
 * Validates an InstructionContract is genuinely PRE-execution and complete
 * -- every field the Owner's Universal Tightened Instruction Template
 * requires must be present and non-placeholder. Mirrors
 * task-tightening.ts::validateTightTask()'s posture exactly (reject before
 * any model is called, never silently proceed on a missing field).
 */
export function validateInstructionContract(contract: Partial<InstructionContract>): InstructionContractValidation {
  const REQUIRED_STRING_FIELDS: Array<[keyof InstructionContract, string]> = [
    ["taskId", "taskId"],
    ["objective", "objective"],
    ["input", "input"],
    ["expectedOutputFormat", "expectedOutputFormat"],
    ["validationCriteria", "validationCriteria"],
    ["successCriteria", "successCriteria"],
    ["failureCriteria", "failureCriteria"],
    ["retryPolicy", "retryPolicy"],
    ["escalationRule", "escalationRule"],
    ["documentationRequirements", "documentationRequirements"],
    ["evidenceRequired", "evidenceRequired"],
    ["handoverRequirements", "handoverRequirements"],
  ]

  for (const [key, label] of REQUIRED_STRING_FIELDS) {
    if (isBlank(contract[key])) {
      return {
        valid: false,
        reason: `InstructionContract.${label} is missing or too short.`,
        guidance: `Every Instruction Contract must supply a real, non-placeholder "${label}" -- the AI agent shall not make assumptions or invent information for a missing mandatory input.`,
      }
    }
  }

  // Audit round 1 (GLM-5.2, m4 finding): was a bare truthiness check --
  // "L9"/"garbage" passed. Now validated against the real level set, since
  // this validator is a public export other call sites may use directly
  // (validateLevelDispatch in the route only catches this for ITS OWN
  // caller, not for every future consumer of this function).
  if (!contract.level || !SOFTWARE_TEAM_LEVELS.includes(contract.level)) {
    return { valid: false, reason: `InstructionContract.level "${contract.level}" is not a real level.`, guidance: `Set level to one of ${SOFTWARE_TEAM_LEVELS.join(", ")} (see software-team-ladder.ts's SoftwareTeamLevel).` }
  }

  if (!Number.isInteger(contract.expectedSteps) || (contract.expectedSteps as number) < 1) {
    return { valid: false, reason: "InstructionContract.expectedSteps must be a positive integer.", guidance: "Declare the real total step count this task_id's workflow expects (1 for an ordinary single-step dispatch) -- never assume or omit it." }
  }

  if (!Array.isArray(contract.preconditions) || contract.preconditions.length === 0) {
    return {
      valid: false,
      reason: "InstructionContract.preconditions must be a non-empty array.",
      guidance: "State at least one precondition explicitly -- even 'none' must be an explicit array entry, never an omitted field (the agent must never assume no preconditions exist).",
    }
  }

  if (!Array.isArray(contract.process) || contract.process.length === 0) {
    return {
      valid: false,
      reason: "InstructionContract.process must be a non-empty ordered array of steps.",
      guidance: "Every Instruction Contract must enumerate its process steps explicitly -- the agent shall not invent its own process when none is given.",
    }
  }

  return { valid: true }
}

// ─── Execution Report (Owner's literal schema, 4 worked examples) ────────

export type ExecutionStepStatus = "PASS" | "FAIL" | "PARTIAL"

export type ExecutionStep = {
  step_no: number
  name: string
  status: ExecutionStepStatus
  confidence: number
  retry_count: number
  validation: "PASS" | "FAIL"
}

export type TaskType = "Single Step" | "Two Step" | "Three Step" | "Multi Step"

export type ExecutionReport = {
  task_id: string
  task_type: TaskType
  objective: string
  status: ExecutionStepStatus
  overall_confidence: number
  completion: { completed: number; expected: number; percentage: number }
  steps: ExecutionStep[]
  missing: string[]
  warnings: string[]
  errors: string[]
  escalation: { required: boolean; reason: string }
  execution_summary: {
    duration_seconds: number
    tokens_used: number
    files_created?: number
    files_modified?: number
    tests_passed?: number
    tests_failed?: number
  }
}

/** Owner's own step-count -> task_type naming, applied consistently rather than left to caller judgment. */
export function taskTypeForStepCount(stepCount: number): TaskType {
  if (stepCount <= 1) return "Single Step"
  if (stepCount === 2) return "Two Step"
  if (stepCount === 3) return "Three Step"
  return "Multi Step"
}

export type ExecutionReportValidation =
  | { valid: true }
  | { valid: false; reason: string; guidance: string }

/**
 * Structural validation only (shape, internal consistency of the counters)
 * -- matches the Owner's 4 example payloads field-for-field. Does not judge
 * whether the underlying work was actually good; that's what the guardrail
 * pipeline (/api/ai/team/dispatch's confidence/knowledge-gap/risk checks)
 * is for.
 */
export function validateExecutionReport(report: Partial<ExecutionReport>): ExecutionReportValidation {
  if (isBlank(report.task_id)) {
    return { valid: false, reason: "ExecutionReport.task_id is missing.", guidance: "Every Execution Report must echo back the same task_id its Instruction Contract used." }
  }
  if (!report.status) {
    return { valid: false, reason: "ExecutionReport.status is required.", guidance: "status must be one of PASS/FAIL/PARTIAL -- the agent shall never silently omit its own outcome." }
  }
  if (typeof report.overall_confidence !== "number" || report.overall_confidence < 0 || report.overall_confidence > 100) {
    return { valid: false, reason: "ExecutionReport.overall_confidence must be a number 0-100.", guidance: "Report a real confidence percentage -- never omit it or invent an out-of-range value." }
  }
  if (!report.completion || typeof report.completion.completed !== "number" || typeof report.completion.expected !== "number") {
    return { valid: false, reason: "ExecutionReport.completion.{completed,expected} are required numbers.", guidance: "State exactly how many of the expected steps actually completed." }
  }
  if (report.completion.expected > 0) {
    const expectedPercentage = Math.round((report.completion.completed / report.completion.expected) * 100)
    if (report.completion.percentage !== expectedPercentage) {
      return {
        valid: false,
        reason: `ExecutionReport.completion.percentage (${report.completion.percentage}) does not match completed/expected (${report.completion.completed}/${report.completion.expected} = ${expectedPercentage}%).`,
        guidance: "The agent shall not invent a percentage inconsistent with its own reported completed/expected counts.",
      }
    }
  }
  if (!Array.isArray(report.steps) || report.steps.length === 0) {
    return { valid: false, reason: "ExecutionReport.steps must be a non-empty array.", guidance: "Report at least one step -- the agent shall never silently omit what it actually did." }
  }
  if (!report.escalation || typeof report.escalation.required !== "boolean") {
    return { valid: false, reason: "ExecutionReport.escalation.required is required.", guidance: "Every Execution Report must explicitly state whether escalation is required, never leave it implicit." }
  }
  if (report.escalation.required && isBlank(report.escalation.reason)) {
    return { valid: false, reason: "ExecutionReport.escalation.reason is required when escalation.required is true.", guidance: "The agent shall immediately escalate with a real, stated reason -- never a silent or unexplained escalation flag." }
  }
  if (!report.execution_summary || typeof report.execution_summary.duration_seconds !== "number" || typeof report.execution_summary.tokens_used !== "number") {
    return { valid: false, reason: "ExecutionReport.execution_summary.{duration_seconds,tokens_used} are required numbers.", guidance: "Report real, measured execution metadata -- never omit or guess it." }
  }
  return { valid: true }
}

/** L1-L3 escalation rule (Owner's Universal Tightened Instruction Template): confidence below this threshold always escalates, regardless of status. */
export const WORKER_ESCALATION_CONFIDENCE_THRESHOLD = 95

export type ComplexityTierForLevel = ComplexityTier | null
