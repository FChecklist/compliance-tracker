// VERIDIAN Review Framework gap-closure (2026-07-18), "Audit Trail & Change
// History" -- Medium: "No unified cross-table audit query/search interface."
// Query layer over compliance.audit_search (drizzle/0229_audit_search_view.sql),
// the view unioning audit_logs/orchestra_executions/activity_log into one
// common shape. Not modeled as a Drizzle schema table (this codebase has no
// existing precedent for that -- attached_asset_triggers, the one other
// view here, is likewise queried only via raw SQL) -- a plain
// `db.execute(sql...)` through withTenantContext, same pattern
// mdm-quality-service.ts already uses for a raw cross-table query.
//
// Always runs through withTenantContext (never the direct `db` import) --
// the view's own security_invoker + current_org_id() filter (see that
// migration's header) depends on the app.current_org_id GUC actually being
// set, exactly like every other tenant-scoped query in this codebase.
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { sql, type SQL } from "drizzle-orm"

export type AuditSearchRow = {
  sourceTable: "audit_logs" | "orchestra_executions" | "activity_log"
  id: string
  orgId: string
  userId: string | null
  actorLabel: string | null
  action: string
  entityType: string | null
  entityId: string | null
  details: string | null
  createdAt: string
}

export type AuditSearchFilters = {
  /** Restrict to one or more of the 3 unioned source tables -- omitted means all. */
  sourceTables?: Array<AuditSearchRow["sourceTable"]>
  /** Substring match against `action` (ILIKE) -- e.g. 'approve', 'chat.ai_thread_reply'. */
  actionContains?: string
  entityType?: string
  entityId?: string
  userId?: string
  fromDate?: Date
  toDate?: Date
  limit?: number
}

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 100
const VALID_SOURCE_TABLES = new Set(["audit_logs", "orchestra_executions", "activity_log"])

/** Cross-table audit search: one query surface over audit_logs + orchestra_executions + activity_log, ordered newest-first. */
export async function searchAuditTrail(ctx: { orgId: string }, filters: AuditSearchFilters = {}): Promise<AuditSearchRow[]> {
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions: SQL[] = []
    if (filters.sourceTables?.length) {
      const validated = filters.sourceTables.filter((t) => VALID_SOURCE_TABLES.has(t))
      if (validated.length > 0) conditions.push(sql`source_table = ANY(${validated})`)
    }
    if (filters.actionContains) conditions.push(sql`action ILIKE ${"%" + filters.actionContains + "%"}`)
    if (filters.entityType) conditions.push(sql`entity_type = ${filters.entityType}`)
    if (filters.entityId) conditions.push(sql`entity_id = ${filters.entityId}`)
    if (filters.userId) conditions.push(sql`user_id = ${filters.userId}`)
    if (filters.fromDate) conditions.push(sql`created_at >= ${filters.fromDate}`)
    if (filters.toDate) conditions.push(sql`created_at <= ${filters.toDate}`)

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``

    const rows = await db.execute(sql`
      SELECT source_table, id, org_id, user_id, actor_label, action, entity_type, entity_id, details, created_at
      FROM compliance.audit_search
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)

    return (rows as unknown as Record<string, unknown>[]).map((r) => ({
      sourceTable: r.source_table as AuditSearchRow["sourceTable"],
      id: r.id as string,
      orgId: r.org_id as string,
      userId: (r.user_id as string | null) ?? null,
      actorLabel: (r.actor_label as string | null) ?? null,
      action: r.action as string,
      entityType: (r.entity_type as string | null) ?? null,
      entityId: (r.entity_id as string | null) ?? null,
      details: (r.details as string | null) ?? null,
      createdAt: r.created_at as string,
    }))
  })
}
