// tree4-unified U-D19.B1.S1 ("Reporting Framework" -- "Every AI model
// reports on an identical cadence (Daily/Hourly/Per-Task/Weekly/Monthly/
// Quarterly/Annual), each covering Performance/Quality/Failures/
// Escalations/Token-Usage/Learning/Knowledge-Updates/Recommendations/
// Risk-Trends"). Confirmed genuinely 0% before this wave (custom-report-
// service.ts is user-authored ad-hoc BI querying, a materially different
// thing from an automated AI-performance pipeline; API-16's own evidence
// note says so explicitly).
//
// Scope, stated honestly rather than silently narrowed: this builds ONE
// real, deterministic report generator sourced entirely from data this
// codebase already collects with zero new tracking infrastructure --
//   - Performance/Failures: orchestra_executions.status, grouped and turned
//     into a failure rate (real rows, written by every real Orchestra Layer
//     call via recordOrchestraExecution()).
//   - Token-Usage: reuses token-usage-service.ts's getTokenUsageSummary()
//     verbatim (Finance's own existing, real report) rather than
//     duplicating its aggregation.
//   - Quality: worker_agents.accuracyScore, averaged across every agent
//     that has one -- the only accuracy-shaped column that exists anywhere
//     in this schema.
//   - Learning/Knowledge-Updates: loop_improvements rows (a real, populated
//     table -- loop-improvement-proposer.ts is a live writer), counted by
//     generated/deployed/rolled-back and averaged by improvementDelta.
// Escalations/Recommendations/Risk-Trends are honestly NOT covered --
// escalation-ladder.ts's nextEscalationRung() only ever writes a chat
// message (confirmed by reading its call site in task-execution-engine.ts),
// there is no persisted, queryable escalation-events table to aggregate;
// "Recommendations" and "Risk-Trends" have no deterministic source table
// anywhere in this schema either. Fabricating numbers for these would be
// exactly the kind of thing this codebase's guardrail discipline forbids
// (no LLM self-grading, no invented signal) -- they're named in
// `notCovered` on every report instead of silently omitted.
//
// Cadence: only "daily" is actually wired to a cron entry by this wave (see
// /api/internal/ai-performance-report/run + vercel.json). The other 6 named
// cadences (Hourly/Per-Task/Weekly/Monthly/Quarterly/Annual) are NOT
// separate engineering -- generateAiPerformanceReport(days) already takes
// an arbitrary period length, so adding another cadence later is a second
// vercel.json cron entry calling the same function with a different `days`
// value, not new code. Not pre-built here because there is no real
// consumer/schedule for them yet (matching this codebase's "no code
// speculatively built for an unused cadence" discipline).
import { db, orchestraExecutions, workerAgents, loopImprovements } from "@/lib/db"
import { gte, sql } from "drizzle-orm"
import { getTokenUsageSummary, type TokenUsageSummary } from "./token-usage-service"

export type ExecutionStatusCounts = Record<string, number>

const FAILURE_STATUSES = new Set(["failed", "error"])

/** Pure: turns a raw status->count map into total/failed/failureRate. Zero executions in the period is not a division-by-zero bug -- failureRate is defined as 0 in that case (nothing failed because nothing ran), not NaN. */
export function computeFailureRate(statusCounts: ExecutionStatusCounts): { total: number; failed: number; failureRate: number } {
  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0)
  const failed = Object.entries(statusCounts)
    .filter(([status]) => FAILURE_STATUSES.has(status))
    .reduce((sum, [, count]) => sum + count, 0)
  return { total, failed, failureRate: total > 0 ? failed / total : 0 }
}

/** Pure: average of a numeric-string column (Drizzle numeric columns come back as strings), dropping nulls. Returns null (not 0) when there is no data -- "no signal" and "zero score" must stay distinguishable to a reader of the report. */
export function averageNumericColumn(values: (string | null)[]): number | null {
  const parsed = values.filter((v): v is string => v !== null).map(Number).filter((n) => !Number.isNaN(n))
  if (parsed.length === 0) return null
  return parsed.reduce((sum, n) => sum + n, 0) / parsed.length
}

export type AiPerformanceReport = {
  cadence: "daily"
  periodStart: string
  periodEnd: string
  performance: { statusCounts: ExecutionStatusCounts; total: number; failed: number; failureRate: number }
  tokenUsage: TokenUsageSummary
  quality: { agentsWithScore: number; avgAccuracyScore: number | null }
  learning: { improvementsGenerated: number; improvementsDeployed: number; improvementsRolledBack: number; avgImprovementDelta: number | null }
  /** Named requirement dimensions this report honestly does not cover, and why -- see this file's own header. */
  notCovered: { dimension: string; reason: string }[]
}

/** Real DB aggregation -- see this file's header for exactly which tables/columns each section reads. */
export async function generateAiPerformanceReport(days = 1): Promise<AiPerformanceReport> {
  const periodEndDate = new Date()
  const periodStartDate = new Date(periodEndDate.getTime() - days * 86_400_000)

  const [statusRows, tokenUsage, agents, improvements] = await Promise.all([
    db.select({ status: orchestraExecutions.status, count: sql<number>`count(*)::int` })
      .from(orchestraExecutions)
      .where(gte(orchestraExecutions.createdAt, periodStartDate))
      .groupBy(orchestraExecutions.status),
    getTokenUsageSummary(days),
    db.query.workerAgents.findMany({ columns: { accuracyScore: true } }),
    db.query.loopImprovements.findMany({ where: gte(loopImprovements.createdAt, periodStartDate) }),
  ])

  const statusCounts: ExecutionStatusCounts = {}
  for (const row of statusRows) statusCounts[row.status] = row.count
  const performance = { statusCounts, ...computeFailureRate(statusCounts) }

  const accuracyScores = agents.map((a) => a.accuracyScore)
  const avgAccuracyScore = averageNumericColumn(accuracyScores)

  return {
    cadence: "daily",
    periodStart: periodStartDate.toISOString(),
    periodEnd: periodEndDate.toISOString(),
    performance,
    tokenUsage,
    quality: { agentsWithScore: accuracyScores.filter((s) => s !== null).length, avgAccuracyScore },
    learning: {
      improvementsGenerated: improvements.length,
      improvementsDeployed: improvements.filter((i) => i.isDeployed).length,
      improvementsRolledBack: improvements.filter((i) => i.rollbackTriggered).length,
      avgImprovementDelta: averageNumericColumn(improvements.map((i) => i.improvementDelta)),
    },
    notCovered: [
      { dimension: "escalations", reason: "escalation-ladder.ts's nextEscalationRung() only writes a chat message today -- no persisted, queryable escalation-events table exists to aggregate." },
      { dimension: "recommendations", reason: "no deterministic recommendation-tracking table exists in this schema." },
      { dimension: "risk_trends", reason: "no deterministic, time-series risk-scoring table exists in this schema (risk-classification.ts scores individual items, not a trend series)." },
    ],
  }
}
