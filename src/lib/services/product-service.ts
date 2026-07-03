// Wave 19 (VAIOS Product/Project scope layer, constitution L2) service
// layer. A scope/data layer only, NOT an AI actor -- see
// PLATFORM_STRATEGY.md §11's honesty section for exactly what this does
// and doesn't establish (no autonomous Product Intelligence is created by
// this file).
import { products, projects } from "@/lib/db"
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

/** Org-wide, not scoped to a single product -- the VERIDIAN AI PMS project picker (Wave 27) needs every project regardless of which product it sits under. */
export async function listAllProjectsForOrg(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.projects.findMany({ where: eq(projects.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
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
