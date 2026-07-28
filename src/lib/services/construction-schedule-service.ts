// Wave 174 (PROJEXA Owner resource-management spec, item 10: Schedule) --
// upload an Excel baseline schedule, track real progress against it over
// time. Excel parsing reuses this codebase's dynamic-import(`xlsx`) pattern
// from src/lib/ingest/parser.ts (there is no BOQ-specific importer to reuse
// -- construction-boq-service.ts takes plain JSON, never Excel). Progress is
// NEVER tracked here: constructionScheduleItems stores only the imported
// baseline (planned dates/qty); when a row is linked to a constructionActivities
// row via activityId, its real progress is read live from the existing Work
// Progress Report data (constructionWorkProgressEntries, Wave 115) -- one
// progress signal, not two, per the Owner's explicit constraint.
import {
  constructionScheduleItems, constructionActivities, constructionWorkProgressEntries, projects,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

async function getXlsx() {
  const mod = await import("xlsx")
  return mod.default ?? mod
}

export type ScheduleRowDraft = {
  wbsCode: string | null
  taskName: string
  unit: string | null
  plannedQuantity: number | null
  plannedStartDate: string | null
  plannedEndDate: string | null
}

const HEADER_ALIASES: Record<string, keyof ScheduleRowDraft | "skip"> = {
  "wbs": "wbsCode", "wbs code": "wbsCode", "item code": "wbsCode", "code": "wbsCode",
  "task": "taskName", "task name": "taskName", "activity": "taskName", "description": "taskName",
  "unit": "unit", "uom": "unit",
  "qty": "plannedQuantity", "quantity": "plannedQuantity", "planned quantity": "plannedQuantity",
  "start": "plannedStartDate", "start date": "plannedStartDate", "planned start": "plannedStartDate", "planned start date": "plannedStartDate",
  "end": "plannedEndDate", "end date": "plannedEndDate", "planned end": "plannedEndDate", "planned end date": "plannedEndDate",
}

function normaliseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/** Maps loose spreadsheet rows (arbitrary header casing/spacing) to schedule drafts. Exported pure so header-mapping/row-validation is directly testable without a real Excel file. Rows with no recognisable task name are dropped, not defaulted. */
export function mapRowsToScheduleItems(rows: Record<string, unknown>[]): ScheduleRowDraft[] {
  const drafts: ScheduleRowDraft[] = []
  for (const row of rows) {
    const draft: Partial<ScheduleRowDraft> = {}
    for (const [rawHeader, value] of Object.entries(row)) {
      const key = HEADER_ALIASES[rawHeader.trim().toLowerCase()]
      if (!key || key === "skip") continue
      const str = value === null || value === undefined ? null : String(value).trim()
      if (key === "plannedQuantity") {
        const n = Number(value)
        draft.plannedQuantity = Number.isFinite(n) ? n : null
      } else if (key === "plannedStartDate") {
        draft.plannedStartDate = normaliseDate(value)
      } else if (key === "plannedEndDate") {
        draft.plannedEndDate = normaliseDate(value)
      } else if (key === "wbsCode") {
        draft.wbsCode = str
      } else if (key === "unit") {
        draft.unit = str
      } else if (key === "taskName") {
        draft.taskName = str ?? undefined
      }
    }
    if (!draft.taskName?.trim()) continue
    drafts.push({
      wbsCode: draft.wbsCode ?? null,
      taskName: draft.taskName.trim(),
      unit: draft.unit ?? null,
      plannedQuantity: draft.plannedQuantity ?? null,
      plannedStartDate: draft.plannedStartDate ?? null,
      plannedEndDate: draft.plannedEndDate ?? null,
    })
  }
  return drafts
}

export async function parseScheduleExcel(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const XLSX = await getXlsx()
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellNF: false, cellText: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new ServiceError("Excel file has no sheets", 400)
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, dateNF: "yyyy-mm-dd", blankrows: false }) as Record<string, unknown>[]
  if (rows.length === 0) throw new ServiceError("Excel file is empty or has no data rows", 400)
  return rows
}

export async function importScheduleFromExcel(
  ctx: { orgId: string; userId: string },
  input: { projectId: string; buffer: Buffer; fileName: string }
) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)

  const rows = await parseScheduleExcel(input.buffer)
  const drafts = mapRowsToScheduleItems(rows)
  if (drafts.length === 0) throw new ServiceError("No rows with a recognisable task name were found in this file", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const rowsToInsert = drafts.map((d) => ({
      orgId: ctx.orgId, projectId: input.projectId,
      wbsCode: d.wbsCode, taskName: d.taskName, unit: d.unit,
      plannedQuantity: d.plannedQuantity !== null ? String(d.plannedQuantity) : null,
      plannedStartDate: d.plannedStartDate, plannedEndDate: d.plannedEndDate,
      sourceFileName: input.fileName, importedById: ctx.userId,
    }))
    const inserted = await db.insert(constructionScheduleItems).values(rowsToInsert).returning()
    return { imported: inserted.length, items: inserted }
  })
}

export async function linkScheduleItemToActivity(ctx: { orgId: string }, scheduleItemId: string, activityId: string | null) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const item = await db.query.constructionScheduleItems.findFirst({ where: and(eq(constructionScheduleItems.id, scheduleItemId), eq(constructionScheduleItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Schedule item not found", 404)
    if (activityId) {
      const activity = await db.query.constructionActivities.findFirst({ where: and(eq(constructionActivities.id, activityId), eq(constructionActivities.orgId, ctx.orgId)) })
      if (!activity) throw new ServiceError("Activity not found", 404)
    }
    const [row] = await db.update(constructionScheduleItems).set({ activityId }).where(eq(constructionScheduleItems.id, scheduleItemId)).returning()
    return row
  })
}

export type ScheduleWithProgressRow = {
  id: string
  wbsCode: string | null
  taskName: string
  unit: string | null
  plannedQuantity: number | null
  plannedStartDate: string | null
  plannedEndDate: string | null
  activityId: string | null
  percentComplete: number | null // null = not linked to a Work Progress activity yet
}

/** Pure join, exported for direct testing (no DB): schedule baseline rows + the latest WPR percentComplete per linked activity (reduced from an already entryDate-desc-ordered list, first occurrence wins). */
export function joinScheduleWithProgress(
  items: { id: string; wbsCode: string | null; taskName: string; unit: string | null; plannedQuantity: string | number | null; plannedStartDate: string | null; plannedEndDate: string | null; activityId: string | null }[],
  progressEntriesDescByDate: { activityId: string; percentComplete: number }[]
): ScheduleWithProgressRow[] {
  const latestByActivityId = new Map<string, number>()
  for (const entry of progressEntriesDescByDate) {
    if (!latestByActivityId.has(entry.activityId)) latestByActivityId.set(entry.activityId, entry.percentComplete)
  }
  return items.map((item) => ({
    id: item.id, wbsCode: item.wbsCode, taskName: item.taskName, unit: item.unit,
    plannedQuantity: item.plannedQuantity !== null ? Number(item.plannedQuantity) : null,
    plannedStartDate: item.plannedStartDate, plannedEndDate: item.plannedEndDate,
    activityId: item.activityId,
    percentComplete: item.activityId ? latestByActivityId.get(item.activityId) ?? 0 : null,
  }))
}

export async function listScheduleWithProgress(ctx: { orgId: string }, projectId: string): Promise<ScheduleWithProgressRow[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const items = await db.query.constructionScheduleItems.findMany({
      where: and(eq(constructionScheduleItems.orgId, ctx.orgId), eq(constructionScheduleItems.projectId, projectId)),
      orderBy: (t, { asc }) => asc(t.plannedStartDate),
    })

    const activityIds = [...new Set(items.map((i) => i.activityId).filter((v): v is string => !!v))]
    const progressEntries = activityIds.length > 0
      ? await db.query.constructionWorkProgressEntries.findMany({
          where: and(eq(constructionWorkProgressEntries.orgId, ctx.orgId), inArray(constructionWorkProgressEntries.activityId, activityIds)),
          orderBy: (t, { desc }) => desc(t.entryDate),
        })
      : []

    return joinScheduleWithProgress(items, progressEntries)
  })
}
