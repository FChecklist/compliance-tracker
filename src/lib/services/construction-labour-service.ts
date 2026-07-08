// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type RosterInput = {
  projectId: string
  name: string
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
      trade: input.trade || null, skillLevel: input.skillLevel || null, vendorId: input.vendorId || null,
      dailyRate: String(input.dailyRate ?? 0),
    }).returning()
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
  })
}
