// Wave 115 (PROJEXA foundation) service layer -- Work Progress hierarchy
// (Category -> Activity) and daily progress entries against an activity.
// Deliberately project-scoped, not org-wide templates (Wave 1 simplicity,
// see schema.ts comment on constructionCategories) -- an org-wide
// template/copy-down feature can be added later without a breaking migration.
import {
  constructionCategories, constructionActivities, constructionWorkProgressEntries, constructionBoqLineItems, constructionBoqs, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, desc, eq, gte, lte } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { listDocuments } from "./document-service"
// R67 F-27 (R-243): logging or deleting progress moves % complete, earned
// value and the progress bar on the per-project dashboard, which now holds a
// 60 s cache. ONE helper, imported from a dependency-free module so this
// service does not have to depend on the dashboard service.
import { bustProjectDashboardCache } from "./project-dashboard-cache"
export { ServiceError }

/**
 * R67 lane B (B-09) -- ONE RULE FOR A PROGRESS ENTRY, IN ONE PLACE.
 *
 * Before this, the form and the composer disagreed about whether a BOQ line
 * was required: PROJEXA's Daily Entry form marked it OPTIONAL and buried it
 * below the derived fields, while the chat pipeline refused without one and
 * said "itemCode is required". Two answers to one question, and neither of
 * them was the product's.
 *
 * The rule adopted is the recommended one, and it lives HERE -- in the
 * service both callers already go through -- rather than in either caller:
 *
 *   the project has at least one BOQ  -> a BOQ line is REQUIRED
 *   the project has no BOQ at all     -> the entry is accepted, unlinked,
 *                                        and the Work Progress Report says
 *                                        so instead of silently dropping it
 *
 * It is raised as a CODE, never a sentence (decision D-03): the wording lives
 * in projexa's src/lib/task-errors.ts, so the form and the composer print the
 * same words because they read the same dictionary -- not because someone
 * kept two strings in step by hand.
 */
export class ProgressRuleError extends ServiceError {
  readonly missing: string[]
  constructor(code: string, missing: string[]) {
    // The MESSAGE is a code line, not prose. There is deliberately no English
    // here for a route to leak into a UI by accident.
    super(`${code} missing=${missing.join(",")}`, 400, { code })
    this.missing = missing
  }
}

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
// R67 F-24 (audit recommendation R-240) -- THE NAMES COME WITH THE ROWS.
//
// THE MEASURED PROBLEM. /work-progress reached idle at 7.4 s over 15 calls
// because the browser ran a SERIAL chain to answer one question: what does the
// BOQ column say? It fetched the entries, then the activities, then
// /api/scope, then one /api/scope/{id} per revision -- pulling every line item
// of a whole BOQ across the wire -- and after all that still rendered a raw id
// like "e5eibnze72n8u2y3aoeok" in the cell, because the resolution frequently
// missed.
//
// A progress entry's activity and BOQ line are a JOIN. Two LEFT JOINs (LEFT,
// so an entry whose line item was later deleted -- boq_line_item_id is ON
// DELETE SET NULL, see schema.ts -- still lists, with nulls, rather than
// vanishing) put activityName, boqItemCode and boqDescription on the row, in
// the SAME statement, and the client's whole scope fan-out disappears. The
// payload stays small on purpose: three resolved strings per row, never the
// BOQ.
//
// Column list, not `select()`: an explicit projection is what keeps this from
// silently widening into "every column of three tables" when any of them
// gains one.
export type ProgressEntryRow = typeof constructionWorkProgressEntries.$inferSelect & {
  /** The activity's name. null only if the activity row is gone. */
  activityName: string | null
  /** The linked BOQ line's item code, e.g. "R60SK". null when unlinked. */
  boqItemCode: string | null
  /** The linked BOQ line's description. null when unlinked. */
  boqDescription: string | null
}

export async function listProgressEntries(
  ctx: { orgId: string },
  filters: { projectId?: string; activityId?: string; boqLineItemId?: string; dateFrom?: string; dateTo?: string }
): Promise<ProgressEntryRow[]> {
  if (!filters.projectId && !filters.activityId) throw new ServiceError("projectId or activityId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionWorkProgressEntries.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionWorkProgressEntries.projectId, filters.projectId))
    if (filters.activityId) conditions.push(eq(constructionWorkProgressEntries.activityId, filters.activityId))
    if (filters.boqLineItemId) conditions.push(eq(constructionWorkProgressEntries.boqLineItemId, filters.boqLineItemId))
    if (filters.dateFrom) conditions.push(gte(constructionWorkProgressEntries.entryDate, filters.dateFrom))
    if (filters.dateTo) conditions.push(lte(constructionWorkProgressEntries.entryDate, filters.dateTo))
    return db
      .select({
        id: constructionWorkProgressEntries.id,
        orgId: constructionWorkProgressEntries.orgId,
        projectId: constructionWorkProgressEntries.projectId,
        activityId: constructionWorkProgressEntries.activityId,
        boqLineItemId: constructionWorkProgressEntries.boqLineItemId,
        entryDate: constructionWorkProgressEntries.entryDate,
        quantityDone: constructionWorkProgressEntries.quantityDone,
        percentComplete: constructionWorkProgressEntries.percentComplete,
        entryBasis: constructionWorkProgressEntries.entryBasis,
        remarks: constructionWorkProgressEntries.remarks,
        recordedById: constructionWorkProgressEntries.recordedById,
        createdAt: constructionWorkProgressEntries.createdAt,
        activityName: constructionActivities.name,
        boqItemCode: constructionBoqLineItems.itemCode,
        boqDescription: constructionBoqLineItems.description,
      })
      .from(constructionWorkProgressEntries)
      .leftJoin(constructionActivities, eq(constructionActivities.id, constructionWorkProgressEntries.activityId))
      .leftJoin(constructionBoqLineItems, eq(constructionBoqLineItems.id, constructionWorkProgressEntries.boqLineItemId))
      .where(and(...conditions))
      .orderBy(desc(constructionWorkProgressEntries.entryDate))
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
  }).then((result) => {
    // R67 F-27: a deleted entry changes % complete and earned value.
    bustProjectDashboardCache(ctx.orgId, result.projectId)
    return result
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

    // R67 B-09 -- THE ONE RULE, checked here so both callers get one answer.
    // A project that has a BOQ is a project whose progress is measured
    // against it: an entry with no line cannot be rolled up, cannot be
    // valued, and disappears from the Work Progress Report. So it is refused
    // -- with a code, before anything is written. A project with NO BOQ has
    // nothing to link to, and refusing there would make the module unusable
    // for a job that is not billed off a bill of quantities at all.
    const projectHasBoq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, input.projectId)),
    })
    if (projectHasBoq && !input.boqLineItemId) {
      throw new ProgressRuleError("BOQ_LINE_REQUIRED", ["boqLine"])
    }

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
    // R67 B-09: the caller is told, on the row itself, whether this entry is
    // counted by the Work Progress Report. Derived from what was actually
    // stored, never from what was asked for.
    return { ...row, linkedToBoq: boqLineItemId !== null }
  }).then((row) => {
    // R67 F-27: this row moved % complete, earned value and the progress bar
    // on the project dashboard. Bust BEFORE anything async below, so the very
    // next read recomputes rather than serving the figure from a moment ago --
    // "I just logged progress, where is it?" is the whole point.
    bustProjectDashboardCache(ctx.orgId, row.projectId)
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
