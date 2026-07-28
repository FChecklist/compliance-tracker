// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, erpSuppliers, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
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

// Wave 174 (PROJEXA Owner resource-management spec, item 7: Manpower).
// Daily attendance rolling into a cost report -- S.No/ID/Name/Company/Salary
// per the Owner's exact column spec, filterable by trade. "Company" is the
// worker's subcontracting vendor (constructionLabourRoster.vendorId ->
// erpSuppliers.supplierName), or "In-house" when the worker isn't
// subcontracted. Computed live from roster + attendance, matching this
// service's existing no-denormalized-totals convention.
export type ManpowerCostReportRow = {
  id: string
  name: string
  trade: string | null
  company: string
  salary: number
  attendanceDate: string
  status: string
  dailyCost: number
}

export type ManpowerDailyCostRollup = { date: string; totalCost: number; workerCount: number }

/** Pure aggregation, exported for direct testing (no DB). One row per attendance entry, joined against its roster entry; optionally filtered by trade. */
export function buildManpowerCostReport(
  roster: { id: string; name: string; trade: string | null; dailyRate: string | number; vendorId: string | null }[],
  attendance: { rosterId: string; attendanceDate: string; status: string; dailyCost: string | number }[],
  vendorNamesById: Record<string, string>,
  filters: { trade?: string } = {}
): { rows: ManpowerCostReportRow[]; dailyRollup: ManpowerDailyCostRollup[] } {
  const rosterById = new Map(roster.map((r) => [r.id, r]))
  const rows: ManpowerCostReportRow[] = []

  for (const entry of attendance) {
    const r = rosterById.get(entry.rosterId)
    if (!r) continue
    if (filters.trade && r.trade !== filters.trade) continue
    rows.push({
      id: r.id,
      name: r.name,
      trade: r.trade,
      company: r.vendorId ? (vendorNamesById[r.vendorId] ?? r.vendorId) : "In-house",
      salary: Number(r.dailyRate),
      attendanceDate: entry.attendanceDate,
      status: entry.status,
      dailyCost: Number(entry.dailyCost),
    })
  }

  const byDate = new Map<string, { totalCost: number; workerCount: number }>()
  for (const row of rows) {
    const acc = byDate.get(row.attendanceDate) ?? { totalCost: 0, workerCount: 0 }
    acc.totalCost += row.dailyCost
    acc.workerCount += 1
    byDate.set(row.attendanceDate, acc)
  }
  const dailyRollup = [...byDate.entries()]
    .map(([date, acc]) => ({ date, ...acc }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return { rows, dailyRollup }
}

export async function getManpowerCostReport(ctx: { orgId: string }, projectId: string, filters: { trade?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [roster, attendance] = await Promise.all([
      db.query.constructionLabourRoster.findMany({ where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)) }),
      db.query.constructionAttendance.findMany({ where: and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId)) }),
    ])

    const vendorIds = [...new Set(roster.map((r) => r.vendorId).filter((v): v is string => !!v))]
    const vendors = vendorIds.length > 0
      ? await db.query.erpSuppliers.findMany({ where: inArray(erpSuppliers.id, vendorIds) })
      : []
    const vendorNamesById = Object.fromEntries(vendors.map((v) => [v.id, v.supplierName]))

    return buildManpowerCostReport(roster, attendance, vendorNamesById, filters)
  })
}
