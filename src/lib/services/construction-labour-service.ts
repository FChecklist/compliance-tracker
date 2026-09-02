// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, projects } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, gte, lte, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type RosterInput = {
  projectId: string
  name: string
  employeeCode?: string
  trade?: string
  skillLevel?: string
  vendorId?: string
  dailyRate: number
}

export async function listRoster(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)),
    })
  )
}

// R67 F-30 (audit recommendation R-274) -- THE MANPOWER LANDING, IN ONE HOP.
//
// THE MEASURED PROBLEM. /labour took about 6 s to a usable screen for SQL the
// audit measured as trivial. F-18 removed the serial /dashboard +
// /screen-definitions chain in front of it and F-25 stopped the screen
// fetching the whole undated attendance log it was not showing. What was left
// is the shape of the landing itself: the page wants the roster AND the "how
// did today go" summary, and asking for them one after the other is two
// network hops to VERIDIAN and two transactions on a five-connection pool for
// one screen.
//
// So a single call answers both, inside ONE withTenantContext. The summary is
// a grouped aggregate over ONE DAY -- not the whole log -- so it uses the
// (project_id, attendance_date) index migration 0529 added and stays a
// constant-size answer however long the project runs.

export type AttendanceSummary = {
  /** The day this summary is about, YYYY-MM-DD. */
  date: string
  /** How many attendance rows exist for that day. */
  recorded: number
  present: number
  halfDay: number
  absent: number
  /** Σ daily_cost for that day. */
  totalCost: number
}

const EMPTY_STATUS_COUNTS = { present: 0, halfDay: 0, absent: 0 }

/**
 * One day's attendance, grouped by status, in ONE statement.
 *
 * A day with no rows is a real answer -- "nobody has marked attendance yet" --
 * and returns zeroes, never null, so the caller does not have to decide
 * whether an absent object means "none" or "we could not find out". The
 * failure case is a thrown error, which is a different thing entirely.
 */
async function loadAttendanceSummary(
  db: TenantDb,
  orgId: string,
  projectId: string,
  date: string
): Promise<AttendanceSummary> {
  const rows = (await db.execute(sql`
    SELECT status,
           count(*)::int AS entries,
           coalesce(sum(daily_cost), 0)::float AS cost
    FROM compliance.construction_attendance
    WHERE org_id = ${orgId} AND project_id = ${projectId} AND attendance_date = ${date}
    GROUP BY status
  `)) as { status: string; entries: number; cost: number }[]

  const counts = { ...EMPTY_STATUS_COUNTS }
  let recorded = 0
  let totalCost = 0
  for (const row of rows) {
    const entries = Number(row.entries ?? 0)
    recorded += entries
    totalCost += Number(row.cost ?? 0)
    if (row.status === "present") counts.present += entries
    else if (row.status === "half_day") counts.halfDay += entries
    else if (row.status === "absent") counts.absent += entries
    // An unrecognised status still counts toward `recorded` and the cost --
    // silently dropping a row would understate the day.
  }
  return { date, recorded, ...counts, totalCost }
}

/**
 * The whole /labour landing: the roster, and one day's attendance summary,
 * in ONE transaction and ONE round trip.
 *
 * `date` is the day the summary is about. The caller supplies it -- the
 * server's own "today" is not the site's today, and a foreman in Mumbai
 * looking at a summary computed in UTC would be looking at the wrong day for
 * five and a half hours of every one of them.
 */
export async function getLabourLanding(
  ctx: { orgId: string },
  projectId: string,
  options: { attendanceDate?: string } = {}
): Promise<{ roster: (typeof constructionLabourRoster.$inferSelect)[]; attendanceSummary: AttendanceSummary | null }> {
  if (!projectId) throw new ServiceError("projectId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const roster = await db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)),
    })
    const attendanceSummary = options.attendanceDate
      ? await loadAttendanceSummary(db, ctx.orgId, projectId, options.attendanceDate)
      : null
    return { roster, attendanceSummary }
  })
}

export async function createRosterEntry(ctx: { orgId: string }, input: RosterInput) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [row] = await db.insert(constructionLabourRoster).values({
      orgId: ctx.orgId, projectId: input.projectId, name,
      employeeCode: input.employeeCode || null,
      trade: input.trade || null, skillLevel: input.skillLevel || null, vendorId: input.vendorId || null,
      dailyRate: String(input.dailyRate ?? 0),
    }).returning()
    return row
  })
}

// Real-screen conversion (2026-08-30): single-entry lookup + real update for
// the Roster Object Page -- listRoster/createRosterEntry existed since Wave
// 116 with no way to view or edit one entry (rate corrections, reassigning
// a subcontractor, retiring a worker) short of re-creating it.
export async function getRosterEntry(ctx: { orgId: string }, rosterId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.constructionLabourRoster.findFirst({ where: and(eq(constructionLabourRoster.id, rosterId), eq(constructionLabourRoster.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Roster entry not found", 404)
    return entry
  })
}

export async function updateRosterEntry(
  ctx: { orgId: string },
  rosterId: string,
  patch: Partial<{ name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: number; isActive: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionLabourRoster.findFirst({ where: and(eq(constructionLabourRoster.id, rosterId), eq(constructionLabourRoster.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Roster entry not found", 404)
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("name cannot be empty", 400)

    const [row] = await db.update(constructionLabourRoster)
      .set({ ...patch, dailyRate: patch.dailyRate !== undefined ? String(patch.dailyRate) : undefined })
      .where(eq(constructionLabourRoster.id, rosterId)).returning()
    return row
  })
}

// R67 F-25 (audit recommendation R-241) -- ATTENDANCE IS A DATED QUESTION.
//
// THE MEASURED PROBLEM. PROJEXA's Manpower screen fetched THE WHOLE ATTENDANCE
// LOG on every landing, with no date filter at all, even though the screen
// opens on the Roster tab and never shows a row of it until the user switches.
// A site with 40 workers produces 40 rows a day, so the payload grows without
// bound for a table nobody has asked to see, and the one date a foreman
// actually wants -- today -- is buried in it.
//
// `date` (one day) and `from`/`to` (a range, both inclusive, entryDate is a
// plain date column) are the filters that were missing. `attendanceDate` is
// KEPT as an alias for `date` so every existing caller and every existing
// ?attendanceDate= query string keeps working unchanged; passing both is not
// an error, they mean the same thing and `date` wins.
export type AttendanceFilters = {
  projectId?: string
  rosterId?: string
  /** One exact day, YYYY-MM-DD. */
  date?: string
  /** Back-compat alias for `date` -- the original parameter name. */
  attendanceDate?: string
  /** Inclusive range start, YYYY-MM-DD. Ignored when `date` is set. */
  from?: string
  /** Inclusive range end, YYYY-MM-DD. Ignored when `date` is set. */
  to?: string
}

export async function listAttendance(ctx: { orgId: string }, filters: AttendanceFilters) {
  if (!filters.projectId && !filters.rosterId) throw new ServiceError("projectId or rosterId is required", 400)
  const exactDate = filters.date ?? filters.attendanceDate
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionAttendance.projectId, filters.projectId))
    if (filters.rosterId) conditions.push(eq(constructionAttendance.rosterId, filters.rosterId))
    // A single day is an equality, not a degenerate range -- it can use the
    // (project_id, attendance_date) index directly.
    if (exactDate) {
      conditions.push(eq(constructionAttendance.attendanceDate, exactDate))
    } else {
      if (filters.from) conditions.push(gte(constructionAttendance.attendanceDate, filters.from))
      if (filters.to) conditions.push(lte(constructionAttendance.attendanceDate, filters.to))
    }
    return db.query.constructionAttendance.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.attendanceDate) })
  })
}

const COST_MULTIPLIER: Record<string, number> = { present: 1, half_day: 0.5, absent: 0 }

export async function recordAttendance(
  ctx: { orgId: string },
  input: { projectId: string; rosterId: string; attendanceDate: string; status?: string; hoursWorked?: number }
) {
  if (!input.rosterId) throw new ServiceError("rosterId is required", 400)
  if (!input.attendanceDate) throw new ServiceError("attendanceDate is required", 400)
  const status = input.status || "present"

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const roster = await db.query.constructionLabourRoster.findFirst({ where: and(eq(constructionLabourRoster.id, input.rosterId), eq(constructionLabourRoster.orgId, ctx.orgId)) })
    if (!roster) throw new ServiceError("Roster entry not found", 404)

    const existing = await db.query.constructionAttendance.findFirst({
      where: and(eq(constructionAttendance.rosterId, input.rosterId), eq(constructionAttendance.attendanceDate, input.attendanceDate)),
    })
    if (existing) throw new ServiceError("Attendance already recorded for this worker on this date", 409)

    const dailyCost = Number(roster.dailyRate) * (COST_MULTIPLIER[status] ?? 1)

    const [row] = await db.insert(constructionAttendance).values({
      orgId: ctx.orgId, projectId: input.projectId, rosterId: input.rosterId, attendanceDate: input.attendanceDate,
      status: status as typeof constructionAttendance.$inferInsert.status,
      hoursWorked: input.hoursWorked !== undefined ? String(input.hoursWorked) : null,
      dailyCost: String(dailyCost),
    }).returning()
    return row
  }).then((row) => {
    // Wave 126: fire-and-forget automation trigger.
    if (row.status === "absent") {
      void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
        evaluateAndRunRules({ orgId: ctx.orgId }, "construction_attendance.worker_absent", {
          rosterId: row.rosterId, projectId: row.projectId, attendanceDate: row.attendanceDate,
        })
      )
    }
    return row
  })
}
