// Wave 26 (VERIDIAN AI PMS) service layer -- issue types (org-wide),
// issue statuses (per-project), workflow transitions, labels, estimate
// schemes/points, milestones. All read/write paths assume the caller has
// already passed requirePmsEnabled() (enforced at the route layer).
import {
  pmsIssueTypes, pmsIssueStatuses, pmsWorkflowTransitions, pmsLabels,
  pmsEstimateSchemes, pmsEstimatePoints, pmsMilestones, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const DEFAULT_STATUSES: Array<{ name: string; group: "backlog" | "unstarted" | "started" | "completed" | "cancelled"; position: number; isDefault?: boolean }> = [
  { name: "Backlog", group: "backlog", position: 0, isDefault: true },
  { name: "Todo", group: "unstarted", position: 1 },
  { name: "In Progress", group: "started", position: 2 },
  { name: "Done", group: "completed", position: 3 },
  { name: "Cancelled", group: "cancelled", position: 4 },
]

/**
 * Copy-on-first-use: a project has no PMS statuses until the first time
 * it's actually used for PMS work (statuses are per-project, unlike
 * org-wide issue types seeded once at org-enable time in
 * pms-enablement-service.ts). Idempotent -- safe to call on every read.
 */
export async function ensureDefaultStatusesForProject(db: TenantDb, orgId: string, projectId: string) {
  const existing = await db.query.pmsIssueStatuses.findMany({ where: eq(pmsIssueStatuses.projectId, projectId) })
  if (existing.length > 0) return existing
  return db.insert(pmsIssueStatuses).values(DEFAULT_STATUSES.map((s) => ({ orgId, projectId, ...s }))).returning()
}

export async function listIssueTypes(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsIssueTypes.findMany({ where: eq(pmsIssueTypes.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  )
}

export async function createIssueType(ctx: PmsContext, input: { name: string; icon?: string; color?: string; isEpic?: boolean }) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating an issue type requires admin role or higher", 403)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsIssueTypes).values({
      orgId: ctx.orgId, name, icon: input.icon || null, color: input.color || null, isEpic: input.isEpic ?? false,
    }).returning()
    return row
  })
}

export async function listIssueStatuses(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    const statuses = await ensureDefaultStatusesForProject(db, ctx.orgId, projectId)
    return [...statuses].sort((a, b) => a.position - b.position)
  })
}

export async function createIssueStatus(
  ctx: PmsContext,
  projectId: string,
  input: { name: string; group: string; color?: string; position?: number }
) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating an issue status requires admin role or higher", 403)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  const validGroups = new Set(["backlog", "unstarted", "started", "completed", "cancelled", "triage"])
  if (!validGroups.has(input.group)) throw new ServiceError(`group must be one of: ${[...validGroups].join(", ")}`, 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [row] = await db.insert(pmsIssueStatuses).values({
      orgId: ctx.orgId, projectId, name,
      group: input.group as "backlog" | "unstarted" | "started" | "completed" | "cancelled" | "triage",
      color: input.color || null, position: input.position ?? 0,
    }).returning()
    return row
  })
}

export async function createWorkflowTransition(
  ctx: PmsContext,
  input: { issueTypeId: string; fromStatusId: string; toStatusId: string; role?: string }
) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating a workflow transition requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsWorkflowTransitions).values({
      orgId: ctx.orgId, issueTypeId: input.issueTypeId, fromStatusId: input.fromStatusId,
      toStatusId: input.toStatusId, role: input.role as typeof pmsWorkflowTransitions.$inferInsert.role,
    }).returning()
    return row
  })
}

export async function listWorkflowTransitions(ctx: { orgId: string }, issueTypeId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsWorkflowTransitions.findMany({
      where: issueTypeId
        ? and(eq(pmsWorkflowTransitions.orgId, ctx.orgId), eq(pmsWorkflowTransitions.issueTypeId, issueTypeId))
        : eq(pmsWorkflowTransitions.orgId, ctx.orgId),
    })
  )
}

export async function listLabels(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsLabels.findMany({ where: and(eq(pmsLabels.orgId, ctx.orgId), eq(pmsLabels.projectId, projectId)), orderBy: (t, { asc }) => asc(t.name) })
  )
}

export async function createLabel(ctx: PmsContext, projectId: string, input: { name: string; color?: string }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsLabels).values({ orgId: ctx.orgId, projectId, name, color: input.color || null }).returning()
    return row
  })
}

export async function listMilestones(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsMilestones.findMany({ where: and(eq(pmsMilestones.orgId, ctx.orgId), eq(pmsMilestones.projectId, projectId)), orderBy: (t, { asc }) => asc(t.targetDate) })
  )
}

export async function createMilestone(
  ctx: PmsContext,
  projectId: string,
  input: { name: string; description?: string; targetDate?: string }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(pmsMilestones).values({
      orgId: ctx.orgId, projectId, name, description: input.description || null, targetDate: input.targetDate || null,
    }).returning()
    return row
  })
}

export async function listEstimateSchemes(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const schemes = await db.query.pmsEstimateSchemes.findMany({ where: and(eq(pmsEstimateSchemes.orgId, ctx.orgId), eq(pmsEstimateSchemes.projectId, projectId)) })
    const points = await db.query.pmsEstimatePoints.findMany({
      where: (t, { inArray }) => inArray(t.schemeId, schemes.map((s) => s.id)),
    })
    return schemes.map((s) => ({ ...s, points: points.filter((p) => p.schemeId === s.id).sort((a, b) => a.position - b.position) }))
  })
}

export async function createEstimateScheme(ctx: PmsContext, projectId: string, input: { name: string; points: string[] }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!Array.isArray(input.points) || input.points.length === 0) throw new ServiceError("points must be a non-empty array", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [scheme] = await db.insert(pmsEstimateSchemes).values({ orgId: ctx.orgId, projectId, name }).returning()
    const points = await db.insert(pmsEstimatePoints).values(
      input.points.map((value, i) => ({ schemeId: scheme.id, value, position: i }))
    ).returning()
    return { ...scheme, points }
  })
}
