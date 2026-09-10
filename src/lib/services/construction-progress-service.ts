// Wave 115 (PROJEXA foundation) service layer -- Work Progress hierarchy
// (Category -> Activity) and daily progress entries against an activity.
// Deliberately project-scoped, not org-wide templates (Wave 1 simplicity,
// see schema.ts comment on constructionCategories) -- an org-wide
// template/copy-down feature can be added later without a breaking migration.
import {
  constructionCategories, constructionActivities, constructionWorkProgressEntries, constructionBoqLineItems, constructionBoqs, projects,
  pmsIssues, pmsIssueBoqLinks,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { listDocuments } from "./document-service"
import { logActivity } from "@/lib/audit"
import { users as usersTable } from "@/lib/db"
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
// ─── R67 lane D22 (item D-64, rec R-230) x R67 D-28/F-24 (already on main) ──
// THE 25-CHARACTER ID IN THE "BOQ LINE" COLUMN, and what closed it.
//
// Lane D22 and lane D-28/F-24 found the same defect -- this list is what a site
// engineer reads back to check what they logged, and its BOQ line column
// printed a cuid, because the entry row carries only boq_line_item_id and
// nothing joined it to the line. PROJEXA papered over it with a client-side
// lookup against whichever BOQ the form happened to have loaded, so an entry
// recorded against any OTHER revision still rendered as its raw id.
//
// Two implementations existed. F-24's LEFT JOIN (below, already on main) is
// kept, because it resolves the name in the SAME statement and removes the
// client's /api/scope fan-out that D22's in-memory attachBoqLines() left in
// place. D22's own attachBoqLines()/ProgressEntryBoqLine pair is therefore
// folded away rather than kept beside it -- two shapes for one fact on one
// payload is the double truth this programme exists to remove -- and the one
// thing D22's shape carried that the join did not, the line's OWN BOQ id, is
// added to the projection below as boqLineBoqId so the cell can LINK to the
// line instead of merely naming it (R-230's second half).
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
//
// R67 D-28 x F-24 RECONCILIATION (integration train, lane D21 onto main).
// Two lanes joined the same two tables for two different reasons and both are
// kept:
//   * F-24 (already on main) needed the LIST to stop fanning out to /api/scope,
//     and deliberately capped what crosses the wire -- resolved strings only,
//     "never the BOQ". Its field name `boqDescription` is the one PROJEXA's
//     merged list client already reads, so it is the canonical name here.
//   * D-28 (this lane) needed the entry's UNIT on every row -- a quantity with
//     no unit beside it is not a measurement -- and the line's contracted
//     figures on the OBJECT page, so a delete confirmation can state a real
//     blast radius instead of guessing.
// So: the list projection gains `unit` (a label, not a measurement, so F-24's
// "nothing priced or quantified crosses the wire" rule still holds literally),
// and quantity/rate/amount are projected ONLY by getProgressEntry, which
// returns exactly one row.
//
// LEFT, not INNER, on both sides deliberately: boq_line_item_id is nullable
// (an activity-only entry is legitimate, see createProgressEntry) and its FK
// is ON DELETE SET NULL, so an inner join would silently DROP real entries
// rather than show them with an em-dash. The activity join is left too --
// activity_id is NOT NULL, but a join that can only ever fail closed is worth
// more than one that can hide a row if referential integrity ever slips.
const BASE_ENTRY_COLUMNS = {
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
  // R67 lane D22 (D-64, rec R-230), folded into F-24's projection: the line's
  // OWN BOQ id. Naming the line is only half of R-230 -- the cell has to be a
  // way IN to the line ("/scope/{boqId}#line-{lineItemId}"), and without this
  // the screen would have to fetch a BOQ to discover which one the line sits
  // on, which is the fan-out F-24 removed. One id per row, no figures: F-24's
  // "nothing priced or quantified crosses the wire in the list" still holds.
  boqLineBoqId: constructionBoqLineItems.boqId,
  // Inputs to resolveProgressUnit() only -- they are stripped from the row
  // before it is returned, so no caller has to know the precedence rule.
  activityUnit: constructionActivities.unit,
  boqLineUnit: constructionBoqLineItems.unit,
} as const

// R67 D-28: the line's own contracted figures travel with the ONE entry the
// object page asked for, so the delete confirmation can state a REAL blast
// radius ("the running total drops from 60% to 48%") using PROJEXA's existing
// computeLineItemProgress() rule, instead of the screen guessing or fetching
// a whole BOQ to find one line. Never in the list -- see F-24's cap above.
const OBJECT_ENTRY_COLUMNS = {
  ...BASE_ENTRY_COLUMNS,
  boqLineQuantity: constructionBoqLineItems.quantity,
  boqLineRate: constructionBoqLineItems.rate,
  boqLineAmount: constructionBoqLineItems.amount,
  // R67 lane D22 (D-77, rec R-289): the project and the person, by NAME.
  projectName: projects.name,
  recordedByName: usersTable.name,
} as const

/** One enriched progress row: the entry, the two joined names, the unit. */
export type EnrichedProgressEntry = {
  id: string
  orgId: string
  projectId: string
  activityId: string
  boqLineItemId: string | null
  entryDate: string
  quantityDone: string
  percentComplete: string
  entryBasis: string
  remarks: string | null
  recordedById: string
  createdAt: Date
  /** The activity's name. null only if the activity row is gone. */
  activityName: string | null
  /** The linked BOQ line's item code, e.g. "R60SK". null when unlinked. */
  boqItemCode: string | null
  /** The linked BOQ line's description. null when unlinked. */
  boqDescription: string | null
  /** The BOQ the linked line lives on, so a cell can link to it. null when unlinked. */
  boqLineBoqId: string | null
  /** The BOQ line's unit when the entry names a line, else the activity's own. */
  unit: string | null
}

/**
 * What listProgressEntries returns. Kept as its own exported name because
 * F-24's callers already import it.
 */
export type ProgressEntryRow = EnrichedProgressEntry

/** What getProgressEntry returns: the list row plus the line's contracted figures. */
export type ProgressEntryDetail = EnrichedProgressEntry & {
  boqLineQuantity: string | null
  boqLineRate: string | null
  boqLineAmount: string | null
  /** R67 lane D22 (D-77): the activity's own unit, beside the line's. */
  activityUnit: string | null
  /** R67 lane D22 (D-77): the project's name -- never its id. */
  projectName: string | null
  /** R67 lane D22 (D-77): who recorded it, by name -- never their id. */
  recordedByName: string | null
}

type EnrichedRow = Record<string, unknown> & { activityUnit?: string | null; boqLineUnit?: string | null }

/**
 * Pure: the ONE rule for which unit a progress row is measured in. A quantity
 * recorded against a BOQ line is in that line's unit; an activity-only entry
 * is in the activity's. Exported so the rule is testable without a database.
 */
export function resolveProgressUnit(row: { boqLineUnit?: string | null; activityUnit?: string | null }): string | null {
  return row.boqLineUnit ?? row.activityUnit ?? null
}

function toEnrichedEntry<T extends EnrichedProgressEntry>(row: EnrichedRow): T {
  const { activityUnit, boqLineUnit, ...rest } = row
  return { ...(rest as unknown as Omit<T, "unit">), unit: resolveProgressUnit({ activityUnit, boqLineUnit }) } as T
}

export async function listProgressEntries(
  ctx: { orgId: string },
  filters: { projectId?: string; activityId?: string; boqLineItemId?: string; dateFrom?: string; dateTo?: string }
): Promise<ProgressEntryRow[]> {
  if (!filters.projectId && !filters.activityId) throw new ServiceError("projectId or activityId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionWorkProgressEntries.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionWorkProgressEntries.projectId, filters.projectId))
    if (filters.activityId) conditions.push(eq(constructionWorkProgressEntries.activityId, filters.activityId))
    if (filters.boqLineItemId) conditions.push(eq(constructionWorkProgressEntries.boqLineItemId, filters.boqLineItemId))
    if (filters.dateFrom) conditions.push(gte(constructionWorkProgressEntries.entryDate, filters.dateFrom))
    if (filters.dateTo) conditions.push(lte(constructionWorkProgressEntries.entryDate, filters.dateTo))
    const rows = await selectEntries(db, BASE_ENTRY_COLUMNS, and(...conditions))
      .orderBy(desc(constructionWorkProgressEntries.entryDate))
    return (rows as EnrichedRow[]).map((r) => toEnrichedEntry<ProgressEntryRow>(r))
  })
}

function selectEntries(
  db: TenantDb,
  columns: typeof BASE_ENTRY_COLUMNS | typeof OBJECT_ENTRY_COLUMNS,
  where: ReturnType<typeof and>
) {
  return db.select(columns).from(constructionWorkProgressEntries)
    .leftJoin(constructionActivities, eq(constructionActivities.id, constructionWorkProgressEntries.activityId))
    .leftJoin(constructionBoqLineItems, eq(constructionBoqLineItems.id, constructionWorkProgressEntries.boqLineItemId))
    .where(where)
}

// R67 D-28: one entry, the same enriched shape the list returns plus the
// line's figures -- the object page must never have to re-resolve a name the
// list already knew.
//
// R67 lane D22 (item D-77, rec R-289), folded in: the object page also has to
// say WHICH PROJECT this entry belongs to and WHO recorded it, and R-289's rule
// is that an id is never printed on a screen. Both are resolved here, on the
// same statement, for the same reason the two joins above exist -- a screen
// that has to fetch a name is a screen that will eventually print the id
// instead. Two more LEFT joins, and only on the single-row read: the list has
// no column for either and must not pay for them.
export async function getProgressEntry(ctx: { orgId: string }, entryId: string): Promise<ProgressEntryDetail> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.select(OBJECT_ENTRY_COLUMNS).from(constructionWorkProgressEntries)
      .leftJoin(constructionActivities, eq(constructionActivities.id, constructionWorkProgressEntries.activityId))
      .leftJoin(constructionBoqLineItems, eq(constructionBoqLineItems.id, constructionWorkProgressEntries.boqLineItemId))
      .leftJoin(projects, eq(projects.id, constructionWorkProgressEntries.projectId))
      .leftJoin(usersTable, eq(usersTable.id, constructionWorkProgressEntries.recordedById))
      .where(and(eq(constructionWorkProgressEntries.id, entryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)))
    if (!row) throw new ServiceError("Progress entry not found", 404)
    const detail = toEnrichedEntry<ProgressEntryDetail>(row as EnrichedRow)
    // toEnrichedEntry() strips activityUnit because the list resolves it into
    // `unit`. The object page needs the activity's own unit back beside the
    // line's, so an activity-only entry still states what it is measured in.
    return { ...detail, activityUnit: (row as EnrichedRow).activityUnit ?? null }
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
//
// R67 lane D22 (review finding, D-49 follow-through): the comment above was
// true when it was written -- every cumulative figure was derived at READ time,
// so deleting the row was the whole recalculation. D-49 changed that: an
// activity's completion_percentage is now a PERSISTED derivation of the site
// records (completion_source='site_records', completed_from_entry_id pointing
// at the entry that produced it), and D-77 gave PROJEXA a Delete button that
// reaches this function. Without the roll-up below, deleting the only entry on
// a line left the schedule asserting a percentage derived from a row that no
// longer exists, and a completed_from_entry_id that resolves to nothing (the
// column carries no DB-level FK -- schema.ts:4477 says so explicitly, so the
// database will not catch it either). That is precisely the double truth
// between the schedule and the site records that D-49 exists to close.
export async function deleteProgressEntry(ctx: { orgId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.constructionWorkProgressEntries.findFirst({
      where: and(eq(constructionWorkProgressEntries.id, entryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)),
    })
    if (!entry) throw new ServiceError("Progress entry not found", 404)
    await db.delete(constructionWorkProgressEntries).where(eq(constructionWorkProgressEntries.id, entryId))
    // On the SAME transaction as the delete (D-06: never a nested
    // withTenantContext), and AFTER it, so the recompute reads a world the row
    // has already left. With no entries remaining on the line, qtyByLine and
    // percentByLine simply have no row for it, lineProgressFraction returns 0
    // and the activity correctly reads 0 rather than a stale figure.
    if (entry.boqLineItemId) await rollUpLinkedIssueCompletion(db, ctx.orgId, entry.boqLineItemId, null)
    return { deleted: true, id: entryId, activityId: entry.activityId, projectId: entry.projectId }
  }).then((result) => {
    // R67 F-27: a deleted entry changes % complete and earned value.
    bustProjectDashboardCache(ctx.orgId, result.projectId)
    return result
  })
}

// ─── R67 lane D22 (item D-77, rec R-289) x R67 D-28 (already on main) ─────
// A WORK-PROGRESS ENTRY HAD NO OBJECT PAGE AND NO WAY BACK. The list printed
// a row and that was the end of it: there was no route to one entry, no way to
// see its remarks or the photo the crew attached, and no way to correct a
// quantity typed wrong on site -- the only mutation that existed was DELETE.
// A record you can only destroy is not a record anyone will trust.
//
// Both lanes wrote that read and that correction. D-28's pair (below, already
// on main) is the one kept, on merit rather than on arrival order: its PATCH
// re-runs create's OWN validation through helpers extracted from it -- the
// percent range, the entry-basis vocabulary, the project-scoped activity
// lookup and the parent-line refusal, one implementation each -- where lane
// D22's re-stated a weaker copy of two of the four and could not have caught a
// line moved to another project's BOQ. D22's getProgressEntry/updateProgressEntry
// are therefore folded away, and the two things they had that D-28's did not
// are folded IN: the object read's project/recorder names (see
// getProgressEntry above) and D-49's roll-up on the update path (see below).
// Deliberately NOT re-parented in either lane's version, and still not: the
// activity and the BOQ line an entry was recorded against are what make it that
// entry -- except that D-28's PATCH does allow both to be corrected, which is
// the stronger reading of "correct a mis-keyed entry" and is validated as
// strictly as a create.
// ─── R67 lane D22 (item D-49, rec R-125) ──────────────────────────────────
// THE DOUBLE ENTRY THIS CLOSES: a site engineer records quantities against a
// BOQ line here, and then a PM separately retypes a percent on the schedule
// activity's object page. Two humans, two screens, one fact -- and they drift
// apart by construction. With pms_issue_boq_links in place (WS-I item I-04),
// an activity that is linked to BOQ lines can have its completion DERIVED from
// the site records instead.
//
// Kept pure and exported so the arithmetic is provable without a database, the
// same discipline construction-reports-service.ts's computeEarnedValue()
// already follows for the closely-related earned-value roll-up.

export type LinkedBoqLine = {
  boqLineItemId: string
  /** The link's share of that line: 1 = "this activity delivers the whole line" (the schema's own default). */
  weight: number
  /** The BOQ line's contracted quantity. */
  quantity: number
  /** Sum of DELTA quantity_done recorded against the line. */
  quantityToDate: number
  /** Latest percent_complete recorded against the line, 0-100. Used ONLY when nothing has been measured. */
  latestPercentComplete: number | null
}

/**
 * How far along one BOQ line is, 0..1.
 *
 * Prefers a real measured quantity, and only falls back to a reported percent
 * when nothing has been measured -- exactly the rule
 * construction-reports-service.ts's computeEarnedValue() already established
 * for the same two columns (R46/R-51), so a crew that reports "50% done"
 * before a quantity survey is not silently worth zero here while being worth
 * something there.
 */
export function lineProgressFraction(line: LinkedBoqLine): number {
  if (line.quantity > 0 && line.quantityToDate > 0) return line.quantityToDate / line.quantity
  if (line.latestPercentComplete !== null) return line.latestPercentComplete / 100
  return 0
}

/**
 * An activity's completion, as a whole-number percent, from the BOQ lines it
 * delivers: the weight-averaged progress of those lines, capped at 100.
 *
 * WHY WEIGHT-AVERAGED rather than a bare sum: `weight` is documented on
 * pms_issue_boq_links as the link's SHARE of that line, defaulting to 1. A
 * bare sum of (fraction x weight) over two fully-complete lines would read
 * 200%, and over one line with the default weight would read 1 instead of 100.
 * Dividing by the total weight makes the single-link default case -- one
 * activity delivering one whole line -- come out as exactly that line's own
 * percentage, which is the only reading a site engineer would accept.
 *
 * No links, or no weight at all, returns null: "this activity has nothing to
 * derive from", which must leave whatever a human set alone rather than
 * zeroing it.
 */
export function computeLinkedIssueCompletion(lines: LinkedBoqLine[]): number | null {
  if (lines.length === 0) return null
  const totalWeight = lines.reduce((sum, l) => sum + (Number.isFinite(l.weight) ? l.weight : 0), 0)
  if (totalWeight <= 0) return null
  const weighted = lines.reduce((sum, l) => sum + lineProgressFraction(l) * l.weight, 0)
  return Math.min(100, Math.max(0, Math.round((weighted / totalWeight) * 100)))
}

/**
 * Rolls the site records up onto every schedule activity linked to `boqLineItemId`.
 *
 * Runs on the CALLER'S transaction (`db` is the TenantDb handed to the
 * withTenantContext callback), never opening one of its own -- programme
 * decision D-06 forbids a nested withTenantContext, and the roll-up must
 * commit or roll back with the entry that caused it, never separately.
 *
 * `fromEntryId` is the entry whose write triggered this, and is written to
 * pms_issues.completed_from_entry_id as the provenance the activity page
 * prints. It is NULL when the trigger was a DELETE: the figure is still derived
 * from the site records, but there is no longer a single entry to point at, and
 * leaving the old id there would be a reference to a row that no longer exists.
 */
export async function rollUpLinkedIssueCompletion(
  db: TenantDb,
  orgId: string,
  boqLineItemId: string,
  fromEntryId: string | null
): Promise<{ issueId: string; completionPercentage: number }[]> {
  const directLinks = await db.query.pmsIssueBoqLinks.findMany({
    where: and(eq(pmsIssueBoqLinks.orgId, orgId), eq(pmsIssueBoqLinks.boqLineItemId, boqLineItemId)),
  })
  if (directLinks.length === 0) return []

  // Every line each affected activity delivers, not just the one that was
  // recorded against: an activity covering three BOQ lines is 33% done when
  // one of them finishes, and reading only the touched line would report 100%.
  const issueIds = [...new Set(directLinks.map((l) => l.issueId))]
  const allLinks = await db.query.pmsIssueBoqLinks.findMany({
    where: and(eq(pmsIssueBoqLinks.orgId, orgId), inArray(pmsIssueBoqLinks.issueId, issueIds)),
  })
  const lineIds = [...new Set(allLinks.map((l) => l.boqLineItemId))]
  if (lineIds.length === 0) return []

  const lineItems = await db.query.constructionBoqLineItems.findMany({
    where: and(eq(constructionBoqLineItems.orgId, orgId), inArray(constructionBoqLineItems.id, lineIds)),
  })
  const quantityById = new Map(lineItems.map((i) => [i.id, Number(i.quantity)]))

  // Same two aggregates, and the same DISTINCT ON convention, that
  // construction-reports-service.ts's earned-value read already uses -- one
  // grouped query each, never one per line.
  const idsSql = sql.join(lineIds.map((id) => sql`${id}`), sql`, `)
  const qtyRows = (await db.execute(sql`
    SELECT boq_line_item_id, coalesce(sum(quantity_done), 0)::float AS total_qty
    FROM compliance.construction_work_progress_entries
    WHERE boq_line_item_id = ANY(ARRAY[${idsSql}]) AND entry_basis = 'DELTA'
    GROUP BY boq_line_item_id
  `)) as { boq_line_item_id: string; total_qty: number }[]
  const qtyByLine = new Map(qtyRows.map((r) => [r.boq_line_item_id, Number(r.total_qty)]))

  const percentRows = (await db.execute(sql`
    SELECT DISTINCT ON (boq_line_item_id) boq_line_item_id, percent_complete
    FROM compliance.construction_work_progress_entries
    WHERE boq_line_item_id = ANY(ARRAY[${idsSql}])
    ORDER BY boq_line_item_id, entry_date DESC, created_at DESC
  `)) as { boq_line_item_id: string; percent_complete: number }[]
  const percentByLine = new Map(percentRows.map((r) => [r.boq_line_item_id, Number(r.percent_complete)]))

  const updated: { issueId: string; completionPercentage: number }[] = []
  for (const issueId of issueIds) {
    const lines: LinkedBoqLine[] = allLinks
      .filter((l) => l.issueId === issueId)
      .map((l) => ({
        boqLineItemId: l.boqLineItemId,
        weight: Number(l.weight ?? 1),
        quantity: quantityById.get(l.boqLineItemId) ?? 0,
        quantityToDate: qtyByLine.get(l.boqLineItemId) ?? 0,
        latestPercentComplete: percentByLine.has(l.boqLineItemId) ? percentByLine.get(l.boqLineItemId)! : null,
      }))
    const completionPercentage = computeLinkedIssueCompletion(lines)
    if (completionPercentage === null) continue
    await db.update(pmsIssues).set({
      completionPercentage,
      // The provenance the activity object page prints ("Progress from site
      // records: 62 % (last entry 01-09-2026)"). Setting it here is what makes
      // a later manual override an explicit, visible decision rather than an
      // invisible one.
      completionSource: "site_records",
      completedFromEntryId: fromEntryId,
      updatedAt: new Date(),
    }).where(and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, orgId)))
    updated.push({ issueId, completionPercentage })
  }
  return updated
}

// R67 D-28: the parent-line refusal, as ONE exported string. The PATCH path
// added by D-28 has to answer with exactly the same sentence the POST path
// does -- the item's own requirement is that editing an entry runs "exactly
// the same validation as create and returns the backend message verbatim" --
// and two copies of a sentence are two sentences that can drift.
export const PARENT_LINE_PROGRESS_MESSAGE =
  "Progress cannot be recorded directly against a parent BOQ line item -- its quantity/percent is derived from its child line items. Select one of its child line items instead."

export const PERCENT_COMPLETE_RANGE_MESSAGE = "percentComplete must be between 0 and 100"

/**
 * Pure. R39/R-46: defaults to DELTA (today's only real convention) so every
 * existing caller -- none of which have ever sent this field -- keeps behaving
 * identically. Only a caller that explicitly opts into SNAPSHOT gets the
 * latest-wins roll-up treatment.
 */
export function normaliseEntryBasis(entryBasis?: string | null): "DELTA" | "SNAPSHOT" {
  const value = entryBasis ?? "DELTA"
  if (value !== "DELTA" && value !== "SNAPSHOT") throw new ServiceError("entryBasis must be DELTA or SNAPSHOT", 400)
  return value
}

/** Pure. 0-100 inclusive, the one range rule both create and update apply. */
export function assertPercentComplete(percentComplete: number): void {
  if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
    throw new ServiceError(PERCENT_COMPLETE_RANGE_MESSAGE, 400)
  }
}

// R67 D-28: extracted verbatim from createProgressEntry so the PATCH path
// enforces the SAME two rules -- the line must belong to a BOQ of THIS
// project, and it must not be a parent line -- rather than a second, weaker
// copy of them. Every comment below is the original one, unchanged.
async function resolveBoqLineItemForEntry(db: TenantDb, orgId: string, projectId: string, boqLineItemId: string): Promise<string> {
  // R12 point 7 (Option B): the direct BOQ-line link -- optional, so
  // every existing (activity-only) caller keeps working unchanged. When
  // supplied, must resolve to a real line item this org owns (line items
  // carry no orgId of their own; ownership is via their boq).
  //
  // org-scoped DIRECTLY (the column exists) rather than only inferentially
  // through the parent BOQ read below.
  const lineItem = await db.query.constructionBoqLineItems.findFirst({ where: and(eq(constructionBoqLineItems.id, boqLineItemId), eq(constructionBoqLineItems.orgId, orgId)) })
  // Same rule one hop further out. construction_boq_line_items has no
  // project_id column, so the project boundary has to be enforced on the
  // parent BOQ -- which does carry project_id NOT NULL.
  const boq = lineItem ? await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, lineItem.boqId), eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId)) }) : null
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
  const child = await db.query.constructionBoqLineItems.findFirst({ where: eq(constructionBoqLineItems.parentLineItemId, boqLineItemId) })
  if (child) throw new ServiceError(PARENT_LINE_PROGRESS_MESSAGE, 400)
  return boqLineItemId
}

// R67 D-28: correcting a mis-keyed entry was impossible -- there was no
// update path at all, only create and delete, so a site engineer who typed
// 12 instead of 1.2 had to delete the row and retype every field. This runs
// the SAME validation create does (percent range, entry basis, the
// project-scoped activity lookup and the parent-line rule) through the same
// extracted helpers, so the two can never diverge, and every field is
// optional: an omitted field is left exactly as it was.
export async function updateProgressEntry(
  ctx: { orgId: string },
  entryId: string,
  patch: { activityId?: string; boqLineItemId?: string | null; entryDate?: string; quantityDone?: number; percentComplete?: number; remarks?: string | null; entryBasis?: "DELTA" | "SNAPSHOT" }
) {
  // A patch that names no field at all is a caller error, and it must be
  // answered as one. Without this it reached db.update().set({}) with every
  // value undefined, where drizzle's own mapUpdateSet filters the undefineds
  // and then throws a plain Error("No values to set") -- not a ServiceError,
  // so the route's generic catch logged it and answered 500. This is a
  // Bearer-key-callable public v1 route (and its /projexa/work-progress/[id]
  // alias), so "PATCH {}" is a request a real integration will send.
  if (Object.keys(patch).length === 0) throw new ServiceError("No fields to update", 400)
  if (patch.percentComplete !== undefined) assertPercentComplete(patch.percentComplete)
  const entryBasis = patch.entryBasis !== undefined ? normaliseEntryBasis(patch.entryBasis) : undefined
  if (patch.entryDate !== undefined && !patch.entryDate) throw new ServiceError("entryDate is required", 400)
  if (patch.activityId !== undefined && !patch.activityId) throw new ServiceError("activityId is required", 400)

  await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionWorkProgressEntries.findFirst({
      where: and(eq(constructionWorkProgressEntries.id, entryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)),
    })
    if (!existing) throw new ServiceError("Progress entry not found", 404)

    // The project is the entry's own -- an edit never moves an entry between
    // projects, so the same activity/BOQ-line project boundary create enforces
    // is enforced here against the row that already exists.
    const projectId = existing.projectId

    if (patch.activityId !== undefined) {
      const activity = await db.query.constructionActivities.findFirst({ where: and(eq(constructionActivities.id, patch.activityId), eq(constructionActivities.orgId, ctx.orgId), eq(constructionActivities.projectId, projectId)) })
      if (!activity) throw new ServiceError("Activity not found", 404)
    }

    let boqLineItemId: string | null | undefined
    if (patch.boqLineItemId !== undefined) {
      boqLineItemId = patch.boqLineItemId
        ? await resolveBoqLineItemForEntry(db, ctx.orgId, projectId, patch.boqLineItemId)
        : null
    }

    await db.update(constructionWorkProgressEntries).set({
      activityId: patch.activityId,
      boqLineItemId,
      entryDate: patch.entryDate,
      quantityDone: patch.quantityDone !== undefined ? String(patch.quantityDone) : undefined,
      percentComplete: patch.percentComplete !== undefined ? String(patch.percentComplete) : undefined,
      entryBasis,
      remarks: patch.remarks !== undefined ? patch.remarks : undefined,
    }).where(eq(constructionWorkProgressEntries.id, entryId))

    // R67 lane D22 (item D-49), folded onto D-28's PATCH by the integration
    // merge: create and delete already re-derive every schedule activity linked
    // to the line, on this same transaction (programme decision D-06 forbids a
    // nested withTenantContext). The correction path had no such call, and it
    // is the one that matters most -- a quantity typed as 500 and corrected to
    // 50 would otherwise leave the schedule asserting a percentage derived from
    // a reading nobody stands behind any more, with completed_from_entry_id
    // still pointing at this very entry as its provenance.
    //
    // BOTH lines, not just the new one: D-28's PATCH may move an entry to a
    // different BOQ line or clear it, and the line it LEFT has to be re-derived
    // too or it keeps counting a quantity that is no longer recorded against
    // it. rollUpLinkedIssueCompletion recomputes from every entry on the line
    // rather than adding a delta, so running it twice is correct and idempotent.
    const linesToRoll = new Set<string>()
    if (existing.boqLineItemId) linesToRoll.add(existing.boqLineItemId)
    const finalLineId = boqLineItemId !== undefined ? boqLineItemId : existing.boqLineItemId
    if (finalLineId) linesToRoll.add(finalLineId)
    for (const lineId of linesToRoll) {
      // The provenance is this entry only for the line it now names; a line it
      // no longer belongs to is re-derived with no single entry to point at.
      await rollUpLinkedIssueCompletion(db, ctx.orgId, lineId, lineId === finalLineId ? entryId : null)
    }
    return existing.projectId
  }).then((projectId) => {
    // R67 F-27 (R-243), same reasoning as create and delete: a corrected
    // quantity moves % complete and earned value on the project dashboard, so
    // the 60 s cache must not answer the next read with the old figure. The
    // edit path was the only one of the three without this, because create and
    // delete came from a different lane than the PATCH did.
    bustProjectDashboardCache(ctx.orgId, projectId)
  })

  // Read back through the same enriched path the list uses, so the object
  // page never has to guess what the joined names became after an edit.
  return getProgressEntry(ctx, entryId)
}

export async function createProgressEntry(
  ctx: { orgId: string; userId: string },
  input: { projectId: string; activityId: string; boqLineItemId?: string; entryDate: string; quantityDone: number; percentComplete: number; remarks?: string; entryBasis?: "DELTA" | "SNAPSHOT" }
) {
  if (!input.activityId) throw new ServiceError("activityId is required", 400)
  if (!input.entryDate) throw new ServiceError("entryDate is required", 400)
  assertPercentComplete(input.percentComplete)
  const entryBasis = normaliseEntryBasis(input.entryBasis)

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
      boqLineItemId = await resolveBoqLineItemForEntry(db, ctx.orgId, input.projectId, input.boqLineItemId)
    }

    const [row] = await db.insert(constructionWorkProgressEntries).values({
      orgId: ctx.orgId, projectId: input.projectId, activityId: input.activityId, boqLineItemId,
      entryDate: input.entryDate, quantityDone: input.quantityDone !== undefined ? String(input.quantityDone) : undefined, percentComplete: String(input.percentComplete),
      entryBasis, remarks: input.remarks || null, recordedById: ctx.userId,
    }).returning()

    // R67 lane D22 (item D-49): the same transaction, never a nested one
    // (programme decision D-06) and never a fire-and-forget follow-up -- if the
    // roll-up fails the entry must fail with it, or the schedule and the site
    // records disagree with nobody knowing which is right.
    if (boqLineItemId) await rollUpLinkedIssueCompletion(db, ctx.orgId, boqLineItemId, row.id)

    // R67 B-09: the caller is told, on the row itself, whether this entry is
    // counted by the Work Progress Report. Derived from what was actually
    // stored, never from what was asked for.
    //
    // Merge note (D22 with lane B): both intents are kept and the ORDER
    // matters -- the roll-up runs first, inside the transaction, and the flag
    // then describes the row that was really written.
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

// ─── R67 lane D22 (item D-49, rec R-125): the activity's side of the link ──
// The schedule activity's object page has to answer three questions that only
// the construction side can answer: which BOQ lines does this activity
// deliver, where did its percentage come from, and is any of that scope still
// in the current BOQ.

export type LinkedBoqLineView = {
  boqLineItemId: string
  code: string | null
  description: string
  unit: string
  quantity: number
  weight: number
  /** The BOQ revision the LINK points at. */
  linkedBoqVersion: number | null
  /** The revision that line's code lives on today, when a later revision superseded it. */
  currentBoqVersion: number | null
  /** True when the linked revision has been superseded but the code still exists on the current one. */
  supersededButMatched: boolean
  /** True when a later revision (a negative variation) removed this code from the scope entirely. */
  scopeRemoved: boolean
}

export type ActivityCompletionProvenance = {
  issueId: string
  completionPercentage: number
  completionSource: string
  lastProgressAt: string | null
  links: LinkedBoqLineView[]
}

/**
 * What the activity object page's "Linked BOQ items" facet and provenance line
 * are built from.
 *
 * A BOQ revision does not rewrite existing links -- pms_issue_boq_links points
 * at a line item id, and a revision creates NEW line rows. So a link whose BOQ
 * has been superseded is re-matched BY CODE against the project's current
 * revision, which is the only identity a QS would recognise across revisions
 * (R60SK-A is R60SK-A whatever revision it is on). Two honest outcomes:
 *   - the code exists on the current revision -> supersededButMatched, shown as
 *     "Linked to R60SK-A (Rev 2)";
 *   - it does not -> scopeRemoved, because a negative variation deleted that
 *     scope. That is surfaced in clay rather than silently zeroing the
 *     activity: work that was descoped is a decision someone made, not a
 *     measurement of zero progress.
 */
export async function getActivityCompletionProvenance(
  ctx: { orgId: string },
  issueId: string
): Promise<ActivityCompletionProvenance> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issue = await db.query.pmsIssues.findFirst({
      where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)),
    })
    if (!issue) throw new ServiceError("Activity not found", 404)

    const links = await db.query.pmsIssueBoqLinks.findMany({
      where: and(eq(pmsIssueBoqLinks.orgId, ctx.orgId), eq(pmsIssueBoqLinks.issueId, issueId)),
    })

    let lastProgressAt: string | null = null
    if (issue.completedFromEntryId) {
      const entry = await db.query.constructionWorkProgressEntries.findFirst({
        where: and(eq(constructionWorkProgressEntries.id, issue.completedFromEntryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)),
        columns: { entryDate: true },
      })
      lastProgressAt = entry?.entryDate ?? null
    }

    if (links.length === 0) {
      return { issueId, completionPercentage: issue.completionPercentage, completionSource: issue.completionSource, lastProgressAt, links: [] }
    }

    const lineItems = await db.query.constructionBoqLineItems.findMany({
      where: and(eq(constructionBoqLineItems.orgId, ctx.orgId), inArray(constructionBoqLineItems.id, links.map((l) => l.boqLineItemId))),
    })
    const lineById = new Map(lineItems.map((i) => [i.id, i]))

    // The project's BOQ revisions, ordered the same way listBoqs() orders them
    // so "current" is deterministic when two independent BOQs share a version.
    const boqs = await db.query.constructionBoqs.findMany({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, issue.projectId)),
      orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)],
    })
    const boqById = new Map(boqs.map((b) => [b.id, b]))
    const currentBoq = boqs.find((b) => b.status !== "superseded") ?? boqs[0] ?? null
    const currentCodeRows = currentBoq
      ? await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, currentBoq.id), columns: { itemCode: true } })
      : []
    const currentCodes = new Set(
      currentCodeRows.map((i) => i.itemCode?.trim().toLowerCase()).filter((c): c is string => !!c)
    )

    const views: LinkedBoqLineView[] = links.map((link) => {
      const line = lineById.get(link.boqLineItemId)
      const linkedBoq = line ? boqById.get(line.boqId) ?? null : null
      const isSuperseded = !!linkedBoq && !!currentBoq && linkedBoq.id !== currentBoq.id
      const code = line?.itemCode ?? null
      const stillInScope = !code || currentCodes.has(code.trim().toLowerCase())
      return {
        boqLineItemId: link.boqLineItemId,
        code,
        // A link whose line item row is gone is a real state (the row was
        // hard-deleted): say so rather than rendering an empty cell.
        description: line?.description ?? "This BOQ line no longer exists",
        unit: line?.unit ?? "",
        quantity: line ? Number(line.quantity) : 0,
        weight: Number(link.weight ?? 1),
        linkedBoqVersion: linkedBoq?.version ?? null,
        currentBoqVersion: currentBoq?.version ?? null,
        supersededButMatched: isSuperseded && stillInScope,
        scopeRemoved: !!line && !stillInScope,
      }
    })

    return { issueId, completionPercentage: issue.completionPercentage, completionSource: issue.completionSource, lastProgressAt, links: views }
  })
}

/**
 * The explicit manual override: a PM overrules what the site records say.
 *
 * The note is REQUIRED, and that is the whole point of this function existing
 * separately from updateIssue()'s ordinary completionPercentage patch. Once an
 * activity's percentage can be derived from real quantities, typing over it is
 * a decision that needs a reason attached -- otherwise the two numbers diverge
 * with no record of who chose which. Stored in compliance.audit_logs, the
 * repo's existing append-only event log, rather than a new column: the note is
 * evidence about a decision, not an attribute of the activity, and audit_logs
 * already carries the actor snapshot ("who, at the time") that makes it worth
 * anything.
 */
export async function setActivityCompletionManually(
  ctx: { orgId: string; userId: string },
  issueId: string,
  input: { completionPercentage: number; note: string },
  audit?: { dbUser?: typeof usersTable.$inferSelect; apiKey?: { id: string; name: string } }
) {
  const note = input.note?.trim()
  if (!note) throw new ServiceError("A note is required when you set the percentage manually", 400)
  if (!Number.isFinite(input.completionPercentage) || input.completionPercentage < 0 || input.completionPercentage > 100) {
    throw new ServiceError("completionPercentage must be between 0 and 100", 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const issue = await db.query.pmsIssues.findFirst({
      where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)),
    })
    if (!issue) throw new ServiceError("Activity not found", 404)

    const [updated] = await db.update(pmsIssues).set({
      completionPercentage: Math.round(input.completionPercentage),
      completionSource: "manual",
      // Cleared deliberately: the figure is no longer derived from that entry,
      // and leaving the reference would make the object page print a
      // "last entry" date for a number nobody derived from it.
      completedFromEntryId: null,
      updatedAt: new Date(),
    }).where(and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId))).returning()

    // Same transaction as the write it explains -- an override whose reason
    // failed to record is exactly the state this function exists to prevent.
    if (audit?.dbUser) {
      await logActivity({
        tx: db,
        action: "pms_issue.completion_manual_override",
        entityType: "pms_issue",
        entityId: issueId,
        details: `Set to ${Math.round(input.completionPercentage)}% manually (was ${issue.completionPercentage}%, source ${issue.completionSource}). Reason: ${note}`,
        orgId: ctx.orgId,
        dbUser: audit.dbUser,
      })
    } else if (audit?.apiKey) {
      await logActivity({
        tx: db,
        action: "pms_issue.completion_manual_override",
        entityType: "pms_issue",
        entityId: issueId,
        details: `Set to ${Math.round(input.completionPercentage)}% manually (was ${issue.completionPercentage}%, source ${issue.completionSource}). Reason: ${note}`,
        orgId: ctx.orgId,
        apiKey: audit.apiKey,
      })
    }

    return updated
  })
}
