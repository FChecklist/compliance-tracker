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

import { db, taskRegister } from "@/lib/db"
import { eq } from "drizzle-orm"
import type { SoftwareTeamLevel } from "./software-team-ladder"
import type { InstructionContract, ExecutionReport } from "./instruction-contract"

export type TaskRegisterStatus = "pending" | "in_progress" | "completed" | "failed" | "escalated"

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

/**
 * Records (or accumulates onto) a task's Execution Report AFTER a dispatch
 * step runs. When a row for this task_id already carries steps (an L2/L3
 * multi-step workflow's earlier sequential dispatch calls), the new
 * report's steps are appended to the existing ones rather than replacing
 * them -- so a task_id reused across several dispatch calls accumulates
 * one growing Execution Report, matching the Owner's Two/Three/Multi Step
 * examples (each a single report covering every step performed so far).
 */
export async function recordExecutionReport(
  taskId: string,
  report: ExecutionReport,
  status: TaskRegisterStatus
): Promise<boolean> {
  try {
    const existing = await db.query.taskRegister.findFirst({ where: eq(taskRegister.taskId, taskId) })
    const priorReport = existing?.executionReport as ExecutionReport | null | undefined
    const mergedReport: ExecutionReport = priorReport
      ? {
          ...report,
          steps: [...priorReport.steps, ...report.steps],
          missing: [...new Set([...priorReport.missing, ...report.missing])],
          warnings: [...new Set([...priorReport.warnings, ...report.warnings])],
          errors: [...new Set([...priorReport.errors, ...report.errors])],
        }
      : report

    await db
      .update(taskRegister)
      .set({
        executionReport: mergedReport as unknown as Record<string, unknown>,
        status,
        updatedAt: new Date(),
        completedAt: status === "completed" || status === "failed" ? new Date() : undefined,
      })
      .where(eq(taskRegister.taskId, taskId))
    return true
  } catch (error) {
    console.error(`[task-register] failed to record Execution Report for task_id="${taskId}" (non-fatal):`, error)
    return false
  }
}

export async function getTaskRecord(taskId: string) {
  return db.query.taskRegister.findFirst({ where: eq(taskRegister.taskId, taskId) })
}
