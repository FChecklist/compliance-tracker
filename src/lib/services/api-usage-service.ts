// Wave 96 (Comparison CSV 3 gap analysis: API002/API009 "Rate Limiting +
// Usage Analytics"). Real aggregation over api_key_request_log, which
// validateApiKey() populates on every API-key-authenticated request --
// no separate telemetry pipeline.
import { apiKeyRequestLog } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, gte, sql } from "drizzle-orm"

export type ApiUsageSummary = {
  totalRequests: number
  rateLimitedRequests: number
  rateLimitedRate: number
  requestsByDay: { day: string; count: number }[]
  topRoutes: { route: string; method: string; count: number }[]
}

export async function getApiUsageAnalytics(ctx: { orgId: string }, sinceDays: number = 30): Promise<ApiUsageSummary> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - sinceDays)
    const where = and(eq(apiKeyRequestLog.orgId, ctx.orgId), gte(apiKeyRequestLog.createdAt, cutoff))

    const [totals] = await db.select({
      total: sql<number>`count(*)`,
      rateLimited: sql<number>`count(*) filter (where ${apiKeyRequestLog.wasRateLimited} = true)`,
    }).from(apiKeyRequestLog).where(where)

    const total = Number(totals?.total ?? 0)
    const rateLimited = Number(totals?.rateLimited ?? 0)

    const requestsByDay = await db.select({
      day: sql<string>`to_char(${apiKeyRequestLog.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)`,
    }).from(apiKeyRequestLog).where(where)
      .groupBy(sql`to_char(${apiKeyRequestLog.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${apiKeyRequestLog.createdAt}, 'YYYY-MM-DD') asc`)

    const topRoutes = await db.select({
      route: apiKeyRequestLog.route,
      method: apiKeyRequestLog.method,
      count: sql<number>`count(*)`,
    }).from(apiKeyRequestLog).where(where)
      .groupBy(apiKeyRequestLog.route, apiKeyRequestLog.method)
      .orderBy(sql`count(*) desc`)
      .limit(10)

    return {
      totalRequests: total,
      rateLimitedRequests: rateLimited,
      rateLimitedRate: total > 0 ? rateLimited / total : 0,
      requestsByDay: requestsByDay.map((r) => ({ day: r.day, count: Number(r.count) })),
      topRoutes: topRoutes.map((r) => ({ route: r.route, method: r.method, count: Number(r.count) })),
    }
  })
}
