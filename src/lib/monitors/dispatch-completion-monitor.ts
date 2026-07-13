// PLATFORM_STRATEGY.md 29.3 Phase 1+2 / 31.4 Phase B: generalizes the
// Narrow Monitor Agent mechanism (Phase 0, approval-decision-monitor.ts)
// beyond APPROVAL_GRANTED/APPROVAL_REJECTED to watch AI Dev Team dispatch
// completion generally, and wires the first Tier-3 (GPT-OSS-120B-backed)
// executor 29.3 itself scoped but never built.
//
// Input: listStuckActivities() (activity-log-service.ts, PR #250) --
// activity_log rows the real /api/ai/team/dispatch pipeline has left in a
// non-terminal lifecycle_stage (requested/classified/validated/executing/
// reviewing) for longer than a threshold. Detection already existed;
// nothing acted on it before this file (31.1 row 5's named gap).
//
// Why a model call here and not a Tier-1 rule (unlike approval-decision-
// monitor.ts's pure subtraction): "does this dispatch show real signs of
// completion, or does it look abandoned" is not reducible to one column
// comparison. The one structured signal available -- activity_log.
// self_assessment, a HandoverFields-shaped jsonb populated by
// buildDispatchSelfAssessment() (qa-precompletion-gate.ts) at dispatch
// time -- may be null, partial, or present, and a stuck row can be stuck
// at any of 5 different lifecycle stages, each implying a different
// completion picture. This is exactly 29.2's "genuinely needs language
// understanding" carve-out and 31.2's proven-good GPT-OSS-120B task shape:
// read a status, compare against a narrow rubric, emit one of a handful of
// structured fields -- never asked to fix, judge code quality, or write
// anything. See 31.2/31.3 for the full reasoning this file does not repeat.
//
// Model call: resolvePlatformModelConfig("meta_oa") + callLLMJson() -- the
// exact precedent loop-engineering-audit.ts already established for "the
// platform's own meta-loop reasoning about its own health" (this monitor
// IS that: it observes OTHER AI agents' dispatch work, not a customer
// workflow). Resolves to PLATFORM_DEFAULT_MODEL ("openai/gpt-oss-120b" via
// Groq, orchestra-model-resolver.ts) with the existing Cerebras same-model
// failover (platformFallbackFor()) -- zero new HTTP plumbing, zero new
// provider wiring.
//
// Output contract: reused, not reinvented. The model's raw JSON reply is
// parsed straight into Partial<MonitorReportFields> and run through the
// SAME validateMonitorReportFields() gate every Tier-1 report already goes
// through (monitor-protocol.ts) -- this file adds no second validator. A
// model output that fails that gate (malformed, placeholder, ambiguous) --
// OR a model call that throws at all (no platform config, network/HTTP
// failure, invalid JSON) -- is itself a signal something's wrong, so BOTH
// cases fail closed to a synthetic status: escalate report, never silently
// dropped. Escalation itself still runs through the unmodified
// claimEscalation()/evaluateEscalationClaim() single-owner lock
// (escalation-ladder.ts) -- no second escalation path.
//
// What GPT-OSS-120B does NOT gain: it cannot approve, reject, merge, or
// edit anything. Its only possible output is one of the 5
// MonitorReportFields; every downstream action (log, claim an escalation
// rung) is deterministic code reacting to those 5 fields as if a human or
// a Tier-1 rule had produced them -- the model is not trusted more than
// that.
import { activityLog, monitorAgents, type users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { validateMonitorReportFields, type MonitorReportFields } from "@/lib/monitor-protocol"
import { claimEscalation, type EscalationClaimResult } from "@/lib/escalation-ladder"
import { logActivity } from "@/lib/audit"
import { resolvePlatformModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { listStuckActivities } from "@/lib/activity-log-service"

export const DISPATCH_COMPLETION_MONITOR_NAME = "dispatch_completion_monitor"

// Registered in prompt_templates/prompt_versions by drizzle/0174 -- see
// that migration's own header for why it's not applied automatically.
export const DISPATCH_COMPLETION_PROMPT_KEY = "monitor.dispatch_completion_classification"

// Mirrors approval-decision-monitor.ts's own fail-safe-default comment
// exactly -- used only if monitor_agents' seeded row (drizzle/0174) hasn't
// been applied to this DB yet, so the monitor still runs deterministically
// rather than silently no-op'ing. Never diverges from the seed on a DB
// where the migration HAS run, since the registry row is read first and
// always wins.
const FALLBACK_MAX_EXECUTION_TIME_MS = 86_400_000 // 24h, matches governance-health route's STUCK_THRESHOLD_MS default
const FALLBACK_TIMEOUT_MS = 21_600_000 // 6h
const FALLBACK_MAX_RETRY = 3

export type StuckActivity = typeof activityLog.$inferSelect

export type DispatchCompletionMonitorResult = {
  activityId: string
  report: MonitorReportFields
  claim: EscalationClaimResult | null
  /** True when the model call itself failed (no platform config, HTTP error, malformed JSON) rather than merely returning an incomplete report -- surfaced separately so a caller can distinguish "GPT-OSS-120B said escalate" from "GPT-OSS-120B never actually answered." */
  modelCallFailed: boolean
  /** False when the model's raw output (or the absence of one) failed validateMonitorReportFields() and `report` above is the synthetic fail-closed escalate report this file forced, rather than the model's real classification. */
  reportValid: boolean
}

function ageHours(activity: StuckActivity): number {
  return Math.max(0, Math.round((Date.now() - activity.updatedAt.getTime()) / 3_600_000))
}

/**
 * Renders everything genuinely known about a stuck dispatch, using ONLY
 * real, persisted fields -- never inventing a value the pipeline didn't
 * actually record. Deliberately narrow: task-tightening.ts's full TightTask
 * shape (scope/successCriteria/expectedOutput/constraints) is assembled
 * in-memory by POST /api/ai/team/dispatch and discarded after the model
 * call -- it is never persisted to activity_log -- so a genuinely stuck row
 * legitimately has only `objective` + `complexityTier` from that shape, not
 * the full brief. Reported here as "(not recorded)", never guessed at.
 * Exported for direct unit testing of the rendered shape.
 */
export function describeStuckDispatch(activity: StuckActivity): string {
  const lines = [
    `Activity log id: ${activity.id}`,
    `Activity type: ${activity.activityType}`,
    `Lifecycle stage (non-terminal -- this dispatch is stuck here): ${activity.lifecycleStage}`,
    `Hours since last update: ${ageHours(activity)}`,
    `Objective: ${activity.objective ?? "(not recorded)"}`,
    `Complexity tier: ${activity.complexityTier ?? "(not recorded)"}`,
    `Assigned role_key: ${activity.roleKey ?? "(not recorded -- classification may never have completed)"}`,
    `Error reason on file: ${activity.errorReason ?? "(none)"}`,
  ]
  if (activity.selfAssessment && typeof activity.selfAssessment === "object") {
    lines.push(
      `Self-reported handover (HandoverFields shape, from the executing role itself -- NOT independently verified): ${JSON.stringify(activity.selfAssessment)}`
    )
  } else {
    lines.push("Self-reported handover: none recorded -- no handover-protocol.ts-shaped self-assessment exists for this dispatch.")
  }
  return lines.join("\n")
}

type ClassificationOutcome = { fields: Partial<MonitorReportFields>; modelCallFailed: boolean }

/**
 * The one model call this file makes. Never throws -- any failure (no
 * platform model configured, HTTP/network error, malformed/non-JSON reply,
 * missing expected keys) is caught and reported back as an incomplete
 * `fields` object plus `modelCallFailed: true`, which the caller feeds
 * through the SAME validateMonitorReportFields() gate a real-but-invalid
 * model reply would hit -- one fail-closed path, not two.
 */
async function classifyDispatchCompletion(activity: StuckActivity): Promise<ClassificationOutcome> {
  try {
    const modelConfig = await resolvePlatformModelConfig("meta_oa")
    if (!modelConfig) {
      console.error(`${DISPATCH_COMPLETION_MONITOR_NAME}: no platform model configured for the meta_oa layer -- failing closed to escalate for activity ${activity.id}.`)
      return { fields: {}, modelCallFailed: true }
    }

    const systemPrompt = await resolvePromptTemplate(DISPATCH_COMPLETION_PROMPT_KEY)
    const { data } = await callLLMJson<Partial<MonitorReportFields>>(
      modelConfig.provider,
      modelConfig.model,
      modelConfig.apiKey,
      systemPrompt,
      describeStuckDispatch(activity),
      { temperature: 0, maxTokens: 300, expectedKeys: ["status", "worker", "protocol", "confidence", "action"] },
      modelConfig.fallback
    )
    return { fields: data, modelCallFailed: false }
  } catch (err) {
    console.error(`${DISPATCH_COMPLETION_MONITOR_NAME}: model call failed for activity ${activity.id} -- failing closed to escalate:`, err)
    return { fields: {}, modelCallFailed: true }
  }
}

/**
 * Runs the Tier-3 dispatch-completion monitor against one stuck activity.
 * Must run inside the same withTenantContext transaction the caller
 * already opened (same posture as runApprovalDecisionMonitor) -- see
 * runDispatchCompletionSweep() below for the real batch call site. Never
 * throws: a failed model call, an invalid report, or a rejected escalation
 * claim is logged, not thrown.
 */
export async function runDispatchCompletionMonitor(
  db: TenantDb,
  orgId: string,
  dbUser: typeof users.$inferSelect,
  activity: StuckActivity,
  request?: Request
): Promise<DispatchCompletionMonitorResult> {
  const def = await db.query.monitorAgents.findFirst({ where: eq(monitorAgents.name, DISPATCH_COMPLETION_MONITOR_NAME) })
  const maxRetry = def?.maxRetry ?? FALLBACK_MAX_RETRY
  const timeoutMs = def?.timeoutMs ?? FALLBACK_TIMEOUT_MS
  const isActive = def?.isActive ?? true

  const { fields, modelCallFailed } = await classifyDispatchCompletion(activity)
  const validation = validateMonitorReportFields(fields)

  const workerLabel = `ActivityLog ${activity.id} (${activity.activityType}, stage=${activity.lifecycleStage}, role=${activity.roleKey ?? "unassigned"})`

  let report: MonitorReportFields
  if (!validation.valid) {
    // The model's own output failing validateMonitorReportFields() -- or
    // the model call never producing output at all -- is a defect in the
    // classification attempt, not evidence the dispatch is fine. Fail
    // closed by forcing status: escalate rather than silently trusting an
    // invalid/absent report or throwing into the caller's sweep.
    report = {
      status: "escalate",
      worker: workerLabel,
      protocol: `${DISPATCH_COMPLETION_MONITOR_NAME}: ${modelCallFailed ? "model call failed, no classification produced" : "model output failed validateMonitorReportFields()"} -- ${validation.reason}`,
      confidence: 0,
      action: "escalate",
    }
    await logActivity({
      tx: db, action: "monitor.report_invalid", entityType: "ActivityLog", entityId: activity.id, orgId, dbUser, request,
      details: `${DISPATCH_COMPLETION_MONITOR_NAME} produced an invalid MonitorReportFields report for activity ${activity.id}: ${validation.reason}`,
    })
  } else {
    // Normalize casing exactly like handover-protocol.ts's submitHandover()
    // does for its own enum fields before persisting -- validateMonitor
    // ReportFields() itself accepts "OK"/"Escalate" case-insensitively
    // (monitor-protocol.test.ts's own "case-insensitive" case), but every
    // downstream comparison in this file (`=== "ok"`, `=== "escalate"`) is
    // a strict lowercase match, so the report actually acted on must be
    // normalized, not just validated.
    report = {
      status: (fields.status ?? "").trim().toLowerCase(),
      worker: (fields.worker ?? "").trim(),
      protocol: (fields.protocol ?? "").trim(),
      confidence: fields.confidence as number,
      action: (fields.action ?? "").trim().toLowerCase(),
    }
  }

  if (!isActive || report.status === "ok") {
    return { activityId: activity.id, report, claim: null, modelCallFailed, reportValid: validation.valid }
  }

  // report.status === "escalate" (either the model classified it that way,
  // or the forced fail-closed report above) and the monitor is active --
  // escalate via the extended ladder (single-owner lock + persisted
  // retry/timeout counter enforced inside claimEscalation()).
  // "monitoring_rule_violation" mirrors approval-decision-monitor.ts's own
  // reasoning: a dispatch that never produced real completion signals is a
  // governance/policy concern (the pipeline's own monitoring rule fired),
  // not a code defect, so it starts at COO like every other monitoring
  // trigger in escalation-ladder.ts.
  const claim = await claimEscalation(db, {
    orgId,
    taskId: activity.id,
    monitorName: DISPATCH_COMPLETION_MONITOR_NAME,
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
    tx: db, action: "monitor.escalation", entityType: "ActivityLog", entityId: activity.id, orgId, dbUser, request,
    details: `${DISPATCH_COMPLETION_MONITOR_NAME}: ${workerLabel} classified as escalate (${report.protocol}). ${detailsSuffix}`,
  })

  return { activityId: activity.id, report, claim, modelCallFailed, reportValid: validation.valid }
}

export type DispatchCompletionSweepResult = {
  checked: number
  ok: number
  escalated: number
  invalidReports: number
  results: DispatchCompletionMonitorResult[]
}

/**
 * The real batch call site: reads listStuckActivities() (its own separate,
 * read-only withTenantContext), then runs the monitor over every row found
 * inside one fresh withTenantContext -- same "two separate service calls,
 * no shared tx" posture governance-health's GET handler already uses. This
 * is what src/app/api/ai/team/monitor/dispatch-completion/route.ts calls;
 * exported here as a plain function so it's independently testable and
 * triggerable from anywhere else (a future cron), not tied to that one route.
 */
export async function runDispatchCompletionSweep(
  orgId: string,
  dbUser: typeof users.$inferSelect,
  staleAfterMs: number,
  request?: Request
): Promise<DispatchCompletionSweepResult> {
  const stuck = await listStuckActivities(orgId, staleAfterMs)
  if (stuck.length === 0) {
    return { checked: 0, ok: 0, escalated: 0, invalidReports: 0, results: [] }
  }

  return withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const results: DispatchCompletionMonitorResult[] = []
    for (const activity of stuck) {
      results.push(await runDispatchCompletionMonitor(db, orgId, dbUser, activity, request))
    }
    const ok = results.filter((r) => r.report.status === "ok").length
    const escalated = results.filter((r) => r.report.status === "escalate" && r.claim?.claimed).length
    const invalidReports = results.filter((r) => !r.reportValid).length
    return { checked: stuck.length, ok, escalated, invalidReports, results }
  })
}
