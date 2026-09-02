// Wave 115 (PROJEXA foundation) service layer -- Work Progress hierarchy
// (Category -> Activity) and daily progress entries against an activity.
// Deliberately project-scoped, not org-wide templates (Wave 1 simplicity,
// see schema.ts comment on constructionCategories) -- an org-wide
// template/copy-down feature can be added later without a breaking migration.
import {
  constructionCategories, constructionActivities, constructionWorkProgressEntries, constructionBoqLineItems, constructionBoqs, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, gte, inArray, lte } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { listDocuments } from "./document-service"
export { ServiceError }

// R48 gap-closure (2026-08-29, F039: "Daily progress report with photos" --
// genuinely missing, confirmed by searching the whole repo for any file
// with "daily" in its name before writing this: none existed). Composed
// entirely from real, already-built pieces rather than a new subsystem: the
// same progress entries listProgressEntries() already returns (filtered to
// one project + one day, using the dateFrom/dateTo filters added for F086
// above), plus document-service.ts's existing generic upload/list
// (linkedEntityType/linkedEntityId are free-text discriminators by design --
// see that file's own header comment -- so "progress_daily_report" +
// "<projectId>_<date>" is a real, valid link, not a workaround). "Created"
// happens implicitly the first time a photo is uploaded against that
// (projectId, date) key -- there is no separate report row to create or go
// stale, matching this codebase's read-time-aggregation convention (see
// construction-reports-service.ts's own header comment on the same
// preference).
export function dailyProgressReportLinkId(projectId: string, date: string): string {
  return `${projectId}_${date}`
}

export async function getDailyProgressReport(ctx: { orgId: string }, projectId: string, date: string) {
  const [entries, photos] = await Promise.all([
    listProgressEntries(ctx, { projectId, dateFrom: date, dateTo: date }),
    listDocuments(ctx, { linkedEntityType: "progress_daily_report", linkedEntityId: dailyProgressReportLinkId(projectId, date) }),
  ])
  return { projectId, date, entries, photos }
}

async function assertProject(db: TenantDb, orgId: string, projectId: string) {
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)) })
  if (!project) throw new ServiceError("Project not found", 404)
}

export async function listCategories(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionCategories.findMany({ where: and(eq(constructionCategories.orgId, ctx.orgId), eq(constructionCategories.projectId, projectId)) })
  )
}

export async function createCategory(ctx: { orgId: string }, input: { projectId: string; name: string; parentCategoryId?: string }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await assertProject(db, ctx.orgId, input.projectId)
    const [row] = await db.insert(constructionCategories).values({
      orgId: ctx.orgId, projectId: input.projectId, name, parentCategoryId: input.parentCategoryId || null,
    }).returning()
    return row
  })
}

export async function listActivities(ctx: { orgId: string }, filters: { projectId?: string; categoryId?: string }) {
  if (!filters.projectId && !filters.categoryId) throw new ServiceError("projectId or categoryId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionActivities.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionActivities.projectId, filters.projectId))
    if (filters.categoryId) conditions.push(eq(constructionActivities.categoryId, filters.categoryId))
    return db.query.constructionActivities.findMany({ where: and(...conditions) })
  })
}

export async function createActivity(ctx: { orgId: string }, input: { projectId: string; categoryId: string; name: string; unit?: string; plannedQuantity?: number }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.categoryId) throw new ServiceError("categoryId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await assertProject(db, ctx.orgId, input.projectId)
    const category = await db.query.constructionCategories.findFirst({ where: and(eq(constructionCategories.id, input.categoryId), eq(constructionCategories.orgId, ctx.orgId)) })
    if (!category) throw new ServiceError("Category not found", 404)
    const [row] = await db.insert(constructionActivities).values({
      orgId: ctx.orgId, projectId: input.projectId, categoryId: input.categoryId, name,
      unit: input.unit || null, plannedQuantity: input.plannedQuantity !== undefined ? String(input.plannedQuantity) : null,
    }).returning()
    return row
  })
}

// R48 gap-closure (2026-08-29, F086: "Progress search and filter by date and
// line"): the only filters here were projectId/activityId -- no way to
// filter by a date range or by a specific BOQ line item, confirmed by
// reading the API route (only those 2 params were ever read from the
// querystring). Added dateFrom/dateTo (inclusive, entryDate is a plain date
// column) and boqLineItemId (the direct-link column added by R12 point 7)
// as additional, purely optional filters -- every existing caller that
// passes none of them keeps getting exactly the same result set as before.
// R67 F-05 (R-075). The four display fields the Work Progress list needs on
// every row, resolved HERE, inside the transaction that already read the
// entries -- not by the browser.
//
// What this replaces: PROJEXA's Daily Entry screen used to fetch the entries,
// then GET /api/scope (1.5-4.4 s -- the full BOQ list with every line item of
// every revision), then GET /api/scope/{id} for the current revision, purely
// to turn a boqLineItemId into a readable "A-102 -- Blockwork". Analytics then
// repeated the same three-hop chain on tab switch. That was 15 requests and
// 7.4 s to network idle on a screen whose own backend answers in 400-831 ms.
//
// `unit` is the BOQ LINE's unit when the entry is linked to one, because that
// is the unit its quantity was measured in; it falls back to the activity's
// unit for the legacy activity-only entries (R12 point 7 made the BOQ link
// optional, and pre-R12 rows have none).
export type ProgressEntryWithLabels = typeof constructionWorkProgressEntries.$inferSelect & {
  activityName: string | null
  boqItemCode: string | null
  boqLineDescription: string | null
  unit: string | null
}

export async function listProgressEntries(
  ctx: { orgId: string },
  filters: { projectId?: string; activityId?: string; boqLineItemId?: string; dateFrom?: string; dateTo?: string }
): Promise<ProgressEntryWithLabels[]> {
  if (!filters.projectId && !filters.activityId) throw new ServiceError("projectId or activityId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionWorkProgressEntries.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionWorkProgressEntries.projectId, filters.projectId))
    if (filters.activityId) conditions.push(eq(constructionWorkProgressEntries.activityId, filters.activityId))
    if (filters.boqLineItemId) conditions.push(eq(constructionWorkProgressEntries.boqLineItemId, filters.boqLineItemId))
    if (filters.dateFrom) conditions.push(gte(constructionWorkProgressEntries.entryDate, filters.dateFrom))
    if (filters.dateTo) conditions.push(lte(constructionWorkProgressEntries.entryDate, filters.dateTo))
    const entries = await db.query.constructionWorkProgressEntries.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.entryDate) })
    if (entries.length === 0) return []

    // Two batched reads on the SAME open transaction -- never one per row.
    const activityIds = [...new Set(entries.map((e) => e.activityId).filter((id): id is string => !!id))]
    const lineItemIds = [...new Set(entries.map((e) => e.boqLineItemId).filter((id): id is string => !!id))]

    const readActivities = async (): Promise<{ id: string; name: string; unit: string | null }[]> =>
      activityIds.length === 0
        ? []
        : db.query.constructionActivities.findMany({
            where: and(eq(constructionActivities.orgId, ctx.orgId), inArray(constructionActivities.id, activityIds)),
            columns: { id: true, name: true, unit: true },
          })
    const readLineItems = async (): Promise<{ id: string; itemCode: string | null; description: string; unit: string }[]> =>
      lineItemIds.length === 0
        ? []
        : db.query.constructionBoqLineItems.findMany({
            where: and(eq(constructionBoqLineItems.orgId, ctx.orgId), inArray(constructionBoqLineItems.id, lineItemIds)),
            columns: { id: true, itemCode: true, description: true, unit: true },
          })

    const [activityRows, lineItemRows] = await Promise.all([readActivities(), readLineItems()])

    const activityById = new Map(activityRows.map((a) => [a.id, a]))
    const lineItemById = new Map(lineItemRows.map((l) => [l.id, l]))

    return entries.map((entry) => {
      const activity = entry.activityId ? activityById.get(entry.activityId) : undefined
      const lineItem = entry.boqLineItemId ? lineItemById.get(entry.boqLineItemId) : undefined
      return {
        ...entry,
        // null (not the raw id) when the referenced row is genuinely gone --
        // the client decides how to say "unknown", it is not this layer's job
        // to fabricate a label that looks like a real name.
        activityName: activity?.name ?? null,
        boqItemCode: lineItem?.itemCode ?? null,
        boqLineDescription: lineItem?.description ?? null,
        unit: lineItem?.unit ?? activity?.unit ?? null,
      }
    })
  })
}

// R48 gap-closure (F085: "Progress entry delete recalculates cumulative"):
// no delete path existed for a progress entry at all, confirmed by reading
// this whole service file and both API routes before writing this. Every
// cumulative/earned-value figure this app computes (construction-reports-
// service.ts's computeEarnedValue, construction-dashboard-service.ts's
// project value) is derived AT READ TIME by summing constructionWorkProgress
// Entries rows live -- nothing is denormalized/cached -- so a plain DELETE
// of the row is sufficient for "recalculates cumulative": the very next read
// of any dashboard/report/earned-value figure naturally excludes the deleted
// entry, with no separate recalculation step to write. Scoped the same way
// every other mutator in this file is (org-scoped via withTenantContext);
// no status gate like deleteBoq's "draft only" -- a progress entry has no
// lifecycle states to protect (it is itself the raw, atomic record; deleting
// a wrong one is the correction mechanism, not a state-machine violation).
export async function deleteProgressEntry(ctx: { orgId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.constructionWorkProgressEntries.findFirst({
      where: and(eq(constructionWorkProgressEntries.id, entryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)),
    })
    if (!entry) throw new ServiceError("Progress entry not found", 404)
    await db.delete(constructionWorkProgressEntries).where(eq(constructionWorkProgressEntries.id, entryId))
    return { deleted: true, id: entryId, activityId: entry.activityId, projectId: entry.projectId }
  })
}

export async function createProgressEntry(
  ctx: { orgId: string; userId: string },
  input: { projectId: string; activityId: string; boqLineItemId?: string; entryDate: string; quantityDone: number; percentComplete: number; remarks?: string; entryBasis?: "DELTA" | "SNAPSHOT" }
) {
  if (!input.activityId) throw new ServiceError("activityId is required", 400)
  if (!input.entryDate) throw new ServiceError("entryDate is required", 400)
  if (input.percentComplete < 0 || input.percentComplete > 100) throw new ServiceError("percentComplete must be between 0 and 100", 400)
  // R39/R-46: defaults to DELTA (today's only real convention) so every
  // existing caller -- none of which have ever sent this field -- keeps
  // behaving identically. Only a caller that explicitly opts into SNAPSHOT
  // gets the latest-wins roll-up treatment.
  const entryBasis = input.entryBasis ?? "DELTA"
  if (entryBasis !== "DELTA" && entryBasis !== "SNAPSHOT") throw new ServiceError("entryBasis must be DELTA or SNAPSHOT", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await assertProject(db, ctx.orgId, input.projectId)
    // R53 / R48_PROGRESS_ENTRY_NO_PROJECT_MEMBERSHIP_CHECK_01: SCOPED TO THE
    // SUPPLIED PROJECT, not just to the org. Without the projectId predicate a
    // caller could post progress against project A while naming an activity
    // that belongs to project B of the same org -- and input.projectId is
    // written verbatim onto the row, so the entry then surfaces under a
    // project whose activity it does not belong to. constructionActivities
    // carries project_id NOT NULL, so this is a direct check, not a hop.
    // Same shape src/lib/pipeline/executor.ts already uses.
    const activity = await db.query.constructionActivities.findFirst({ where: and(eq(constructionActivities.id, input.activityId), eq(constructionActivities.orgId, ctx.orgId), eq(constructionActivities.projectId, input.projectId)) })
    if (!activity) throw new ServiceError("Activity not found", 404)

    // R12 point 7 (Option B): the direct BOQ-line link -- optional, so
    // every existing (activity-only) caller keeps working unchanged. When
    // supplied, must resolve to a real line item this org owns (line items
    // carry no orgId of their own; ownership is via their boq).
    let boqLineItemId: string | null = null
    if (input.boqLineItemId) {
      // org-scoped DIRECTLY (the column exists) rather than only inferentially
    // through the parent BOQ read below.
    const lineItem = await db.query.constructionBoqLineItems.findFirst({ where: and(eq(constructionBoqLineItems.id, input.boqLineItemId), eq(constructionBoqLineItems.orgId, ctx.orgId)) })
      // Same rule one hop further out. construction_boq_line_items has no
    // project_id column, so the project boundary has to be enforced on the
    // parent BOQ -- which does carry project_id NOT NULL.
    const boq = lineItem ? await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, lineItem.boqId), eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, input.projectId)) }) : null
      if (!lineItem || !boq) throw new ServiceError("BOQ line item not found", 404)

      // T-WPR-15-1 (WPR-15, R41-R45): confirmed live 2026-08-25 that this
      // endpoint accepted a progress entry posted directly against a PARENT
      // BOQ line item with zero guard (POST against item 1.01 "Partition
      // wall", which HAS breakdown children, returned 201 -- the exact
      // failure mode WPR-15 forbids: "a parent figure must never be storable
      // directly"). The schema's own canonical-child-rate-rule comment on
      // constructionBoqLineItems.parentLineItemId establishes the real
      // invariant this enforces: a ROOT/parent line's percent/qty is always
      // DERIVED (rolled up from its children, see
      // work-progress-report.ts's applyWeightedParentRollup on the PROJEXA
      // side), never independently entered -- so a caller must never be able
      // to store one directly, only the roll-up may produce it. "Parent"
      // here means "has at least one other line item pointing at it via
      // parentLineItemId", NOT merely "parentLineItemId is null" -- a
      // standalone leaf line with no children of its own (parentLineItemId
      // null, e.g. a line with no hierarchical breakdown) is a perfectly
      // valid, real progress-tracking target and must keep working.
      const child = await db.query.constructionBoqLineItems.findFirst({ where: eq(constructionBoqLineItems.parentLineItemId, input.boqLineItemId) })
      if (child) {
        throw new ServiceError(
          "Progress cannot be recorded directly against a parent BOQ line item -- its quantity/percent is derived from its child line items. Select one of its child line items instead.",
          400
        )
      }
      boqLineItemId = input.boqLineItemId
    }

    const [row] = await db.insert(constructionWorkProgressEntries).values({
      orgId: ctx.orgId, projectId: input.projectId, activityId: input.activityId, boqLineItemId,
      entryDate: input.entryDate, quantityDone: input.quantityDone !== undefined ? String(input.quantityDone) : undefined, percentComplete: String(input.percentComplete),
      entryBasis, remarks: input.remarks || null, recordedById: ctx.userId,
    }).returning()
    return row
  }).then((row) => {
    // Wave 126: fire-and-forget automation trigger, matching
    // pms-issue-service.ts's updateIssue() status-change trigger posture
    // (dynamic import, void, never blocks/breaks the write it enriches).
    if (Number(row.percentComplete) >= 100) {
      void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
        evaluateAndRunRules({ orgId: ctx.orgId }, "construction_work_progress.completed", {
          activityId: row.activityId, projectId: row.projectId, percentComplete: row.percentComplete,
        })
      )
    }
    return row
  })
}
