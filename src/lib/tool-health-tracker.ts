// Wave 166 (tree4-unified/10-merged-governance-layer.yaml U-D14.B1.S1 "Tool
// Health" gap): records whether an individual tool call succeeded or
// failed, and aggregates that into a health percentage over a time window.
//
// Deliberately a NEW file and a NEW table (toolHealthEvents, schema.ts),
// not an extension of orchestra-execution-logger.ts or orchestraExecutions
// -- that file is out of scope for this wave, and the relationship is
// many-to-one anyway (one LLM-call execution can invoke several tools; a
// single boolean column on orchestraExecutions can't represent that).
// recordToolCallResult() mirrors recordOrchestraExecution()'s own posture
// exactly: fire-and-forget, caught/logged failure, never blocks or fails
// the real tool call it's recording.
import { toolHealthEvents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, sql } from "drizzle-orm"

export type RecordToolCallResultInput = {
  orgId: string
  /** Soft reference to orchestraExecutions.id, by convention -- omit when the tool call didn't happen inside an orchestra-logged LLM execution. */
  executionId?: string
  toolName: string
  succeeded: boolean
  errorMessage?: string
  durationMs?: number
}

export function recordToolCallResult(params: RecordToolCallResultInput): void {
  withTenantContext({ orgId: params.orgId }, async (db) => {
    await db.insert(toolHealthEvents).values({
      orgId: params.orgId,
      executionId: params.executionId ?? null,
      toolName: params.toolName,
      succeeded: params.succeeded,
      errorMessage: params.errorMessage ?? null,
      durationMs: params.durationMs ?? null,
    })
  }).catch((err) => console.warn(`tool_health_events logging failed for tool '${params.toolName}' (non-fatal):`, err))
}

export type ToolHealthSummary = {
  toolName: string
  totalCalls: number
  succeededCalls: number
  /** null when there were zero calls in the window -- distinct from 0%, which means calls happened and all failed. */
  healthPercentage: number | null
}

/**
 * Aggregate tool-health percentage for a single tool name over the last
 * `windowMs` milliseconds, scoped to `orgId`. Mirrors orchestra-analytics-
 * service.ts's `count(*) filter (where ...)` aggregation style.
 */
export async function getToolHealthPercentage(orgId: string, toolName: string, windowMs: number): Promise<ToolHealthSummary> {
  const since = new Date(Date.now() - windowMs)
  return withTenantContext({ orgId }, async (db) => {
    const [row] = await db.select({
      total: sql<number>`count(*)`,
      succeeded: sql<number>`count(*) filter (where ${toolHealthEvents.succeeded} = true)`,
    }).from(toolHealthEvents).where(and(
      eq(toolHealthEvents.orgId, orgId),
      eq(toolHealthEvents.toolName, toolName),
      gte(toolHealthEvents.createdAt, since),
    ))

    const total = Number(row?.total ?? 0)
    const succeeded = Number(row?.succeeded ?? 0)
    return {
      toolName,
      totalCalls: total,
      succeededCalls: succeeded,
      healthPercentage: total > 0 ? Math.round((succeeded / total) * 100) : null,
    }
  })
}
