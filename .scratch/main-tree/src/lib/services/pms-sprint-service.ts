// Wave 26 (VERIDIAN AI PMS) service layer -- sprints + sprint-issue moves +
// close-time burndown snapshot. Callers must have already passed
// requirePmsEnabled() (enforced at the route layer).
import { pmsSprints, pmsSprintIssues, pmsIssues, pmsIssueStatuses, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listSprints(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsSprints.findMany({ where: and(eq(pmsSprints.orgId, ctx.orgId), eq(pmsSprints.projectId, projectId)), orderBy: (t, { desc }) => desc(t.startDate) })
  )
}

export async function createSprint(
  ctx: { orgId: string },
  projectId: string,
  input: { name: string; goal?: string; startDate?: string; endDate?: string }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [row] = await db.insert(pmsSprints).values({
      orgId: ctx.orgId, projectId, name, goal: input.goal || null, startDate: input.startDate || null, endDate: input.endDate || null,
    }).returning()
    return row
  })
}

export async function updateSprint(
  ctx: { orgId: string },
  sprintId: string,
  patch: Partial<{ name: string; goal: string | null; startDate: string | null; endDate: string | null; status: string }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.pmsSprints.findFirst({ where: and(eq(pmsSprints.id, sprintId), eq(pmsSprints.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Sprint not found", 404)

    const [row] = await db.update(pmsSprints)
      .set({ ...patch, status: patch.status as typeof pmsSprints.$inferInsert.status, updatedAt: new Date() })
      .where(eq(pmsSprints.id, sprintId)).returning()
    return row
  })
}

export async function listSprintIssues(ctx: { orgId: string }, sprintId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const sprint = await db.query.pmsSprints.findFirst({ where: and(eq(pmsSprints.id, sprintId), eq(pmsSprints.orgId, ctx.orgId)) })
    if (!sprint) throw new ServiceError("Sprint not found", 404)
    const links = await db.query.pmsSprintIssues.findMany({ where: eq(pmsSprintIssues.sprintId, sprintId) })
    if (links.length === 0) return []
    return db.query.pmsIssues.findMany({ where: (t, { inArray }) => inArray(t.id, links.map((l) => l.issueId)) })
  })
}

export async function addIssueToSprint(ctx: { orgId: string }, sprintId: string, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const sprint = await db.query.pmsSprints.findFirst({ where: and(eq(pmsSprints.id, sprintId), eq(pmsSprints.orgId, ctx.orgId)) })
    if (!sprint) throw new ServiceError("Sprint not found", 404)
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!issue) throw new ServiceError("Issue not found", 404)

    const existing = await db.query.pmsSprintIssues.findFirst({ where: and(eq(pmsSprintIssues.sprintId, sprintId), eq(pmsSprintIssues.issueId, issueId)) })
    if (existing) return existing
    const [row] = await db.insert(pmsSprintIssues).values({ sprintId, issueId }).returning()
    return row
  })
}

export async function removeIssueFromSprint(ctx: { orgId: string }, sprintId: string, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const sprint = await db.query.pmsSprints.findFirst({ where: and(eq(pmsSprints.id, sprintId), eq(pmsSprints.orgId, ctx.orgId)) })
    if (!sprint) throw new ServiceError("Sprint not found", 404)
    await db.delete(pmsSprintIssues).where(and(eq(pmsSprintIssues.sprintId, sprintId), eq(pmsSprintIssues.issueId, issueId)))
    return { removed: true }
  })
}

/** Writes progressSnapshot once, at close time -- never live-computed, per the approved design. */
export async function closeSprint(ctx: { orgId: string }, sprintId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const sprint = await db.query.pmsSprints.findFirst({ where: and(eq(pmsSprints.id, sprintId), eq(pmsSprints.orgId, ctx.orgId)) })
    if (!sprint) throw new ServiceError("Sprint not found", 404)

    const links = await db.query.pmsSprintIssues.findMany({ where: eq(pmsSprintIssues.sprintId, sprintId) })
    const issues = links.length
      ? await db.query.pmsIssues.findMany({ where: (t, { inArray }) => inArray(t.id, links.map((l) => l.issueId)) })
      : []
    const statuses = await db.query.pmsIssueStatuses.findMany({ where: eq(pmsIssueStatuses.projectId, sprint.projectId) })
    const statusGroupById = new Map(statuses.map((s) => [s.id, s.group]))

    const total = issues.length
    const completed = issues.filter((i) => statusGroupById.get(i.statusId) === "completed").length
    const cancelled = issues.filter((i) => statusGroupById.get(i.statusId) === "cancelled").length

    const progressSnapshot = { total, completed, cancelled, remaining: total - completed - cancelled, closedAt: new Date().toISOString() }

    const [row] = await db.update(pmsSprints)
      .set({ status: "completed", progressSnapshot, updatedAt: new Date() })
      .where(eq(pmsSprints.id, sprintId)).returning()
    return row
  })
}
