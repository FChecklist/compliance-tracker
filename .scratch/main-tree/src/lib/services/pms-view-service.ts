// Wave 26 (VERIDIAN AI PMS) service layer -- saved filter/sort/display
// views. Private-vs-shared is enforced by a real RLS branch (migration
// 0022), not just this service filtering -- this layer only adds
// ownership checks for writes. Callers must have already passed
// requirePmsEnabled() (enforced at the route layer).
import { pmsSavedViews } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listSavedViews(ctx: { orgId: string; userId: string }, projectId?: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.pmsSavedViews.findMany({
      where: projectId
        ? and(eq(pmsSavedViews.orgId, ctx.orgId), eq(pmsSavedViews.projectId, projectId))
        : eq(pmsSavedViews.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.sortOrder),
    })
  )
}

export async function createSavedView(
  ctx: { orgId: string; userId: string },
  input: { name: string; projectId?: string; filters?: object; displayFilters?: object; access?: string; sortOrder?: number }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(pmsSavedViews).values({
      orgId: ctx.orgId, projectId: input.projectId || null, ownedById: ctx.userId, name,
      filters: input.filters ?? {}, displayFilters: input.displayFilters ?? {},
      access: (input.access as typeof pmsSavedViews.$inferInsert.access) || "private",
      sortOrder: input.sortOrder ?? 0,
    }).returning()
    return row
  })
}

export async function updateSavedView(
  ctx: { orgId: string; userId: string },
  viewId: string,
  patch: Partial<{ name: string; filters: object; displayFilters: object; access: string; sortOrder: number }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.pmsSavedViews.findFirst({ where: and(eq(pmsSavedViews.id, viewId), eq(pmsSavedViews.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Saved view not found", 404)
    if (existing.ownedById !== ctx.userId) throw new ServiceError("Only the owner may edit this saved view", 403)

    const [row] = await db.update(pmsSavedViews)
      .set({ ...patch, access: patch.access as typeof pmsSavedViews.$inferInsert.access, updatedAt: new Date() })
      .where(eq(pmsSavedViews.id, viewId)).returning()
    return row
  })
}

export async function deleteSavedView(ctx: { orgId: string; userId: string }, viewId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.pmsSavedViews.findFirst({ where: and(eq(pmsSavedViews.id, viewId), eq(pmsSavedViews.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Saved view not found", 404)
    if (existing.ownedById !== ctx.userId) throw new ServiceError("Only the owner may delete this saved view", 403)

    await db.delete(pmsSavedViews).where(eq(pmsSavedViews.id, viewId))
    return { deleted: true }
  })
}
