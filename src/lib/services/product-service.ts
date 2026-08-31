// Wave 19 (VAIOS Product/Project scope layer, constitution L2) service
// layer. A scope/data layer only, NOT an AI actor -- see
// PLATFORM_STRATEGY.md §11's honesty section for exactly what this does
// and doesn't establish (no autonomous Product Intelligence is created by
// this file).
import { products, projects, projectTeamMembers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type ProductContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product"
}

export async function listProducts(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.products.findMany({ where: eq(products.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  )
}

export async function createProduct(ctx: ProductContext, input: { name: string; description?: string }) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating a product requires admin role or higher", 403)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const baseSlug = slugify(name)
    let slug = baseSlug
    let attempt = 0
    while (await db.query.products.findFirst({ where: and(eq(products.orgId, ctx.orgId), eq(products.slug, slug)) })) {
      attempt += 1
      slug = `${baseSlug}-${attempt}`
      if (attempt > 20) break
    }
    const [product] = await db.insert(products).values({
      orgId: ctx.orgId, name, slug, description: input.description?.trim() || null,
    }).returning()
    return { id: product.id, name: product.name, slug: product.slug, description: product.description, createdAt: product.createdAt.toISOString() }
  })
}

export async function listProjects(ctx: { orgId: string }, productId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.projects.findMany({ where: and(eq(projects.productId, productId), eq(projects.orgId, ctx.orgId)), orderBy: (t, { asc }) => asc(t.name) })
  )
}

/**
 * Org-wide, not scoped to a single product -- the VERIDIAN AI PMS project picker (Wave 27) needs every project regardless of which product it sits under.
 *
 * R48 gap-closure (2026-08-30, F002: "A project manager sees only projects
 * she is assigned to"). This previously returned every active project in
 * the org unconditionally, for every caller -- a real, confirmed gap: a
 * "manager"-ranked user (this schema's only per-project assignment is
 * `projects.leadUserId` -- there is no separate project-membership table)
 * saw every other manager's projects too. `assignedToUserId` narrows to
 * projects that user leads; branch_manager/admin/veridian_admin (rank >=4,
 * the real oversight tier) deliberately keep full org-wide visibility --
 * only the exact "manager" rank this business_rule names gets narrowed, so
 * this stays additive rather than a behavior change for every caller.
 */
export async function listAllProjectsForOrg(ctx: { orgId: string }, assignedToUserId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.projects.findMany({
      where: assignedToUserId
        ? and(eq(projects.orgId, ctx.orgId), eq(projects.leadUserId, assignedToUserId))
        : eq(projects.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.name),
    })
  )
}

/**
 * VERIDIAN AI PMS (Wave 27) creates projects directly, without asking a user
 * to first understand the Product/Project (L2) hierarchy -- auto-resolves
 * (or creates once) a hidden "General" default product per org, matching
 * how Plane/Huly/OpenProject present projects as the top-level PM concept.
 */
export async function createProjectDirect(
  ctx: ProductContext,
  input: { name: string; description?: string; clientId?: string; issuePrefix?: string; leadUserId?: string; startDate?: string; targetDate?: string }
) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating a project requires admin role or higher", 403)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    let product = await db.query.products.findFirst({ where: and(eq(products.orgId, ctx.orgId), eq(products.slug, "general")) })
    if (!product) {
      const [created] = await db.insert(products).values({ orgId: ctx.orgId, name: "General", slug: "general" }).returning()
      product = created
    }

    const [project] = await db.insert(projects).values({
      productId: product.id, orgId: ctx.orgId, clientId: input.clientId || null,
      name, description: input.description?.trim() || null,
      issuePrefix: input.issuePrefix?.trim().toUpperCase() || null,
      leadUserId: input.leadUserId || null, startDate: input.startDate || null, targetDate: input.targetDate || null,
    }).returning()
    return project
  })
}

export async function createProject(
  ctx: ProductContext,
  productId: string,
  input: { name: string; description?: string; clientId?: string }
) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Creating a project requires admin role or higher", 403)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const product = await db.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.orgId, ctx.orgId)) })
    if (!product) throw new ServiceError("Product not found", 404)

    const [project] = await db.insert(projects).values({
      productId, orgId: ctx.orgId, clientId: input.clientId || null,
      name, description: input.description?.trim() || null,
    }).returning()
    return { id: project.id, productId: project.productId, name: project.name, description: project.description, createdAt: project.createdAt.toISOString() }
  })
}

// Task #46 (CRM feature-parity gap analysis): projects.leadUserId
// only ever carried a single owner -- no way to represent a multi-person
// project team. Adds the project_team_members junction table (drizzle/0511),
// same shape as pmsMeetingParticipants/conversationParticipants/
// userClientAccess (id/parentId/userId + one discriminator column). Placed
// here rather than crm-service.ts (which has zero project-related code --
// every project function already lives in this file) so the projects
// table's lifecycle stays in one place; follows crm-service.ts's own
// withTenantContext/ServiceError conventions throughout.
//
// leadUserId stays the single source of truth for "who owns this project"
// everywhere that already reads it (unchanged, zero call-site migration
// needed) -- resolveLeadUserIdOnAdd/resolveLeadUserIdOnRemove below are the
// pure rules that keep it consistent with the junction table whenever a
// member is added/removed, extracted standalone (same pattern as
// crm-accounts-service.ts's wouldCreateCycle) so this logic is unit-testable
// without a live DB.

/** Adding someone as role='lead' makes them the project's lead. Any other role leaves the existing leadUserId untouched. */
export function resolveLeadUserIdOnAdd(currentLeadUserId: string | null, memberUserId: string, role: string): string | null {
  return role === "lead" ? memberUserId : currentLeadUserId
}

/** Removing the current lead can't leave leadUserId pointing at someone no longer on the team -- falls back to another remaining 'lead'-role member, else null. Removing anyone else leaves leadUserId untouched. */
export function resolveLeadUserIdOnRemove(
  currentLeadUserId: string | null,
  removedUserId: string,
  remainingMembers: { userId: string; role: string }[]
): string | null {
  if (currentLeadUserId !== removedUserId) return currentLeadUserId
  return remainingMembers.find((m) => m.role === "lead")?.userId ?? null
}

export async function listProjectTeamMembers(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    return db.query.projectTeamMembers.findMany({
      where: eq(projectTeamMembers.projectId, projectId),
      orderBy: (t, { asc }) => asc(t.createdAt),
    })
  })
}

export async function addProjectTeamMember(ctx: ProductContext, projectId: string, userId: string, role: string = "member") {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Adding a project team member requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const existing = await db.query.projectTeamMembers.findFirst({
      where: and(eq(projectTeamMembers.projectId, projectId), eq(projectTeamMembers.userId, userId)),
    })
    const [member] = existing
      ? await db.update(projectTeamMembers).set({ role, updatedAt: new Date() }).where(eq(projectTeamMembers.id, existing.id)).returning()
      : await db.insert(projectTeamMembers).values({ orgId: ctx.orgId, projectId, userId, role }).returning()

    const newLeadUserId = resolveLeadUserIdOnAdd(project.leadUserId, userId, role)
    if (newLeadUserId !== project.leadUserId) {
      await db.update(projects).set({ leadUserId: newLeadUserId, updatedAt: new Date() }).where(eq(projects.id, projectId))
    }
    return member
  })
}

export async function removeProjectTeamMember(ctx: ProductContext, projectId: string, userId: string) {
  if (!hasRole(ctx.dbUser, "admin")) throw new ServiceError("Removing a project team member requires admin role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const existing = await db.query.projectTeamMembers.findFirst({
      where: and(eq(projectTeamMembers.projectId, projectId), eq(projectTeamMembers.userId, userId)),
    })
    if (!existing) throw new ServiceError("Team member not found on this project", 404)
    await db.delete(projectTeamMembers).where(eq(projectTeamMembers.id, existing.id))

    const remaining = await db.query.projectTeamMembers.findMany({ where: eq(projectTeamMembers.projectId, projectId) })
    const newLeadUserId = resolveLeadUserIdOnRemove(project.leadUserId, userId, remaining)
    if (newLeadUserId !== project.leadUserId) {
      await db.update(projects).set({ leadUserId: newLeadUserId, updatedAt: new Date() }).where(eq(projects.id, projectId))
    }
    return { removed: true }
  })
}
