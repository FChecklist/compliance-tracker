// Wave 108 (THE FIRM AI OS) -- staff-to-client capacity assignment. For a
// 4-20 person firm this answers two questions ground truth today lives
// only in someone's head: "who owns this client" and "is anyone
// overallocated." allocatedHoursPerWeek is capacity; actual hours come
// from firm_time_entries (see firm-time-tracking-service.ts) -- the two
// are compared, not conflated, in computeStaffUtilization below.
import { firmStaffAssignments, firmTimeEntries, clients } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, gte, lte, sum } from "drizzle-orm"
import { requireFirmEnabled } from "./firm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

async function assertClientBelongsToOrg(db: TenantDb, clientId: string, orgId: string) {
  const client = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) })
  if (!client) throw new ServiceError("Client not found", 404)
}

export type FirmStaffAssignmentInput = {
  role?: typeof firmStaffAssignments.$inferSelect["role"]
  allocatedHoursPerWeek?: number | null
  startDate: string
  endDate?: string | null
}

export async function assignStaffToClient(ctx: { orgId: string }, clientId: string, userId: string, input: FirmStaffAssignmentInput) {
  await requireFirmEnabled(ctx.orgId)
  if (!input.startDate) throw new ServiceError("startDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await assertClientBelongsToOrg(db, clientId, ctx.orgId)

    const [assignment] = await db.insert(firmStaffAssignments).values({
      orgId: ctx.orgId,
      clientId,
      userId,
      role: input.role ?? "staff",
      allocatedHoursPerWeek: input.allocatedHoursPerWeek != null ? String(input.allocatedHoursPerWeek) : null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
    }).returning()

    return assignment
  })
}

export async function endStaffAssignment(ctx: { orgId: string }, assignmentId: string, endDate: string) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.firmStaffAssignments.findFirst({ where: and(eq(firmStaffAssignments.id, assignmentId), eq(firmStaffAssignments.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Staff assignment not found", 404)

    const [updated] = await db.update(firmStaffAssignments).set({ endDate, updatedAt: new Date() }).where(eq(firmStaffAssignments.id, assignmentId)).returning()
    return updated
  })
}

export async function listAssignmentsForClient(ctx: { orgId: string }, clientId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.firmStaffAssignments.findMany({ where: and(eq(firmStaffAssignments.clientId, clientId), eq(firmStaffAssignments.orgId, ctx.orgId)) })
  })
}

export async function listAssignmentsForStaff(ctx: { orgId: string }, userId: string) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.firmStaffAssignments.findMany({ where: and(eq(firmStaffAssignments.userId, userId), eq(firmStaffAssignments.orgId, ctx.orgId)) })
  })
}

export async function computeStaffUtilization(ctx: { orgId: string }, userId: string, periodStart: string, periodEnd: string) {
  await requireFirmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const assignments = await db.query.firmStaffAssignments.findMany({ where: and(eq(firmStaffAssignments.userId, userId), eq(firmStaffAssignments.orgId, ctx.orgId)) })
    const totalAllocatedPerWeek = assignments.reduce((acc, a) => acc + (a.allocatedHoursPerWeek ? Number(a.allocatedHoursPerWeek) : 0), 0)

    const weeksInPeriod = Math.max(1, Math.round((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (7 * 24 * 60 * 60 * 1000)))
    const capacityHours = totalAllocatedPerWeek * weeksInPeriod

    const [actual] = await db.select({ total: sum(firmTimeEntries.hours) }).from(firmTimeEntries).where(
      and(eq(firmTimeEntries.userId, userId), eq(firmTimeEntries.orgId, ctx.orgId), gte(firmTimeEntries.spentOn, periodStart), lte(firmTimeEntries.spentOn, periodEnd))
    )
    const actualHours = actual?.total ? Number(actual.total) : 0

    return {
      userId,
      periodStart,
      periodEnd,
      capacityHours,
      actualHours,
      utilizationPercent: capacityHours > 0 ? Math.round((actualHours / capacityHours) * 100) : null,
    }
  })
}
