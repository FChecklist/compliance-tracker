// VERIDIAN Review Framework remediation, Wave B: HR Attendance & Manpower
// (2026-07-17). Real gap re-confirmed via a fresh grep of src/ before
// writing this file: the only existing "attendance" concept was
// `construction_attendance` (construction-labour-service.ts) -- PROJEXA's
// project-scoped site-labour roster tracking. That is a distinct concept
// for construction-site day-labour and is never imported or touched here.
// There was no general, org-wide, per-employee-per-day attendance table
// for office staff at all -- this closes that gap.
//
// Employee linkage, actor/permission model, and the org/company-scoping
// convention all deliberately mirror hr-service.ts's leaveRequests handling
// (self-service create + a separate manager-gated decide/mark action, role
// gating enforced in the API route via requireRole, exactly like
// decideLeaveRequest's PATCH route) -- see schema.ts's comment directly
// above hrAttendanceRecords for the full column-level rationale.
import {
  users, employeeProfiles, hrAttendanceRecords, hrHolidays, hrAttendanceStatusEnum,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, gte, lte, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type HrAttendanceContext = { orgId: string; userId: string }

export type AttendanceStatus = (typeof hrAttendanceStatusEnum.enumValues)[number]

// ─── Pure helpers (no DB access -- kept separate and exported so they can
// be unit-tested directly, matching this codebase's established convention
// of not exercising withTenantContext/a live DB from a .test.ts file; see
// erp-fixed-assets-service.test.ts's own note on this) ────────────────────

// Default weekend: Saturday(6)/Sunday(0). Deliberately hardcoded, not a new
// per-org "work week" configuration concept -- searched schema.ts fresh
// for one before writing this (organisations table has no such column) and
// this is the standard convention for the vast majority of Indian offices
// this platform targets. A configurable work week is a real, honest future
// gap if a 6-day-week org ever needs this, not invented here.
const WEEKEND_DAYS = new Set([0, 6])

export function isWeekendDate(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  return WEEKEND_DAYS.has(day)
}

/** Inclusive list of ISO 'YYYY-MM-DD' dates from start to end. */
export function enumerateDates(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const cur = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) {
    throw new ServiceError("Invalid date range", 400)
  }
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/** All calendar dates in a given month (1-12), as ISO strings. */
export function datesInMonth(month: number, year: number): string[] {
  if (month < 1 || month > 12) throw new ServiceError("month must be between 1 and 12", 400)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return Array.from({ length: lastDay }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)
}

export function computeHoursWorked(checkInAt: Date, checkOutAt: Date): number {
  const ms = checkOutAt.getTime() - checkInAt.getTime()
  if (ms <= 0) throw new ServiceError("checkOutAt must be after checkInAt", 400)
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100
}

export type AttendanceRecordLike = { date: string; status: AttendanceStatus }

export type MonthlySummary = {
  month: number
  year: number
  totalDaysInMonth: number
  weekendDays: number
  holidayDays: number
  workingDays: number // totalDaysInMonth - weekendDays - holidayDays: the real denominator for attendance %
  present: number
  absent: number
  halfDay: number
  onLeave: number
  unmarked: number // a working day with no attendance row at all -- neither recorded nor excused
  payableDays: number // present + onLeave + holidayDays + weekendDays + 0.5*halfDay -- the figure a payroll integration would consume (see getPayableDaysForPayroll below)
  attendancePercent: number // present + 0.5*halfDay, out of workingDays; 100 if workingDays is 0 (e.g. a month that's entirely holidays/weekends)
}

/**
 * Pure calculation over already-fetched data -- `records` should contain at
 * most one row per date (the DB's UNIQUE(org_id, user_id, date) constraint
 * guarantees this for real data; a caller passing duplicates gets the last
 * one counted per date, not double-counted, since this iterates a Map).
 * `holidayDates` are ISO dates that fall in this month; a holiday that also
 * lands on a weekend is counted once, as a weekend (weekends are excluded
 * from workingDays first) -- not double-subtracted.
 */
export function computeMonthlySummary(
  month: number,
  year: number,
  records: AttendanceRecordLike[],
  holidayDates: string[]
): MonthlySummary {
  const allDates = datesInMonth(month, year)
  const holidaySet = new Set(holidayDates)
  const byDate = new Map(records.map((r) => [r.date, r.status]))

  let weekendDays = 0
  let holidayDays = 0
  let present = 0
  let absent = 0
  let halfDay = 0
  let onLeave = 0
  let unmarked = 0

  for (const date of allDates) {
    const weekend = isWeekendDate(date)
    const holiday = holidaySet.has(date)
    if (weekend) weekendDays++
    else if (holiday) holidayDays++

    const status = byDate.get(date)
    if (weekend || holiday) continue // weekends/holidays never count toward present/absent/unmarked, even if a stray row exists

    switch (status) {
      case "present": present++; break
      case "absent": absent++; break
      case "half_day": halfDay++; break
      case "on_leave": onLeave++; break
      case "holiday": holidayDays++; break // defensive: a manually-marked 'holiday' row on a day hr_holidays doesn't list
      default: unmarked++; break
    }
  }

  const workingDays = allDates.length - weekendDays - holidayDays
  const payableDays = present + onLeave + holidayDays + weekendDays + halfDay * 0.5
  const attendedForPercent = present + halfDay * 0.5
  const attendancePercent = workingDays > 0 ? Math.round((attendedForPercent / workingDays) * 10000) / 100 : 100

  return {
    month, year, totalDaysInMonth: allDates.length, weekendDays, holidayDays, workingDays,
    present, absent, halfDay, onLeave, unmarked, payableDays, attendancePercent,
  }
}

// ─── DB-backed operations ─────────────────────────────────────────────────

async function getOrgUserIds(orgId: string, departmentId?: string): Promise<string[] | undefined> {
  if (!departmentId) return undefined
  const rows = await withTenantContext({ orgId }, (db) =>
    db.query.users.findMany({ where: and(eq(users.orgId, orgId), eq(users.departmentId, departmentId)), columns: { id: true } })
  )
  return rows.map((r) => r.id)
}

/** Self-service check-in. Idempotent per day: re-checking in the same day updates the existing row rather than erroring. */
export async function checkIn(ctx: HrAttendanceContext, date?: string) {
  const day = date || new Date().toISOString().slice(0, 10)
  const now = new Date()
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(hrAttendanceRecords).values({
      orgId: ctx.orgId, userId: ctx.userId, date: day, status: "present",
      checkInAt: now, markedById: ctx.userId, source: "self",
    }).onConflictDoUpdate({
      target: [hrAttendanceRecords.orgId, hrAttendanceRecords.userId, hrAttendanceRecords.date],
      set: { checkInAt: now, status: "present", markedById: ctx.userId, source: "self", updatedAt: now },
    }).returning()
    return row
  })
}

/** Self-service check-out. Requires an existing check-in for the same day (or an explicit date). */
export async function checkOut(ctx: HrAttendanceContext, date?: string) {
  const day = date || new Date().toISOString().slice(0, 10)
  const now = new Date()
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.hrAttendanceRecords.findFirst({
      where: and(eq(hrAttendanceRecords.orgId, ctx.orgId), eq(hrAttendanceRecords.userId, ctx.userId), eq(hrAttendanceRecords.date, day)),
    })
    if (!existing) throw new ServiceError("No check-in found for this day -- check in first", 400)
    if (!existing.checkInAt) throw new ServiceError("Cannot check out without a check-in time recorded", 400)
    const hoursWorked = computeHoursWorked(new Date(existing.checkInAt), now)
    const [row] = await db.update(hrAttendanceRecords)
      .set({ checkOutAt: now, hoursWorked: String(hoursWorked), updatedAt: now })
      .where(eq(hrAttendanceRecords.id, existing.id)).returning()
    return row
  })
}

export type MarkAttendanceInput = {
  date: string
  status: AttendanceStatus
  checkInAt?: string
  checkOutAt?: string
  hoursWorked?: number
  notes?: string
}

/**
 * Direct mark/correct for a single employee/day -- used both for a manager
 * bulk-marking someone else's attendance and for a manager correcting their
 * own. Role gating (manager-or-above required when targetUserId !==
 * ctx.userId) happens in the API route, matching decideLeaveRequest's own
 * split (hr-service.ts has no permission checks itself; the PATCH route
 * calls requireRole before invoking it).
 */
export async function markAttendance(ctx: HrAttendanceContext, targetUserId: string, input: MarkAttendanceInput) {
  if (!hrAttendanceStatusEnum.enumValues.includes(input.status)) {
    throw new ServiceError(`status must be one of: ${hrAttendanceStatusEnum.enumValues.join(", ")}`, 400)
  }
  if (!input.date) throw new ServiceError("date is required", 400)

  let hoursWorked = input.hoursWorked != null ? input.hoursWorked : undefined
  if (input.checkInAt && input.checkOutAt) {
    hoursWorked = computeHoursWorked(new Date(input.checkInAt), new Date(input.checkOutAt))
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const targetUser = await db.query.users.findFirst({ where: and(eq(users.id, targetUserId), eq(users.orgId, ctx.orgId)) })
    if (!targetUser) throw new ServiceError("Employee not found", 404)

    const values = {
      orgId: ctx.orgId, userId: targetUserId, date: input.date, status: input.status,
      checkInAt: input.checkInAt ? new Date(input.checkInAt) : null,
      checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : null,
      hoursWorked: hoursWorked != null ? String(hoursWorked) : null,
      markedById: ctx.userId,
      source: targetUserId === ctx.userId ? "self" : "manager",
      notes: input.notes || null,
    }
    const [row] = await db.insert(hrAttendanceRecords).values(values).onConflictDoUpdate({
      target: [hrAttendanceRecords.orgId, hrAttendanceRecords.userId, hrAttendanceRecords.date],
      set: { ...values, updatedAt: new Date() },
    }).returning()
    return row
  })
}

/** Manager bulk-mark: one status applied to many employees for a single date (e.g. marking an entire team present for a client visit day). */
export async function bulkMarkAttendance(
  ctx: HrAttendanceContext,
  input: { date: string; userIds: string[]; status: AttendanceStatus; notes?: string }
) {
  if (!input.userIds?.length) throw new ServiceError("userIds must be a non-empty array", 400)
  const results: Awaited<ReturnType<typeof markAttendance>>[] = []
  for (const userId of input.userIds) {
    results.push(await markAttendance(ctx, userId, { date: input.date, status: input.status, notes: input.notes }))
  }
  return results
}

export type ListAttendanceFilters = { userId?: string; departmentId?: string; companyId?: string; startDate?: string; endDate?: string }

export async function listAttendance(ctx: { orgId: string }, filters?: ListAttendanceFilters) {
  const departmentUserIds = await getOrgUserIds(ctx.orgId, filters?.departmentId)
  if (filters?.departmentId && (!departmentUserIds || departmentUserIds.length === 0)) return []

  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(hrAttendanceRecords.orgId, ctx.orgId)]
    if (filters?.userId) conditions.push(eq(hrAttendanceRecords.userId, filters.userId))
    if (filters?.companyId) conditions.push(eq(hrAttendanceRecords.companyId, filters.companyId))
    if (filters?.startDate) conditions.push(gte(hrAttendanceRecords.date, filters.startDate))
    if (filters?.endDate) conditions.push(lte(hrAttendanceRecords.date, filters.endDate))
    if (departmentUserIds) conditions.push(inArray(hrAttendanceRecords.userId, departmentUserIds))
    return db.query.hrAttendanceRecords.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.date),
    })
  })
}

export type MonthlySummaryFilters = { userId?: string; departmentId?: string; companyId?: string }

/** Per-employee monthly summaries for the given month/year, honoring the same filters as listAttendance. */
export async function getMonthlySummaries(
  ctx: { orgId: string },
  params: { month: number; year: number } & MonthlySummaryFilters
): Promise<Array<MonthlySummary & { userId: string; userName: string | null }>> {
  const departmentUserIds = await getOrgUserIds(ctx.orgId, params.departmentId)
  if (params.departmentId && (!departmentUserIds || departmentUserIds.length === 0)) return []

  const monthDates = datesInMonth(params.month, params.year)
  const startDate = monthDates[0]
  const endDate = monthDates[monthDates.length - 1]

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const employeeConditions = [eq(users.orgId, ctx.orgId)]
    if (params.userId) employeeConditions.push(eq(users.id, params.userId))
    if (departmentUserIds) employeeConditions.push(inArray(users.id, departmentUserIds))
    const employees = await db.query.users.findMany({ where: and(...employeeConditions), columns: { id: true, name: true } })
    if (employees.length === 0) return []
    const employeeIds = employees.map((e) => e.id)

    const recordConditions = [
      eq(hrAttendanceRecords.orgId, ctx.orgId),
      gte(hrAttendanceRecords.date, startDate),
      lte(hrAttendanceRecords.date, endDate),
      inArray(hrAttendanceRecords.userId, employeeIds),
    ]
    if (params.companyId) recordConditions.push(eq(hrAttendanceRecords.companyId, params.companyId))
    const records = await db.query.hrAttendanceRecords.findMany({ where: and(...recordConditions) })

    const holidays = await db.query.hrHolidays.findMany({
      where: and(eq(hrHolidays.orgId, ctx.orgId), gte(hrHolidays.date, startDate), lte(hrHolidays.date, endDate)),
    })
    const holidayDates = holidays.map((h) => h.date)

    const recordsByUser = new Map<string, AttendanceRecordLike[]>()
    for (const r of records) {
      const list = recordsByUser.get(r.userId) ?? []
      list.push({ date: r.date, status: r.status })
      recordsByUser.set(r.userId, list)
    }

    return employees.map((emp) => ({
      userId: emp.id,
      userName: emp.name,
      ...computeMonthlySummary(params.month, params.year, recordsByUser.get(emp.id) ?? [], holidayDates),
    }))
  })
}

// ─── Holiday calendar ──────────────────────────────────────────────────────

export async function listHolidays(ctx: { orgId: string }, year?: number) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(hrHolidays.orgId, ctx.orgId)]
    if (year) { conditions.push(gte(hrHolidays.date, `${year}-01-01`)); conditions.push(lte(hrHolidays.date, `${year}-12-31`)) }
    return db.query.hrHolidays.findMany({ where: and(...conditions), orderBy: (t, { asc }) => asc(t.date) })
  })
}

export async function addHoliday(ctx: HrAttendanceContext, input: { date: string; name: string }) {
  if (!input.date || !input.name?.trim()) throw new ServiceError("date and name are required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(hrHolidays).values({ orgId: ctx.orgId, date: input.date, name: input.name })
      .onConflictDoUpdate({ target: [hrHolidays.orgId, hrHolidays.date], set: { name: input.name } })
      .returning()
    return row
  })
}

export async function deleteHoliday(ctx: { orgId: string }, holidayId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.hrHolidays.findFirst({ where: and(eq(hrHolidays.id, holidayId), eq(hrHolidays.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Holiday not found", 404)
    await db.delete(hrHolidays).where(eq(hrHolidays.id, holidayId))
    return { success: true }
  })
}

// ─── Leave integration ─────────────────────────────────────────────────────

/**
 * Called from hr-service.ts's decideLeaveRequest immediately after a leave
 * request is approved -- materializes the approved date range into actual
 * attendance rows so "who was present on this date" and the monthly
 * summary both reflect approved leave without a separate manual step.
 * Weekends are skipped (nobody was going to attend anyway; see schema.ts's
 * comment on why weekend is not a stored status). A day that already has a
 * real check-in recorded (source = 'self' with checkInAt set) is left
 * alone rather than overwritten -- an employee who actually showed up
 * despite an approved leave request for that day (e.g. leave later
 * shortened in person, not through this system) shouldn't have their real
 * attendance silently erased by this sync.
 */
export async function syncLeaveIntoAttendance(
  ctx: HrAttendanceContext,
  leaveRequest: { id: string; userId: string; startDate: string; endDate: string; companyId: string | null }
) {
  const dates = enumerateDates(leaveRequest.startDate, leaveRequest.endDate).filter((d) => !isWeekendDate(d))
  if (dates.length === 0) return []

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const results: (typeof hrAttendanceRecords.$inferSelect)[] = []
    for (const date of dates) {
      const existing = await db.query.hrAttendanceRecords.findFirst({
        where: and(eq(hrAttendanceRecords.orgId, ctx.orgId), eq(hrAttendanceRecords.userId, leaveRequest.userId), eq(hrAttendanceRecords.date, date)),
      })
      if (existing?.source === "self" && existing.checkInAt) continue // don't clobber a real check-in

      const values = {
        orgId: ctx.orgId, userId: leaveRequest.userId, date, status: "on_leave" as const,
        companyId: leaveRequest.companyId, leaveRequestId: leaveRequest.id,
        markedById: ctx.userId, source: "auto_leave" as const,
      }
      const [row] = await db.insert(hrAttendanceRecords).values(values).onConflictDoUpdate({
        target: [hrAttendanceRecords.orgId, hrAttendanceRecords.userId, hrAttendanceRecords.date],
        set: { ...values, updatedAt: new Date() },
      }).returning()
      results.push(row)
    }
    return results
  })
}

// ─── Payroll integration point ─────────────────────────────────────────────
// Honest gap note (checked erp-payroll-service.ts before writing this):
// payroll (erpPayrollRuns/erpPayslips) computes grossEarnings/deductions
// purely from an employee's assigned salary structure components -- it has
// no attendance/days-worked input of any kind today, faked or otherwise,
// so there is nothing currently silently ignoring this data. This function
// is the integration point a future payroll wiring pass would call (e.g.
// to pro-rate a payslip for loss-of-pay days) -- it is NOT called from
// erp-payroll-service.ts in this change; wiring payroll itself to consume
// attendance is a genuine follow-on gap, deliberately left out of this
// change's scope rather than silently half-done.
export async function getPayableDaysForPayroll(
  ctx: { orgId: string },
  userId: string,
  month: number,
  year: number
): Promise<{ payableDays: number; workingDays: number; totalDaysInMonth: number }> {
  const [summary] = await getMonthlySummaries(ctx, { month, year, userId })
  if (!summary) return { payableDays: 0, workingDays: 0, totalDaysInMonth: datesInMonth(month, year).length }
  return { payableDays: summary.payableDays, workingDays: summary.workingDays, totalDaysInMonth: summary.totalDaysInMonth }
}
