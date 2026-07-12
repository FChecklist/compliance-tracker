// GAP-D1-METRICS-TARGET (ai-os/audit-tree/10-merged-tree.yaml D1.B1.S1,
// sources: ["01:Mission"]). Confirmed genuinely 0% before this wave: no
// dashboard/report anywhere tracked the AGCIF Mission's own numeric target
// against real data. Original source text, transcribed verbatim in
// ai-os/audit-tree/01-consutitution.yaml's "Mission" part (Consutitution.docx,
// Part 1):
//
//   "Objective: create an AI organization capable of highly predictable,
//   reliable, continuously improving execution while minimizing human
//   intervention"
//   "Success measured by: Predictability, Repeatability, Auditability,
//   Explainability, Continuous Improvement, Safe Autonomy"
//   "Target: 99.9% successful execution of all eligible tasks by
//   GPT-OSS-120B by 31 August 2026"
//
// This file builds ONE real, deterministic computation from data this
// codebase already collects -- zero new tracking infrastructure, same
// discipline as ai-performance-report-service.ts (whose notCovered pattern
// this file reuses verbatim, including reusing its two pure helpers below).
//
// Two genuinely different things live in the Mission text, kept as two
// separate sections rather than forced into one number:
//
//   1. The named 99.9%-by-31-Aug-2026 TARGET is specifically about
//      "successful execution ... by GPT-OSS-120B" -- i.e. the platform's
//      floor-tier model (orchestra-model-resolver.ts's PLATFORM_DEFAULT_MODEL,
//      "openai/gpt-oss-120b" on Groq, same model via Cerebras failover as
//      "gpt-oss-120b" -- see that file's own header, verified live against
//      each provider's /v1/models 2026-07-10). This is computed from TWO
//      real sources, since GPT-OSS-120B is dispatched through two
//      independent paths that don't share a table:
//        a. AI Team dispatches (src/lib/ai-team/roster.ts roles whose
//           `model` is the floor-tier model, e.g. tool_integration_engineer)
//           -- outcome comes from activity_log.lifecycleStage (real terminal
//           states: completed/failed/closed), roleKey join is model-tier-
//           eligibility.ts's own real constraint: GPT-OSS-120B is
//           mechanical-tier-only, so every dispatch to one of these roles IS
//           by construction an "eligible task" assigned to the floor tier --
//           no separate eligibility column needs to exist for this to be a
//           real, non-invented join.
//        b. Product Orchestra Layer calls that resolved to the floor tier
//           (orchestra_executions.model/status, written by every real call
//           via recordOrchestraExecution() -- orchestra-execution-logger.ts).
//      "denied" (policy-engine refusal, never reached the model) and "gated"
//      (model replied but ai-reply-gate.ts blocked showing it) both count
//      against success here, deliberately -- neither is a trustworthy
//      completed floor-tier answer, and softening that would inflate the
//      number this metric exists to keep honest.
//
//   2. The 6 NAMED success-measurement dimensions (Predictability/
//      Repeatability/Auditability/Explainability/Continuous Improvement/
//      Safe Autonomy) are mission-wide health measures, not floor-tier-
//      specific -- computed (where real data exists) across ALL
//      ai_team_dispatch activity, same posture as
//      activity-log-service.ts's getGovernanceHealthCounts().
//      Real, computed: Continuous Improvement (loop_improvements rows,
//      identical aggregation to ai-performance-report-service.ts's
//      `learning` section) and Auditability (activity_log terminal
//      dispatches that were actually flagged as needing independent review
//      -- confidenceBand in self_review_required/peer_review_required/
//      escalation_required, or riskLevel in high/critical -- vs. how many
//      of those actually got one: reviewDecision or executiveReviewedBy
//      set). Honestly NOT covered, each with a specific reason in
//      `namedMetrics.*.reason` rather than a silent omission or an invented
//      number:
//        - Predictability: no deterministic outcome-variance / expected-
//          vs-actual table exists; inventing a variance threshold here
//          would be exactly the fabricated-signal pattern this codebase's
//          guardrail discipline forbids (see this file's own precedent,
//          ai-performance-report-service.ts's notCovered list).
//        - Repeatability: no test-retest / same-input-same-output tracking
//          exists anywhere in schema.ts.
//        - Explainability: activity_log.selfAssessment is free-form jsonb,
//          not a structured/scored "was this explained" signal.
//        - Safe Autonomy: no persisted escalation-events table exists
//          (floor-tier-escalation.ts / escalation-ladder.ts are both
//          confirmed, in ai-performance-report-service.ts's own header, to
//          never write a queryable row) and the one real human-intervention
//          counter in the schema (assistant_metrics_daily.humanInterventions)
//          is scoped to VERI chat assistants, not AI Team dispatches --
//          reusing it here would silently conflate two different systems.
//
// Uses the raw `db` client (not withTenantContext) -- this is a
// cross-tenant, platform-governed report, same posture as
// ai-performance-report-service.ts and token-usage-service.ts.
import { db, activityLog, orchestraExecutions, loopImprovements } from "@/lib/db"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { AI_TEAM_ROSTER } from "@/lib/ai-team/roster"
import { averageNumericColumn } from "./ai-performance-report-service"

/** Same model, two provider ids -- orchestra-model-resolver.ts's PLATFORM_DEFAULT_MODEL ("openai/gpt-oss-120b" on Groq) and CEREBRAS_GPT_OSS_MODEL ("gpt-oss-120b", no "openai/" prefix, Cerebras's own failover host for the identical model). */
export const FLOOR_TIER_MODEL_IDS = ["openai/gpt-oss-120b", "gpt-oss-120b"] as const

export const D1_MISSION_TARGET_RATE = 0.999
export const D1_MISSION_DEADLINE_ISO = "2026-08-31T00:00:00.000Z"

/** roleKeys (roster.ts) whose assigned model is the floor tier -- the "eligible task assigned to the floor tier" set for the AI Team dispatch path. Recomputed from the live roster each call rather than hardcoded, so a future roster change is picked up automatically. */
export function floorTierRoleKeys(): string[] {
  return AI_TEAM_ROSTER.filter((r) => r.model !== null && (FLOOR_TIER_MODEL_IDS as readonly string[]).includes(r.model)).map((r) => r.roleKey)
}

const AI_TEAM_TERMINAL_STAGES = new Set(["completed", "failed", "closed"])
const AI_TEAM_FAILURE_STAGES = new Set(["failed"])
/** orchestra_executions.status is always terminal on write (see orchestra-execution-logger.ts's RecordOrchestraExecutionInput -- "pending" is only ever a column default, never actually persisted). "denied"/"gated" count against success here: neither is a trustworthy completed floor-tier answer -- see this file's header. */
const ORCHESTRA_FAILURE_STATUSES = new Set(["failed", "error", "denied", "gated"])
const REVIEW_REQUIRED_BANDS = new Set(["self_review_required", "peer_review_required", "escalation_required"])
const REVIEW_REQUIRED_RISK_LEVELS = new Set(["high", "critical"])

export type ExecutionOutcome = { total: number; successful: number; failed: number; successRate: number | null }

/**
 * Pure: turns terminal-stage counts into a success rate. `successRate` is
 * `null` (not 0) when there are zero terminal outcomes in the period --
 * "no data yet" and "0% success" must stay distinguishable to a reader of
 * this report, same discipline as this file's own averageNumericColumn
 * import (ai-performance-report-service.ts).
 */
export function computeExecutionOutcome(counts: { successful: number; failed: number }): ExecutionOutcome {
  const total = counts.successful + counts.failed
  return { total, successful: counts.successful, failed: counts.failed, successRate: total > 0 ? counts.successful / total : null }
}

/** Pure: splits a raw status/stage -> count map into successful vs failed using the given failure-status set, then delegates to computeExecutionOutcome. */
export function outcomeFromStatusCounts(statusCounts: Record<string, number>, failureStatuses: Set<string>): ExecutionOutcome {
  let successful = 0
  let failed = 0
  for (const [status, count] of Object.entries(statusCounts)) {
    if (failureStatuses.has(status)) failed += count
    else successful += count
  }
  return computeExecutionOutcome({ successful, failed })
}

export type TargetGap = { targetRate: number; currentRate: number | null; gapPercentagePoints: number | null; targetMet: boolean | null }

/** Pure: how far `successRate` is from the named 99.9% target, in percentage points. `null` throughout when there's no data yet, not a misleading 0-point gap. */
export function computeTargetGap(successRate: number | null, targetRate: number = D1_MISSION_TARGET_RATE): TargetGap {
  if (successRate === null) return { targetRate, currentRate: null, gapPercentagePoints: null, targetMet: null }
  const gapPercentagePoints = Math.round((targetRate - successRate) * 100 * 100) / 100
  return { targetRate, currentRate: successRate, gapPercentagePoints, targetMet: successRate >= targetRate }
}

export type DeadlineProximity = { deadlineIso: string; daysRemaining: number; isPastDeadline: boolean }

/** Pure: calendar-day distance from `now` to the named 31 Aug 2026 deadline. Rounds up (ceil) so "less than a day left" still reads as 1, not 0. */
export function computeDeadlineProximity(now: Date, deadlineIso: string = D1_MISSION_DEADLINE_ISO): DeadlineProximity {
  const deadline = new Date(deadlineIso)
  const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000)
  return { deadlineIso, daysRemaining, isPastDeadline: daysRemaining < 0 }
}

export type FloorTierTargetSection = {
  aiTeamDispatch: ExecutionOutcome & { gap: TargetGap; roleKeysIncluded: string[] }
  productOrchestra: ExecutionOutcome & { gap: TargetGap }
  combined: ExecutionOutcome & { gap: TargetGap }
}

export type CoveredMetric<T> = T & { covered: true }
export type NotCoveredMetric = { covered: false; reason: string }

export type NamedMetrics = {
  predictability: NotCoveredMetric
  repeatability: NotCoveredMetric
  auditability: CoveredMetric<{ reviewRequiredCount: number; reviewClosedCount: number; auditCoverageRate: number | null }> | NotCoveredMetric
  explainability: NotCoveredMetric
  continuousImprovement: CoveredMetric<{ improvementsGenerated: number; improvementsDeployed: number; improvementsRolledBack: number; avgImprovementDelta: number | null }>
  safeAutonomy: NotCoveredMetric
}

export type D1MetricsReport = {
  generatedAt: string
  sinceDays: number
  periodStart: string
  periodEnd: string
  mission: {
    sourceQuote: string
    targetRate: number
    deadline: DeadlineProximity
  }
  floorTierTarget: FloorTierTargetSection
  namedMetrics: NamedMetrics
}

const MISSION_SOURCE_QUOTE =
  "Target: 99.9% successful execution of all eligible tasks by GPT-OSS-120B by 31 August 2026 (Success measured by: Predictability, Repeatability, Auditability, Explainability, Continuous Improvement, Safe Autonomy)"

/** Real DB aggregation -- see this file's header for exactly which tables/columns each section reads, and which of the 6 named dimensions are honestly notCovered. */
export async function generateD1MetricsReport(days = 90): Promise<D1MetricsReport> {
  const periodEndDate = new Date()
  const periodStartDate = new Date(periodEndDate.getTime() - days * 86_400_000)
  const roleKeys = floorTierRoleKeys()

  const [aiTeamStageRows, orchestraStatusRows, reviewCountsRow, improvements] = await Promise.all([
    roleKeys.length > 0
      ? db.select({ lifecycleStage: activityLog.lifecycleStage, count: sql<number>`count(*)::int` })
          .from(activityLog)
          .where(and(
            eq(activityLog.activityType, "ai_team_dispatch"),
            inArray(activityLog.roleKey, roleKeys),
            gte(activityLog.createdAt, periodStartDate),
          ))
          .groupBy(activityLog.lifecycleStage)
      : Promise.resolve([]),
    db.select({ status: orchestraExecutions.status, count: sql<number>`count(*)::int` })
      .from(orchestraExecutions)
      .where(and(
        inArray(orchestraExecutions.model, [...FLOOR_TIER_MODEL_IDS]),
        gte(orchestraExecutions.createdAt, periodStartDate),
      ))
      .groupBy(orchestraExecutions.status),
    db.select({
        reviewRequiredCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} in ('completed', 'failed', 'closed') and (${activityLog.confidenceBand} in ('self_review_required', 'peer_review_required', 'escalation_required') or ${activityLog.riskLevel} in ('high', 'critical')))::int`,
        reviewClosedCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} in ('completed', 'failed', 'closed') and (${activityLog.confidenceBand} in ('self_review_required', 'peer_review_required', 'escalation_required') or ${activityLog.riskLevel} in ('high', 'critical')) and (${activityLog.reviewDecision} is not null or ${activityLog.executiveReviewedBy} is not null))::int`,
      })
      .from(activityLog)
      .where(and(eq(activityLog.activityType, "ai_team_dispatch"), gte(activityLog.createdAt, periodStartDate))),
    db.query.loopImprovements.findMany({ where: gte(loopImprovements.createdAt, periodStartDate) }),
  ])

  // --- floor-tier target section ---
  const aiTeamStageCounts: Record<string, number> = {}
  for (const row of aiTeamStageRows) aiTeamStageCounts[row.lifecycleStage] = row.count
  const aiTeamTerminalCounts = { successful: 0, failed: 0 }
  for (const [stage, count] of Object.entries(aiTeamStageCounts)) {
    if (!AI_TEAM_TERMINAL_STAGES.has(stage)) continue
    if (AI_TEAM_FAILURE_STAGES.has(stage)) aiTeamTerminalCounts.failed += count
    else aiTeamTerminalCounts.successful += count // 'completed' and 'closed' (closed-without-rejection) both count as a terminated, non-error outcome
  }
  const aiTeamOutcome = computeExecutionOutcome(aiTeamTerminalCounts)

  const orchestraStatusCounts: Record<string, number> = {}
  for (const row of orchestraStatusRows) orchestraStatusCounts[row.status] = row.count
  const orchestraOutcome = outcomeFromStatusCounts(orchestraStatusCounts, ORCHESTRA_FAILURE_STATUSES)

  const combinedOutcome = computeExecutionOutcome({
    successful: aiTeamOutcome.successful + orchestraOutcome.successful,
    failed: aiTeamOutcome.failed + orchestraOutcome.failed,
  })

  const floorTierTarget: FloorTierTargetSection = {
    aiTeamDispatch: { ...aiTeamOutcome, gap: computeTargetGap(aiTeamOutcome.successRate), roleKeysIncluded: roleKeys },
    productOrchestra: { ...orchestraOutcome, gap: computeTargetGap(orchestraOutcome.successRate) },
    combined: { ...combinedOutcome, gap: computeTargetGap(combinedOutcome.successRate) },
  }

  // --- named metrics ---
  const reviewCounts = reviewCountsRow[0] ?? { reviewRequiredCount: 0, reviewClosedCount: 0 }
  const auditability: NamedMetrics["auditability"] =
    reviewCounts.reviewRequiredCount > 0
      ? { covered: true, reviewRequiredCount: reviewCounts.reviewRequiredCount, reviewClosedCount: reviewCounts.reviewClosedCount, auditCoverageRate: reviewCounts.reviewClosedCount / reviewCounts.reviewRequiredCount }
      : { covered: false, reason: "No ai_team_dispatch rows in this period were flagged as requiring independent review (confidence_band in self_review_required/peer_review_required/escalation_required, or risk_level high/critical) -- auditCoverageRate is undefined with an empty denominator rather than a misleading 0% or 100%." }

  const namedMetrics: NamedMetrics = {
    predictability: { covered: false, reason: "No deterministic outcome-variance / expected-vs-actual table exists in this schema. Inventing a variance threshold to fill this in would be exactly the fabricated-signal pattern this codebase's guardrail discipline forbids (see ai-performance-report-service.ts's own notCovered precedent)." },
    repeatability: { covered: false, reason: "No test-retest / same-input-same-output tracking exists anywhere in schema.ts -- there is no real signal to aggregate." },
    auditability,
    explainability: { covered: false, reason: "activity_log.selfAssessment is free-form jsonb (the executing role's own unstructured self-report), not a structured or scored 'was this explained to a reviewer' signal -- no deterministic measure exists." },
    continuousImprovement: {
      covered: true,
      improvementsGenerated: improvements.length,
      improvementsDeployed: improvements.filter((i) => i.isDeployed).length,
      improvementsRolledBack: improvements.filter((i) => i.rollbackTriggered).length,
      avgImprovementDelta: averageNumericColumn(improvements.map((i) => i.improvementDelta)),
    },
    safeAutonomy: { covered: false, reason: "No persisted escalation-events table exists (floor-tier-escalation.ts / escalation-ladder.ts never write a queryable row -- confirmed in ai-performance-report-service.ts's own header) and the schema's one real human-intervention counter (assistant_metrics_daily.humanInterventions) is scoped to VERI chat assistants, not AI Team dispatches -- reusing it here would silently conflate two different systems rather than measure this dimension honestly." },
  }

  return {
    generatedAt: periodEndDate.toISOString(),
    sinceDays: days,
    periodStart: periodStartDate.toISOString(),
    periodEnd: periodEndDate.toISOString(),
    mission: {
      sourceQuote: MISSION_SOURCE_QUOTE,
      targetRate: D1_MISSION_TARGET_RATE,
      deadline: computeDeadlineProximity(periodEndDate),
    },
    floorTierTarget,
    namedMetrics,
  }
}
