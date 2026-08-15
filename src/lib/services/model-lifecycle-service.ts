// AI Model Lifecycle & Benchmarking: Ongoing Quality Monitoring.
//
// PLATFORM_STRATEGY.md 30.2's Agent Performance (APR) row confirms
// model-scorecard-service.ts (GAP-MODEL-SCORECARD, PR #230) is "real but
// narrow" -- a live, ephemeral (model, complexityTier) aggregation,
// re-derived from scratch on every call and discarded, that answers "how
// is this model doing right now." It deliberately does NOT answer "should
// this MODEL's standing change, based on its real history" -- that
// periodic promote/maintain/retrain/deprecate question. That question
// already has a real answer at ROLE granularity: agentReviewRecords /
// agent-review-service.ts (GAP-AI-WORKFORCE-GOVERNANCE, Agent Review
// Registry). This file is the same question at MODEL granularity, needed
// because multiple roster.ts roles routinely share one model (most
// GLM_52 roles, for instance) -- a single role going stale doesn't tell
// you whether the underlying MODEL itself should keep receiving
// judgment-tier work platform-wide, and a model can cross a real
// threshold even when no individual role dispatching it alone clears
// agent-review-service.ts's own MIN_DISPATCHES_FOR_VERDICT floor.
//
// Deliberately REUSES agent-review-service.ts's computeReviewRates() /
// computeReviewVerdict() rather than re-implementing the same threshold
// math a second time -- confirmed by direct read that both functions are
// already granularity-agnostic (they only need dispatch/terminal/success/
// failure/reviewed/auditFinding/escalation COUNTS, never a role_key), so
// reusing them against a model's own aggregated numbers is the same
// "don't duplicate real, already-shipped work" discipline this codebase
// applies everywhere else, not a coincidental shortcut.
//
// Builds ON TOP of model-scorecard-service.ts's own (model, complexityTier)
// merge (getModelScorecard()) rather than re-querying activity_log a
// second time -- the scorecard's dispatch/success/audit-finding/cost
// numbers are exactly what this table needs, plus one more real signal
// the scorecard doesn't carry: escalation counts (audit_logs'
// audit_trigger.ai_escalation rows), aggregated here the same way
// agent-review-service.ts already aggregates them, just grouped by
// (roleKey, complexityTier) instead of roleKey alone so they resolve to
// the same (model, complexityTier) keys the scorecard uses.
import { db, activityLog, auditLogs, modelLifecycleReviews } from "@/lib/db"
import { and, desc, eq, gte, lt, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { getRole } from "@/lib/ai-team/roster"
import { isModelEligibleForTier, requiresMandatoryAudit } from "@/lib/model-tier-eligibility"
import {
  getModelScorecard,
  type ModelScorecardEntry,
} from "./model-scorecard-service"
import {
  computeReviewRates,
  computeReviewVerdict,
  MIN_DISPATCHES_FOR_VERDICT,
  type ReviewMetrics,
  type ReviewVerdictResult,
} from "./agent-review-service"

export type ModelLifecycleMetrics = ReviewMetrics & { model: string; complexityTier: string; costUsd: number | null }

/** One (roleKey, complexityTier) group's real escalation count in the window, as recorded in audit_logs. */
type EscalationGroupRow = { roleKey: string | null; complexityTier: string | null; escalationCount: number }

/**
 * Pure: resolves each escalation group's roleKey to its roster.ts model
 * (same resolution model-scorecard-service.ts's mergeScorecardGroups
 * already uses) and merges additively into a (model, complexityTier) map --
 * multiple roleKeys sharing a model+tier sum, exactly matching how the
 * scorecard itself merges dispatch counts.
 */
export function mergeEscalationByModel(
  rows: EscalationGroupRow[],
  resolveModel: (roleKey: string | null) => string
): Map<string, number> {
  const byModelTier = new Map<string, number>()
  for (const row of rows) {
    const model = resolveModel(row.roleKey)
    const tier = row.complexityTier ?? "unknown"
    const key = `${model}::${tier}`
    byModelTier.set(key, (byModelTier.get(key) ?? 0) + row.escalationCount)
  }
  return byModelTier
}

/**
 * Pure: combines one scorecard entry with its real escalation count into
 * the ReviewMetrics shape computeReviewRates()/computeReviewVerdict()
 * already expect -- the actual bridge letting this file reuse
 * agent-review-service.ts's verdict math unmodified. escalationCount
 * defaults to 0 (a real "none observed" fact, not a missing signal) when
 * no escalation row matched this (model, tier) key.
 */
export function toLifecycleMetrics(entry: ModelScorecardEntry, escalationByModelTier: Map<string, number>): ModelLifecycleMetrics {
  const key = `${entry.model}::${entry.complexityTier}`
  return {
    model: entry.model,
    complexityTier: entry.complexityTier,
    dispatchCount: entry.dispatchCount,
    terminalCount: entry.terminalCount,
    successCount: entry.successCount,
    failureCount: entry.failureCount,
    reviewedCount: entry.reviewedCount,
    auditFindingCount: entry.auditFindingCount,
    escalationCount: escalationByModelTier.get(key) ?? 0,
    costUsd: entry.costUsd.totalUsd,
  }
}

export type ModelLifecycleReviewRecord = typeof modelLifecycleReviews.$inferSelect

/**
 * Runs one review cycle: for every (model, complexityTier) group the
 * scorecard reports with at least one dispatch in the window, computes a
 * real escalation count, a deterministic verdict (reusing
 * agent-review-service.ts's computeReviewVerdict()), and INSERTS a new
 * append-only history row. Returns the rows it created. Platform-level
 * (raw `db`), same posture as model-scorecard-service.ts /
 * agent-review-service.ts.
 */
export async function runModelLifecycleReviewCycle(opts: { sinceDays?: number } = {}): Promise<ModelLifecycleReviewRecord[]> {
  const sinceDays = opts.sinceDays ?? 30
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - sinceDays * 86_400_000)

  const [scorecard, escalationRows] = await Promise.all([
    getModelScorecard({ sinceDays }),
    db
      .select({
        roleKey: activityLog.roleKey,
        complexityTier: activityLog.complexityTier,
        escalationCount: sql<number>`count(*)::int`,
      })
      .from(auditLogs)
      .innerJoin(activityLog, eq(auditLogs.entityId, activityLog.id))
      .where(and(
        eq(auditLogs.action, "audit_trigger.ai_escalation"),
        eq(auditLogs.entityType, "activity_log"),
        gte(activityLog.createdAt, periodStart),
        lt(activityLog.createdAt, periodEnd),
      ))
      .groupBy(activityLog.roleKey, activityLog.complexityTier),
  ])

  if (scorecard.length === 0) return []

  const escalationByModelTier = mergeEscalationByModel(
    escalationRows,
    (roleKey) => (roleKey ? getRole(roleKey)?.model ?? "unclassified" : "unclassified")
  )

  const created: ModelLifecycleReviewRecord[] = []
  for (const entry of scorecard) {
    if (entry.dispatchCount === 0) continue // no dispatch in window -- no review to record, not a fabricated zero-verdict row (mirrors runAgentReviewCycle's own guard)

    const metrics = toLifecycleMetrics(entry, escalationByModelTier)
    const rates = computeReviewRates(metrics)
    const judgmentEligible = isModelEligibleForTier(entry.model, "judgment")
    const { verdict, verdictReason, trustTierFlag }: ReviewVerdictResult = computeReviewVerdict(metrics, judgmentEligible)

    const [row] = await db
      .insert(modelLifecycleReviews)
      .values({
        id: createId(),
        model: entry.model,
        complexityTier: entry.complexityTier,
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
        costUsd: metrics.costUsd !== null ? String(metrics.costUsd) : null,
        verdict,
        verdictReason,
        trustTierFlag,
      })
      .returning()
    created.push(row)
  }

  return created
}

/** Full review history for one model, most recent first. */
export async function getModelLifecycleHistory(model: string, limit = 50): Promise<ModelLifecycleReviewRecord[]> {
  return db.query.modelLifecycleReviews.findMany({
    where: eq(modelLifecycleReviews.model, model),
    orderBy: desc(modelLifecycleReviews.reviewedAt),
    limit,
  })
}

/** Latest review row per (model, complexityTier) -- "current standing" across every model+tier combination ever reviewed. */
export async function getLatestModelLifecycleReviews(): Promise<ModelLifecycleReviewRecord[]> {
  return db
    .selectDistinctOn([modelLifecycleReviews.model, modelLifecycleReviews.complexityTier])
    .from(modelLifecycleReviews)
    .orderBy(modelLifecycleReviews.model, modelLifecycleReviews.complexityTier, desc(modelLifecycleReviews.reviewedAt))
    .then((rows) => rows as ModelLifecycleReviewRecord[])
}

/** Every (model, complexityTier) row currently carrying a non-null trustTierFlag on its LATEST review -- direct answer to "which models' Rule 10 trust standing should a human revisit right now." */
export async function getModelsNeedingTrustTierReconsideration(): Promise<ModelLifecycleReviewRecord[]> {
  const latest = await getLatestModelLifecycleReviews()
  return latest.filter((r) => r.trustTierFlag !== null)
}

/** Real, mandatory-audit-gated models (model-tier-eligibility.ts's requiresMandatoryAudit) currently flagged 'deprecate' or 'retrain' on their latest review -- the sharpest "which models need a human decision right now" cut this registry can answer. */
export async function getModelsNeedingUrgentReview(): Promise<ModelLifecycleReviewRecord[]> {
  const latest = await getLatestModelLifecycleReviews()
  return latest.filter((r) => (r.verdict === "deprecate" || r.verdict === "retrain") && requiresMandatoryAudit(r.model))
}
