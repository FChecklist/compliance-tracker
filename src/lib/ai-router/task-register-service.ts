// AIROUTER-01 Phase 2 (Owner directive 2026-07-19): DB-backed persistence
// for the Instruction Contract / Execution Report task register
// (platform.task_register, see schema.ts + drizzle/0249). Genuinely
// distinct from mother-router.ts's logRoutingDecision() -- that persists a
// MODEL ROUTING decision (platform.ai_routing_audit_log); this persists the
// actual per-task input/output contract.
//
// Same "audit logging must never break a real dispatch" posture already
// established by mother-router.ts's logRoutingDecision(): every write here
// is best-effort and must never throw back into a dispatch call site.
//
// Known, accepted Phase-1 limitation (audit round 1, GLM-5.2 finding M4,
// not engineered around): recordExecutionReport()'s read-merge-write below
// is NOT atomic. Two concurrent dispatch calls sharing the same taskId can
// both read the same prior report and the second write can silently drop
// the first call's step. L2 (Sequential Worker) and L3 (Feature Worker)
// are SEQUENTIAL by the Owner's own ladder contract (software-team-ladder.ts)
// -- genuine concurrent writes to the same taskId are outside this phase's
// real usage pattern, not a scenario this dispatch surface is designed to
// support. Same disclosure class as mother-router.ts's own rollbackPolicy()
// concurrent-caller gap -- noted plainly rather than silently ignored or
// over-engineered with a transaction/row lock this phase doesn't need yet.

import { db, taskRegister } from "@/lib/db"
import { eq } from "drizzle-orm"
import type { SoftwareTeamLevel } from "./software-team-ladder"
import { taskTypeForStepCount, type InstructionContract, type ExecutionReport, type ExecutionStepStatus } from "./instruction-contract"

// Audit round 3 (GLM-5.2, m14-NEW finding): "pending" removed -- no code
// path ever sets it (registerInstructionContract always inserts
// "in_progress" directly; nothing represents a pre-registration state as
// a real row). Dead enum value, removed rather than left unreachable.
export type TaskRegisterStatus = "in_progress" | "completed" | "failed" | "escalated"

/**
 * Registers a task's Instruction Contract BEFORE execution starts. Returns
 * false (never throws) on a DB failure -- the caller's own dispatch must
 * proceed regardless, same fail-open posture as mother-router.ts's
 * logRoutingDecision().
 */
export async function registerInstructionContract(
  contract: InstructionContract,
  level: SoftwareTeamLevel,
  roleKey: string | null
): Promise<boolean> {
  try {
    await db.insert(taskRegister).values({
      taskId: contract.taskId,
      level,
      roleKey,
      status: "in_progress",
      instructionContract: contract as unknown as Record<string, unknown>,
    })
    return true
  } catch (error) {
    console.error(`[task-register] failed to register Instruction Contract for task_id="${contract.taskId}" (non-fatal):`, error)
    return false
  }
}

function sumSummaryField(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined
  return (a ?? 0) + (b ?? 0)
}

/**
 * Audit round 1 (GLM-5.2, B1/B2/B3/B4 findings): computes a genuine
 * workflow-level Execution Report from every step accumulated so far, NOT
 * "the latest step's report with steps appended" (the original bug --
 * status/overall_confidence/completion/objective all silently reflected
 * only the most recent call). A workflow is only as done as its weakest
 * step, only as confident as its weakest step, and keeps the FIRST step's
 * objective (the workflow's own initiating objective, per the Owner's own
 * worked examples), never a later narrower step's objective.
 */
function aggregateExecutionReport(priorReport: ExecutionReport | null | undefined, newStepReport: ExecutionReport): ExecutionReport {
  if (!priorReport) return newStepReport

  const steps = [...priorReport.steps, ...newStepReport.steps]
  const anyFail = steps.some((s) => s.status === "FAIL")
  const anyPartial = steps.some((s) => s.status === "PARTIAL")
  const aggregatedStatus: ExecutionStepStatus = anyFail ? "FAIL" : anyPartial ? "PARTIAL" : "PASS"
  const overallConfidence = Math.min(priorReport.overall_confidence, newStepReport.overall_confidence)
  const completedCount = steps.filter((s) => s.status === "PASS").length
  const expected = Math.max(priorReport.completion.expected, newStepReport.completion.expected, steps.length)

  return {
    task_id: newStepReport.task_id,
    // Audit round 2 (GLM-5.2, m8 finding): task_type must reflect the
    // workflow's INTENDED shape (expectedSteps), not merely how many steps
    // have run so far -- otherwise step 1 of an expected 8-step workflow
    // reports "Single Step" instead of "Multi Step" until every step has
    // accumulated.
    task_type: taskTypeForStepCount(expected),
    objective: priorReport.objective, // FIRST step's objective wins -- the workflow's own initiating objective, never overwritten by a later, narrower step
    status: aggregatedStatus,
    overall_confidence: overallConfidence,
    completion: { completed: completedCount, expected, percentage: expected > 0 ? Math.round((completedCount / expected) * 100) : 0 },
    steps,
    missing: [...new Set([...priorReport.missing, ...newStepReport.missing])],
    warnings: [...new Set([...priorReport.warnings, ...newStepReport.warnings])],
    errors: [...new Set([...priorReport.errors, ...newStepReport.errors])],
    escalation: {
      required: priorReport.escalation.required || newStepReport.escalation.required,
      reason: [priorReport.escalation.reason, newStepReport.escalation.reason].filter(Boolean).join("; "),
    },
    execution_summary: {
      duration_seconds: (priorReport.execution_summary.duration_seconds ?? 0) + (newStepReport.execution_summary.duration_seconds ?? 0),
      tokens_used: (priorReport.execution_summary.tokens_used ?? 0) + (newStepReport.execution_summary.tokens_used ?? 0),
      files_created: sumSummaryField(priorReport.execution_summary.files_created, newStepReport.execution_summary.files_created),
      files_modified: sumSummaryField(priorReport.execution_summary.files_modified, newStepReport.execution_summary.files_modified),
      tests_passed: sumSummaryField(priorReport.execution_summary.tests_passed, newStepReport.execution_summary.tests_passed),
      tests_failed: sumSummaryField(priorReport.execution_summary.tests_failed, newStepReport.execution_summary.tests_failed),
    },
  }
}

export type RecordExecutionReportResult = {
  ok: boolean
  mergedReport: ExecutionReport | null
  status: TaskRegisterStatus | null
}

/**
 * Records (or accumulates onto) a task's Execution Report AFTER a dispatch
 * step runs, and derives the task_register row's own status internally --
 * audit round 1 (GLM-5.2, B1 finding) removed the caller-supplied `status`
 * param entirely: a caller has no reliable way to know whether ITS step is
 * the workflow's LAST step, so trusting an externally-passed status caused
 * a multi-step task_id to be marked "completed" after its first passing
 * step. Status is now: "escalated" if escalation.required; else "failed"
 * if any accumulated step FAILed; else "completed" once the accumulated
 * step count reaches expectedSteps (declared once on the Instruction
 * Contract's FIRST dispatch call, see instruction-contract.ts); else
 * "in_progress".
 */
export async function recordExecutionReport(taskId: string, stepReport: ExecutionReport, expectedSteps: number): Promise<RecordExecutionReportResult> {
  try {
    const existing = await db.query.taskRegister.findFirst({ where: eq(taskRegister.taskId, taskId) })
    const priorReport = existing?.executionReport as ExecutionReport | null | undefined
    const mergedReport = aggregateExecutionReport(priorReport, stepReport)

    const anyFail = mergedReport.steps.some((s) => s.status === "FAIL")
    const allStepsRan = mergedReport.steps.length >= expectedSteps
    const status: TaskRegisterStatus = mergedReport.escalation.required
      ? "escalated"
      : anyFail
        ? "failed"
        : allStepsRan
          ? "completed"
          : "in_progress"

    // Audit round 2 (GLM-5.2, M6 finding): `.returning()` makes a 0-row
    // update DETECTABLE -- previously, if registerInstructionContract()
    // had silently failed (its own try/catch swallows a DB error and
    // returns false, which the route did not check), this UPDATE would
    // affect 0 rows with no signal anywhere: the Execution Report was
    // simply lost. Now surfaced as a loud, explicit error and an honest
    // {ok:false} result distinguishable from a generic DB exception.
    const updated = await db
      .update(taskRegister)
      .set({
        executionReport: mergedReport as unknown as Record<string, unknown>,
        status,
        updatedAt: new Date(),
        completedAt: status === "completed" || status === "failed" ? new Date() : undefined,
      })
      .where(eq(taskRegister.taskId, taskId))
      .returning({ id: taskRegister.id })
    if (updated.length === 0) {
      console.error(`[task-register] recordExecutionReport: no task_register row exists for task_id="${taskId}" -- registerInstructionContract() likely failed earlier and was not checked by the caller. Execution Report NOT persisted.`)
      return { ok: false, mergedReport: null, status: null }
    }
    return { ok: true, mergedReport, status }
  } catch (error) {
    console.error(`[task-register] failed to record Execution Report for task_id="${taskId}" (non-fatal):`, error)
    return { ok: false, mergedReport: null, status: null }
  }
}

export async function getTaskRecord(taskId: string) {
  return db.query.taskRegister.findFirst({ where: eq(taskRegister.taskId, taskId) })
}
