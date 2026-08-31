// AI Model Lifecycle & Benchmarking gap-closure (VERIDIAN Review Framework,
// 2026-08-15), Finding 2: "Cost-per-quality-point tracked per model to
// inform routing decisions." Gap confirmed by direct code read: token_usage_
// ledger (token-usage-service.ts) is a real, per-role/per-model cost ledger;
// model-scorecard-service.ts is a real per-model quality-ish signal
// (successRate/auditFindingRate from activity_log) -- but its own header
// explicitly documents NOT joining token_usage_ledger, calling it "a
// different, already-shipped capability" it deliberately doesn't duplicate.
// No function anywhere in the repo joins cost and quality for the same
// model/role. Per this finding's own recommended approach ("depends on row
// 99 being built first"), this joins against role-quality-regression-
// service.ts's new role_quality_runs (Finding 1's per-role eval pass rate)
// rather than re-deriving a second quality signal.
//
// The join key is exact, not a fuzzy time-window heuristic: every eval call
// role-quality-regression-service.ts makes tags its token_usage_ledger row
// with `taskSummary = 'role_quality_run:<runId>'`, so summing ledger rows
// by that exact tag gives the real, precise cost of exactly that run's
// calls -- no risk of accidentally attributing an unrelated concurrent
// dispatch's spend to a quality run just because it happened nearby in time.
import { db, roleQualityRuns, tokenUsageLedger } from "@/lib/db"
import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm"

export type CostPerQualityRun = {
  runId: string
  roleKey: string
  model: string
  passRate: number
  passedCases: number
  totalCases: number
  regressionDetected: boolean
  costUsd: number
  /** costUsd / passedCases. null when passedCases = 0 -- cost was spent but nothing passed, an undefined ratio, never fabricated as 0 or Infinity. */
  costPerPassedCase: number | null
  createdAt: string
}

const RUN_TAG_PREFIX = "role_quality_run:"

/** Real DB join: role_quality_runs (quality) x token_usage_ledger (cost), matched on the exact per-run tag. */
export async function getCostPerQualityRuns(opts: { roleKey?: string; sinceDays?: number; limit?: number } = {}): Promise<CostPerQualityRun[]> {
  const conditions: SQL[] = []
  if (opts.roleKey) conditions.push(eq(roleQualityRuns.roleKey, opts.roleKey))
  if (opts.sinceDays != null) conditions.push(gte(roleQualityRuns.createdAt, new Date(Date.now() - opts.sinceDays * 86_400_000)))

  const runs = await db.query.roleQualityRuns.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: opts.limit ?? 100,
  })
  if (runs.length === 0) return []

  const costRows = await db
    .select({
      taskSummary: tokenUsageLedger.taskSummary,
      costUsd: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float`,
    })
    .from(tokenUsageLedger)
    .where(inArray(tokenUsageLedger.taskSummary, runs.map((r) => `${RUN_TAG_PREFIX}${r.id}`)))
    .groupBy(tokenUsageLedger.taskSummary)

  const costByRunId = new Map(costRows.map((r) => [(r.taskSummary ?? "").replace(RUN_TAG_PREFIX, ""), r.costUsd]))

  return runs.map((run) => {
    const costUsd = costByRunId.get(run.id) ?? 0
    return {
      runId: run.id,
      roleKey: run.roleKey,
      model: run.model,
      passRate: Number(run.passRate),
      passedCases: run.passedCases,
      totalCases: run.totalCases,
      regressionDetected: run.regressionDetected,
      costUsd,
      costPerPassedCase: run.passedCases > 0 ? costUsd / run.passedCases : null,
      createdAt: run.createdAt.toISOString(),
    }
  })
}

export type RoleCostQualityEntry = {
  roleKey: string
  model: string
  runCount: number
  totalCostUsd: number
  totalPassedCases: number
  totalCases: number
  /** totalPassedCases / totalCases across every included run -- exact addition, not an average-of-averages (same discipline as model-scorecard-service.ts's mergeScorecardGroups). */
  aggregatePassRate: number | null
  /** totalCostUsd / totalPassedCases -- the routing-facing headline number: real $ spent per passed eval case, this role/model's whole history. null when nothing has ever passed (undefined ratio, not 0 or Infinity). */
  costPerQualityPoint: number | null
  /** Most recent run's verdict for this role -- surfaces "is this role's quality trending down right now" alongside the cost figure. */
  latestRegressionDetected: boolean
}

/**
 * Pure: groups already-fetched runs by (roleKey, model) and sums exactly
 * (never averages an average). `runs` must be ordered most-recent-first
 * (getCostPerQualityRuns's own contract) so the first run seen per group is
 * the one whose regressionDetected becomes latestRegressionDetected.
 */
export function aggregateCostPerQuality(runs: CostPerQualityRun[]): RoleCostQualityEntry[] {
  type Accumulator = {
    roleKey: string
    model: string
    runCount: number
    totalCostUsd: number
    totalPassedCases: number
    totalCases: number
    latestRegressionDetected: boolean
  }
  const merged = new Map<string, Accumulator>()

  for (const run of runs) {
    const key = `${run.roleKey}::${run.model}`
    const existing = merged.get(key)
    if (existing) {
      existing.runCount += 1
      existing.totalCostUsd += run.costUsd
      existing.totalPassedCases += run.passedCases
      existing.totalCases += run.totalCases
      // existing.latestRegressionDetected already set from the first (most
      // recent) run seen for this key -- do not overwrite with an older run.
    } else {
      merged.set(key, {
        roleKey: run.roleKey, model: run.model, runCount: 1,
        totalCostUsd: run.costUsd, totalPassedCases: run.passedCases, totalCases: run.totalCases,
        latestRegressionDetected: run.regressionDetected,
      })
    }
  }

  const entries: RoleCostQualityEntry[] = Array.from(merged.values()).map((m) => ({
    roleKey: m.roleKey,
    model: m.model,
    runCount: m.runCount,
    totalCostUsd: m.totalCostUsd,
    totalPassedCases: m.totalPassedCases,
    totalCases: m.totalCases,
    aggregatePassRate: m.totalCases > 0 ? m.totalPassedCases / m.totalCases : null,
    costPerQualityPoint: m.totalPassedCases > 0 ? m.totalCostUsd / m.totalPassedCases : null,
    latestRegressionDetected: m.latestRegressionDetected,
  }))

  // Most expensive-per-quality-point first -- the routing decision this
  // finding exists to inform is "which model is burning money for the
  // least passing quality," so that's the head of the list, not the tail.
  // Entries with no signal (costPerQualityPoint null) sort last.
  entries.sort((a, b) => (b.costPerQualityPoint ?? -1) - (a.costPerQualityPoint ?? -1))
  return entries
}

/** DB-shell wrapper: real per-role/model cost-per-quality-point, to inform routing decisions. */
export async function getCostPerQualityPoints(opts: { sinceDays?: number; limit?: number } = {}): Promise<RoleCostQualityEntry[]> {
  const runs = await getCostPerQualityRuns(opts)
  return aggregateCostPerQuality(runs)
}
