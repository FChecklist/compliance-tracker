// Priority 13 (Self-Serve Ad-Hoc BI / Chart-Builder, MVP scope, drizzle/
// 0187_custom_charts.sql). Confirmed gap: the Reports & Analysis Engine
// (report_definitions, report-engine-service.ts) is a curated catalog a
// developer/AI authors; custom-report-service.ts's savedReports (Wave 31)
// already lets a user build a live chart, but only count aggregation over 5
// whitelisted tables (GROUP_BY_FIELDS). This file adds a genuinely ad-hoc
// chart builder over the newer, larger TABLE_REGISTRY (28+ tables,
// report-engine-service.ts) with count/sum/avg aggregation -- reusing that
// registry and its runAggregationFromConfig() executor VERBATIM (no second
// whitelist, no second query engine, per this codebase's established
// whitelist-only-table-access discipline).
import { customCharts } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import {
  TABLE_REGISTRY, runAggregationFromConfig, getTableRegistryMetadata,
  type AggregationConfig, type ReportDefinitionResult,
} from "./report-engine-service"
export { getTableRegistryMetadata }

export const CHART_TYPES = ["bar", "line", "pie", "table"] as const
export type ChartType = (typeof CHART_TYPES)[number]

export type CreateCustomChartInput = {
  name: string
  chartType?: ChartType
  aggregationConfig: AggregationConfig
}

/**
 * Validates a chart definition against TABLE_REGISTRY -- the exact same
 * whitelist report-engine-service.ts's resolveAggregationTarget() enforces
 * at execution time. Validating here too means a bad tableKey/columnKey is
 * rejected at SAVE time with a clear 400, not only discovered the first time
 * someone tries to run the chart.
 */
export function validateCustomChartInput(input: Partial<CreateCustomChartInput>): { valid: true } | { valid: false; reason: string } {
  if (!input.name?.trim()) return { valid: false, reason: "name is required" }
  if (input.chartType && !CHART_TYPES.includes(input.chartType)) return { valid: false, reason: `chartType must be one of: ${CHART_TYPES.join(", ")}` }

  const config = input.aggregationConfig
  if (!config || config.kind !== "aggregation") return { valid: false, reason: "aggregationConfig with kind:'aggregation' is required" }
  if (!config.tableKey) return { valid: false, reason: "aggregationConfig.tableKey is required" }
  const entry = TABLE_REGISTRY[config.tableKey]
  if (!entry) return { valid: false, reason: `Unknown dataset "${config.tableKey}" -- must be one of: ${Object.keys(TABLE_REGISTRY).join(", ")}` }
  if (config.groupByColumn && !entry.columns[config.groupByColumn]) {
    return { valid: false, reason: `Column "${config.groupByColumn}" is not available for dataset "${config.tableKey}"` }
  }
  if (!["count", "sum", "avg"].includes(config.aggregation)) return { valid: false, reason: "aggregation must be one of: count, sum, avg" }
  if ((config.aggregation === "sum" || config.aggregation === "avg") && !config.aggregationColumnKey) {
    return { valid: false, reason: `aggregationColumnKey is required when aggregation is "${config.aggregation}"` }
  }
  if (config.aggregationColumnKey && !entry.columns[config.aggregationColumnKey]) {
    return { valid: false, reason: `Column "${config.aggregationColumnKey}" is not available for dataset "${config.tableKey}"` }
  }
  if (config.filterEquals && !entry.columns[config.filterEquals.columnKey]) {
    return { valid: false, reason: `Column "${config.filterEquals.columnKey}" is not available for dataset "${config.tableKey}"` }
  }
  return { valid: true }
}

export async function listCustomCharts(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.customCharts.findMany({ where: eq(customCharts.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function createCustomChart(ctx: { orgId: string; userId: string }, input: CreateCustomChartInput) {
  const check = validateCustomChartInput(input)
  if (!check.valid) throw new ServiceError(check.reason, 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(customCharts).values({
      orgId: ctx.orgId,
      name: input.name.trim(),
      chartType: input.chartType ?? "bar",
      aggregationConfig: input.aggregationConfig,
      createdById: ctx.userId,
    }).returning()
    return row
  })
}

export async function updateCustomChart(ctx: { orgId: string }, id: string, patch: Partial<CreateCustomChartInput>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.customCharts.findFirst({ where: and(eq(customCharts.id, id), eq(customCharts.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Custom chart not found", 404)

    const merged: CreateCustomChartInput = {
      name: patch.name ?? existing.name,
      chartType: (patch.chartType ?? existing.chartType) as ChartType,
      aggregationConfig: (patch.aggregationConfig ?? existing.aggregationConfig) as AggregationConfig,
    }
    const check = validateCustomChartInput(merged)
    if (!check.valid) throw new ServiceError(check.reason, 400)

    const [row] = await db.update(customCharts).set({
      name: merged.name.trim(), chartType: merged.chartType, aggregationConfig: merged.aggregationConfig, updatedAt: new Date(),
    }).where(eq(customCharts.id, id)).returning()
    return row
  })
}

export async function deleteCustomChart(ctx: { orgId: string }, id: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.customCharts.findFirst({ where: and(eq(customCharts.id, id), eq(customCharts.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Custom chart not found", 404)
    await db.delete(customCharts).where(eq(customCharts.id, id))
  })
}

/** Runs a saved chart definition live -- through report-engine-service.ts's own runAggregationFromConfig(), the exact same dispatcher deterministic_aggregation report_definitions rows use. Never caches/stores results, matching this codebase's "compute actuals live" convention. */
export async function runCustomChart(ctx: { orgId: string }, id: string): Promise<ReportDefinitionResult> {
  const chart = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.customCharts.findFirst({ where: and(eq(customCharts.id, id), eq(customCharts.orgId, ctx.orgId)) })
  )
  if (!chart) throw new ServiceError("Custom chart not found", 404)
  return runAggregationFromConfig({ orgId: ctx.orgId }, chart.aggregationConfig as AggregationConfig)
}
