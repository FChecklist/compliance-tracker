// PLATFORM_STRATEGY.md section 29.3, Phase 0: the one real Tier-1
// rule-engine monitor this phase wires end-to-end, proven on
// APPROVAL_GRANTED/APPROVAL_REJECTED only -- see src/app/api/approvals/
// [id]/route.ts's PATCH handler for the real call site, right next to the
// existing recordAuditTrigger('sop_changed', ...) call this mirrors the
// posture of (record now, inside the same transaction, never block the
// real approval decision the caller already committed).
//
// Rule (deterministic, genuinely checkable from real columns, per this
// phase's own "do not invent business logic that doesn't map to real
// columns" scope): was the decision made within the monitor's registered
// maxExecutionTimeMs of the request being created? approval_requests
// already has both createdAt and resolvedAt (schema.ts) -- no new column
// needed. Zero LLM calls -- a single subtraction and comparison.
import { monitorAgents, type users } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { validateMonitorReportFields, type MonitorReportFields } from "@/lib/monitor-protocol"
import { claimEscalation, type EscalationClaimResult } from "@/lib/escalation-ladder"
import { logActivity } from "@/lib/audit"

export const APPROVAL_DECISION_MONITOR_NAME = "approval_decision_timeliness_monitor"

// Mirrors monitor_agents' seeded row (drizzle/0173) -- used only as a
// fail-safe default if that row hasn't been applied to this DB yet, so the
// monitor still runs deterministically rather than silently no-op'ing.
// Never diverges from the seed on a DB where the migration HAS run, since
// the registry row is read first and always wins.
const FALLBACK_MAX_EXECUTION_TIME_MS = 86_400_000 // 24h
const FALLBACK_TIMEOUT_MS = 21_600_000 // 6h
const FALLBACK_MAX_RETRY = 3

export type ApprovalDecisionMonitorInput = {
  approvalRequestId: string
  requestType: string
  createdAt: Date
  resolvedAt: Date
  decision: "approve" | "reject"
  decidedByUserId: string
}

export type ApprovalDecisionMonitorResult = {
  report: MonitorReportFields
  claim: EscalationClaimResult | null
}

/**
 * Runs the one Phase-0 rule-engine monitor against a real approval decision.
 * Must run inside the same withTenantContext transaction as the approval
 * decision itself (same posture as recordAuditTrigger) -- pass the same
 * `db`/`orgId` the caller's PATCH handler already opened. Never throws:
 * a malformed report or a rejected escalation claim is logged, not thrown,
 * so this can never block the real approval decision.
 */
export async function runApprovalDecisionMonitor(
  db: TenantDb,
  orgId: string,
  dbUser: typeof users.$inferSelect,
  input: ApprovalDecisionMonitorInput,
  request?: Request
): Promise<ApprovalDecisionMonitorResult> {
  const def = await db.query.monitorAgents.findFirst({ where: eq(monitorAgents.name, APPROVAL_DECISION_MONITOR_NAME) })
  const maxExecutionTimeMs = def?.maxExecutionTimeMs ?? FALLBACK_MAX_EXECUTION_TIME_MS
  const timeoutMs = def?.timeoutMs ?? FALLBACK_TIMEOUT_MS
  const maxRetry = def?.maxRetry ?? FALLBACK_MAX_RETRY
  const isActive = def?.isActive ?? true

  const decisionMs = input.resolvedAt.getTime() - input.createdAt.getTime()
  const withinSla = decisionMs <= maxExecutionTimeMs
  const status: MonitorReportFields["status"] = withinSla ? "ok" : "escalate"
  const action: MonitorReportFields["action"] = withinSla ? "none" : "escalate"

  const report: MonitorReportFields = {
    status,
    worker: `ApprovalRequest ${input.approvalRequestId} (${input.requestType}, ${input.decision}d by user ${input.decidedByUserId})`,
    protocol: `${APPROVAL_DECISION_MONITOR_NAME}: decisionMs(${decisionMs}) <= maxExecutionTimeMs(${maxExecutionTimeMs})`,
    confidence: 100,
    action,
  }

  const validation = validateMonitorReportFields(report)
  if (!validation.valid) {
    // The monitor's OWN output failing its own contract is a defect in this
    // module, not in the approval decision -- fail closed by logging it
    // rather than silently trusting an invalid report or throwing into the
    // caller's real approval-decision transaction.
    await logActivity({
      tx: db, action: "monitor.report_invalid", entityType: "ApprovalRequest", entityId: input.approvalRequestId, orgId, dbUser, request,
      details: `${APPROVAL_DECISION_MONITOR_NAME} produced an invalid MonitorReportFields report: ${validation.reason}`,
    })
    return { report, claim: null }
  }

  if (!isActive || status === "ok") {
    return { report, claim: null }
  }

  // Rule failed and the monitor is active -- escalate via the extended
  // ladder (single-owner lock + persisted retry/timeout counter enforced
  // inside claimEscalation()). "monitoring_rule_violation" is the existing
  // EscalationReason this shape already maps to (escalation-ladder.ts's own
  // doc comment: "a Dynamic Chain's monitoringRules fired an 'escalate'-
  // action rule -- a governance/policy trigger, not a code defect" -- a
  // late approval decision is exactly that, not a software defect).
  const claim = await claimEscalation(db, {
    orgId,
    taskId: input.approvalRequestId,
    monitorName: APPROVAL_DECISION_MONITOR_NAME,
    context: { reason: "monitoring_rule_violation" },
    maxRetry,
    timeoutMs,
  })

  const detailsSuffix =
    claim.claimed
      ? `Escalated to ${claim.rung.title} (${claim.rung.authority}), retry ${claim.retryCount}/${maxRetry}.`
      : claim.reason === "already_owned_by_other_agent"
        ? `Escalation claim rejected -- already owned by ${claim.ownerRoleKey} (single-owner lock).`
        : `Escalation claim rejected -- retry ${claim.retryCount}/${claim.maxRetry} exhausted, no further automatic retries.`

  await logActivity({
    tx: db, action: "monitor.escalation", entityType: "ApprovalRequest", entityId: input.approvalRequestId, orgId, dbUser, request,
    details: `${APPROVAL_DECISION_MONITOR_NAME}: decision took ${decisionMs}ms, exceeding the ${maxExecutionTimeMs}ms SLA (reason: monitoring_rule_violation, task_id: ${input.approvalRequestId}). ${detailsSuffix}`,
  })

  return { report, claim }
}
