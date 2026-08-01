// Task #47 PM gap analysis (2026-07-31): Project Groups CRUD -- grouping
// related projects together (e.g. a program spanning several individual
// projects). Many-to-many via projectGroupProjects (see schema.ts comment).
import { projectGroups, projectGroupProjects, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, desc, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ProjectGroupContext = { orgId: string; userId?: string }

export async function listProjectGroups(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.projectGroups.findMany({ where: eq(projectGroups.orgId, ctx.orgId), orderBy: desc(projectGroups.createdAt) })
  )
}

export async function createProjectGroup(
  ctx: ProjectGroupContext,
  input: { name: string; description?: string; color?: string }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [group] = await db.insert(projectGroups).values({
      orgId: ctx.orgId, name, description: input.description?.trim() || null, color: input.color || null,
    }).returning()
    return group
  })
}

export async function updateProjectGroup(
  ctx: ProjectGroupContext,
  groupId: string,
  patch: Partial<{ name: string; description: string | null; color: string | null }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.projectGroups.findFirst({ where: and(eq(projectGroups.id, groupId), eq(projectGroups.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Project group not found", 404)
    const [updated] = await db.update(projectGroups).set({ ...patch, updatedAt: new Date() }).where(eq(projectGroups.id, groupId)).returning()
    return updated
  })
}

export async function listGroupProjects(ctx: { orgId: string }, groupId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const group = await db.query.projectGroups.findFirst({ where: and(eq(projectGroups.id, groupId), eq(projectGroups.orgId, ctx.orgId)) })
    if (!group) throw new ServiceError("Project group not found", 404)

    const links = await db.query.projectGroupProjects.findMany({ where: eq(projectGroupProjects.groupId, groupId) })
    if (links.length === 0) return []
    return db.query.projects.findMany({ where: and(eq(projects.orgId, ctx.orgId), inArray(projects.id, links.map((l) => l.projectId))) })
  })
}

export async function addProjectToGroup(ctx: { orgId: string }, groupId: string, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const group = await db.query.projectGroups.findFirst({ where: and(eq(projectGroups.id, groupId), eq(projectGroups.orgId, ctx.orgId)) })
    if (!group) throw new ServiceError("Project group not found", 404)
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const existing = await db.query.projectGroupProjects.findFirst({
      where: and(eq(projectGroupProjects.groupId, groupId), eq(projectGroupProjects.projectId, projectId)),
    })
    if (existing) throw new ServiceError("Project is already in this group", 409)

    const [link] = await db.insert(projectGroupProjects).values({ groupId, projectId }).returning()
    return link
  })
}

export async function removeProjectFromGroup(ctx: { orgId: string }, groupId: string, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const group = await db.query.projectGroups.findFirst({ where: and(eq(projectGroups.id, groupId), eq(projectGroups.orgId, ctx.orgId)) })
    if (!group) throw new ServiceError("Project group not found", 404)
    const existing = await db.query.projectGroupProjects.findFirst({
      where: and(eq(projectGroupProjects.groupId, groupId), eq(projectGroupProjects.projectId, projectId)),
    })
    if (!existing) throw new ServiceError("Project is not in this group", 404)
    await db.delete(projectGroupProjects).where(and(eq(projectGroupProjects.groupId, groupId), eq(projectGroupProjects.projectId, projectId)))
    return { removed: true }
  })
}
