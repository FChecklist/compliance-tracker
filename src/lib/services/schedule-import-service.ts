// R67 lane D22 (item D-48, rec R-123) -- PROGRAMME (SCHEDULE) EXCEL IMPORT.
//
// Every real contractor's programme arrives as a spreadsheet, and PROJEXA had
// no way to take one: the only route that even mentioned it,
// projexa/src/app/api/schedule-tracker/import/route.ts, pointed at a VERIDIAN
// path that does not exist. This is the missing backend.
//
// ALL PARSING STAYS HERE, in compliance-tracker. PROJEXA must not gain an XLSX
// or PDF library (programme rule; see repo_map.md section C) -- the browser
// uploads the file as FormData and the server answers with parsed rows. The
// parsing itself reuses src/lib/ingest/parser.ts's parseFile(), whose xlsx
// import is dynamic so this module stays Edge-safe to import, exactly as the
// shipped construction-boq-import-service.ts does for BOQ sheets. Nothing
// about xlsx handling is re-invented here.
//
// The pure half (mapScheduleHeaders/mapRowsToActivities) has no DB and no
// xlsx access, so a real programme sheet's edge cases -- a finish before its
// start, a duplicate activity name, a predecessor that does not exist -- are
// provable in a unit test, the same discipline construction-boq-import-
// service.ts's own mapRowsToLineItems() follows.
import { parseFile } from "@/lib/ingest/parser"
import { parseAmount } from "@/lib/gst/column-mapper"
import {
  pmsIssues, pmsIssueRelations, pmsIssueBoqLinks, pmsIssueTypes, projects,
  constructionBoqs, constructionBoqLineItems, organisations,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { ensureDefaultStatusesForProject } from "./pms-taxonomy-service"
export { ServiceError }

export type ScheduleFieldKey =
  | "activity" | "startDate" | "finishDate" | "duration" | "predecessor" | "weight" | "boqCode"

// Alias order within a field is a PRIORITY order, not a membership list --
// the same rule BOQ_FIELD_ALIASES documents. It matters here because a real
// programme export routinely carries BOTH "Task" and "Description" columns
// (the task name and a longer note), and "Description" must never win over a
// real Activity/Task column when both are present.
export const SCHEDULE_FIELD_ALIASES: Record<ScheduleFieldKey, string[]> = {
  activity: ["activity", "activity name", "task", "task name", "description", "work item"],
  startDate: ["start", "start date", "planned start", "baseline start"],
  finishDate: ["finish", "finish date", "end", "end date", "due", "due date", "planned finish"],
  duration: ["duration", "duration days", "days"],
  predecessor: ["predecessor", "predecessors", "pred", "depends on"],
  weight: ["weight", "weight %", "weightage", "%", "percent", "value"],
  boqCode: ["boq", "boq code", "boq item code", "item code", "code"],
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim().replace(/\s+/g, " ")
}

export type ScheduleColumnMapping = Partial<Record<ScheduleFieldKey, string>>

export function mapScheduleHeaders(headers: string[]): ScheduleColumnMapping {
  const mapping: ScheduleColumnMapping = {}
  const used = new Set<string>()
  for (const field of Object.keys(SCHEDULE_FIELD_ALIASES) as ScheduleFieldKey[]) {
    let match: string | undefined
    for (const alias of SCHEDULE_FIELD_ALIASES[field]) {
      match = headers.find((h) => !used.has(h) && normalizeHeader(h) === alias)
      if (match) break
    }
    if (match) { mapping[field] = match; used.add(match) }
  }
  return mapping
}

/**
 * How a slash/dot/dash-separated date is read when day and month are both
 * <= 12 and the file itself cannot say which is which.
 *
 * Resolved from compliance.organisations.date_format (WS-I item I-02), never
 * from the SERVER's locale -- a Node process in UTC has no opinion worth
 * having about a UAE contractor's programme. Unset falls back to day-first,
 * which is the real convention in both of this product's markets and the same
 * reasoning drizzle/0529 used when it backfilled AED/INR orgs to 'dd-MM-yyyy'.
 * Whichever way it resolves, the preview STATES it -- "Reading dates as
 * dd/mm/yyyy" -- so a wrong reading is visible before anything is written.
 */
export function resolveDateOrder(orgDateFormat: string | null | undefined): "dmy" | "mdy" {
  return orgDateFormat && /^mm/i.test(orgDateFormat.trim()) ? "mdy" : "dmy"
}

export function dateOrderLabel(order: "dmy" | "mdy"): string {
  return order === "mdy" ? "Reading dates as mm/dd/yyyy" : "Reading dates as dd/mm/yyyy"
}

/**
 * Parses one cell into an ISO yyyy-mm-dd date, or null when there is nothing
 * usable there. Never throws: a bad date is a per-row message, not a failed
 * import.
 */
export function parseScheduleDate(raw: unknown, order: "dmy" | "mdy"): string | null {
  if (raw === null || raw === undefined) return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10)
  const text = String(raw).trim()
  if (!text) return null

  // Unambiguous ISO first -- xlsx's own dateNF: 'yyyy-mm-dd' emits this shape,
  // so a properly formatted sheet never reaches the ambiguous branch at all.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const parts = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/)
  if (parts) {
    const a = Number(parts[1]), b = Number(parts[2])
    let year = Number(parts[3])
    if (year < 100) year += year < 70 ? 2000 : 1900
    // A value over 12 can only be the day, whatever the org's setting says --
    // honouring the setting there would turn 25/12 into an invalid month.
    const dayFirst = a > 12 ? true : b > 12 ? false : order === "dmy"
    const day = dayFirst ? a : b
    const month = dayFirst ? b : a
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export type ParsedScheduleActivity = {
  /** 1-based row number in the sheet, header included -- the number a human sees in Excel. */
  rowNumber: number
  name: string
  startDate: string | null
  finishDate: string | null
  durationDays: number | null
  predecessorNames: string[]
  weight: number | null
  boqCode: string | null
  /** Zero duration, or a start equal to its finish: a date on the programme, not a span of work. */
  isMilestone: boolean
}

export type ScheduleParseResult = {
  activities: ParsedScheduleActivity[]
  warnings: string[]
  blockingErrors: string[]
  mapping: ScheduleColumnMapping
  totalRows: number
  milestoneCount: number
  dateInterpretation: string
}

const NO_USABLE_ROWS = "No usable rows found - check that the first row holds the column headers"

/**
 * Pure: already-parsed spreadsheet rows -> programme activities plus the
 * messages a human needs before committing anything.
 *
 * WARNINGS describe something imported differently from what the sheet said
 * (a duplicate name that had to be suffixed, a finish before its start).
 * BLOCKING ERRORS describe something that cannot be imported at all (no
 * Activity column, no rows, a predecessor naming an activity that is not in
 * the file). The split matters: the UI enables Import on warnings and refuses
 * on blocking errors, so "38 activities, 2 milestones, 3 warnings" is an
 * importable state and "Fix 1 blocking error" is not.
 */
export function mapRowsToActivities(
  rows: Record<string, unknown>[],
  mapping: ScheduleColumnMapping,
  order: "dmy" | "mdy" = "dmy"
): { activities: ParsedScheduleActivity[]; warnings: string[]; blockingErrors: string[] } {
  const warnings: string[] = []
  const blockingErrors: string[] = []

  if (!mapping.activity) {
    return { activities: [], warnings, blockingErrors: ["Could not find an Activity column in this spreadsheet"] }
  }

  const activities: ParsedScheduleActivity[] = []
  const seenNames = new Map<string, number>()

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2 // +1 for the header row, +1 because humans count from 1
    const rawName = String(row[mapping.activity!] ?? "").trim()
    if (!rawName) return // a blank spacer row is not an error, it is just not an activity

    // A duplicate activity name is real (two floors, the same trade) and must
    // import -- but as its own row, not silently merged into the first one,
    // and never silently: the suffix is stated so a reader can tell which is
    // which on the Gantt.
    const seen = seenNames.get(rawName.toLowerCase()) ?? 0
    seenNames.set(rawName.toLowerCase(), seen + 1)
    const name = seen === 0 ? rawName : `${rawName} (${seen + 1})`
    if (seen > 0) warnings.push(`Row ${rowNumber}: duplicate activity name "${rawName}" imported as "${name}"`)

    const startDate = mapping.startDate ? parseScheduleDate(row[mapping.startDate], order) : null
    const finishDate = mapping.finishDate ? parseScheduleDate(row[mapping.finishDate], order) : null
    if (startDate && finishDate && finishDate < startDate) {
      warnings.push(`Row ${rowNumber}: Finish before Start`)
    }

    const durationRaw = mapping.duration ? String(row[mapping.duration] ?? "").trim() : ""
    const durationDays = durationRaw === "" ? null : parseAmount(row[mapping.duration!])
    const weightRaw = mapping.weight ? String(row[mapping.weight] ?? "").trim() : ""
    // xlsx stores a percent-formatted cell as its underlying fraction (30% ->
    // 0.3) and parseAmount passes that straight through -- the same leak
    // construction-boq-import-service.ts documents for breakdownPercentage,
    // fixed the same way. A real programme weight is > 1 and <= 100.
    let weight = weightRaw === "" ? null : parseAmount(row[mapping.weight!])
    if (weight !== null && weight > 0 && weight <= 1) weight = weight * 100

    const predecessorRaw = mapping.predecessor ? String(row[mapping.predecessor] ?? "").trim() : ""
    const predecessorNames = predecessorRaw
      ? predecessorRaw.split(/[;,]/).map((p) => p.trim()).filter((p) => p.length > 0)
      : []

    const boqCode = mapping.boqCode ? String(row[mapping.boqCode] ?? "").trim() || null : null

    activities.push({
      rowNumber, name, startDate, finishDate,
      durationDays: durationDays !== null && Number.isFinite(durationDays) ? durationDays : null,
      predecessorNames, weight, boqCode,
      isMilestone: durationDays === 0 || (!!startDate && startDate === finishDate),
    })
  })

  if (activities.length === 0) blockingErrors.push(NO_USABLE_ROWS)

  // A predecessor must name an activity that is actually in this file --
  // importing a dependency on something that does not exist would produce a
  // Gantt with a dangling arrow and no way to fix it from the UI.
  const knownNames = new Set(activities.map((a) => a.name.toLowerCase()))
  for (const activity of activities) {
    for (const predecessor of activity.predecessorNames) {
      if (!knownNames.has(predecessor.toLowerCase())) {
        blockingErrors.push(`Row ${activity.rowNumber}: predecessor '${predecessor}' not found`)
      }
    }
  }

  return { activities, warnings, blockingErrors }
}

/** Parses an uploaded programme spreadsheet (xlsx/xls/csv) into activities, warnings and blocking errors. */
export async function parseScheduleSpreadsheet(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  options: { orgDateFormat?: string | null } = {}
): Promise<ScheduleParseResult> {
  const order = resolveDateOrder(options.orgDateFormat)
  let parsed
  try {
    parsed = await parseFile(buffer, fileName, mimeType)
  } catch {
    // parseFile throws on an empty sheet ("Excel file is empty or has no data
    // rows"). That is the same situation as a sheet whose rows are all blank,
    // and the user needs the same sentence for both.
    return {
      activities: [], warnings: [], blockingErrors: [NO_USABLE_ROWS],
      mapping: {}, totalRows: 0, milestoneCount: 0, dateInterpretation: dateOrderLabel(order),
    }
  }
  const mapping = mapScheduleHeaders(parsed.headers)
  const { activities, warnings, blockingErrors } = mapRowsToActivities(parsed.rows as Record<string, unknown>[], mapping, order)
  return {
    activities, warnings, blockingErrors, mapping,
    totalRows: parsed.totalRows,
    milestoneCount: activities.filter((a) => a.isMilestone).length,
    dateInterpretation: dateOrderLabel(order),
  }
}

/**
 * The org's own date convention, for parseScheduleSpreadsheet's ambiguous-date
 * branch. Its OWN transaction, before parsing starts -- never nested inside
 * one (programme decision D-06). A missing row or an unset column is not an
 * error: resolveDateOrder() has a documented fallback and the preview states
 * whichever reading it used.
 */
export async function resolveOrgDateFormat(orgId: string): Promise<string | null> {
  return withTenantContext({ orgId }, async (db) => {
    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { dateFormat: true } })
    return org?.dateFormat ?? null
  })
}

export type ScheduleImportResult = {
  projectId: string
  createdIssueIds: string[]
  dependencyCount: number
  boqLinkCount: number
  unmatchedBoqCodes: string[]
}

/**
 * Commits a parsed programme: one pms_issues row per activity, one
 * pms_issue_relations 'blocks' edge per predecessor, and one
 * pms_issue_boq_links row per activity whose BOQ code matches a line on the
 * project's latest BOQ.
 *
 * ONE TRANSACTION for the whole import, and never a nested one (programme
 * decision D-06): a half-imported programme -- activities without their
 * dependencies -- is worse than no import at all, and createIssue() opens its
 * own withTenantContext per call, which would be one transaction per row on a
 * five-connection pool. The parts of createIssue() that matter here (the
 * per-project number sequence, ensureDefaultStatusesForProject) are reused
 * directly rather than reimplemented.
 */
export async function importScheduleActivities(
  ctx: { orgId: string; userId: string },
  input: { projectId: string; activities: ParsedScheduleActivity[] }
): Promise<ScheduleImportResult> {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (input.activities.length === 0) throw new ServiceError(NO_USABLE_ROWS, 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)),
    })
    if (!project) throw new ServiceError("Project not found", 404)

    const statuses = await ensureDefaultStatusesForProject(db, ctx.orgId, input.projectId)
    const statusId = statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id
    if (!statusId) throw new ServiceError("No issue status could be resolved for this project", 400)

    const types = await db.query.pmsIssueTypes.findMany({ where: eq(pmsIssueTypes.orgId, ctx.orgId) })
    const typeId = types.find((t) => t.isDefault)?.id ?? types[0]?.id
    if (!typeId) throw new ServiceError("No issue type could be resolved for this organisation", 400)

    // The BOQ vocabulary this project's codes are matched against: the latest
    // non-superseded revision, resolved with listBoqs()'s own
    // version-then-createdAt ordering so "latest" is deterministic when two
    // independent BOQs share a version.
    const boqs = await db.query.constructionBoqs.findMany({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, input.projectId)),
      orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)],
    })
    const latestBoq = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    const boqLines = latestBoq
      ? await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, latestBoq.id) })
      : []
    const lineIdByCode = new Map(
      boqLines.filter((l) => l.itemCode).map((l) => [l.itemCode!.trim().toLowerCase(), l.id])
    )

    // The per-project number sequence, claimed once for the whole batch with a
    // single atomic statement -- the same shape createIssue() uses, but not
    // once per row.
    const [bumped] = await db.update(projects)
      .set({ issueSequence: sql`${projects.issueSequence} + ${input.activities.length}` })
      .where(eq(projects.id, input.projectId))
      .returning({ issueSequence: projects.issueSequence })
    const lastNumber = bumped.issueSequence
    const firstNumber = lastNumber - input.activities.length + 1

    const inserted = await db.insert(pmsIssues).values(
      input.activities.map((activity, i) => ({
        orgId: ctx.orgId, projectId: input.projectId, typeId, statusId,
        number: firstNumber + i,
        title: activity.name,
        startDate: activity.startDate, dueDate: activity.finishDate,
        createdById: ctx.userId,
      }))
    ).returning()

    const idByName = new Map(inserted.map((issue) => [issue.title.toLowerCase(), issue.id]))

    const dependencyRows = input.activities.flatMap((activity) => {
      const successorId = idByName.get(activity.name.toLowerCase())
      if (!successorId) return []
      return activity.predecessorNames.flatMap((predecessorName) => {
        const predecessorId = idByName.get(predecessorName.toLowerCase())
        if (!predecessorId || predecessorId === successorId) return []
        // Stored from the predecessor's side as 'blocks', which is the
        // direction schedule-service.ts's normalizeEdges() treats as
        // predecessor -> successor without needing a mirror row.
        return [{ orgId: ctx.orgId, issueId: predecessorId, relatedIssueId: successorId, relationType: "blocks" as const, lagDays: 0 }]
      })
    })
    if (dependencyRows.length > 0) await db.insert(pmsIssueRelations).values(dependencyRows)

    const unmatchedBoqCodes: string[] = []
    const linkRows = input.activities.flatMap((activity) => {
      if (!activity.boqCode) return []
      const lineId = lineIdByCode.get(activity.boqCode.trim().toLowerCase())
      const issueId = idByName.get(activity.name.toLowerCase())
      if (!lineId || !issueId) {
        if (!lineId) unmatchedBoqCodes.push(activity.boqCode)
        return []
      }
      return [{
        orgId: ctx.orgId, issueId, boqLineItemId: lineId,
        // The sheet's Weight column is a share of the PROGRAMME; the link's
        // weight is a share of the BOQ LINE. Only a real per-line split
        // belongs here, so an unstated one takes the schema's own default of
        // 1 ("this activity delivers the whole line") rather than borrowing a
        // number that means something else.
        weight: "1",
      }]
    })
    if (linkRows.length > 0) await db.insert(pmsIssueBoqLinks).values(linkRows)

    return {
      projectId: input.projectId,
      createdIssueIds: inserted.map((i) => i.id),
      dependencyCount: dependencyRows.length,
      boqLinkCount: linkRows.length,
      unmatchedBoqCodes: [...new Set(unmatchedBoqCodes)],
    }
  })
}
