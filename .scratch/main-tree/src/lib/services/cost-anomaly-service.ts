// AI Cost Governance & FinOps gap-closure (2026-07-18): "Cost anomaly
// detection (a single tenant/role spiking spend)". Prior to this, spend
// control was static-threshold only (cost-guard.ts's monthlyCostCapUsd) --
// real, but it only ever fires once an admin-configured absolute dollar
// cap is crossed. It says nothing about a tenant or AI-Team role whose
// spend suddenly jumped relative to its OWN normal pattern, which is what
// this closes. Per the task's own recommended approach ("simple
// ratio-based deviation check first, cheap, explainable -- escalate to
// statistical methods only if needed"): this is deliberately NOT a
// z-score/stddev model. It compares the last `recentWindowDays` of real
// spend (token_usage_ledger, same source cost-guard.ts and
// token-usage-service.ts already read) against the average daily spend of
// the `baselineWindowDays` immediately before that window, per org
// (scope='product_orchestra') and separately per AI-Team role
// (scope='ai_team_internal') -- "tenant" and "role" respectively, matching
// the finding's own wording.
import { db, tokenUsageLedger } from "@/lib/db"
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm"

export type CostAnomalyGroupType = "org" | "role"

export type CostAnomaly = {
  groupType: CostAnomalyGroupType
  groupKey: string
  recentSpendUsd: number
  baselineAvgDailyUsd: number
  // null when there is no baseline spend at all to divide by -- a "new
  // spender" anomaly is still real and worth surfacing, just not
  // expressible as a ratio. Never NaN/Infinity: this field is either a
  // finite number or explicitly null.
  ratio: number | null
  isNewSpender: boolean
}

const DEFAULT_RATIO_THRESHOLD = 3
// Ignores spend below $1 in the recent window entirely -- a tenant going
// from $0.02 to $0.10 is a 5x "spike" that means nothing at this scale.
// Keeps the report explainable (every anomaly it lists is real money), not
// just numerically correct.
const DEFAULT_MIN_SPEND_FLOOR_USD = 1

export type ClassifyAnomalyInput = {
  groupType: CostAnomalyGroupType
  groupKey: string
  recentSpendUsd: number
  baselineAvgDailyUsd: number
}

export type ClassifyAnomalyOptions = {
  ratioThreshold?: number
  minSpendFloorUsd?: number
}

/** Pure: the actual ratio-based deviation check. Returns null when the group isn't anomalous (including "too small to matter"). */
export function classifyAnomaly(input: ClassifyAnomalyInput, opts: ClassifyAnomalyOptions = {}): CostAnomaly | null {
  const ratioThreshold = opts.ratioThreshold ?? DEFAULT_RATIO_THRESHOLD
  const minSpendFloorUsd = opts.minSpendFloorUsd ?? DEFAULT_MIN_SPEND_FLOOR_USD
  const { recentSpendUsd, baselineAvgDailyUsd } = input

  if (recentSpendUsd < minSpendFloorUsd) return null

  if (baselineAvgDailyUsd <= 0) {
    return { ...input, ratio: null, isNewSpender: true }
  }

  const ratio = recentSpendUsd / baselineAvgDailyUsd
  if (ratio < ratioThreshold) return null
  return { ...input, ratio, isNewSpender: false }
}

export type CostAnomalyReport = {
  recentWindowDays: number
  baselineWindowDays: number
  ratioThreshold: number
  anomalies: CostAnomaly[]
}

const SUM_COST = sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float`

async function spendByGroup(groupCol: typeof tokenUsageLedger.orgId | typeof tokenUsageLedger.roleKey, scope: string, start: Date, end: Date | null) {
  return db
    .select({ groupKey: groupCol, total: SUM_COST })
    .from(tokenUsageLedger)
    .where(and(
      eq(tokenUsageLedger.scope, scope),
      isNotNull(groupCol),
      gte(tokenUsageLedger.createdAt, start),
      ...(end ? [lt(tokenUsageLedger.createdAt, end)] : []),
    ))
    .groupBy(groupCol)
}

function toAnomalies(
  groupType: CostAnomalyGroupType,
  recentRows: { groupKey: string | null; total: number }[],
  baselineRows: { groupKey: string | null; total: number }[],
  baselineWindowDays: number,
  ratioThreshold: number,
): CostAnomaly[] {
  const baselineMap = new Map(baselineRows.map((r) => [r.groupKey, r.total]))
  const anomalies: CostAnomaly[] = []
  for (const row of recentRows) {
    if (row.groupKey === null) continue
    const baselineTotal = baselineMap.get(row.groupKey) ?? 0
    const anomaly = classifyAnomaly(
      { groupType, groupKey: row.groupKey, recentSpendUsd: row.total, baselineAvgDailyUsd: baselineTotal / baselineWindowDays },
      { ratioThreshold },
    )
    if (anomaly) anomalies.push(anomaly)
  }
  return anomalies
}

/** DB wrapper: detects org (tenant) and AI-Team role spend spikes over the last `recentWindowDays` vs the `baselineWindowDays` immediately before it. */
export async function detectCostAnomalies(recentWindowDays = 1, baselineWindowDays = 7, ratioThreshold = DEFAULT_RATIO_THRESHOLD): Promise<CostAnomalyReport> {
  const now = new Date()
  const recentStart = new Date(now.getTime() - recentWindowDays * 86_400_000)
  const baselineStart = new Date(recentStart.getTime() - baselineWindowDays * 86_400_000)

  const [recentByOrg, baselineByOrg, recentByRole, baselineByRole] = await Promise.all([
    spendByGroup(tokenUsageLedger.orgId, "product_orchestra", recentStart, null),
    spendByGroup(tokenUsageLedger.orgId, "product_orchestra", baselineStart, recentStart),
    spendByGroup(tokenUsageLedger.roleKey, "ai_team_internal", recentStart, null),
    spendByGroup(tokenUsageLedger.roleKey, "ai_team_internal", baselineStart, recentStart),
  ])

  const anomalies = [
    ...toAnomalies("org", recentByOrg, baselineByOrg, baselineWindowDays, ratioThreshold),
    ...toAnomalies("role", recentByRole, baselineByRole, baselineWindowDays, ratioThreshold),
  ]

  return { recentWindowDays, baselineWindowDays, ratioThreshold, anomalies }
}
