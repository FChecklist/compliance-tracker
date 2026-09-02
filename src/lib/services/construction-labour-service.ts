// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, inArray, lte } from "drizzle-orm"
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

// R67 D-30: `from`/`to` added alongside the pre-existing exact-date filter.
// The daily attendance sheet reads one date, but the worker object page's
// attendance history reads a month window and the daily-summary tab reads a
// range -- doing that client-side would mean pulling every attendance row a
// project has ever had and filtering in the browser, which is exactly the
// "fetch everything then reduce in JS" pattern getMaterialCostReport's own
// header rejects. Both bounds are inclusive (date columns, not timestamps).
export async function listAttendance(
  ctx: { orgId: string },
  filters: { projectId?: string; rosterId?: string; attendanceDate?: string; from?: string; to?: string }
) {
  if (!filters.projectId && !filters.rosterId) throw new ServiceError("projectId or rosterId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionAttendance.projectId, filters.projectId))
    if (filters.rosterId) conditions.push(eq(constructionAttendance.rosterId, filters.rosterId))
    if (filters.attendanceDate) conditions.push(eq(constructionAttendance.attendanceDate, filters.attendanceDate))
    if (filters.from) conditions.push(gte(constructionAttendance.attendanceDate, filters.from))
    if (filters.to) conditions.push(lte(constructionAttendance.attendanceDate, filters.to))
    return db.query.constructionAttendance.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.attendanceDate) })
  })
}

export type AttendanceStatus = "present" | "absent" | "half_day"

// The one place the present/half-day/absent -> money rule lives. Exported so
// the batch path below and its unit test read the SAME multipliers the
// single-row recordAttendance() has used since Wave 116, rather than a
// second copy that could drift.
export const ATTENDANCE_COST_MULTIPLIER: Record<AttendanceStatus, number> = { present: 1, half_day: 0.5, absent: 0 }

const COST_MULTIPLIER: Record<string, number> = ATTENDANCE_COST_MULTIPLIER

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === "present" || value === "absent" || value === "half_day"
}

/** Pure: the money a single marked row is worth. `dailyRate` arrives as the numeric column's string form. */
export function computeDailyCost(dailyRate: string | number, status: AttendanceStatus): number {
  const rate = Number(dailyRate)
  if (!Number.isFinite(rate)) return 0
  return Math.round(rate * ATTENDANCE_COST_MULTIPLIER[status] * 100) / 100
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

export type AttendanceBatchRow = { rosterId: string; status: AttendanceStatus; hoursWorked?: number | null }

export type AttendanceBatchInput = {
  projectId: string
  attendanceDate: string
  rows: AttendanceBatchRow[]
}

export type AttendanceBatchResult = {
  attendanceDate: string
  savedCount: number
  createdCount: number
  updatedCount: number
  totalCost: number
  attendance: (typeof constructionAttendance.$inferSelect)[]
}

// R67 D-30 (Daily Attendance Sheet). recordAttendance() above writes exactly
// ONE row per call and 409s if that worker/date pair already exists, so
// marking a 38-worker roster meant 38 HTTP round trips, 38 withTenantContext
// TRANSACTIONS on a 5-connection pool, and no way at all to correct a
// mis-marked row from the sheet. This is the batch twin: one transaction,
// three round trips of work regardless of roster size (roster lookup,
// existing-row lookup, then the writes), and an UPSERT on
// (orgId, rosterId, attendanceDate) so re-saving the same sheet corrects the
// rows instead of duplicating or 409ing them.
//
// The upsert is done as read-then-update/insert inside the transaction rather
// than ON CONFLICT: the unique index on (org_id, roster_id, attendance_date)
// this key needs ships in the R67 WS-I migration set, which is a different
// lane's file, so this path must be correct with OR without it. Once that
// index exists it additionally makes the pair unique under concurrency; the
// logic here does not change.
//
// dailyCost is recomputed from the roster's own dailyRate on every save --
// never trusted from the client, and never carried over from the row's
// previous status -- matching recordAttendance()'s write-time posture.
export async function recordAttendanceBatch(ctx: { orgId: string }, input: AttendanceBatchInput): Promise<AttendanceBatchResult> {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.attendanceDate) throw new ServiceError("attendanceDate is required", 400)
  const rows = input.rows ?? []
  if (rows.length === 0) throw new ServiceError("At least one marked row is required", 400)

  const seen = new Set<string>()
  for (const row of rows) {
    if (!row?.rosterId) throw new ServiceError("Every row needs a rosterId", 400)
    if (seen.has(row.rosterId)) throw new ServiceError(`Worker ${row.rosterId} appears twice in the same sheet`, 400)
    seen.add(row.rosterId)
    if (!isAttendanceStatus(row.status)) throw new ServiceError(`Unknown attendance status "${String(row.status)}"`, 400)
    if (row.hoursWorked !== undefined && row.hoursWorked !== null && !Number.isFinite(Number(row.hoursWorked))) {
      throw new ServiceError("hoursWorked must be a number", 400)
    }
  }
  const rosterIds = [...seen]

  const result = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    // One lookup for the whole sheet. Scoped by projectId as well as orgId so
    // a sheet cannot silently mark a worker who belongs to another project of
    // the same org -- the same intra-tenant misattribution
    // construction-progress-service.ts's own R48 fix closed.
    const rosterRows = await db.query.constructionLabourRoster.findMany({
      where: and(
        eq(constructionLabourRoster.orgId, ctx.orgId),
        eq(constructionLabourRoster.projectId, input.projectId),
        inArray(constructionLabourRoster.id, rosterIds)
      ),
    })
    const rosterById = new Map(rosterRows.map((r) => [r.id, r]))
    const missing = rosterIds.filter((id) => !rosterById.has(id))
    if (missing.length > 0) throw new ServiceError(`Roster entry not found on this project: ${missing.join(", ")}`, 404)

    const existingRows = await db.query.constructionAttendance.findMany({
      where: and(
        eq(constructionAttendance.orgId, ctx.orgId),
        eq(constructionAttendance.attendanceDate, input.attendanceDate),
        inArray(constructionAttendance.rosterId, rosterIds)
      ),
    })
    const existingByRosterId = new Map(existingRows.map((r) => [r.rosterId, r]))

    const saved: (typeof constructionAttendance.$inferSelect)[] = []
    const toInsert: (typeof constructionAttendance.$inferInsert)[] = []
    let updatedCount = 0

    for (const row of rows) {
      const roster = rosterById.get(row.rosterId)!
      const dailyCost = computeDailyCost(roster.dailyRate, row.status)
      const hoursWorked = row.hoursWorked === undefined || row.hoursWorked === null ? null : String(row.hoursWorked)
      const existing = existingByRosterId.get(row.rosterId)

      if (existing) {
        // Still one transaction: an UPDATE per corrected row, not a
        // transaction per row. Only rows already on this date are touched.
        const [updated] = await db.update(constructionAttendance)
          .set({ status: row.status, hoursWorked, dailyCost: String(dailyCost), projectId: input.projectId })
          .where(eq(constructionAttendance.id, existing.id))
          .returning()
        saved.push(updated)
        updatedCount++
      } else {
        toInsert.push({
          orgId: ctx.orgId, projectId: input.projectId, rosterId: row.rosterId,
          attendanceDate: input.attendanceDate, status: row.status,
          hoursWorked, dailyCost: String(dailyCost),
        })
      }
    }

    // Every new row in ONE insert statement.
    if (toInsert.length > 0) {
      const inserted = await db.insert(constructionAttendance).values(toInsert).returning()
      saved.push(...inserted)
    }

    return {
      attendanceDate: input.attendanceDate,
      savedCount: saved.length,
      createdCount: toInsert.length,
      updatedCount,
      totalCost: Math.round(saved.reduce((sum, r) => sum + Number(r.dailyCost), 0) * 100) / 100,
      attendance: saved,
    }
  })

  // Wave 126 parity: the single-row path fires the absence automation, so the
  // sheet must too or a worker marked absent from the sheet would silently
  // skip rules a worker marked one-at-a-time triggers. Fire-and-forget, same
  // as recordAttendance().
  const absent = result.attendance.filter((r) => r.status === "absent")
  if (absent.length > 0) {
    void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
      Promise.all(absent.map((row) =>
        evaluateAndRunRules({ orgId: ctx.orgId }, "construction_attendance.worker_absent", {
          rosterId: row.rosterId, projectId: row.projectId, attendanceDate: row.attendanceDate,
        })
      ))
    )
  }

  return result
}
