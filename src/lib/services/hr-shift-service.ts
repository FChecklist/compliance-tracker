// Phase 0 HR gap-closure (2026-07-27): Shift Management / Roster. Real gap
// re-confirmed by reading hrAttendanceRecords fresh before writing this --
// daily present/absent/half_day/on_leave/holiday status only, no concept of
// *which shift* an employee was expected to work. Two tables: a shift-type
// master (name + start/end time) and a roster assignment linking an
// employee to a shift type for a date range (schema.ts has the full
// rationale on why a date-range row, not a per-date row).
import { hrShiftTypes, hrShiftRosterAssignments } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type HrShiftContext = { orgId: string; userId: string }

// ─── Pure helper (no DB access -- exported so it can be unit-tested
// directly, matching hr-attendance-service.ts's established convention of
// not exercising withTenantContext/a live DB from a .test.ts file) ────────
export type RosterAssignmentLike = { shiftTypeId: string; startDate: string; endDate: string | null }

/**
 * Resolves which roster assignment (if any) covers a given date, i.e. the
 * shift an employee was expected to work that day. `endDate: null` means an
 * open-ended/ongoing assignment. When more than one assignment covers the
 * same date (an admin overlap -- not prevented at the DB level, matching
 * this schema's "business rule in the service layer" convention), the most
 * recently created one wins -- callers pass assignments pre-sorted by
 * createdAt desc, this function just takes the first match.
 */
export function resolveShiftForDate(assignments: RosterAssignmentLike[], date: string): string | null {
  const match = assignments.find((a) => a.startDate <= date && (a.endDate == null || a.endDate >= date))
  return match?.shiftTypeId ?? null
}

export async function listShiftTypes(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.hrShiftTypes.findMany({ where: eq(hrShiftTypes.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  )
}

export async function createShiftType(ctx: HrShiftContext, input: { name: string; startTime: string; endTime: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) {
    throw new ServiceError("startTime/endTime must be in 'HH:MM' format", 400)
  }
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(hrShiftTypes).values({
      orgId: ctx.orgId, name: input.name, startTime: input.startTime, endTime: input.endTime,
    }).returning()
    return created
  })
}

export async function listRosterAssignments(ctx: { orgId: string }, filters?: { userId?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(hrShiftRosterAssignments.orgId, ctx.orgId)]
    if (filters?.userId) conditions.push(eq(hrShiftRosterAssignments.userId, filters.userId))
    return db.query.hrShiftRosterAssignments.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  })
}

export async function createRosterAssignment(
  ctx: HrShiftContext,
  input: { userId: string; shiftTypeId: string; startDate: string; endDate?: string }
) {
  if (!input.userId) throw new ServiceError("userId is required", 400)
  if (input.endDate && input.endDate < input.startDate) throw new ServiceError("endDate cannot be before startDate", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const shiftType = await db.query.hrShiftTypes.findFirst({ where: and(eq(hrShiftTypes.id, input.shiftTypeId), eq(hrShiftTypes.orgId, ctx.orgId)) })
    if (!shiftType) throw new ServiceError("Shift type not found", 404)
    const [created] = await db.insert(hrShiftRosterAssignments).values({
      orgId: ctx.orgId, userId: input.userId, shiftTypeId: input.shiftTypeId,
      startDate: input.startDate, endDate: input.endDate ?? null, createdById: ctx.userId,
    }).returning()
    return created
  })
}

/** Used by hr-attendance-service.ts to snapshot the expected shift for a check-in/mark-attendance date. */
export async function getExpectedShiftId(ctx: { orgId: string }, userId: string, date: string): Promise<string | null> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const assignments = await db.query.hrShiftRosterAssignments.findMany({
      where: and(eq(hrShiftRosterAssignments.orgId, ctx.orgId), eq(hrShiftRosterAssignments.userId, userId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
    return resolveShiftForDate(assignments, date)
  })
}
