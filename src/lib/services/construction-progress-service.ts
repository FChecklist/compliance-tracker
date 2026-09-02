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
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { listDocuments } from "./document-service"
import { logActivity } from "@/lib/audit"
import { users as usersTable } from "@/lib/db"
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
// ─── R67 lane D22 (item D-64, rec R-230) ──────────────────────────────────
// THE 25-CHARACTER ID IN THE "BOQ LINE" COLUMN. This list is what a site
// engineer reads back to check what they logged, and its BOQ line column
// printed a cuid, because the entry row carries only boq_line_item_id and
// nothing joined it to the line. The PROJEXA screen papered over it with a
// client-side lookup against whichever BOQ the form happened to have loaded --
// so an entry recorded against any OTHER revision still rendered as its raw id.
// Joining here fixes it for the list, the report and the chat at once.

/** What an entry says about the BOQ line it was recorded against. */
export type ProgressEntryBoqLine = {
  boqLineId: string
  code: string | null
  description: string
  unit: string
  /** The line's contracted quantity. */
  qtyTotal: number
  /** This entry's own quantity, not the line's running total -- one row, one fact. */
  qtyDone: number
  boqId: string
}

/**
 * Pure: attaches each entry's BOQ line, by id, from an already-loaded set.
 *
 * Kept separate from the query so the shape is provable without a database,
 * the same discipline lineProgressFraction()/computeLinkedIssueCompletion()
 * below already follow. An entry with no boq_line_item_id -- legitimate, the
 * column is nullable -- gets `boqLine: null`, which the screen renders as an
 * en-dash. It must never render as the string "null" or as an id.
 */
export function attachBoqLines<T extends { boqLineItemId: string | null; quantityDone: string | number }>(
  entries: T[],
  lines: { id: string; boqId: string; itemCode: string | null; description: string; unit: string; quantity: string | number }[]
): (T & { boqLine: ProgressEntryBoqLine | null })[] {
  const byId = new Map(lines.map((l) => [l.id, l]))
  return entries.map((entry) => {
    const line = entry.boqLineItemId ? byId.get(entry.boqLineItemId) : undefined
    return {
      ...entry,
      boqLine: line
        ? {
            boqLineId: line.id,
            code: line.itemCode,
            description: line.description,
            unit: line.unit,
            qtyTotal: Number(line.quantity) || 0,
            qtyDone: Number(entry.quantityDone) || 0,
            boqId: line.boqId,
          }
        : null,
    }
  })
}

export async function listProgressEntries(
  ctx: { orgId: string },
  filters: { projectId?: string; activityId?: string; boqLineItemId?: string; dateFrom?: string; dateTo?: string }
) {
  if (!filters.projectId && !filters.activityId) throw new ServiceError("projectId or activityId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionWorkProgressEntries.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionWorkProgressEntries.projectId, filters.projectId))
    if (filters.activityId) conditions.push(eq(constructionWorkProgressEntries.activityId, filters.activityId))
    if (filters.boqLineItemId) conditions.push(eq(constructionWorkProgressEntries.boqLineItemId, filters.boqLineItemId))
    if (filters.dateFrom) conditions.push(gte(constructionWorkProgressEntries.entryDate, filters.dateFrom))
    if (filters.dateTo) conditions.push(lte(constructionWorkProgressEntries.entryDate, filters.dateTo))
    const entries = await db.query.constructionWorkProgressEntries.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.entryDate),
    })

    // ONE extra query for the whole page, not one per row.
    const lineIds = [...new Set(entries.map((e) => e.boqLineItemId).filter((v): v is string => !!v))]
    const lines = lineIds.length
      ? await db.query.constructionBoqLineItems.findMany({
          where: and(eq(constructionBoqLineItems.orgId, ctx.orgId), inArray(constructionBoqLineItems.id, lineIds)),
          columns: { id: true, boqId: true, itemCode: true, description: true, unit: true, quantity: true },
        })
      : []
    return attachBoqLines(entries, lines)
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

// ─── R67 lane D22 (item D-77, rec R-289) ──────────────────────────────────
// A WORK-PROGRESS ENTRY HAD NO OBJECT PAGE AND NO WAY BACK. The list printed
// a row and that was the end of it: there was no route to one entry, no way to
// see its remarks or the photo the crew attached, and no way to correct a
// quantity typed wrong on site -- the only mutation that existed was DELETE.
// A record you can only destroy is not a record anyone will trust.
//
// This is the read and the correction. Deliberately NOT re-parented: the
// activity and the BOQ line an entry was recorded against are what make it
// that entry, and moving it between activities is a different act (delete and
// re-record) with different consequences for every roll-up that reads it.

export type ProgressEntryDetail = Awaited<ReturnType<typeof getProgressEntry>>

/** One entry, with everything the object page shows -- so the screen makes ONE call, not five. */
export async function getProgressEntry(ctx: { orgId: string }, entryId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.constructionWorkProgressEntries.findFirst({
      where: and(eq(constructionWorkProgressEntries.id, entryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)),
    })
    if (!entry) throw new ServiceError("Progress entry not found", 404)

    const [activity, project, recordedBy, lines] = await Promise.all([
      db.query.constructionActivities.findFirst({
        where: and(eq(constructionActivities.id, entry.activityId), eq(constructionActivities.orgId, ctx.orgId)),
        columns: { id: true, name: true, unit: true },
      }),
      db.query.projects.findFirst({
        where: and(eq(projects.id, entry.projectId), eq(projects.orgId, ctx.orgId)),
        columns: { id: true, name: true },
      }),
      db.query.users.findFirst({
        where: and(eq(usersTable.id, entry.recordedById), eq(usersTable.orgId, ctx.orgId)),
        columns: { id: true, name: true },
      }),
      entry.boqLineItemId
        ? db.query.constructionBoqLineItems.findMany({
            where: and(eq(constructionBoqLineItems.orgId, ctx.orgId), inArray(constructionBoqLineItems.id, [entry.boqLineItemId])),
            columns: { id: true, boqId: true, itemCode: true, description: true, unit: true, quantity: true },
          })
        : Promise.resolve([]),
    ])

    // The SAME composer the list uses, so one entry and its row in the list can
    // never name the same BOQ line two different ways.
    const [withLine] = attachBoqLines([entry], lines)
    return {
      ...withLine,
      activityName: activity?.name ?? null,
      activityUnit: activity?.unit ?? null,
      projectName: project?.name ?? null,
      // The person, by name. An id is never printed on a screen (R-230/R-289).
      recordedByName: recordedBy?.name ?? null,
    }
  })
}

/**
 * Corrects a recorded entry.
 *
 * WHAT MAY CHANGE: the measured facts (date, quantity, percent, basis) and the
 * remarks. WHAT MAY NOT: project, activity and BOQ line -- see this section's
 * header.
 *
 * The linked schedule activities are rolled up again on the SAME transaction,
 * exactly as createProgressEntry does (programme decision D-06 forbids a
 * nested withTenantContext). rollUpLinkedIssueCompletion recomputes from every
 * entry on the line rather than adding a delta, so re-running it after an edit
 * is both correct and idempotent -- a quantity typed as 500 and corrected to
 * 50 leaves the activity reading what the site records now say, not the sum of
 * both readings.
 */
export async function updateProgressEntry(
  ctx: { orgId: string },
  entryId: string,
  input: { entryDate?: string; quantityDone?: number; percentComplete?: number; remarks?: string | null; entryBasis?: "DELTA" | "SNAPSHOT" }
) {
  if (input.percentComplete !== undefined && (input.percentComplete < 0 || input.percentComplete > 100)) {
    throw new ServiceError("percentComplete must be between 0 and 100", 400)
  }
  if (input.entryBasis !== undefined && input.entryBasis !== "DELTA" && input.entryBasis !== "SNAPSHOT") {
    throw new ServiceError("entryBasis must be DELTA or SNAPSHOT", 400)
  }
  if (input.entryDate !== undefined && !input.entryDate) throw new ServiceError("entryDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.constructionWorkProgressEntries.findFirst({
      where: and(eq(constructionWorkProgressEntries.id, entryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)),
    })
    if (!entry) throw new ServiceError("Progress entry not found", 404)

    const patch: Record<string, unknown> = {}
    if (input.entryDate !== undefined) patch.entryDate = input.entryDate
    if (input.quantityDone !== undefined) patch.quantityDone = String(input.quantityDone)
    if (input.percentComplete !== undefined) patch.percentComplete = String(input.percentComplete)
    if (input.entryBasis !== undefined) patch.entryBasis = input.entryBasis
    if (input.remarks !== undefined) patch.remarks = input.remarks || null
    if (Object.keys(patch).length === 0) throw new ServiceError("Nothing to update", 400)

    const [row] = await db
      .update(constructionWorkProgressEntries)
      .set(patch)
      .where(and(eq(constructionWorkProgressEntries.id, entryId), eq(constructionWorkProgressEntries.orgId, ctx.orgId)))
      .returning()

    if (row.boqLineItemId) await rollUpLinkedIssueCompletion(db, ctx.orgId, row.boqLineItemId, row.id)
    return row
  })
}

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
 */
export async function rollUpLinkedIssueCompletion(
  db: TenantDb,
  orgId: string,
  boqLineItemId: string,
  fromEntryId: string
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

    // R67 lane D22 (item D-49): the same transaction, never a nested one
    // (programme decision D-06) and never a fire-and-forget follow-up -- if the
    // roll-up fails the entry must fail with it, or the schedule and the site
    // records disagree with nobody knowing which is right.
    if (boqLineItemId) await rollUpLinkedIssueCompletion(db, ctx.orgId, boqLineItemId, row.id)

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
