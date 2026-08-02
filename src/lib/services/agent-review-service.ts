// GAP-AI-WORKFORCE-GOVERNANCE, Agent Review Registry (ARR) --
// PLATFORM_STRATEGY.md section 30.2/30.4: the one of the framework's 6
// named registries confirmed to not exist anywhere in this codebase ("no
// periodic, performance-driven promote/retrain/deprecate/retire cycle
// exists anywhere. Genuinely new territory") -- sequenced last per that
// section's own recommendation, since it needs Agent Performance
// (model-scorecard-service.ts, GAP-MODEL-SCORECARD, already closed PR #230)
// and Agent Escalation (escalation-ladder.ts / audit_trigger.ai_escalation,
// already real) data to act on. See schema.ts's agentReviewRecords comment
// for the full investigation trail distinguishing this from both of those
// (and from the AI Team Closure Review gate, POST /api/ai/team/review) --
// not repeated here.
//
// Reviews roster.ts's dispatchable AI Dev Team roles only (isHuman: false,
// model !== null) -- not workerAgents (the separate customer-facing
// capability catalog). Investigated workerAgents.accuracyScore as a
// candidate second subject before writing this file: confirmed by grep
// (only 2 read call sites -- src/app/api/worker-agents/route.ts,
// ai-performance-report-service.ts -- zero writes anywhere) that it is,
// like supervisorWorkerAgentId, a column with no real write path. Building
// a review cycle against it would mean either fabricating the "correctness"
// signal or reviewing a field that is always null -- neither is honest.
// workerAgents' own real periodic-review gap stays open, explicitly not
// solved here.
//
// Pure verdict core (computeReviewVerdict) is unit-tested directly, no DB --
// same pure-core/DB-shell split as model-scorecard-service.ts's
// mergeScorecardGroups/getModelScorecard and d1-metrics-tracker-service.ts's
// computeExecutionOutcome/generateD1MetricsReport.
import { db, activityLog, auditLogs, agentReviewRecords } from "@/lib/db"
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { AI_TEAM_ROSTER, getRole } from "@/lib/ai-team/roster"
import { isModelEligibleForTier, requiresMandatoryAudit } from "@/lib/model-tier-eligibility"

export type AgentReviewVerdict = "promote" | "maintain" | "retrain" | "deprecate"
export type TrustTierFlag = "consider_promoting_to_judgment_tier" | "consider_revoking_judgment_tier_trust" | null

export type ReviewMetrics = {
  dispatchCount: number
  terminalCount: number
  successCount: number
  failureCount: number
  reviewedCount: number
  auditFindingCount: number
  escalationCount: number
}

export type ReviewRates = {
  successRate: number | null
  auditFindingRate: number | null
  escalationRate: number | null
}

export type ReviewVerdictResult = {
  verdict: AgentReviewVerdict
  verdictReason: string
  trustTierFlag: TrustTierFlag
}

// Below this many real dispatches in the review window, any verdict beyond
// "maintain" would be a judgment call on noise, not signal -- matches this
// codebase's established "null/insufficient-data over a fabricated number"
// discipline (model-scorecard-service.ts's successRate=null,
// d1-metrics-tracker-service.ts's TargetGap). 5 mirrors the smallest real
// sample size already treated as meaningful elsewhere in this codebase
// (audit-cadence.ts's own minimum sample conventions).
export const MIN_DISPATCHES_FOR_VERDICT = 5
// A stricter volume bar for "promote" specifically -- a role should not be
// flagged for expanded trust off a handful of lucky dispatches.
export const MIN_DISPATCHES_FOR_PROMOTE = 20

const DEPRECATE_SUCCESS_RATE_BELOW = 0.5
const DEPRECATE_AUDIT_FINDING_RATE_ABOVE = 0.5
const RETRAIN_SUCCESS_RATE_BELOW = 0.8
const RETRAIN_AUDIT_FINDING_RATE_ABOVE = 0.25
const RETRAIN_ESCALATION_RATE_ABOVE = 0.2
const PROMOTE_SUCCESS_RATE_AT_LEAST = 0.95
const PROMOTE_AUDIT_FINDING_RATE_AT_MOST = 0.05
const PROMOTE_ESCALATION_RATE_AT_MOST = 0.05

function pct(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 1000) / 10}%`
}

/** Pure: successCount/terminalCount, auditFindingCount/reviewedCount, escalationCount/dispatchCount -- null (not 0) when the denominator is 0, same null-vs-zero discipline as model-scorecard-service.ts. */
export function computeReviewRates(m: ReviewMetrics): ReviewRates {
  return {
    successRate: m.terminalCount > 0 ? m.successCount / m.terminalCount : null,
    auditFindingRate: m.reviewedCount > 0 ? m.auditFindingCount / m.reviewedCount : null,
    escalationRate: m.dispatchCount > 0 ? m.escalationCount / m.dispatchCount : null,
  }
}

/**
 * Pure: the deterministic promote/maintain/retrain/deprecate verdict this
 * table exists to produce, plus an AGENTS.md Rule 10 trust-tier flag when a
 * role's real outcomes disagree with its current model-tier-eligibility
 * standing. No LLM call -- matches audit-protocol.ts/monitor-protocol.ts's
 * own no-LLM posture for structured governance records. Every branch cites
 * the real numbers it decided on in verdictReason (d1-metrics-tracker-
 * service.ts's "show your work" convention), never a bare label.
 */
export function computeReviewVerdict(m: ReviewMetrics, judgmentEligible: boolean): ReviewVerdictResult {
  const { successRate, auditFindingRate, escalationRate } = computeReviewRates(m)
  const summary = `${m.dispatchCount} dispatches (${m.terminalCount} terminal), successRate=${pct(successRate)}, auditFindingRate=${pct(auditFindingRate)} (${m.auditFindingCount}/${m.reviewedCount} reviewed), escalationRate=${pct(escalationRate)} (${m.escalationCount}/${m.dispatchCount}).`

  if (m.dispatchCount < MIN_DISPATCHES_FOR_VERDICT) {
    return {
      verdict: "maintain",
      verdictReason: `Insufficient data for a real verdict: only ${m.dispatchCount} dispatch(es) in this window (minimum ${MIN_DISPATCHES_FOR_VERDICT}). ${summary}`,
      trustTierFlag: null,
    }
  }

  const isDeprecate =
    (successRate !== null && successRate < DEPRECATE_SUCCESS_RATE_BELOW) ||
    (auditFindingRate !== null && auditFindingRate > DEPRECATE_AUDIT_FINDING_RATE_ABOVE)
  if (isDeprecate) {
    return {
      verdict: "deprecate",
      verdictReason: `Below the deprecate threshold (successRate < ${pct(DEPRECATE_SUCCESS_RATE_BELOW)} or auditFindingRate > ${pct(DEPRECATE_AUDIT_FINDING_RATE_ABOVE)}). ${summary}`,
      trustTierFlag: judgmentEligible ? "consider_revoking_judgment_tier_trust" : null,
    }
  }

  const isRetrain =
    (successRate !== null && successRate < RETRAIN_SUCCESS_RATE_BELOW) ||
    (auditFindingRate !== null && auditFindingRate > RETRAIN_AUDIT_FINDING_RATE_ABOVE) ||
    (escalationRate !== null && escalationRate > RETRAIN_ESCALATION_RATE_ABOVE)
  if (isRetrain) {
    return {
      verdict: "retrain",
      verdictReason: `Below the retrain threshold (successRate < ${pct(RETRAIN_SUCCESS_RATE_BELOW)}, or auditFindingRate > ${pct(RETRAIN_AUDIT_FINDING_RATE_ABOVE)}, or escalationRate > ${pct(RETRAIN_ESCALATION_RATE_ABOVE)}). ${summary}`,
      trustTierFlag: null,
    }
  }

  const isPromote =
    m.dispatchCount >= MIN_DISPATCHES_FOR_PROMOTE &&
    successRate !== null &&
    successRate >= PROMOTE_SUCCESS_RATE_AT_LEAST &&
    (auditFindingRate === null || auditFindingRate <= PROMOTE_AUDIT_FINDING_RATE_AT_MOST) &&
    (escalationRate === null || escalationRate <= PROMOTE_ESCALATION_RATE_AT_MOST)
  if (isPromote) {
    return {
      verdict: "promote",
      verdictReason: `Meets the promote bar (>= ${MIN_DISPATCHES_FOR_PROMOTE} dispatches, successRate >= ${pct(PROMOTE_SUCCESS_RATE_AT_LEAST)}, auditFindingRate <= ${pct(PROMOTE_AUDIT_FINDING_RATE_AT_MOST)}, escalationRate <= ${pct(PROMOTE_ESCALATION_RATE_AT_MOST)}). ${summary}`,
      trustTierFlag: judgmentEligible ? null : "consider_promoting_to_judgment_tier",
    }
  }

  return {
    verdict: "maintain",
    verdictReason: `Within normal range -- no deprecate/retrain/promote threshold crossed. ${summary}`,
    trustTierFlag: null,
  }
}

export type AgentReviewRecord = typeof agentReviewRecords.$inferSelect

/** Every roster.ts role a review cycle actually applies to -- real, dispatchable, non-human roles. Recomputed from the live roster each call, same convention as d1-metrics-tracker-service.ts's floorTierRoleKeys(). */
export function reviewableRoleKeys(): string[] {
  return AI_TEAM_ROSTER.filter((r) => !r.isHuman && r.model !== null).map((r) => r.roleKey)
}

type RawRoleMetricsRow = {
  roleKey: string | null
  dispatchCount: number
  terminalCount: number
  successCount: number
  failureCount: number
  reviewedCount: number
  auditFindingCount: number
}

/**
 * Runs one review cycle: for every reviewable role with at least one
 * dispatch in the window, aggregates real activity_log + audit_logs data,
 * computes a verdict, and INSERTS a new history row (append-only -- this
 * table is a track record over time, never upserted/overwritten). Returns
 * the rows it created. Platform-level (raw `db`), same posture as
 * model-scorecard-service.ts/aiAgentDirectory.
 */
export async function runAgentReviewCycle(opts: { sinceDays?: number } = {}): Promise<AgentReviewRecord[]> {
  const sinceDays = opts.sinceDays ?? 30
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - sinceDays * 86_400_000)
  const roleKeys = reviewableRoleKeys()
  if (roleKeys.length === 0) return []

  const metricsRows: RawRoleMetricsRow[] = await db
    .select({
      roleKey: activityLog.roleKey,
      dispatchCount: sql<number>`count(*)::int`,
      terminalCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} in ('completed', 'failed', 'closed'))::int`,
      successCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} = 'completed')::int`,
      failureCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} = 'failed')::int`,
      reviewedCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} is not null)::int`,
      auditFindingCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} = 'rejected')::int`,
    })
    .from(activityLog)
    .where(and(
      eq(activityLog.activityType, "ai_team_dispatch"),
      inArray(activityLog.roleKey, roleKeys),
      gte(activityLog.createdAt, periodStart),
      lt(activityLog.createdAt, periodEnd),
    ))
    .groupBy(activityLog.roleKey)

  // Escalation counts: audit_logs is a real append-only event log (unlike
  // monitor_task_state, which is current-owner-only and gets overwritten on
  // every re-claim -- see schema.ts's agentReviewRecords comment for why
  // that table can't answer a historical "how many times" question). Joins
  // audit_trigger.ai_escalation rows back to the role that owned the
  // escalated dispatch via entity_id = activity_log.id.
  const escalationRows: { roleKey: string | null; escalationCount: number }[] = await db
    .select({
      roleKey: activityLog.roleKey,
      escalationCount: sql<number>`count(*)::int`,
    })
    .from(auditLogs)
    .innerJoin(activityLog, eq(auditLogs.entityId, activityLog.id))
    .where(and(
      eq(auditLogs.action, "audit_trigger.ai_escalation"),
      eq(auditLogs.entityType, "activity_log"),
      inArray(activityLog.roleKey, roleKeys),
      gte(activityLog.createdAt, periodStart),
      lt(activityLog.createdAt, periodEnd),
    ))
    .groupBy(activityLog.roleKey)

  const escalationByRole = new Map<string, number>()
  for (const row of escalationRows) {
    if (row.roleKey) escalationByRole.set(row.roleKey, row.escalationCount)
  }
  const metricsByRole = new Map<string, RawRoleMetricsRow>()
  for (const row of metricsRows) {
    if (row.roleKey) metricsByRole.set(row.roleKey, row)
  }

  const created: AgentReviewRecord[] = []
  for (const roleKey of roleKeys) {
    const raw = metricsByRole.get(roleKey)
    if (!raw || raw.dispatchCount === 0) continue // nothing dispatched this window -- no review to record, not a fabricated zero-verdict row

    const role = getRole(roleKey)
    const metrics: ReviewMetrics = {
      dispatchCount: raw.dispatchCount,
      terminalCount: raw.terminalCount,
      successCount: raw.successCount,
      failureCount: raw.failureCount,
      reviewedCount: raw.reviewedCount,
      auditFindingCount: raw.auditFindingCount,
      escalationCount: escalationByRole.get(roleKey) ?? 0,
    }
    const rates = computeReviewRates(metrics)
    const judgmentEligible = role?.model ? isModelEligibleForTier(role.model, "judgment") : false
    const { verdict, verdictReason, trustTierFlag } = computeReviewVerdict(metrics, judgmentEligible)

    const complexityTierTrust = role?.model
      ? {
          mechanicalEligible: isModelEligibleForTier(role.model, "mechanical"),
          integrativeEligible: isModelEligibleForTier(role.model, "integrative"),
          judgmentEligible,
          mandatoryAudit: requiresMandatoryAudit(role.model),
        }
      : null

    const [row] = await db
      .insert(agentReviewRecords)
      .values({
        id: createId(),
        roleKey,
        title: role?.title ?? null,
        team: role?.team ?? null,
        model: role?.model ?? null,
        periodStart,
        periodEnd,
        dispatchCount: metrics.dispatchCount,
        terminalCount: metrics.terminalCount,
        successCount: metrics.successCount,
        failureCount: metrics.failureCount,
        successRate: rates.successRate !== null ? String(rates.successRate) : null,
        reviewedCount: metrics.reviewedCount,
        auditFindingCount: metrics.auditFindingCount,
        auditFindingRate: rates.auditFindingRate !== null ? String(rates.auditFindingRate) : null,
        escalationCount: metrics.escalationCount,
        escalationRate: rates.escalationRate !== null ? String(rates.escalationRate) : null,
        complexityTierTrust,
        verdict,
        verdictReason,
        trustTierFlag,
      })
      .returning()
    created.push(row)
  }

  return created
}

/** Full review history for one role, most recent first -- the real "track record over time" read this table exists to serve. */
export async function getAgentReviewHistory(roleKey: string, limit = 50): Promise<AgentReviewRecord[]> {
  return db.query.agentReviewRecords.findMany({
    where: eq(agentReviewRecords.roleKey, roleKey),
    orderBy: desc(agentReviewRecords.reviewedAt),
    limit,
  })
}

/** Latest review row per role (DISTINCT ON, Postgres) -- "current standing" read across every role that has ever been reviewed, without re-deriving it from raw activity_log on every request. */
export async function getLatestAgentReviews(): Promise<AgentReviewRecord[]> {
  return db
    .selectDistinctOn([agentReviewRecords.roleKey])
    .from(agentReviewRecords)
    .orderBy(agentReviewRecords.roleKey, desc(agentReviewRecords.reviewedAt))
    .then((rows) => rows as AgentReviewRecord[])
}

/** Every role currently carrying a non-null trustTierFlag on its LATEST review -- the direct answer to "which roles' Rule 10 trust standing should a human revisit right now." */
export async function getRolesNeedingTrustTierReconsideration(): Promise<AgentReviewRecord[]> {
  const latest = await getLatestAgentReviews()
  return latest.filter((r) => r.trustTierFlag !== null)
}
