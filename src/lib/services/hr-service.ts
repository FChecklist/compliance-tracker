// Wave 40 (VERIDIAN HR, PLATFORM_STRATEGY.md §19). minthcm/erpnext(hrms)/
// orangehrm evaluated and rejected as software. Closes the confirmed gap:
// `users` had auth fields + departmentId/reportingToId but no actual
// employee master data, and leavePolicyEntries is policy text, not a
// request/balance ledger. Payroll deliberately out of scope -- VERIDIAN
// tracks payroll *compliance*, never runs payroll itself.
import { users, employeeProfiles, leaveRequests, leaveBalances } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type HrContext = { orgId: string; userId: string }

export async function listEmployees(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const orgUsers = await db.query.users.findMany({
      where: eq(users.orgId, ctx.orgId),
      columns: { id: true, name: true, email: true, role: true, departmentId: true, reportingToId: true },
    })
    const profiles = await db.query.employeeProfiles.findMany({ where: eq(employeeProfiles.orgId, ctx.orgId) })
    const profileByUserId = new Map(profiles.map((p) => [p.userId, p]))
    return orgUsers.map((u) => ({ ...u, profile: profileByUserId.get(u.id) ?? null }))
  })
}

// Org chart: zero new schema -- a read-only tree over the already-existing
// users.reportingToId/departmentId (Wave 1). The one clear "already have
// the data, just needed a UI" finding from this research.
export async function getOrgChart(ctx: { orgId: string }) {
  const employees = await listEmployees(ctx)
  const byManager = new Map<string, typeof employees>()
  for (const emp of employees) {
    const key = emp.reportingToId ?? "__root__"
    const list = byManager.get(key) ?? []
    list.push(emp)
    byManager.set(key, list)
  }
  return { employees, roots: byManager.get("__root__") ?? [], byManager: Object.fromEntries(byManager) }
}

export async function upsertEmployeeProfile(
  ctx: HrContext,
  targetUserId: string,
  input: { employeeCode?: string; jobTitle?: string; employmentType?: string; dateOfJoining?: string; dateOfBirth?: string }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const targetUser = await db.query.users.findFirst({ where: and(eq(users.id, targetUserId), eq(users.orgId, ctx.orgId)) })
    if (!targetUser) throw new ServiceError("Employee not found", 404)

    const existing = await db.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, targetUserId) })
    if (existing) {
      const [updated] = await db.update(employeeProfiles)
        .set({
          employeeCode: input.employeeCode ?? existing.employeeCode,
          jobTitle: input.jobTitle ?? existing.jobTitle,
          employmentType: input.employmentType ?? existing.employmentType,
          dateOfJoining: input.dateOfJoining ?? existing.dateOfJoining,
          dateOfBirth: input.dateOfBirth ?? existing.dateOfBirth,
          updatedAt: new Date(),
        })
        .where(eq(employeeProfiles.id, existing.id)).returning()
      return updated
    }
    const [created] = await db.insert(employeeProfiles).values({
      userId: targetUserId, orgId: ctx.orgId,
      employeeCode: input.employeeCode || null, jobTitle: input.jobTitle || null,
      employmentType: input.employmentType || "full_time",
      dateOfJoining: input.dateOfJoining || null, dateOfBirth: input.dateOfBirth || null,
    }).returning()
    return created
  })
}

// ─── Leave requests + balances ───────────────────────────────────────────
export async function listLeaveRequests(ctx: { orgId: string }, filters?: { userId?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.leaveRequests.findMany({
      where: filters?.userId
        ? and(eq(leaveRequests.orgId, ctx.orgId), eq(leaveRequests.userId, filters.userId))
        : eq(leaveRequests.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1)
}

export async function requestLeave(
  ctx: HrContext,
  input: { leaveType: string; startDate: string; endDate: string; reason?: string }
) {
  if (!input.leaveType?.trim()) throw new ServiceError("leaveType is required", 400)
  if (!input.startDate || !input.endDate) throw new ServiceError("startDate and endDate are required", 400)
  const numDays = daysBetween(input.startDate, input.endDate)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [request] = await db.insert(leaveRequests).values({
      orgId: ctx.orgId, userId: ctx.userId, leaveType: input.leaveType,
      startDate: input.startDate, endDate: input.endDate, numDays: String(numDays),
      reason: input.reason || null,
    }).returning()
    return request
  })
}

export async function decideLeaveRequest(ctx: HrContext, requestId: string, decision: "approved" | "rejected") {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const request = await db.query.leaveRequests.findFirst({ where: and(eq(leaveRequests.id, requestId), eq(leaveRequests.orgId, ctx.orgId)) })
    if (!request) throw new ServiceError("Leave request not found", 404)
    if (request.status !== "pending") throw new ServiceError("This request has already been decided", 400)

    const [updated] = await db.update(leaveRequests)
      .set({ status: decision, approverId: ctx.userId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(leaveRequests.id, requestId)).returning()

    if (decision === "approved") {
      const year = new Date(request.startDate).getFullYear()
      const balance = await db.query.leaveBalances.findFirst({
        where: and(eq(leaveBalances.orgId, ctx.orgId), eq(leaveBalances.userId, request.userId), eq(leaveBalances.leaveType, request.leaveType), eq(leaveBalances.year, year)),
      })
      if (balance) {
        await db.update(leaveBalances)
          .set({ usedDays: String(Number(balance.usedDays) + Number(request.numDays)), updatedAt: new Date() })
          .where(eq(leaveBalances.id, balance.id))
      }
    }
    return updated
  })
}

export async function listLeaveBalances(ctx: { orgId: string }, userId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.leaveBalances.findMany({
      where: userId ? and(eq(leaveBalances.orgId, ctx.orgId), eq(leaveBalances.userId, userId)) : eq(leaveBalances.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.year),
    })
  )
}

export async function setLeaveBalance(
  ctx: HrContext,
  input: { userId: string; leaveType: string; year: number; totalDays: number }
) {
  if (!input.userId || !input.leaveType?.trim()) throw new ServiceError("userId and leaveType are required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.leaveBalances.findFirst({
      where: and(eq(leaveBalances.orgId, ctx.orgId), eq(leaveBalances.userId, input.userId), eq(leaveBalances.leaveType, input.leaveType), eq(leaveBalances.year, input.year)),
    })
    if (existing) {
      const [updated] = await db.update(leaveBalances).set({ totalDays: String(input.totalDays), updatedAt: new Date() }).where(eq(leaveBalances.id, existing.id)).returning()
      return updated
    }
    const [created] = await db.insert(leaveBalances).values({
      orgId: ctx.orgId, userId: input.userId, leaveType: input.leaveType, year: input.year, totalDays: String(input.totalDays),
    }).returning()
    return created
  })
}
