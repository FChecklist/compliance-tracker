// Wave 107 (VERI FM & CS AI OS) -- checklist template + item CRUD.
// Templates are a platform-owned catalog resolved at runtime (orgId
// nullable: NULL = seeded library row available to every org), not
// copy-on-enable -- see fmChecklistTemplates' schema comment for why.
// resolveTemplatesForOrg() implements the most-specific-wins resolution:
// an org's own fork (org_id = orgId) for a given category+frequency wins
// over the platform row for that same category+frequency, matching the
// resolution-chain convention already used across this codebase (customer
// config over platform default, etc.).
import { fmChecklistTemplates, fmChecklistTemplateItems } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, isNull, or } from "drizzle-orm"
import { requireFmEnabled } from "./fm-enablement-service"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FmChecklistContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

/** Every template visible to this org: platform-seeded rows (org_id NULL)
 *  plus this org's own forks, for a given category (optional filter). */
export async function listChecklistTemplates(ctx: { orgId: string }, filters?: { categoryId?: string; frequency?: string }) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [
      or(isNull(fmChecklistTemplates.orgId), eq(fmChecklistTemplates.orgId, ctx.orgId)),
      eq(fmChecklistTemplates.isActive, true),
    ]
    if (filters?.categoryId) conditions.push(eq(fmChecklistTemplates.categoryId, filters.categoryId))
    if (filters?.frequency) conditions.push(eq(fmChecklistTemplates.frequency, filters.frequency as typeof fmChecklistTemplates.$inferSelect["frequency"]))
    return db.query.fmChecklistTemplates.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => [asc(t.categoryId), asc(t.frequency)],
    })
  })
}

export async function getChecklistTemplateWithItems(ctx: { orgId: string }, templateId: string) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const template = await db.query.fmChecklistTemplates.findFirst({
      where: and(eq(fmChecklistTemplates.id, templateId), or(isNull(fmChecklistTemplates.orgId), eq(fmChecklistTemplates.orgId, ctx.orgId))),
    })
    if (!template) throw new ServiceError("Checklist template not found", 404)
    const items = await db.query.fmChecklistTemplateItems.findMany({
      where: eq(fmChecklistTemplateItems.templateId, templateId),
      orderBy: (t, { asc }) => asc(t.sequenceOrder),
    })
    return { template, items }
  })
}

export type FmChecklistTemplateInput = {
  categoryId: string
  frequency: string
  name: string
  description?: string | null
  items: { itemText: string; itemType?: string; isMandatory?: boolean }[]
}

// Shared inner implementation, takes an already-open tx -- called by both
// createOrgChecklistTemplate and forkChecklistTemplate so the latter's
// "read platform template, then create the fork" stays one atomic
// transaction instead of two separate withTenantContext calls.
async function insertOrgChecklistTemplate(db: TenantDb, ctx: FmChecklistContext, input: FmChecklistTemplateInput) {
  const [template] = await db.insert(fmChecklistTemplates).values({
    orgId: ctx.orgId,
    categoryId: input.categoryId,
    frequency: input.frequency as typeof fmChecklistTemplates.$inferSelect["frequency"],
    name: input.name.trim(),
    description: input.description ?? null,
    createdById: ctx.userId,
  }).returning()

  await db.insert(fmChecklistTemplateItems).values(
    input.items.map((item, i) => ({
      templateId: template.id,
      sequenceOrder: i,
      itemText: item.itemText,
      itemType: item.itemType ?? "checkbox",
      isMandatory: item.isMandatory ?? true,
    }))
  )

  return template
}

/** Creates an org-owned template (org-specific fork), never a platform
 *  (org_id NULL) row -- platform rows are migration-seeded only, per the
 *  product-catalog-governance rule already established for productBranches. */
export async function createOrgChecklistTemplate(ctx: FmChecklistContext, input: FmChecklistTemplateInput) {
  await requireFmEnabled(ctx.orgId)
  if (!hasRole(ctx.dbUser, "manager")) throw new ServiceError("Creating a checklist template requires manager role or higher", 403)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one checklist item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) => insertOrgChecklistTemplate(db, ctx, input))
}

/** Clones a platform template into an org-owned fork the org can then
 *  freely edit -- the schema-ready path fmChecklistTemplates.orgId's
 *  nullability exists for, UI itself deferred to a later wave. */
export async function forkChecklistTemplate(ctx: FmChecklistContext, platformTemplateId: string) {
  await requireFmEnabled(ctx.orgId)
  if (!hasRole(ctx.dbUser, "manager")) throw new ServiceError("Forking a checklist template requires manager role or higher", 403)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const platformTemplate = await db.query.fmChecklistTemplates.findFirst({
      where: and(eq(fmChecklistTemplates.id, platformTemplateId), isNull(fmChecklistTemplates.orgId)),
    })
    if (!platformTemplate) throw new ServiceError("Platform checklist template not found", 404)
    const platformItems = await db.query.fmChecklistTemplateItems.findMany({
      where: eq(fmChecklistTemplateItems.templateId, platformTemplateId),
      orderBy: (t, { asc }) => asc(t.sequenceOrder),
    })

    return insertOrgChecklistTemplate(db, ctx, {
      categoryId: platformTemplate.categoryId,
      frequency: platformTemplate.frequency,
      name: `${platformTemplate.name} (Custom)`,
      description: platformTemplate.description,
      items: platformItems.map((i) => ({ itemText: i.itemText, itemType: i.itemType, isMandatory: i.isMandatory })),
    })
  })
}
