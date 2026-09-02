// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, erpSuppliers, projects } from "@/lib/db"
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

// R67 F-13 (R-193/R-217): each row carries its vendor's NAME, resolved by ONE
// batched read on the transaction this function already holds (never one per
// row, and skipped entirely when no row is subcontracted).
//
// Why it belongs here: every consumer of this list that wants to show "who the
// worker belongs to" had to fetch the whole vendor master separately and join
// it in the browser -- PROJEXA's Work Progress Report did exactly that as one
// of its six VERIDIAN calls, purely to turn a vendorId into a name. vendorId is
// kept alongside it, so nothing that keys on the id has to change.
//
// A vendor row that has been deleted reports null, never the raw id: the caller
// decides how to say "unknown", the same convention
// construction-progress-service.ts uses for its own label resolution.
export async function listRoster(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)),
    })
    const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter((id): id is string => !!id))]
    const vendors = vendorIds.length === 0
      ? []
      : await db.query.erpSuppliers.findMany({
          where: and(eq(erpSuppliers.orgId, ctx.orgId), inArray(erpSuppliers.id, vendorIds)),
          columns: { id: true, supplierName: true },
        })
    const nameById = new Map(vendors.map((v) => [v.id, v.supplierName]))
    return rows.map((r) => ({ ...r, vendorName: r.vendorId ? (nameById.get(r.vendorId) ?? null) : null }))
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

export type AttendanceFilters = {
  projectId?: string
  rosterId?: string
  attendanceDate?: string
  from?: string
  to?: string
}

// R67 F-06 (R-088/R-094). The attendance log had exactly one date filter --
// `attendanceDate`, an exact match -- so PROJEXA's /labour screen asked for
// EVERY attendance row this project has ever recorded, on every page load.
// That list grows as workers x days: a 40-worker site is 40 rows a day, so a
// project a year old answers this call with roughly 10,000 rows nobody looks
// at. There is no page size and no window; the only reason it is fast today is
// that the demo data is small.
//
// A half-open [from, to] window fixes it at the source. Both bounds are
// optional and default to "no bound", so every existing caller -- the object
// screens, the reports service, the /labour/[id] worker page -- keeps its
// exact previous behaviour; only a caller that asks for a window gets one.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validates the optional [from, to] attendance window.
 *
 * Deliberately strict: `attendance_date` is a Postgres DATE compared as text
 * here, so a malformed bound would not error, it would silently match nothing
 * and be read as "this worker was never on site". A caller that sends a bad
 * date is told so (400) rather than shown a confidently empty log.
 */
export function normaliseAttendanceRange(filters: { from?: string; to?: string }): { from?: string; to?: string } {
  const from = filters.from?.trim() || undefined
  const to = filters.to?.trim() || undefined
  if (from && !ISO_DATE.test(from)) throw new ServiceError("from must be a date in YYYY-MM-DD format", 400)
  if (to && !ISO_DATE.test(to)) throw new ServiceError("to must be a date in YYYY-MM-DD format", 400)
  if (from && to && from > to) throw new ServiceError("from must not be later than to", 400)
  return { from, to }
}

export async function listAttendance(ctx: { orgId: string }, filters: AttendanceFilters) {
  if (!filters.projectId && !filters.rosterId) throw new ServiceError("projectId or rosterId is required", 400)
  const { from, to } = normaliseAttendanceRange(filters)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionAttendance.projectId, filters.projectId))
    if (filters.rosterId) conditions.push(eq(constructionAttendance.rosterId, filters.rosterId))
    if (filters.attendanceDate) conditions.push(eq(constructionAttendance.attendanceDate, filters.attendanceDate))
    if (from) conditions.push(gte(constructionAttendance.attendanceDate, from))
    if (to) conditions.push(lte(constructionAttendance.attendanceDate, to))
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
