// Token Usage Ledger (Finance). Unified record of both AI Team internal
// spend and product/customer Orchestra Layer spend -- see schema.ts's
// tokenUsageLedger comment for why this couldn't just reuse
// orchestra_executions. Uses the raw `db` client (postgres role), same
// "platform-governed asset" posture as prompt-os-resolver.ts and
// orchestra-model-resolver.ts's platform-scoped reads -- this ledger spans
// both platform-internal (no org) and per-org rows, so it was never a fit
// for withTenantContext's org-scoped model.
import { db, tokenUsageLedger } from "@/lib/db"
import { sql, gte, and, isNotNull } from "drizzle-orm"
import { estimateCostUsd, type LLMUsage } from "@/lib/llm-client"
import { buildSpendForecast, startOfMonthUtc, type SpendForecast } from "@/lib/spend-forecast"

export type LogTokenUsageInput = {
  scope: "ai_team_internal" | "product_orchestra"
  orgId?: string | null
  userId?: string | null
  roleKey?: string | null
  layerKey?: string | null
  taskSummary?: string | null
  provider: string
  model: string
  usage: LLMUsage
}

/** Fire-and-forget-safe: caller decides whether to await or not. Never throws past a caught/logged failure. */
export async function logTokenUsage(input: LogTokenUsageInput): Promise<void> {
  try {
    const estimatedCostUsd = estimateCostUsd(input.model, input.usage)
    await db.insert(tokenUsageLedger).values({
      scope: input.scope,
      orgId: input.orgId ?? null,
      userId: input.userId ?? null,
      roleKey: input.roleKey ?? null,
      layerKey: input.layerKey ?? null,
      taskSummary: input.taskSummary?.slice(0, 300) ?? null,
      provider: input.provider,
      model: input.model,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      estimatedCostUsd: estimatedCostUsd !== null ? String(estimatedCostUsd) : null,
    })
  } catch (err) {
    console.error("[token-usage] failed to log usage (non-fatal):", err)
  }
}

export type TokenUsageSummaryRow = {
  groupKey: string | null
  requests: number
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
}

export type TokenUsageSummary = {
  sinceDays: number
  totalCostUsd: number
  totalRequests: number
  byScope: TokenUsageSummaryRow[]
  byRole: TokenUsageSummaryRow[]
  byModel: TokenUsageSummaryRow[]
  byOrg: TokenUsageSummaryRow[]
  // AI Cost Governance & FinOps gap-closure (2026-07-18): "forecasted vs
  // actual monthly AI spend," platform-wide (across every org + AI-Team
  // internal spend combined) -- the Finance-facing counterpart to
  // cost-guard.ts's per-org forecast (surfaced in OrgLimitsSection.tsx).
  // Same linear run-rate calc (spend-forecast.ts), independent of this
  // report's own `sinceDays` window since a monthly forecast is always
  // calendar-month-scoped regardless of what window the rest of the report
  // was requested with.
  platformMonthlyForecast: SpendForecast
}

const AGG_COLUMNS = {
  requests: sql<number>`count(*)::int`,
  promptTokens: sql<number>`coalesce(sum(${tokenUsageLedger.promptTokens}), 0)::int`,
  completionTokens: sql<number>`coalesce(sum(${tokenUsageLedger.completionTokens}), 0)::int`,
  estimatedCostUsd: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float`,
}

/** Pure-ish DB wrapper: total platform-wide spend (every scope/org combined) since the start of the current calendar month, projected to month end via the shared linear run-rate calc. */
export async function getPlatformMonthlyForecast(now = new Date()): Promise<SpendForecast> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float` })
    .from(tokenUsageLedger)
    .where(gte(tokenUsageLedger.createdAt, startOfMonthUtc(now)))
  return buildSpendForecast(row?.total ?? 0, now)
}

/** Finance-facing report: real spend, grouped every way that answers "where and why". veridian_admin-gated at the route level. */
export async function getTokenUsageSummary(sinceDays = 7): Promise<TokenUsageSummary> {
  const since = new Date(Date.now() - sinceDays * 86400_000)
  const sinceClause = gte(tokenUsageLedger.createdAt, since)

  const [byScope, byRole, byModel, byOrg, totals, platformMonthlyForecast] = await Promise.all([
    db.select({ groupKey: tokenUsageLedger.scope, ...AGG_COLUMNS })
      .from(tokenUsageLedger).where(sinceClause)
      .groupBy(tokenUsageLedger.scope).orderBy(sql`4 desc`),
    db.select({ groupKey: tokenUsageLedger.roleKey, ...AGG_COLUMNS })
      .from(tokenUsageLedger).where(and(sinceClause, isNotNull(tokenUsageLedger.roleKey)))
      .groupBy(tokenUsageLedger.roleKey).orderBy(sql`4 desc`),
    db.select({ groupKey: tokenUsageLedger.model, ...AGG_COLUMNS })
      .from(tokenUsageLedger).where(sinceClause)
      .groupBy(tokenUsageLedger.model).orderBy(sql`4 desc`),
    db.select({ groupKey: tokenUsageLedger.orgId, ...AGG_COLUMNS })
      .from(tokenUsageLedger).where(and(sinceClause, isNotNull(tokenUsageLedger.orgId)))
      .groupBy(tokenUsageLedger.orgId).orderBy(sql`4 desc`),
    db.select({ requests: sql<number>`count(*)::int`, estimatedCostUsd: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float` })
      .from(tokenUsageLedger).where(sinceClause),
    getPlatformMonthlyForecast(),
  ])

  return {
    sinceDays,
    totalCostUsd: totals[0]?.estimatedCostUsd ?? 0,
    totalRequests: totals[0]?.requests ?? 0,
    byScope,
    byRole,
    byModel,
    byOrg,
    platformMonthlyForecast,
  }
}
