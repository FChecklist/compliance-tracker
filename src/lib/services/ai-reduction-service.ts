// VERIDIAN Review Framework remediation (Predictive AI Model Selection gap,
// 2026-07-18): "No metric tracks whether AI usage/dependence decreases over
// time." Recommended approach: "Track classifyExecution() bucket
// distribution monthly as a proxy for AI-reduction."
//
// software-coverage-service.ts's classifyExecution()/
// classifyExecutionWithReliability() is a pure decision function -- it
// returns a bucket, it never persists anything itself. The actual
// persistence is capability-learning-service.ts's recordExecutionOutcome(),
// called by task-execution-engine.ts and dialogue-script-executor.ts on
// every real classification, which increments taskCapabilities'
// CUMULATIVE fullSoftwareCount/packageAvailableCount/novelCount counters.
// Those counters have no per-event timestamp, so there was no way to derive
// a monthly trend from them directly -- only the cumulative total right
// now. This module adds the missing piece: a monthly snapshot of the
// SUMMED cumulative counters (ai_reduction_snapshots, schema.ts), so
// diffing two consecutive snapshots recovers that specific month's real
// (non-cumulative) bucket distribution.
import { db, taskCapabilities, aiReductionSnapshots } from "@/lib/db"
import { sql } from "drizzle-orm"

export type AiReductionSnapshotRow = {
  snapshotDate: string
  fullSoftwareCount: number
  packageAvailableCount: number
  novelCount: number
  totalCount: number
}

/** Sums every task_capabilities row's cumulative counters platform-wide and inserts one snapshot row for today. Safe to call more than once on the same calendar day (e.g. a manual re-run) -- each call is a new, independent row; nothing here assumes exactly one snapshot per day. */
export async function takeAiReductionSnapshot(): Promise<AiReductionSnapshotRow> {
  const [totals] = await db
    .select({
      fullSoftwareCount: sql<number>`coalesce(sum(${taskCapabilities.fullSoftwareCount}), 0)`,
      packageAvailableCount: sql<number>`coalesce(sum(${taskCapabilities.packageAvailableCount}), 0)`,
      novelCount: sql<number>`coalesce(sum(${taskCapabilities.novelCount}), 0)`,
    })
    .from(taskCapabilities)

  const fullSoftwareCount = Number(totals?.fullSoftwareCount ?? 0)
  const packageAvailableCount = Number(totals?.packageAvailableCount ?? 0)
  const novelCount = Number(totals?.novelCount ?? 0)
  const totalCount = fullSoftwareCount + packageAvailableCount + novelCount
  const snapshotDate = new Date().toISOString().slice(0, 10)

  await db.insert(aiReductionSnapshots).values({ snapshotDate, fullSoftwareCount, packageAvailableCount, novelCount, totalCount })

  return { snapshotDate, fullSoftwareCount, packageAvailableCount, novelCount, totalCount }
}

export type MonthlyBucketDelta = {
  periodEnd: string
  fullSoftwareDelta: number
  packageAvailableDelta: number
  novelDelta: number
  totalDelta: number
  /** (fullSoftwareDelta + packageAvailableDelta) / totalDelta for this period -- the actual AI-reduction proxy. null when totalDelta is 0 (no classified activity that period, not "0% software-covered"). */
  softwareCoverageRatio: number | null
}

/**
 * Pure: diffs two consecutive cumulative snapshots into that period's real
 * (non-cumulative) bucket counts -- the underlying counters only ever
 * increase, so `current - previous` recovers exactly what happened between
 * the two snapshot dates. Clamped at 0: a negative diff would mean a
 * capability row was deleted or a counter reset between snapshots (not
 * something recordExecutionOutcome() ever does today, but this function
 * doesn't assume that invariant holds forever), not a real negative
 * occurrence count.
 *
 * `previous: null` (the very first snapshot ever taken) reports the whole
 * cumulative total as this "period"'s delta -- there is no earlier snapshot
 * to diff against, so the honest answer is "everything up to now," not 0.
 */
export function computeMonthlyBucketDelta(current: AiReductionSnapshotRow, previous: AiReductionSnapshotRow | null): MonthlyBucketDelta {
  const fullSoftwareDelta = previous ? Math.max(0, current.fullSoftwareCount - previous.fullSoftwareCount) : current.fullSoftwareCount
  const packageAvailableDelta = previous ? Math.max(0, current.packageAvailableCount - previous.packageAvailableCount) : current.packageAvailableCount
  const novelDelta = previous ? Math.max(0, current.novelCount - previous.novelCount) : current.novelCount
  const totalDelta = fullSoftwareDelta + packageAvailableDelta + novelDelta

  return {
    periodEnd: current.snapshotDate,
    fullSoftwareDelta,
    packageAvailableDelta,
    novelDelta,
    totalDelta,
    softwareCoverageRatio: totalDelta > 0 ? (fullSoftwareDelta + packageAvailableDelta) / totalDelta : null,
  }
}

/** Reads the last `limitMonths` snapshots (oldest to newest) and returns each one's diffed monthly delta -- the real trend line, not the raw cumulative rows. */
export async function getAiReductionTrend(limitMonths = 12): Promise<MonthlyBucketDelta[]> {
  const rows = await db.query.aiReductionSnapshots.findMany({
    orderBy: (t, { desc }) => desc(t.snapshotDate),
    limit: limitMonths + 1,
  })
  const ascending = [...rows].reverse()

  const deltas: MonthlyBucketDelta[] = []
  for (let i = 0; i < ascending.length; i++) {
    const previous = i > 0 ? ascending[i - 1] : null
    deltas.push(computeMonthlyBucketDelta(ascending[i], previous))
  }
  return deltas.slice(-limitMonths)
}
