// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
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

export async function listAttendance(ctx: { orgId: string }, filters: { projectId?: string; rosterId?: string; attendanceDate?: string }) {
  if (!filters.projectId && !filters.rosterId) throw new ServiceError("projectId or rosterId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionAttendance.projectId, filters.projectId))
    if (filters.rosterId) conditions.push(eq(constructionAttendance.rosterId, filters.rosterId))
    if (filters.attendanceDate) conditions.push(eq(constructionAttendance.attendanceDate, filters.attendanceDate))
    return db.query.constructionAttendance.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.attendanceDate) })
  })
}

const COST_MULTIPLIER: Record<string, number> = { present: 1, half_day: 0.5, absent: 0 }

export const ATTENDANCE_STATUSES = ["present", "absent", "half_day"] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

/** The code a caller checks for to know it must ask before overwriting. */
export const REPLACE_REQUIRED = "REPLACE_REQUIRED"

export type AttendanceBatchEntry = { rosterId: string; status?: string; hoursWorked?: number }

export type AttendanceBatchInput = {
  projectId: string
  attendanceDate: string
  entries: AttendanceBatchEntry[]
  /**
   * The caller has seen the "already saved -- replace it?" question and said
   * yes. Without it a date that already has rows is REFUSED, never silently
   * doubled and never silently overwritten.
   */
  replace?: boolean
}

/**
 * R67 WS-C (C-08) -- MARK A WHOLE CREW IN ONE WRITE.
 *
 * WHY THIS EXISTS. recordAttendance above writes exactly ONE row, so marking
 * a twelve-worker crew present meant twelve round trips from PROJEXA, twelve
 * transactions on a five-connection pool, and no way at all to end up with
 * either all twelve rows or none of them -- a dropped connection at worker
 * seven left the day half recorded, with nothing to say so.
 *
 * *** ONE TRANSACTION, AND NO NESTED ONE (D-06). *** Every read, every
 * delete and every insert below happens inside the SINGLE withTenantContext
 * this function opens. It deliberately does not call recordAttendance in a
 * loop: that would open a transaction per worker inside this one, which is
 * the exact nesting D-06 exists to stop.
 *
 * *** A SECOND SAVE FOR THE SAME DATE IS A QUESTION, NOT A CRASH AND NOT AN
 * OVERWRITE. *** It refuses with code REPLACE_REQUIRED and names how many
 * rows are already there, so the UI can ask "Attendance for today is already
 * saved -- replace it?" with the blast radius in the sentence.
 */
export async function recordAttendanceBatch(ctx: { orgId: string }, input: AttendanceBatchInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.attendanceDate) throw new ServiceError("attendanceDate is required", 400)
  const entries = Array.isArray(input.entries) ? input.entries : []
  if (entries.length === 0) throw new ServiceError("entries is required", 400)

  const rosterIds: string[] = []
  for (const entry of entries) {
    const rosterId = String(entry?.rosterId || "").trim()
    if (!rosterId) throw new ServiceError("every entry needs a rosterId", 400)
    // The same worker twice in one submission is a caller bug, and guessing
    // which of the two statuses was meant would be worse than refusing.
    if (rosterIds.includes(rosterId)) throw new ServiceError("the same worker appears twice in this batch", 400)
    const status = entry.status ?? "present"
    if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
      throw new ServiceError(`status must be one of ${ATTENDANCE_STATUSES.join(", ")}`, 400)
    }
    rosterIds.push(rosterId)
  }

  const rows = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const roster = await db.query.constructionLabourRoster.findMany({
      where: and(
        eq(constructionLabourRoster.orgId, ctx.orgId),
        eq(constructionLabourRoster.projectId, input.projectId),
        inArray(constructionLabourRoster.id, rosterIds)
      ),
    })
    const rateById = new Map(roster.map((r) => [r.id, Number(r.dailyRate)]))
    const missing = rosterIds.filter((id) => !rateById.has(id))
    if (missing.length > 0) {
      // Names the count, not the ids: an id is not something a site engineer
      // can act on, and the UI holds the names.
      throw new ServiceError(
        `${missing.length} of these workers are not on this project's roster`,
        404
      )
    }

    const existing = await db.query.constructionAttendance.findMany({
      where: and(
        eq(constructionAttendance.orgId, ctx.orgId),
        eq(constructionAttendance.attendanceDate, input.attendanceDate),
        inArray(constructionAttendance.rosterId, rosterIds)
      ),
    })

    if (existing.length > 0 && !input.replace) {
      throw new ServiceError(
        `Attendance for ${input.attendanceDate} is already saved for ${existing.length} of these workers`,
        409,
        { code: REPLACE_REQUIRED }
      )
    }

    if (existing.length > 0) {
      // A REPLACE really replaces: the old rows for exactly these workers on
      // exactly this date go, inside the same transaction, so there is no
      // instant in which the day is recorded twice.
      await db
        .delete(constructionAttendance)
        .where(
          and(
            eq(constructionAttendance.orgId, ctx.orgId),
            eq(constructionAttendance.attendanceDate, input.attendanceDate),
            inArray(constructionAttendance.rosterId, rosterIds)
          )
        )
    }

    const values = entries.map((entry) => {
      const status = (entry.status ?? "present") as AttendanceStatus
      const dailyCost = (rateById.get(entry.rosterId) ?? 0) * (COST_MULTIPLIER[status] ?? 1)
      return {
        orgId: ctx.orgId,
        projectId: input.projectId,
        rosterId: entry.rosterId,
        attendanceDate: input.attendanceDate,
        status: status as typeof constructionAttendance.$inferInsert.status,
        hoursWorked: entry.hoursWorked !== undefined ? String(entry.hoursWorked) : null,
        dailyCost: String(dailyCost),
      }
    })

    // ONE insert for the whole crew -- N rows, one statement, one transaction.
    return db.insert(constructionAttendance).values(values).returning()
  })

  // Wave 126's fire-and-forget automation trigger, kept for the batch path so
  // an absence recorded through the composer raises the same rule an absence
  // recorded one at a time does.
  const absent = rows.filter((row) => row.status === "absent")
  if (absent.length > 0) {
    void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
      Promise.all(
        absent.map((row) =>
          evaluateAndRunRules({ orgId: ctx.orgId }, "construction_attendance.worker_absent", {
            rosterId: row.rosterId,
            projectId: row.projectId,
            attendanceDate: row.attendanceDate,
          })
        )
      )
    )
  }

  return {
    attendanceDate: input.attendanceDate,
    written: rows.length,
    replaced: Boolean(input.replace),
    present: rows.filter((r) => r.status === "present").length,
    absent: absent.length,
    halfDay: rows.filter((r) => r.status === "half_day").length,
    attendance: rows,
  }
}

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
