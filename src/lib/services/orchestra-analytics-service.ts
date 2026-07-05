// Wave 95 (Comparison CSV 3 gap analysis: AI010 "Orchestra Analytics
// Dashboard"). A real dashboard over the existing orchestra_executions data
// (Wave 22/23 observability columns) -- no new telemetry, purely surfacing
// what recordOrchestraExecution() already captures on every real LLM call.
// Latency percentiles use Postgres's own percentile_cont, not an
// application-side approximation. Denial rate reads status='denied' rows,
// which are real policy-engine refusals (Wave 46's Constitution/Policy
// Enforcement Engine) that never reached an LLM at all.
import { orchestraExecutions } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, gte, sql } from "drizzle-orm"

export type OrchestraAnalyticsSummary = {
  totalExecutions: number
  completedCount: number
  failedCount: number
  deniedCount: number
  failureRate: number
  denialRate: number
  totalCostUsd: number
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  costByModel: { model: string; provider: string; costUsd: number; executions: number }[]
  executionsByDay: { day: string; count: number }[]
}

export async function getOrchestraAnalytics(ctx: { orgId: string }, sinceDays: number = 30): Promise<OrchestraAnalyticsSummary> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - sinceDays)

    const [totals] = await db.select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${orchestraExecutions.status} = 'completed')`,
      failed: sql<number>`count(*) filter (where ${orchestraExecutions.status} = 'failed')`,
      denied: sql<number>`count(*) filter (where ${orchestraExecutions.status} = 'denied')`,
      totalCost: sql<number>`coalesce(sum(${orchestraExecutions.costUsd}), 0)`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${orchestraExecutions.durationMs})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${orchestraExecutions.durationMs})`,
    }).from(orchestraExecutions).where(and(eq(orchestraExecutions.orgId, ctx.orgId), gte(orchestraExecutions.createdAt, cutoff)))

    const total = Number(totals?.total ?? 0)
    const completed = Number(totals?.completed ?? 0)
    const failed = Number(totals?.failed ?? 0)
    const denied = Number(totals?.denied ?? 0)

    const costByModel = await db.select({
      model: orchestraExecutions.model,
      provider: orchestraExecutions.provider,
      costUsd: sql<number>`coalesce(sum(${orchestraExecutions.costUsd}), 0)`,
      executions: sql<number>`count(*)`,
    }).from(orchestraExecutions)
      .where(and(eq(orchestraExecutions.orgId, ctx.orgId), gte(orchestraExecutions.createdAt, cutoff), sql`${orchestraExecutions.model} is not null`))
      .groupBy(orchestraExecutions.model, orchestraExecutions.provider)
      .orderBy(sql`sum(${orchestraExecutions.costUsd}) desc nulls last`)

    const executionsByDay = await db.select({
      day: sql<string>`to_char(${orchestraExecutions.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)`,
    }).from(orchestraExecutions)
      .where(and(eq(orchestraExecutions.orgId, ctx.orgId), gte(orchestraExecutions.createdAt, cutoff)))
      .groupBy(sql`to_char(${orchestraExecutions.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${orchestraExecutions.createdAt}, 'YYYY-MM-DD') asc`)

    return {
      totalExecutions: total,
      completedCount: completed,
      failedCount: failed,
      deniedCount: denied,
      failureRate: total > 0 ? failed / total : 0,
      denialRate: total > 0 ? denied / total : 0,
      totalCostUsd: Number(totals?.totalCost ?? 0),
      latencyP50Ms: totals?.p50 !== null && totals?.p50 !== undefined ? Number(totals.p50) : null,
      latencyP95Ms: totals?.p95 !== null && totals?.p95 !== undefined ? Number(totals.p95) : null,
      costByModel: costByModel.map((r) => ({ model: r.model ?? "unknown", provider: r.provider ?? "unknown", costUsd: Number(r.costUsd), executions: Number(r.executions) })),
      executionsByDay: executionsByDay.map((r) => ({ day: r.day, count: Number(r.count) })),
    }
  })
}
