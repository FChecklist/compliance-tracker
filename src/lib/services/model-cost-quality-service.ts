// AI Model Lifecycle & Benchmarking gap-closure, Finding 2: "Cost-per-
// quality-point tracked per model to inform routing decisions." The
// finding's own recommended approach: "Depends on row 99 being built
// first" -- row 99 is Finding 1 (model-quality-regression-service.ts),
// built alongside this file in the same PR.
//
// Investigated before writing this: cost tracking (token_usage_ledger,
// token-usage-service.ts) and quality tracking (role_quality_snapshots,
// model-quality-regression-service.ts) are real, but nothing joins them --
// confirmed by grepping both services for any cross-reference to the
// other; there is none. This file is that join, at MODEL granularity (not
// role_key) because routing decisions (orchestra-model-resolver.ts,
// AGENTS.md Rule 8/10) are made per model, and one model is commonly
// shared by several roles (roster.ts's own GLM_52 comment: "every role
// that isn't vision/research/second-opinion").
import { db, tokenUsageLedger, roleQualitySnapshots } from "@/lib/db"
import { and, eq, gte, sql } from "drizzle-orm"

export type ModelQualityAgg = { model: string; avgScore: number; snapshotCount: number }
export type ModelCostAgg = { model: string; totalCostUsd: number; requests: number }

export type CostPerQualityEntry = {
  model: string
  avgQualityScore: number | null
  qualitySnapshotCount: number
  totalCostUsd: number
  requests: number
  costPerRequestUsd: number | null
  /** totalCostUsd / avgQualityScore -- lower is better value for routing. null when there is no quality signal for this model yet (no snapshots), NOT when cost is zero -- a model that's never been scored can't be ranked, that's a missing-data state, not an infinitely-cheap one. */
  costPerQualityPoint: number | null
}

/**
 * Pure: merges independently-aggregated cost and quality rows by model.
 * A model present in one input but not the other still appears in the
 * output (routing needs to know "we're spending on this with zero quality
 * signal" and "we've scored this but never actually routed to it" as
 * distinct, visible states -- silently dropping either would hide a real
 * gap, not just declutter the table).
 */
export function joinCostAndQuality(
  costRows: ModelCostAgg[],
  qualityRows: ModelQualityAgg[]
): CostPerQualityEntry[] {
  const costByModel = new Map(costRows.map((r) => [r.model, r]))
  const qualityByModel = new Map(qualityRows.map((r) => [r.model, r]))
  const allModels = new Set([...costByModel.keys(), ...qualityByModel.keys()])

  const entries: CostPerQualityEntry[] = Array.from(allModels).map((model) => {
    const cost = costByModel.get(model)
    const quality = qualityByModel.get(model)
    const totalCostUsd = cost?.totalCostUsd ?? 0
    const requests = cost?.requests ?? 0
    const avgQualityScore = quality?.avgScore ?? null

    return {
      model,
      avgQualityScore,
      qualitySnapshotCount: quality?.snapshotCount ?? 0,
      totalCostUsd,
      requests,
      costPerRequestUsd: requests > 0 ? totalCostUsd / requests : null,
      // avgQualityScore is 0-100; guard against a real 0 score (a role
      // that's failing every probe) producing a division-by-zero
      // Infinity -- that's "infinitely expensive per point", not a
      // missing-data null, so it's reported as such rather than hidden.
      costPerQualityPoint:
        avgQualityScore === null ? null : avgQualityScore === 0 ? Infinity : totalCostUsd / avgQualityScore,
    }
  })

  // Best-value-first: lowest cost-per-quality-point ranks first (the
  // routing-relevant ordering the finding asks for), unscored models
  // (null) last -- can't recommend routing toward a model with no quality
  // signal regardless of how cheap it looks.
  entries.sort((a, b) => {
    if (a.costPerQualityPoint === null && b.costPerQualityPoint === null) return b.totalCostUsd - a.totalCostUsd
    if (a.costPerQualityPoint === null) return 1
    if (b.costPerQualityPoint === null) return -1
    return a.costPerQualityPoint - b.costPerQualityPoint
  })

  return entries
}

/**
 * Real DB wrapper. Platform-level (raw `db`), same posture as
 * token-usage-service.ts and model-quality-regression-service.ts -- both
 * source tables this joins are already platform-level.
 */
export async function getCostPerQualityPoint(sinceDays = 30): Promise<CostPerQualityEntry[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000)

  const costRows = await db
    .select({
      model: tokenUsageLedger.model,
      totalCostUsd: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float`,
      requests: sql<number>`count(*)::int`,
    })
    .from(tokenUsageLedger)
    .where(and(gte(tokenUsageLedger.createdAt, since), eq(tokenUsageLedger.scope, "ai_team_internal")))
    .groupBy(tokenUsageLedger.model)

  const qualityRows = await db
    .select({
      model: roleQualitySnapshots.model,
      avgScore: sql<number>`avg(${roleQualitySnapshots.score})::float`,
      snapshotCount: sql<number>`count(*)::int`,
    })
    .from(roleQualitySnapshots)
    .where(gte(roleQualitySnapshots.createdAt, since))
    .groupBy(roleQualitySnapshots.model)

  return joinCostAndQuality(
    costRows.map((r) => ({ model: r.model ?? "unknown", totalCostUsd: Number(r.totalCostUsd), requests: Number(r.requests) })),
    qualityRows.map((r) => ({ model: r.model, avgScore: Number(r.avgScore), snapshotCount: Number(r.snapshotCount) }))
  )
}
