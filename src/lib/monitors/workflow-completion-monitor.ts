// PLATFORM_STRATEGY.md section 29.3 Phase 1: the WORKFLOW_STARTED/
// WORKFLOW_COMPLETED slice of the ~28 remaining documented event types.
// Structurally identical to approval-decision-monitor.ts's own rule
// (createdAt vs a completion timestamp, compared to maxExecutionTimeMs) --
// approvalWorkflowInstances (schema.ts) is the ERP/procurement multi-step
// approval-workflow-instance mechanism (approval-workflow-service.ts),
// distinct from the plain approval_requests table Phase 0 already watches,
// but with the exact same createdAt/completedAt shape.
//
// Real call site: approval-workflow-service.ts's decideApprovalStep(), the
// one place an instance's status genuinely transitions out of 'pending'
// (either 'rejected' immediately, or 'approved' once its last step clears
// quorum via advanceWorkflow()) -- see that file's own call to
// runWorkflowCompletionMonitor() right after it computes instanceStatus.
// Registered under both 'workflow_started' and 'workflow_completed' event
// types (like approval_granted/approval_rejected both firing from one PATCH
// handler) even though the runtime check only fires at completion --
// there's no real per-event SLA to check at start time itself (an instance
// with zero applicable steps never gets created at all, per
// startApprovalWorkflow's own early return).
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { ServiceActor } from "@/lib/services/context"
import { resolveMonitorDef, runRuleEngineMonitor, type RuleEngineMonitorResult } from "./rule-engine-monitor"

export const WORKFLOW_COMPLETION_MONITOR_NAME = "workflow_completion_timeliness_monitor"

export type WorkflowCompletionMonitorInput = {
  instanceId: string
  entityType: string
  entityId: string
  status: "approved" | "rejected"
  createdAt: Date
  completedAt: Date
}

export async function runWorkflowCompletionMonitor(
  db: TenantDb,
  orgId: string,
  actor: ServiceActor,
  input: WorkflowCompletionMonitorInput,
  request?: Request
): Promise<RuleEngineMonitorResult> {
  const { maxExecutionTimeMs } = await resolveMonitorDef(db, WORKFLOW_COMPLETION_MONITOR_NAME)

  const decisionMs = input.completedAt.getTime() - input.createdAt.getTime()
  const withinRule = decisionMs <= maxExecutionTimeMs

  return runRuleEngineMonitor(db, orgId, actor, {
    monitorName: WORKFLOW_COMPLETION_MONITOR_NAME,
    entityType: "ApprovalWorkflowInstance",
    entityId: input.instanceId,
    worker: `ApprovalWorkflowInstance ${input.instanceId} (${input.entityType} ${input.entityId}, ${input.status})`,
    check: { withinRule, protocol: `decisionMs(${decisionMs}) <= maxExecutionTimeMs(${maxExecutionTimeMs})` },
    request,
  })
}
