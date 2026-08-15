// PLATFORM_STRATEGY.md section 29.3 Phase 1: the TASK_CREATED/
// TASK_COMPLETED slice of the ~28 remaining documented event types.
//
// `tasks` (schema.ts) has no dedicated `completedAt` column -- completion is
// inferred only from `status === 'completed'`, timestamped by `updatedAt`
// (see task-service.ts's own updateTask(), which already isolates the exact
// transition moment via didFeatureComplete() for its own feature_completed
// audit trigger). The one real, deterministic SLA available without
// inventing a column: was the task marked completed on or before its own
// `dueDate`, when a dueDate was actually set. A task with no dueDate has no
// SLA to violate, so it's trivially 'ok' (matches this codebase's existing
// "no rule to check" convention rather than fabricating one).
//
// Real call site: task-service.ts's updateTask(), right after the existing
// feature_completed recordAuditTrigger() call -- fires on the same real
// transition, no new call site invented.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { ServiceActor } from "@/lib/services/context"
import { runRuleEngineMonitor, type RuleEngineMonitorResult } from "./rule-engine-monitor"

export const TASK_COMPLETION_MONITOR_NAME = "task_completion_timeliness_monitor"

export type TaskCompletionMonitorInput = {
  taskId: string
  title: string
  dueDate: Date | null
  completedAt: Date
}

export async function runTaskCompletionMonitor(
  db: TenantDb,
  orgId: string,
  actor: ServiceActor,
  input: TaskCompletionMonitorInput,
  request?: Request
): Promise<RuleEngineMonitorResult> {
  // No dueDate set -- no SLA to violate. Deterministic, not fuzzy: this is
  // the same "trivially true, nothing to escalate" posture a rule engine
  // gives a row with no applicable comparison, not a guess.
  const withinRule = input.dueDate === null || input.completedAt.getTime() <= input.dueDate.getTime()
  const protocol =
    input.dueDate === null
      ? "no dueDate set -- no completion SLA applies"
      : `completedAt(${input.completedAt.toISOString()}) <= dueDate(${input.dueDate.toISOString()})`

  return runRuleEngineMonitor(db, orgId, actor, {
    monitorName: TASK_COMPLETION_MONITOR_NAME,
    entityType: "Task",
    entityId: input.taskId,
    worker: `Task ${input.taskId} ("${input.title}")`,
    check: { withinRule, protocol },
    request,
  })
}
