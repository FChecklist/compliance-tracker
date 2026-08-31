// VERIDIAN Review Framework gap-closure, AI Maintainability / Change Risk
// Management -- [Low] "AI Confidence Before Code Changes": "Confidence
// input itself is not independently verified. Recommended approach:
// Periodically audit whether reported confidence percentages correlate
// with actual outcome quality."
//
// Investigated before writing this: activity_log (schema.ts, Wave 165)
// already persists BOTH halves of this correlation on every closed AI Team
// dispatch -- confidence_band (the self-reported signal, from
// confidence-banding.ts's bandConfidence()) and review_decision/
// lifecycle_stage (the real, independently-recorded outcome from the AI
// Team Closure Review gate, AGENTS.md Rule 7c). Nothing had ever queried
// them together -- the same gap model-scorecard-service.ts closed for
// (model, tier) outcomes, applied here to (reported confidence, real
// outcome) instead. Same pure-core/DB-shell split, same platform-level
// (not tenant-scoped) posture, matching model-scorecard-service.ts's own
// reasoning for why this is not per-org data.
//
// "Periodically audit" (the recommendation's own wording) is realized as a
// queryable report (this service + GET /api/ai/team/confidence-correlation),
// the same shape as the Model Performance Scorecard -- there is no cron
// wired for either one; both are pulled on demand by an admin/reviewer,
// consistent with this repo's existing periodic-review cadence framework
// (audit-cadence.ts's L5/L6/L7 periodic levels are the natural place this
// slots into, not a new scheduling mechanism).
import { db, activityLog } from "@/lib/db"
import { and, eq, gte, isNotNull, sql } from "drizzle-orm"
import type { ConfidenceBand } from "@/lib/confidence-banding"

// Highest reported confidence first. If confidence reporting is honest,
// successRate should be non-increasing (and auditFindingRate
// non-decreasing) as you move down this list -- a task banded
// escalation_required "should" fail/get rejected at least as often as one
// banded auto_proceed, because the model itself said it was less sure.
const BAND_ORDER: readonly ConfidenceBand[] = [
  "auto_proceed",
  "self_review_required",
  "peer_review_required",
  "escalation_required",
]

export type ConfidenceBandGroupRow = {
  confidenceBand: string | null
  dispatchCount: number
  terminalCount: number
  successCount: number
  reviewedCount: number
  auditFindingCount: number
}

export type ConfidenceCorrelationEntry = {
  confidenceBand: string
  dispatchCount: number
  terminalCount: number
  successCount: number
  /** successCount / terminalCount. null when nothing has reached a terminal stage yet (no signal, not zero). */
  successRate: number | null
  reviewedCount: number
  /** review_decision = 'rejected' -- a real, independently recorded audit finding, not inferred. */
  auditFindingCount: number
  /** auditFindingCount / reviewedCount. null when nothing has been reviewed yet (no signal, not zero). */
  auditFindingRate: number | null
}

export type ConfidenceCorrelationReport = {
  /** Ordered highest-reported-confidence first (auto_proceed) to lowest (escalation_required). Only bands with at least one dispatch are included. */
  bands: ConfidenceCorrelationEntry[]
  /**
   * true: successRate never increases going from a higher-confidence band
   * to a lower one, across every consecutive pair that both have signal --
   * i.e. reported confidence tracks real outcome quality, the thing this
   * finding asked to verify.
   * false: at least one pair inverted (a lower-confidence band did BETTER
   * than a higher-confidence one) -- see `anomalies`.
   * null: fewer than 2 bands have a successRate signal yet -- not enough
   * data to judge either way (honestly reported as no-signal, not a pass).
   */
  monotonic: boolean | null
  /** One entry per inverted pair, naming both bands and both rates -- so a real review can see exactly where confidence reporting diverges from outcomes, not just that it does. */
  anomalies: string[]
}

/**
 * Pure: merges raw per-confidence_band SQL aggregates into the correlation
 * report and evaluates the monotonicity check described on
 * ConfidenceCorrelationReport.monotonic. Unit-tested directly
 * (confidence-correlation-service.test.ts), matching this repo's
 * established pure-core/DB-shell split (model-scorecard-service.ts's
 * mergeScorecardGroups).
 */
export function buildConfidenceCorrelationReport(rows: ConfidenceBandGroupRow[]): ConfidenceCorrelationReport {
  const byBand = new Map<string, ConfidenceBandGroupRow>()
  for (const row of rows) {
    if (!row.confidenceBand) continue // unbanded rows carry no confidence signal to correlate
    const existing = byBand.get(row.confidenceBand)
    if (existing) {
      existing.dispatchCount += row.dispatchCount
      existing.terminalCount += row.terminalCount
      existing.successCount += row.successCount
      existing.reviewedCount += row.reviewedCount
      existing.auditFindingCount += row.auditFindingCount
    } else {
      byBand.set(row.confidenceBand, { ...row })
    }
  }

  const bands: ConfidenceCorrelationEntry[] = BAND_ORDER.filter((b) => byBand.has(b)).map((b) => {
    const row = byBand.get(b)!
    return {
      confidenceBand: b,
      dispatchCount: row.dispatchCount,
      terminalCount: row.terminalCount,
      successCount: row.successCount,
      successRate: row.terminalCount > 0 ? row.successCount / row.terminalCount : null,
      reviewedCount: row.reviewedCount,
      auditFindingCount: row.auditFindingCount,
      auditFindingRate: row.reviewedCount > 0 ? row.auditFindingCount / row.reviewedCount : null,
    }
  })

  const anomalies: string[] = []
  const withSignal = bands.filter((b) => b.successRate !== null)
  for (let i = 0; i < withSignal.length - 1; i++) {
    const higher = withSignal[i]
    const lower = withSignal[i + 1]
    // "lower" here means lower REPORTED confidence, not lower index value.
    if (lower.successRate! > higher.successRate!) {
      anomalies.push(
        `${lower.confidenceBand} (lower reported confidence) has a HIGHER success rate (${(lower.successRate! * 100).toFixed(1)}%) than ${higher.confidenceBand} (${(higher.successRate! * 100).toFixed(1)}%) -- confidence reporting is not tracking real outcome quality here.`
      )
    }
  }

  return {
    bands,
    monotonic: withSignal.length < 2 ? null : anomalies.length === 0,
    anomalies,
  }
}

/**
 * Real DB aggregation. Platform-level (raw `db`, not withTenantContext) --
 * same posture as model-scorecard-service.ts/agent-directory-service.ts:
 * AI Team dispatch confidence/outcome is platform-internal governance data,
 * not tenant data.
 */
export async function getConfidenceCorrelationReport(opts: { sinceDays?: number } = {}): Promise<ConfidenceCorrelationReport> {
  const sinceClause = opts.sinceDays != null
    ? gte(activityLog.createdAt, new Date(Date.now() - opts.sinceDays * 86_400_000))
    : undefined

  const baseWhere = and(eq(activityLog.activityType, "ai_team_dispatch"), isNotNull(activityLog.confidenceBand))

  const rows = await db
    .select({
      confidenceBand: activityLog.confidenceBand,
      dispatchCount: sql<number>`count(*)::int`,
      terminalCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} in ('completed', 'failed', 'closed'))::int`,
      successCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} = 'completed')::int`,
      reviewedCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} is not null)::int`,
      auditFindingCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} = 'rejected')::int`,
    })
    .from(activityLog)
    .where(sinceClause ? and(baseWhere, sinceClause) : baseWhere)
    .groupBy(activityLog.confidenceBand)

  return buildConfidenceCorrelationReport(rows)
}
