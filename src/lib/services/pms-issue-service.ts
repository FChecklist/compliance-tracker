// Wave 26 (VERIDIAN AI PMS) service layer -- core issue CRUD, atomic
// per-project issue numbering, and multi-assignee sync. Callers must have
// already passed requirePmsEnabled() (enforced at the route layer).
import {
  pmsIssues, pmsIssueAssignees, pmsIssueRelations, pmsIssueLabels, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, sql, type SQL } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"
import { ensureDefaultStatusesForProject } from "./pms-taxonomy-service"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type IssueInput = {
  projectId: string
  typeId: string
  statusId?: string
  priority?: string
  title: string
  description?: string
  clientId?: string
  assigneeIds?: string[]
  parentIssueId?: string
  milestoneId?: string
  estimatePointId?: string
  startDate?: string
  dueDate?: string
  labelIds?: string[]
}

/** Denormalized primary-assignee cache -- pmsIssueAssignees is authoritative, this mirrors the first row. Service-layer logic, not a DB trigger, matching this codebase's convention. */
async function syncAssignees(db: TenantDb, issueId: string, userIds: string[] | undefined) {
  if (userIds === undefined) return
  await db.delete(pmsIssueAssignees).where(eq(pmsIssueAssignees.issueId, issueId))
  if (userIds.length > 0) {
    await db.insert(pmsIssueAssignees).values(userIds.map((userId) => ({ issueId, userId })))
  }
  await db.update(pmsIssues).set({ assigneeId: userIds[0] ?? null }).where(eq(pmsIssues.id, issueId))
}

async function syncLabels(db: TenantDb, issueId: string, labelIds: string[] | undefined) {
  if (labelIds === undefined) return
  await db.delete(pmsIssueLabels).where(eq(pmsIssueLabels.issueId, issueId))
  if (labelIds.length > 0) {
    await db.insert(pmsIssueLabels).values(labelIds.map((labelId) => ({ issueId, labelId })))
  }
}

export async function listIssues(
  ctx: { orgId: string },
  projectId: string,
  filters: { statusId?: string; assigneeId?: string; priority?: string; milestoneId?: string; includeArchived?: boolean } = {}
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const conditions: SQL[] = [eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)]
    if (filters.statusId) conditions.push(eq(pmsIssues.statusId, filters.statusId))
    if (filters.assigneeId) conditions.push(eq(pmsIssues.assigneeId, filters.assigneeId))
    if (filters.priority) conditions.push(eq(pmsIssues.priority, filters.priority as typeof pmsIssues.$inferSelect.priority))
    if (filters.milestoneId) conditions.push(eq(pmsIssues.milestoneId, filters.milestoneId))
    if (!filters.includeArchived) conditions.push(eq(pmsIssues.isArchived, false))

    return db.query.pmsIssues.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => asc(t.position),
    })
  })
}

export async function getIssue(ctx: { orgId: string }, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!issue) throw new ServiceError("Issue not found", 404)
    const assignees = await db.query.pmsIssueAssignees.findMany({ where: eq(pmsIssueAssignees.issueId, issueId) })
    const labels = await db.query.pmsIssueLabels.findMany({ where: eq(pmsIssueLabels.issueId, issueId) })
    const relations = await db.query.pmsIssueRelations.findMany({ where: and(eq(pmsIssueRelations.orgId, ctx.orgId), eq(pmsIssueRelations.issueId, issueId)) })
    return { ...issue, assigneeIds: assignees.map((a) => a.userId), labelIds: labels.map((l) => l.labelId), relations }
  })
}

export async function createIssue(ctx: PmsContext, input: IssueInput) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)
  if (!input.typeId) throw new ServiceError("typeId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    let statusId = input.statusId
    if (!statusId) {
      const statuses = await ensureDefaultStatusesForProject(db, ctx.orgId, input.projectId)
      statusId = statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id
    }
    if (!statusId) throw new ServiceError("statusId is required and no default status could be resolved", 400)

    const [updatedProject] = await db.update(projects)
      .set({ issueSequence: sql`${projects.issueSequence} + 1` })
      .where(eq(projects.id, input.projectId))
      .returning({ issueSequence: projects.issueSequence })
    const number = updatedProject.issueSequence

    const [issue] = await db.insert(pmsIssues).values({
      orgId: ctx.orgId, clientId: input.clientId || null, projectId: input.projectId, typeId: input.typeId, statusId,
      priority: (input.priority as typeof pmsIssues.$inferInsert.priority) || "no_priority",
      number, title, description: input.description || null,
      parentIssueId: input.parentIssueId || null, milestoneId: input.milestoneId || null,
      estimatePointId: input.estimatePointId || null, startDate: input.startDate || null, dueDate: input.dueDate || null,
      createdById: ctx.userId,
    }).returning()

    await syncAssignees(db, issue.id, input.assigneeIds)
    await syncLabels(db, issue.id, input.labelIds)

    return getIssueRow(db, issue.id)
  })
}

async function getIssueRow(db: TenantDb, issueId: string) {
  const issue = await db.query.pmsIssues.findFirst({ where: eq(pmsIssues.id, issueId) })
  const assignees = await db.query.pmsIssueAssignees.findMany({ where: eq(pmsIssueAssignees.issueId, issueId) })
  const labels = await db.query.pmsIssueLabels.findMany({ where: eq(pmsIssueLabels.issueId, issueId) })
  return { ...issue, assigneeIds: assignees.map((a) => a.userId), labelIds: labels.map((l) => l.labelId) }
}

export type IssuePatch = Partial<{
  title: string; description: string | null; statusId: string; priority: string;
  assigneeIds: string[]; labelIds: string[]; milestoneId: string | null; estimatePointId: string | null;
  startDate: string | null; dueDate: string | null; position: string; isArchived: boolean; assignedById: string;
}>

export async function updateIssue(ctx: PmsContext, issueId: string, patch: IssuePatch) {
  const result = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Issue not found", 404)

    const { assigneeIds, labelIds, ...rest } = patch
    const updateValues: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (assigneeIds !== undefined && assigneeIds.length > 0) updateValues.assignedById = ctx.userId
    if (Object.keys(updateValues).length > 1) {
      await db.update(pmsIssues).set(updateValues).where(eq(pmsIssues.id, issueId))
    }
    await syncAssignees(db, issueId, assigneeIds)
    await syncLabels(db, issueId, labelIds)

    const row = await getIssueRow(db, issueId)
    return { row, previousStatusId: existing.statusId }
  })

  // Wave 30: fire-and-forget automation rule evaluation on status change --
  // never blocks/breaks this update, matching evaluateAndRunRules()'s own
  // internal error-swallowing contract.
  if (patch.statusId !== undefined && patch.statusId !== result.previousStatusId) {
    void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
      evaluateAndRunRules({ orgId: ctx.orgId }, "pms_issue.status_changed", { issueId, previousStatusId: result.previousStatusId, newStatusId: patch.statusId })
    )
  }

  return result.row
}

export async function addIssueRelation(
  ctx: { orgId: string },
  issueId: string,
  input: { relatedIssueId: string; relationType: string }
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, issueId), eq(pmsIssues.orgId, ctx.orgId)) })
    if (!issue) throw new ServiceError("Issue not found", 404)

    const [row] = await db.insert(pmsIssueRelations).values({
      orgId: ctx.orgId, issueId, relatedIssueId: input.relatedIssueId,
      relationType: input.relationType as typeof pmsIssueRelations.$inferInsert.relationType,
    }).returning()
    return row
  })
}

export async function listIssueRelations(ctx: { orgId: string }, issueId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsIssueRelations.findMany({ where: and(eq(pmsIssueRelations.orgId, ctx.orgId), eq(pmsIssueRelations.issueId, issueId)) })
  )
}
