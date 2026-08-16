// Wave 31 (Metabase/Superset-inspired saved queries, PLATFORM_STRATEGY.md
// §15). runReport() executes a WHITELISTED grouped-count query per
// sourceEntity -- never raw/arbitrary SQL. That whitelist (both the source
// table and the groupByField) is the explicit security boundary vs.
// Metabase/Superset's SQL editors, which this pass deliberately does not
// adopt: arbitrary SQL against a multi-tenant DB is a real security
// surface this codebase has never exposed anywhere else.
import { savedReports, complianceItems, notices, risks, pmsIssues, incidents, constructionBoqs, constructionWorkProgressEntries, constructionAttendance } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type ReportContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Whitelist of allowed sourceEntity + groupByField combinations -- purely
// for validation (string checks), the actual per-entity query execution
// below is an explicit switch so each branch stays fully typed against its
// own table, rather than a generic cross-table cast.
const GROUP_BY_FIELDS: Record<string, string[]> = {
  compliance_items: ["status", "priority", "departmentId"],
  notices: ["status", "authority"],
  risks: ["status", "category"],
  pms_issues: ["statusId", "priority"],
  incidents: ["stage", "severity"],
  // Wave 118 (PROJEXA reporting integration). construction_boq_line_items is
  // deliberately excluded -- it has no direct orgId column (scoped via its
  // parent BOQ), which doesn't fit this switch's flat orgId-filter pattern.
  construction_boqs: ["status"],
  construction_work_progress_entries: ["activityId"],
  construction_attendance: ["status", "rosterId"],
}

export type SourceEntity = keyof typeof GROUP_BY_FIELDS

// AI Report Builder (2026-07-13, "Need a Report?" upload flow,
// drizzle/0177_ai_report_builder.sql): a distinct, non-live sourceEntity --
// its data is a static AI proposal stored in savedReports.aiGeneratedData,
// never a whitelisted grouped-count query, so it's deliberately kept OUT of
// GROUP_BY_FIELDS (which is the security boundary for the live-query switch
// in runReport() below) and checked separately everywhere that matters.
export const AI_GENERATED_SOURCE_ENTITY = "ai_generated" as const

export function isValidSourceEntity(value: string): value is SourceEntity {
  return value in GROUP_BY_FIELDS
}

export function isValidGroupByField(sourceEntity: SourceEntity, field: string): boolean {
  return GROUP_BY_FIELDS[sourceEntity].includes(field)
}

export async function listSavedReports(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.savedReports.findMany({
      where: eq(savedReports.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

export async function createSavedReport(
  ctx: ReportContext,
  input: {
    name: string; description?: string; sourceEntity: string; filters?: Record<string, unknown>; groupByField?: string
    chartType?: string; visibility?: "private" | "shared"
    // AI Report Builder fields -- only meaningful (and only validated) when
    // sourceEntity === AI_GENERATED_SOURCE_ENTITY.
    aiGeneratedData?: Record<string, unknown>; sourceFileName?: string
  }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  if (input.sourceEntity === AI_GENERATED_SOURCE_ENTITY) {
    const data = input.aiGeneratedData
    if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) {
      throw new ServiceError("aiGeneratedData with columns[] and rows[] is required for sourceEntity 'ai_generated'", 400)
    }
  } else if (!isValidSourceEntity(input.sourceEntity)) {
    throw new ServiceError(`sourceEntity must be one of: ${Object.keys(GROUP_BY_FIELDS).join(", ")}, ${AI_GENERATED_SOURCE_ENTITY}`, 400)
  } else if (input.groupByField && !isValidGroupByField(input.sourceEntity, input.groupByField)) {
    throw new ServiceError(`groupByField must be one of: ${GROUP_BY_FIELDS[input.sourceEntity].join(", ")}`, 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [report] = await db.insert(savedReports).values({
      orgId: ctx.orgId, name, description: input.description || null, ownedById: ctx.userId,
      sourceEntity: input.sourceEntity, filters: input.filters || {}, groupByField: input.groupByField || null,
      chartType: input.chartType || "table", visibility: input.visibility || "private",
      aiGeneratedData: input.sourceEntity === AI_GENERATED_SOURCE_ENTITY ? input.aiGeneratedData : null,
      sourceFileName: input.sourceEntity === AI_GENERATED_SOURCE_ENTITY ? (input.sourceFileName || null) : null,
    }).returning()
    return report
  })
}

export async function updateSavedReport(ctx: { orgId: string }, reportId: string, patch: Partial<{ name: string; description: string | null; filters: Record<string, unknown>; groupByField: string | null; chartType: string; visibility: "private" | "shared" }>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.savedReports.findFirst({ where: and(eq(savedReports.id, reportId), eq(savedReports.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Report not found", 404)
    const [report] = await db.update(savedReports).set({ ...patch, updatedAt: new Date() }).where(eq(savedReports.id, reportId)).returning()
    return report
  })
}

export async function deleteSavedReport(ctx: { orgId: string }, reportId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.savedReports.findFirst({ where: and(eq(savedReports.id, reportId), eq(savedReports.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Report not found", 404)
    await db.delete(savedReports).where(eq(savedReports.id, reportId))
  })
}

type ReportRow = { groupValue: unknown; count: number }

// Executes the report live -- results are never cached/stored, matching
// this codebase's existing "compute actuals live" convention (PMS budgets).
// Explicit per-entity switch (not a generic cross-table function) so each
// branch is fully typed against its own table -- the whitelist above is
// what prevents this from ever becoming an arbitrary-query surface.
export async function runReport(ctx: { orgId: string }, reportId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const report = await db.query.savedReports.findFirst({ where: and(eq(savedReports.id, reportId), eq(savedReports.orgId, ctx.orgId)) })
    if (!report) throw new ServiceError("Report not found", 404)

    // AI-generated reports are static (built once from an uploaded file, see
    // ai-report-builder-service.ts) -- there's no live query to run, so this
    // just echoes back the stored proposal. `rows` mirrors the groupValue/
    // count shape the existing chart renderer (ReportChart in
    // CustomReportsSection.tsx) already knows how to draw for bar/pie/line;
    // the full multi-column table lives in aiGeneratedData.columns/rows,
    // returned alongside for the table view.
    if (report.sourceEntity === AI_GENERATED_SOURCE_ENTITY) {
      const data = (report.aiGeneratedData ?? {}) as { chartRows?: ReportRow[] }
      return { report, rows: data.chartRows ?? [], aiGeneratedData: report.aiGeneratedData }
    }

    if (!isValidSourceEntity(report.sourceEntity)) throw new ServiceError("Report has an invalid sourceEntity", 400)

    const groupBy = report.groupByField && isValidGroupByField(report.sourceEntity, report.groupByField) ? report.groupByField : null
    let rows: ReportRow[] = []

    switch (report.sourceEntity) {
      case "compliance_items": {
        const col = groupBy === "priority" ? complianceItems.priority : groupBy === "departmentId" ? complianceItems.departmentId : groupBy === "status" ? complianceItems.status : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(complianceItems).where(eq(complianceItems.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(complianceItems).where(eq(complianceItems.orgId, ctx.orgId)))[0].count }]
        break
      }
      case "notices": {
        const col = groupBy === "authority" ? notices.authority : groupBy === "status" ? notices.status : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(notices).where(eq(notices.orgId, ctx.orgId)))[0].count }]
        break
      }
      case "risks": {
        const col = groupBy === "category" ? risks.category : groupBy === "status" ? risks.status : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(risks).where(eq(risks.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(risks).where(eq(risks.orgId, ctx.orgId)))[0].count }]
        break
      }
      case "pms_issues": {
        const col = groupBy === "priority" ? pmsIssues.priority : groupBy === "statusId" ? pmsIssues.statusId : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(pmsIssues).where(eq(pmsIssues.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(pmsIssues).where(eq(pmsIssues.orgId, ctx.orgId)))[0].count }]
        break
      }
      case "incidents": {
        const col = groupBy === "severity" ? incidents.severity : groupBy === "stage" ? incidents.stage : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(incidents).where(eq(incidents.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(incidents).where(eq(incidents.orgId, ctx.orgId)))[0].count }]
        break
      }
      case "construction_boqs": {
        const col = groupBy === "status" ? constructionBoqs.status : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(constructionBoqs).where(eq(constructionBoqs.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(constructionBoqs).where(eq(constructionBoqs.orgId, ctx.orgId)))[0].count }]
        break
      }
      case "construction_work_progress_entries": {
        const col = groupBy === "activityId" ? constructionWorkProgressEntries.activityId : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(constructionWorkProgressEntries).where(eq(constructionWorkProgressEntries.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(constructionWorkProgressEntries).where(eq(constructionWorkProgressEntries.orgId, ctx.orgId)))[0].count }]
        break
      }
      case "construction_attendance": {
        const col = groupBy === "rosterId" ? constructionAttendance.rosterId : groupBy === "status" ? constructionAttendance.status : null
        rows = col
          ? await db.select({ groupValue: col, count: sql<number>`count(*)::int` }).from(constructionAttendance).where(eq(constructionAttendance.orgId, ctx.orgId)).groupBy(col)
          : [{ groupValue: "Total", count: (await db.select({ count: sql<number>`count(*)::int` }).from(constructionAttendance).where(eq(constructionAttendance.orgId, ctx.orgId)))[0].count }]
        break
      }
    }

    return { report, rows }
  })
}
