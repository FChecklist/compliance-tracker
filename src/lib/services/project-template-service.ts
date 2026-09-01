// Task #47 PM gap analysis (2026-07-31): Project Templates -- capturing a
// project's structure (phases/tasks/default team) as a reusable JSON
// snapshot, and cloning that snapshot into a brand-new project. See
// schema.ts's projectTemplates/projectPhases/projectTasks comment for why
// this deliberately targets new, minimal, ungated tables rather than
// pms_issues/pms_milestones (out of scope, and PMS-branch-gated).
import { projectTemplates, projectPhases, projectTasks, projectTeamAssignments, products, projects, pmTeams } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ProjectTemplateContext = { orgId: string; userId?: string }

export type TemplatePhaseDef = { name: string; description?: string | null; position?: number }
export type TemplateTaskDef = { title: string; description?: string | null; position?: number; phaseIndex?: number | null }

/** Pure -- builds the project_phases insert rows for a clone, in template order. No DB/randomness, directly unit-testable. */
export function buildClonedPhaseRows(phases: TemplatePhaseDef[], orgId: string, projectId: string) {
  return phases.map((p, i) => ({
    orgId, projectId, name: p.name, description: p.description ?? null, position: p.position ?? i,
  }))
}

/**
 * Pure -- builds the project_tasks insert rows for a clone, resolving each
 * task's phaseIndex (an index into the template's phases[] array) to the
 * REAL phase id created for this clone via phaseIdByIndex. No DB/randomness,
 * directly unit-testable.
 */
export function buildClonedTaskRows(
  tasks: TemplateTaskDef[],
  orgId: string,
  projectId: string,
  phaseIdByIndex: Map<number, string>
) {
  return tasks.map((t, i) => {
    const phaseId = t.phaseIndex !== undefined && t.phaseIndex !== null ? phaseIdByIndex.get(t.phaseIndex) ?? null : null
    return { orgId, projectId, phaseId, title: t.title, description: t.description ?? null, position: t.position ?? i }
  })
}

export async function listProjectTemplates(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.projectTemplates.findMany({ where: eq(projectTemplates.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function getProjectTemplate(ctx: { orgId: string }, templateId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const template = await db.query.projectTemplates.findFirst({ where: and(eq(projectTemplates.id, templateId), eq(projectTemplates.orgId, ctx.orgId)) })
    if (!template) throw new ServiceError("Project template not found", 404)
    return template
  })
}

async function snapshotFromProject(db: TenantDb, orgId: string, sourceProjectId: string) {
  const phases = await db.query.projectPhases.findMany({
    where: and(eq(projectPhases.orgId, orgId), eq(projectPhases.projectId, sourceProjectId)),
    orderBy: (t, { asc }) => asc(t.position),
  })
  const tasks = await db.query.projectTasks.findMany({
    where: and(eq(projectTasks.orgId, orgId), eq(projectTasks.projectId, sourceProjectId)),
    orderBy: (t, { asc }) => asc(t.position),
  })
  const phaseIndexById = new Map(phases.map((p, i) => [p.id, i]))
  return {
    phases: phases.map((p) => ({ name: p.name, description: p.description, position: p.position })),
    tasks: tasks.map((t) => ({
      title: t.title, description: t.description, position: t.position,
      phaseIndex: t.phaseId ? phaseIndexById.get(t.phaseId) ?? null : null,
    })),
  }
}

export async function createProjectTemplate(
  ctx: ProjectTemplateContext,
  input: {
    name: string; description?: string; defaultTeamId?: string;
    sourceProjectId?: string; phases?: TemplatePhaseDef[]; tasks?: TemplateTaskDef[];
  }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.defaultTeamId) {
      const team = await db.query.pmTeams.findFirst({ where: and(eq(pmTeams.id, input.defaultTeamId), eq(pmTeams.orgId, ctx.orgId)) })
      if (!team) throw new ServiceError("defaultTeamId not found", 404)
    }

    let structure: { phases: TemplatePhaseDef[]; tasks: TemplateTaskDef[] }
    if (input.sourceProjectId) {
      const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.sourceProjectId), eq(projects.orgId, ctx.orgId)) })
      if (!project) throw new ServiceError("sourceProjectId not found", 404)
      structure = await snapshotFromProject(db, ctx.orgId, input.sourceProjectId)
    } else {
      structure = { phases: input.phases ?? [], tasks: input.tasks ?? [] }
    }

    const [template] = await db.insert(projectTemplates).values({
      orgId: ctx.orgId, name, description: input.description?.trim() || null,
      defaultTeamId: input.defaultTeamId || null,
      phases: structure.phases, tasks: structure.tasks,
      createdById: ctx.userId || null,
    }).returning()
    return template
  })
}

export async function updateProjectTemplate(
  ctx: ProjectTemplateContext,
  templateId: string,
  patch: Partial<{ name: string; description: string | null; defaultTeamId: string | null }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.projectTemplates.findFirst({ where: and(eq(projectTemplates.id, templateId), eq(projectTemplates.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Project template not found", 404)
    const [updated] = await db.update(projectTemplates).set({ ...patch, updatedAt: new Date() }).where(eq(projectTemplates.id, templateId)).returning()
    return updated
  })
}

/**
 * Clones a template's phases/tasks/default-team into a brand-new project.
 * Mirrors product-service.ts's createProjectDirect() "auto-resolve-or-create
 * the hidden General product" convention, inlined into this same
 * transaction (rather than calling that function, which would open its own
 * nested withTenantContext) so project + phases + tasks + team assignment
 * commit atomically.
 */
export async function createProjectFromTemplate(
  ctx: ProjectTemplateContext,
  templateId: string,
  input: { name: string; description?: string; clientId?: string }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const template = await db.query.projectTemplates.findFirst({ where: and(eq(projectTemplates.id, templateId), eq(projectTemplates.orgId, ctx.orgId)) })
    if (!template) throw new ServiceError("Project template not found", 404)

    let product = await db.query.products.findFirst({ where: and(eq(products.orgId, ctx.orgId), eq(products.slug, "general")) })
    if (!product) {
      const [created] = await db.insert(products).values({ orgId: ctx.orgId, name: "General", slug: "general" }).returning()
      product = created
    }

    const [project] = await db.insert(projects).values({
      productId: product.id, orgId: ctx.orgId, clientId: input.clientId || null,
      name, description: input.description?.trim() || null,
    }).returning()

    const templatePhases = (template.phases as TemplatePhaseDef[]) ?? []
    const templateTasks = (template.tasks as TemplateTaskDef[]) ?? []

    const phaseRows = buildClonedPhaseRows(templatePhases, ctx.orgId, project.id)
    const createdPhases: (typeof projectPhases.$inferSelect)[] = []
    const phaseIdByIndex = new Map<number, string>()
    for (let i = 0; i < phaseRows.length; i++) {
      const [row] = await db.insert(projectPhases).values(phaseRows[i]).returning()
      createdPhases.push(row)
      phaseIdByIndex.set(i, row.id)
    }

    const taskRows = buildClonedTaskRows(templateTasks, ctx.orgId, project.id, phaseIdByIndex)
    const createdTasks = taskRows.length > 0 ? await db.insert(projectTasks).values(taskRows).returning() : []

    let teamAssignment: typeof projectTeamAssignments.$inferSelect | null = null
    if (template.defaultTeamId) {
      const [assignment] = await db.insert(projectTeamAssignments).values({
        orgId: ctx.orgId, projectId: project.id, teamId: template.defaultTeamId, isPrimary: true,
      }).returning()
      teamAssignment = assignment
    }

    return { project, phases: createdPhases, tasks: createdTasks, teamAssignment }
  })
}
