// VERIDIAN Review Framework remediation (AI Orchestration observability gap,
// 2026-07-18): "no unified orchestration observability layer." Recommended
// approach: "Extend orchestra-execution-logger.ts into a queryable trace
// view."
//
// orchestra-analytics-service.ts (Wave 95) already covers the AGGREGATE half
// of this -- totals, cost-by-model, latency percentiles, executions-by-day.
// What genuinely didn't exist: a way to look at INDIVIDUAL executions --
// list them, filter by layer/status/model, and drill into one row's full
// input/output. This module is that missing half, over the exact same
// orchestra_executions table recordOrchestraExecution() already writes --
// no new telemetry, no new table, purely a read surface.
import { orchestraExecutions, orchestraLayers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, lt, desc, sql, type SQL } from "drizzle-orm"

export type OrchestraTraceListItem = {
  id: string
  layerKey: string
  eventType: string
  status: string
  model: string | null
  provider: string | null
  durationMs: number | null
  costUsd: number | null
  promptTokens: number | null
  completionTokens: number | null
  createdAt: string
}

export type OrchestraTraceFilters = {
  layerKey?: string
  status?: string
  model?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

export type OrchestraTraceListResult = {
  traces: OrchestraTraceListItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export async function listOrchestraTraces(ctx: { orgId: string }, filters: OrchestraTraceFilters = {}): Promise<OrchestraTraceListResult> {
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
  const offset = (page - 1) * limit

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions: SQL[] = [eq(orchestraExecutions.orgId, ctx.orgId)]
    if (filters.layerKey) {
      const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, filters.layerKey) })
      // A layerKey filter that matches no real layer must return zero rows,
      // not "filter ignored, show everything" -- id-not-a-real-uuid also
      // safely matches nothing rather than throwing.
      conditions.push(eq(orchestraExecutions.orchestraLayerId, layer?.id ?? "no-such-layer"))
    }
    if (filters.status) conditions.push(eq(orchestraExecutions.status, filters.status))
    if (filters.model) conditions.push(eq(orchestraExecutions.model, filters.model))
    if (filters.startDate) conditions.push(gte(orchestraExecutions.createdAt, new Date(filters.startDate)))
    if (filters.endDate) {
      const end = new Date(filters.endDate)
      end.setDate(end.getDate() + 1)
      conditions.push(lt(orchestraExecutions.createdAt, end))
    }
    const where = and(...conditions)

    const [rows, [{ count }], layers] = await Promise.all([
      db.query.orchestraExecutions.findMany({ where, orderBy: desc(orchestraExecutions.createdAt), limit, offset }),
      db.select({ count: sql<number>`count(*)::int` }).from(orchestraExecutions).where(where),
      db.query.orchestraLayers.findMany(),
    ])

    const layerKeyById = new Map(layers.map((l) => [l.id, l.layerKey]))

    return {
      traces: rows.map((r) => ({
        id: r.id,
        layerKey: layerKeyById.get(r.orchestraLayerId) ?? r.orchestraLayerId,
        eventType: r.eventType,
        status: r.status,
        model: r.model,
        provider: r.provider,
        durationMs: r.durationMs,
        costUsd: r.costUsd !== null ? Number(r.costUsd) : null,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        createdAt: r.createdAt.toISOString(),
      })),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    }
  })
}

export type OrchestraTraceDetail = OrchestraTraceListItem & {
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  taskId: string | null
  clientId: string | null
  userId: string | null
}

/** Single-trace drill-down -- the full input/output a list row's summary omits. Returns null both when the id doesn't exist and when it exists but belongs to another org (RLS-enforced via withTenantContext, same "not found" response either way -- never leaks a cross-tenant row's existence). */
export async function getOrchestraTraceDetail(ctx: { orgId: string }, id: string): Promise<OrchestraTraceDetail | null> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const row = await db.query.orchestraExecutions.findFirst({ where: and(eq(orchestraExecutions.id, id), eq(orchestraExecutions.orgId, ctx.orgId)) })
    if (!row) return null
    const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.id, row.orchestraLayerId) })

    return {
      id: row.id,
      layerKey: layer?.layerKey ?? row.orchestraLayerId,
      eventType: row.eventType,
      status: row.status,
      model: row.model,
      provider: row.provider,
      durationMs: row.durationMs,
      costUsd: row.costUsd !== null ? Number(row.costUsd) : null,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      createdAt: row.createdAt.toISOString(),
      input: row.input as Record<string, unknown>,
      output: row.output as Record<string, unknown> | null,
      taskId: row.taskId,
      clientId: row.clientId,
      userId: row.userId,
    }
  })
}
