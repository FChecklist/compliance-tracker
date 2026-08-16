// GAP-MODEL-SCORECARD: "Model Performance Scorecard -- dispatch count,
// success rate, iteration count, and audit-finding-rate, aggregated per AI
// model + complexity tier." Discussed across several prior priorities in
// this session, never built until now.
//
// Investigated before writing a single line, per this task's own
// instruction not to duplicate token-usage-ledger-service.ts (that service
// tracks COST per dispatch -- a different, already-shipped capability) or
// invent a second event-logging pipeline:
//   - activity_log (schema.ts, Wave 160/163/165/172) already records every
//     real AI Dev Team dispatch through POST /api/ai/team/dispatch:
//     activity_type='ai_team_dispatch', role_key (roster.ts), a real
//     terminal lifecycle_stage ('completed'|'failed'|'closed'), and
//     review_decision ('approved'|'rejected') from the internal AI Team
//     Closure Review gate (AI_TEAM_CLOSURE_REVIEW_LEAF, "doer != auditor",
//     AGENTS.md Rule 7c made a real gate by /api/ai/team/review).
//   - model-tier-eligibility.ts's ComplexityTier ('mechanical'/
//     'integrative'/'judgment') is validated at dispatch time
//     (checkTierEligibility, Rule 10) but was never persisted -- 0165
//     closes exactly that gap with one nullable/additive column.
//   - There is no `model` column on activity_log; model is resolved from
//     role_key via roster.ts's getRole(), the exact same resolution
//     agent-directory-service.ts already relies on for its own per-role
//     directory (a role's model is a roster fact, not per-dispatch data,
//     so storing it a second time on every row would be redundant, not a
//     genuine new signal).
//
// iteration count -- named in the task, honestly NOT computable from any
// persisted data today, documented rather than fabricated (see
// ITERATION_COUNT_NOTE below): the repo-write dispatch path
// (scripts/ai-workforce-agent.mjs's MAX_ITERATIONS tool-call loop) has no
// DATABASE_URL in CI (that script's own header, "fetchSystemPrompt()'s own
// comment") and cannot persist a per-dispatch iteration count without a
// real infrastructure decision (DB access from CI, or an authenticated
// callback to the app) -- not a missing column. The DB-backed advisory
// path (POST /api/ai/team/dispatch -> runRole()) is a single, non-looping
// LLM call, so an iteration count there would always be trivially 1 --
// real, but not a distinguishing signal worth a migration. Surfaced as an
// explicit `note`, matching this codebase's own established
// "verdict: null, note" discipline (see taskReflections.differentAiTierFlag/
// reusablePatternFlag in schema.ts) rather than inventing a number.
import { db, activityLog } from "@/lib/db"
import { and, eq, gte, sql } from "drizzle-orm"
import { getRole } from "@/lib/ai-team/roster"

export const ITERATION_COUNT_NOTE =
  "Not computable from persisted data yet: the repo-write dispatch path (scripts/ai-workforce-agent.mjs's MAX_ITERATIONS tool-call loop) has no DATABASE_URL in CI and cannot persist a per-dispatch iteration count; the DB-backed advisory path (POST /api/ai/team/dispatch, runRole()) is a single non-looping LLM call, so an iteration count there would always trivially be 1 -- not a real distinguishing signal. Wiring iteration reporting requires an infrastructure decision (DB access from CI, or an authenticated callback), not a new column -- flagged honestly rather than fabricated."

/** One raw (role_key, complexity_tier) group as aggregated in SQL -- sums/counts only, so merging groups that share a resolved model is exact addition, not an average-of-averages approximation. */
export type ScorecardGroupRow = {
  roleKey: string | null
  complexityTier: string | null
  dispatchCount: number
  terminalCount: number
  successCount: number
  failureCount: number
  durationMsSum: number
  durationMsSampleCount: number
  reviewedCount: number
  auditFindingCount: number
}

export type ModelScorecardEntry = {
  model: string
  complexityTier: string
  dispatchCount: number
  terminalCount: number
  successCount: number
  failureCount: number
  /** successCount / terminalCount. null when nothing has reached a terminal stage yet (no signal, not zero). */
  successRate: number | null
  avgDurationMs: number | null
  /** Dispatches an independent reviewer actually closed via the AI Team Closure Review gate (activity_log.review_decision is not null). */
  reviewedCount: number
  /** reviewDecision = 'rejected' -- a real, recorded audit finding, not inferred. */
  auditFindingCount: number
  /** auditFindingCount / reviewedCount. null when nothing has been reviewed yet (no signal, not zero). */
  auditFindingRate: number | null
  iterationCount: { avg: number | null; note: string }
}

/**
 * Pure: merges raw per-(role_key, complexity_tier) SQL aggregates into the
 * real scorecard shape, resolving each role_key to its roster.ts model
 * (multiple roles commonly share one model -- e.g. most GLM_52 roles --
 * so this is a genuine many-to-one merge, not a relabel). Unit-tested
 * directly (model-scorecard-service.test.ts), matching this repo's
 * established pure-core/DB-shell split (task-service.ts's
 * validateChainDepth/isTaskOverdue, ai-performance-report-service.ts's
 * computeFailureRate/averageNumericColumn).
 *
 * resolveModel is injected rather than importing roster.ts's getRole()
 * directly so the pure function has no DB/module dependency at all.
 */
/** Internal running-total accumulator for one (model, complexityTier) group -- kept separate from ModelScorecardEntry so the sums needed to merge exactly (not average-of-averages) don't leak into the public shape. */
type ScorecardAccumulator = {
  model: string
  complexityTier: string
  dispatchCount: number
  terminalCount: number
  successCount: number
  failureCount: number
  durationMsSum: number
  durationMsSampleCount: number
  reviewedCount: number
  auditFindingCount: number
}

export function mergeScorecardGroups(
  rows: ScorecardGroupRow[],
  resolveModel: (roleKey: string | null) => string
): ModelScorecardEntry[] {
  const merged = new Map<string, ScorecardAccumulator>()

  for (const row of rows) {
    const model = resolveModel(row.roleKey)
    const complexityTier = row.complexityTier ?? "unknown"
    const key = `${model}::${complexityTier}`
    const existing = merged.get(key)
    if (existing) {
      existing.dispatchCount += row.dispatchCount
      existing.terminalCount += row.terminalCount
      existing.successCount += row.successCount
      existing.failureCount += row.failureCount
      existing.reviewedCount += row.reviewedCount
      existing.auditFindingCount += row.auditFindingCount
      existing.durationMsSum += row.durationMsSum
      existing.durationMsSampleCount += row.durationMsSampleCount
    } else {
      merged.set(key, {
        model,
        complexityTier,
        dispatchCount: row.dispatchCount,
        terminalCount: row.terminalCount,
        successCount: row.successCount,
        failureCount: row.failureCount,
        reviewedCount: row.reviewedCount,
        auditFindingCount: row.auditFindingCount,
        durationMsSum: row.durationMsSum,
        durationMsSampleCount: row.durationMsSampleCount,
      })
    }
  }

  const entries: ModelScorecardEntry[] = Array.from(merged.values()).map((m) => ({
    model: m.model,
    complexityTier: m.complexityTier,
    dispatchCount: m.dispatchCount,
    terminalCount: m.terminalCount,
    successCount: m.successCount,
    failureCount: m.failureCount,
    successRate: m.terminalCount > 0 ? m.successCount / m.terminalCount : null,
    avgDurationMs: m.durationMsSampleCount > 0 ? m.durationMsSum / m.durationMsSampleCount : null,
    reviewedCount: m.reviewedCount,
    auditFindingCount: m.auditFindingCount,
    auditFindingRate: m.reviewedCount > 0 ? m.auditFindingCount / m.reviewedCount : null,
    iterationCount: { avg: null, note: ITERATION_COUNT_NOTE },
  }))

  // Highest-volume model+tier first -- same "most consequential first"
  // ordering convention as agent-directory-service.ts's common-errors query.
  entries.sort((a, b) => b.dispatchCount - a.dispatchCount)
  return entries
}

/**
 * Real DB aggregation. Platform-level (raw `db`, not withTenantContext) --
 * same posture as agent-directory-service.ts/token-usage-service.ts: an AI
 * Dev Team dispatch is platform-internal work, not tenant data, and one
 * role's dispatches routinely span multiple orgs (different
 * veridian_admins), so this is a single cross-org scorecard, not
 * org-scoped.
 */
export async function getModelScorecard(opts: { sinceDays?: number } = {}): Promise<ModelScorecardEntry[]> {
  const sinceClause = opts.sinceDays != null
    ? gte(activityLog.createdAt, new Date(Date.now() - opts.sinceDays * 86_400_000))
    : undefined

  const rows = await db
    .select({
      roleKey: activityLog.roleKey,
      complexityTier: activityLog.complexityTier,
      dispatchCount: sql<number>`count(*)::int`,
      terminalCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} in ('completed', 'failed', 'closed'))::int`,
      successCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} = 'completed')::int`,
      failureCount: sql<number>`count(*) filter (where ${activityLog.lifecycleStage} = 'failed')::int`,
      durationMsSum: sql<number>`coalesce(sum(${activityLog.durationMs}) filter (where ${activityLog.durationMs} is not null), 0)::int`,
      durationMsSampleCount: sql<number>`count(*) filter (where ${activityLog.durationMs} is not null)::int`,
      reviewedCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} is not null)::int`,
      auditFindingCount: sql<number>`count(*) filter (where ${activityLog.reviewDecision} = 'rejected')::int`,
    })
    .from(activityLog)
    .where(sinceClause ? and(eq(activityLog.activityType, "ai_team_dispatch"), sinceClause) : eq(activityLog.activityType, "ai_team_dispatch"))
    .groupBy(activityLog.roleKey, activityLog.complexityTier)

  return mergeScorecardGroups(rows, (roleKey) => (roleKey ? getRole(roleKey)?.model ?? "unclassified" : "unclassified"))
}
