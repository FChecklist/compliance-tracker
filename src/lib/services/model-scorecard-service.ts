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
//
// AI Model Lifecycle & Benchmarking, Ongoing Quality Monitoring pass
// (added later, this same file): this scorecard's own PLATFORM_STRATEGY.md
// 30.2 status row admitted two gaps -- "no hallucination-score or cost
// field yet (cost lives separately in token-usage-service.ts)". Cost is
// closed below: token_usage_ledger (token-usage-service.ts) genuinely has
// a `model` column already, grouped and merged in as a real, additive
// total -- not a duplicate pipeline, the exact same ledger the Finance
// summary already reads, just re-grouped for this shape. Honestly NOT
// tier-split -- token_usage_ledger has no complexity_tier column (a
// dispatch's cost isn't tagged with the tier it was validated against),
// so costUsd is attached at model granularity and repeated identically
// across that model's own tier rows; see COST_GRANULARITY_NOTE.
// hallucination-score stays genuinely NOT computable, same honesty
// discipline as ITERATION_COUNT_NOTE below -- confirmed by grep
// (2026-08-15) that no persisted signal anywhere in this codebase scores
// an individual dispatch's output for fabricated/incorrect claims; the
// closest real things are auditFindingRate (a human/reviewer verdict on
// the whole dispatch, not a hallucination-specific measure) and the
// static communication-guardrails.ts pattern-matchers (regex rules on
// draft communications, not a per-dispatch scored signal persisted
// anywhere). Documented via HALLUCINATION_SCORE_NOTE rather than
// fabricating a number.
import { db, activityLog, tokenUsageLedger } from "@/lib/db"
import { and, eq, gte, sql } from "drizzle-orm"
import { getRole } from "@/lib/ai-team/roster"

export const ITERATION_COUNT_NOTE =
  "Not computable from persisted data yet: the repo-write dispatch path (scripts/ai-workforce-agent.mjs's MAX_ITERATIONS tool-call loop) has no DATABASE_URL in CI and cannot persist a per-dispatch iteration count; the DB-backed advisory path (POST /api/ai/team/dispatch, runRole()) is a single non-looping LLM call, so an iteration count there would always trivially be 1 -- not a real distinguishing signal. Wiring iteration reporting requires an infrastructure decision (DB access from CI, or an authenticated callback), not a new column -- flagged honestly rather than fabricated."

export const HALLUCINATION_SCORE_NOTE =
  "Not computable from persisted data yet: no persisted signal anywhere in this codebase scores an individual dispatch's output for fabricated/incorrect claims. auditFindingRate (reviewDecision='rejected') is the closest real proxy but is a whole-dispatch pass/fail verdict from a human/reviewer, not a hallucination-specific measure; communication-guardrails.ts's pattern-matchers catch specific known phrasings (e.g. a hallucinated 'already sent' claim) at send-time but don't persist a per-dispatch score anywhere. Flagged honestly rather than fabricated -- matches ITERATION_COUNT_NOTE's own discipline."

export const COST_GRANULARITY_NOTE =
  "costUsd is real spend from token_usage_ledger (scope='ai_team_internal'), grouped by model -- token_usage_ledger has no complexity_tier column, so this total cannot be split per tier and is attached identically to every complexityTier row this model appears in. Do not sum costUsd.totalUsd across a single model's own tier rows -- that double-counts; sum across distinct MODELS only."

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
  /** Real spend from token_usage_ledger, grouped by model only (see COST_GRANULARITY_NOTE). null (not 0) when this model has no recorded ledger rows in the window -- same null-vs-zero discipline as avgDurationMs. */
  costUsd: { totalUsd: number | null; note: string }
  /** Honestly not computable yet -- see HALLUCINATION_SCORE_NOTE. */
  hallucinationScore: { value: number | null; note: string }
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
    // Filled in by attachModelCost() below -- kept absent here so this
    // function stays a pure merge of activity_log-derived groups only,
    // same pure-core/DB-shell split token_usage_ledger's own query needs
    // to respect (a second, independent aggregate, not part of this one).
    costUsd: { totalUsd: null, note: COST_GRANULARITY_NOTE },
    hallucinationScore: { value: null, note: HALLUCINATION_SCORE_NOTE },
  }))

  // Highest-volume model+tier first -- same "most consequential first"
  // ordering convention as agent-directory-service.ts's common-errors query.
  entries.sort((a, b) => b.dispatchCount - a.dispatchCount)
  return entries
}

/** One model's real total spend in the window, from token_usage_ledger grouped by model. */
export type ModelCostRow = { model: string; totalUsd: number }

/**
 * Pure: attaches each model's real ledger total onto every scorecard entry
 * for that model (repeated across its tier rows -- see COST_GRANULARITY_NOTE
 * on why this can't be tier-split), leaving costUsd.totalUsd null for a
 * model with no matching ledger rows in the window rather than defaulting
 * to 0. Kept separate from mergeScorecardGroups so that function's own
 * activity_log-only contract (and its existing tests) stay untouched.
 */
export function attachModelCost(entries: ModelScorecardEntry[], costRows: ModelCostRow[]): ModelScorecardEntry[] {
  const costByModel = new Map(costRows.map((r) => [r.model, r.totalUsd]))
  return entries.map((entry) => {
    const totalUsd = costByModel.get(entry.model)
    return totalUsd === undefined ? entry : { ...entry, costUsd: { totalUsd, note: COST_GRANULARITY_NOTE } }
  })
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

  const entries = mergeScorecardGroups(rows, (roleKey) => (roleKey ? getRole(roleKey)?.model ?? "unclassified" : "unclassified"))

  const costSinceClause = opts.sinceDays != null
    ? gte(tokenUsageLedger.createdAt, new Date(Date.now() - opts.sinceDays * 86_400_000))
    : undefined
  const costRows: ModelCostRow[] = await db
    .select({
      model: tokenUsageLedger.model,
      totalUsd: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float`,
    })
    .from(tokenUsageLedger)
    .where(costSinceClause ? and(eq(tokenUsageLedger.scope, "ai_team_internal"), costSinceClause) : eq(tokenUsageLedger.scope, "ai_team_internal"))
    .groupBy(tokenUsageLedger.model)

  return attachModelCost(entries, costRows)
}
