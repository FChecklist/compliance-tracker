// PLATFORM_STRATEGY.md section 29.3 Phase 1: expands the Tier-1 rule-engine
// Narrow Monitor mechanism (Phase 0, approval-decision-monitor.ts) beyond
// APPROVAL_GRANTED/APPROVAL_REJECTED to every other event this phase wires.
//
// approval-decision-monitor.ts's own body is registry-lookup + build report
// + validateMonitorReportFields() + (if escalate) claimEscalation() +
// logActivity() -- exactly the same 5 steps every Phase-1 event needs, with
// only the deterministic rule comparison itself (the "pure subtraction and
// comparison" approval-decision-monitor.ts's own header describes) differing
// per event. This file factors that shared shape into one function so each
// new event gets a small, event-specific file that computes its own
// RuleEngineCheck from real columns and calls runRuleEngineMonitor() --
// not a new architecture, the same mechanism Phase 0 proved, reused instead
// of copy-pasted 5+ times. approval-decision-monitor.ts itself is left
// untouched (already merged, audited PASS, tested) -- this is purely
// additive.
import { monitorAgents } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { validateMonitorReportFields, type MonitorReportFields } from "@/lib/monitor-protocol"
import { claimEscalation, type EscalationClaimResult } from "@/lib/escalation-ladder"
import { logActivity } from "@/lib/audit"
import type { ServiceActor } from "@/lib/services/context"

// Mirrors approval-decision-monitor.ts's own fail-safe-default comment
// exactly -- used only if a given monitor's seeded monitor_agents row hasn't
// been applied to this DB yet, so the monitor still runs deterministically
// rather than silently no-op'ing. Never diverges from the seed on a DB where
// the migration HAS run, since the registry row is read first and always
// wins.
export const FALLBACK_MAX_EXECUTION_TIME_MS = 86_400_000 // 24h
export const FALLBACK_TIMEOUT_MS = 21_600_000 // 6h
export const FALLBACK_MAX_RETRY = 3

export type MonitorDef = {
  maxExecutionTimeMs: number
  timeoutMs: number
  maxRetry: number
  isActive: boolean
}

export const DEFAULT_MONITOR_DEF: MonitorDef = {
  maxExecutionTimeMs: FALLBACK_MAX_EXECUTION_TIME_MS,
  timeoutMs: FALLBACK_TIMEOUT_MS,
  maxRetry: FALLBACK_MAX_RETRY,
  isActive: true,
}

/**
 * Looks up a monitor_agents row by name, merging real column values over
 * `fallback` field-by-field (never all-or-nothing) so a partially-seeded row
 * still behaves correctly. Exported so an event-specific monitor file can
 * call this itself to read maxExecutionTimeMs BEFORE computing its own rule
 * comparison -- runRuleEngineMonitor() below reads the same row again for
 * isActive/maxRetry/timeoutMs, a second small lookup on this tiny,
 * platform-wide (no RLS), rarely-changing table rather than threading an
 * already-fetched row through both layers.
 */
export async function resolveMonitorDef(db: TenantDb, monitorName: string, fallback: MonitorDef = DEFAULT_MONITOR_DEF): Promise<MonitorDef> {
  const def = await db.query.monitorAgents.findFirst({ where: eq(monitorAgents.name, monitorName) })
  return {
    maxExecutionTimeMs: def?.maxExecutionTimeMs ?? fallback.maxExecutionTimeMs,
    timeoutMs: def?.timeoutMs ?? fallback.timeoutMs,
    maxRetry: def?.maxRetry ?? fallback.maxRetry,
    isActive: def?.isActive ?? fallback.isActive,
  }
}

/** The one deterministic YES/NO verdict an event-specific monitor file computes from its own real columns -- no business reasoning beyond a single comparison, per 29's own "one instruction, one YES/NO decision" definition. */
export type RuleEngineCheck = {
  /** true = rule satisfied (report status 'ok'); false = rule violated (report status 'escalate'). */
  withinRule: boolean
  /** Traceable description of the exact comparison made, e.g. "decisionMs(1200) <= maxExecutionTimeMs(86400000)" -- same convention as MonitorReportFields.protocol. */
  protocol: string
}

export type RuleEngineMonitorParams = {
  monitorName: string
  entityType: string
  entityId: string
  worker: string
  check: RuleEngineCheck
  request?: Request
}

export type RuleEngineMonitorResult = {
  report: MonitorReportFields
  claim: EscalationClaimResult | null
}

/**
 * Runs one Tier-1 rule-engine monitor against an already-computed
 * RuleEngineCheck. Must run inside the same withTenantContext transaction as
 * the real state change being monitored (same posture as
 * runApprovalDecisionMonitor) -- pass the same `db`/`orgId` the caller's own
 * transaction already opened. Never throws: a malformed report or a
 * rejected escalation claim is logged, not thrown, so this can never block
 * the real write the caller already committed.
 */
export async function runRuleEngineMonitor(
  db: TenantDb,
  orgId: string,
  actor: ServiceActor,
  params: RuleEngineMonitorParams
): Promise<RuleEngineMonitorResult> {
  const { isActive, maxRetry, timeoutMs } = await resolveMonitorDef(db, params.monitorName)

  const status: MonitorReportFields["status"] = params.check.withinRule ? "ok" : "escalate"
  const action: MonitorReportFields["action"] = params.check.withinRule ? "none" : "escalate"

  const report: MonitorReportFields = {
    status,
    worker: params.worker,
    protocol: `${params.monitorName}: ${params.check.protocol}`,
    confidence: 100,
    action,
  }

  const validation = validateMonitorReportFields(report)
  if (!validation.valid) {
    // The monitor's OWN output failing its own contract is a defect in the
    // calling event-specific file, not in the entity being monitored -- fail
    // closed by logging it rather than silently trusting an invalid report.
    await logActivity({
      tx: db, action: "monitor.report_invalid", entityType: params.entityType, entityId: params.entityId, orgId, ...actor, request: params.request,
      details: `${params.monitorName} produced an invalid MonitorReportFields report: ${validation.reason}`,
    })
    return { report, claim: null }
  }

  if (!isActive || status === "ok") {
    return { report, claim: null }
  }

  // Rule failed and the monitor is active -- escalate via the extended
  // ladder (single-owner lock + persisted retry/timeout counter enforced
  // inside claimEscalation()). "monitoring_rule_violation" mirrors
  // approval-decision-monitor.ts's own reasoning exactly: a Tier-1 rule
  // firing 'escalate' is a governance/policy-timing concern, not a code
  // defect, so it starts at COO like every other monitoring trigger in
  // escalation-ladder.ts.
  const claim = await claimEscalation(db, {
    orgId,
    taskId: params.entityId,
    monitorName: params.monitorName,
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
    tx: db, action: "monitor.escalation", entityType: params.entityType, entityId: params.entityId, orgId, ...actor, request: params.request,
    details: `${params.monitorName}: ${params.worker} -- ${params.check.protocol}. ${detailsSuffix}`,
  })

  return { report, claim }
}
