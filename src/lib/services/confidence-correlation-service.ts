// VERIDIAN Review Framework gap-closure, "AI Maintainability / Change Risk
// Management" -- [Low] "AI Confidence Before Code Changes": "Confidence
// input itself is not independently verified." Recommended approach:
// "Periodically audit whether reported confidence percentages correlate
// with actual outcome quality."
//
// confidence-banding.ts (Guardrail 9) already maps a self-reported 0-100
// confidence percentage to a closure path (auto_proceed / self_review_
// required / peer_review_required / escalation_required), and
// activity-log-service.ts already persists both confidencePercentage and
// confidenceBand on every activity_log row that supplied one. What none of
// that verifies: whether a model that SAYS "98% confident" (auto_proceed --
// the band that skips independent review) actually produces work that
// holds up, versus a model whose stated confidence is just noise. This
// service is that verification pass -- read-only, deterministic, no LLM
// call, matching every other gate in this codebase.
//
// Outcome-quality signal, using only what's already persisted (no new
// columns, no new event pipeline -- same investigation discipline as
// model-scorecard-service.ts's header):
//   - reviewDecision = 'rejected' -- an independent reviewer actually found
//     a problem (AI Team Closure Review gate, AGENTS.md Rule 7c). Only
//     meaningful for rows that WERE reviewed (reviewDecision is not null);
//     auto_proceed rows are frequently never reviewed at all by design, so
//     rejectionRate is reported as null (no signal), not 0, when that's true.
//   - reAuditRequestedAt is not null -- a previously-closed row got flagged
//     for re-audit later (schema.ts's "no task is EVER permanently
//     complete" flag, area 9 "Auditing"). This fires regardless of which
//     band skipped/required review at closure time, so it is the one signal
//     comparable ACROSS all four bands -- the real correlation check this
//     finding asks for.
//
// Pure-core/DB-shell split, same convention as model-scorecard-service.ts
// (mergeScorecardGroups) and task-service.ts (validateChainDepth/
// isTaskOverdue): mergeConfidenceCorrelationGroups is unit-tested directly
// in confidence-correlation-service.test.ts without touching a live DB.
import { db, activityLog } from "@/lib/db"
import { and, eq, gte, isNotNull, sql } from "drizzle-orm"
import type { ConfidenceBand } from "@/lib/confidence-banding"

/** Best-confidence-first order -- the ranking miscalibration detection walks. */
export const CONFIDENCE_BAND_ORDER: readonly ConfidenceBand[] = [
  "auto_proceed",
  "self_review_required",
  "peer_review_required",
  "escalation_required",
]

export type ConfidenceCorrelationGroupRow = {
  confidenceBand: string | null
  sampleCount: number
  reviewedCount: number
  rejectedCount: number
  reAuditCount: number
}

export type ConfidenceCorrelationEntry = {
  confidenceBand: ConfidenceBand
  sampleCount: number
  reviewedCount: number
  rejectedCount: number
  /** rejectedCount / reviewedCount. null when nothing in this band was independently reviewed (no signal -- common for auto_proceed, which skips review by design). */
  rejectionRate: number | null
  reAuditCount: number
  /** reAuditCount / sampleCount. The cross-band-comparable signal -- fires regardless of whether the row was ever independently reviewed at closure time. null when the band has no samples. */
  reAuditRate: number | null
}

export type ConfidenceCorrelationReport = {
  bands: ConfidenceCorrelationEntry[]
  /**
   * True when a band whose reported confidence implied a SAFER closure path
   * (e.g. auto_proceed) shows a strictly higher reAuditRate than a band
   * whose reported confidence implied a less-safe path (e.g.
   * escalation_required) -- i.e. the reported confidence is not actually
   * correlated with outcome quality in the expected direction.
   */
  miscalibrationDetected: boolean
  /** One human-readable note per (betterBand, worseBand) pair that violated the expected ordering. Empty when miscalibrationDetected is false. */
  miscalibrationNotes: string[]
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

/**
 * Merges raw per-confidence_band SQL aggregates into the correlation report,
 * including the pairwise miscalibration check. Pure -- no DB, no Date.now(),
 * fully deterministic given its input rows.
 */
export function mergeConfidenceCorrelationGroups(rows: ConfidenceCorrelationGroupRow[]): ConfidenceCorrelationReport {
  const byBand = new Map<ConfidenceBand, ConfidenceCorrelationEntry>()

  for (const row of rows) {
    if (!row.confidenceBand || !(CONFIDENCE_BAND_ORDER as readonly string[]).includes(row.confidenceBand)) continue
    const band = row.confidenceBand as ConfidenceBand
    const existing = byBand.get(band)
    const sampleCount = (existing?.sampleCount ?? 0) + row.sampleCount
    const reviewedCount = (existing?.reviewedCount ?? 0) + row.reviewedCount
    const rejectedCount = (existing?.rejectedCount ?? 0) + row.rejectedCount
    const reAuditCount = (existing?.reAuditCount ?? 0) + row.reAuditCount
    byBand.set(band, {
      confidenceBand: band,
      sampleCount,
      reviewedCount,
      rejectedCount,
      rejectionRate: rate(rejectedCount, reviewedCount),
      reAuditCount,
      reAuditRate: rate(reAuditCount, sampleCount),
    })
  }

  const bands = CONFIDENCE_BAND_ORDER.filter((b) => byBand.has(b)).map((b) => byBand.get(b)!)

  const miscalibrationNotes: string[] = []
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const better = bands[i]
      const worse = bands[j]
      if (better.reAuditRate == null || worse.reAuditRate == null) continue
      if (better.reAuditRate > worse.reAuditRate) {
        miscalibrationNotes.push(
          `'${better.confidenceBand}' (reported HIGHER confidence) has a re-audit rate of ${(better.reAuditRate * 100).toFixed(1)}%, worse than '${worse.confidenceBand}' (reported LOWER confidence) at ${(worse.reAuditRate * 100).toFixed(1)}% -- reported confidence is not correlating with actual outcome quality here.`
        )
      }
    }
  }

  return {
    bands,
    miscalibrationDetected: miscalibrationNotes.length > 0,
    miscalibrationNotes,
  }
}

/**
 * Real DB aggregation. Platform-level (raw `db`, not withTenantContext) --
 * same posture as model-scorecard-service.ts/agent-directory-service.ts:
 * this is a cross-org governance report over AI-authored work, not tenant
 * data.
 */
export async function getConfidenceOutcomeCorrelation(opts: { sinceDays?: number } = {}): Promise<ConfidenceCorrelationReport> {
  const sinceClause = opts.sinceDays != null
    ? gte(activityLog.createdAt, new Date(Date.now() - opts.sinceDays * 86_400_000))
    : undefined

  const baseWhere = isNotNull(activityLog.confidenceBand)
  const where = sinceClause ? and(baseWhere, sinceClause) : baseWhere

  const rows = await db
    .select({
      confidenceBand: activityLog.confidenceBand,
      sampleCount: sql<number>`count(*)::int`,
      reviewedCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} is not null)::int`,
      rejectedCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} = 'rejected')::int`,
      reAuditCount: sql<number>`count(*) filter (where ${activityLog.reAuditRequestedAt} is not null)::int`,
    })
    .from(activityLog)
    .where(where)
    .groupBy(activityLog.confidenceBand)

  return mergeConfidenceCorrelationGroups(rows)
}
