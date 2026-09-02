// R67 lane I (WS-I item I-05, R-177) -- the org's editable BOQ category list.
//
// WHY THIS EXISTS: before this, a BOQ line's category was derived
// lineItem.activityId -> activity.categoryId -> category.name (see
// categoryBoqAmountsReport's own comment, "constructionBoqLineItems has no
// direct category column of its own"). Most real lines have no activityId at
// all -- an imported BOQ never does -- so the Work Progress Report's
// Category-wise tab grouped nearly everything under "Uncategorized" and the
// dashboard category charts had almost nothing to plot.
// drizzle/0532_r67_i05_boq_line_category.sql adds the real column; this module
// is the pick-list behind it, and the rename/delete rules that keep the two
// consistent.
//
// TWO DELIBERATE ASYMMETRIES, both from the item's own wording:
//
// 1. RENAME UPDATES LINES BY ID, NOT BY TEXT. The caller names the category
//    ROW (its id); this module reads that row's CURRENT name and rewrites only
//    the lines carrying it. A blind `UPDATE ... SET category = $new WHERE
//    category = $old` driven by two caller-supplied strings would let a typo
//    rewrite an unrelated category's lines, with nothing to check it against.
//
// 2. DELETE OF AN IN-USE CATEGORY IS REFUSED, with the count in the message
//    ("Used by 12 BOQ lines"). Never a cascade, never a silent
//    re-categorisation to Uncategorized -- both would quietly change money
//    figures in a shipped report. A category that is genuinely unused is
//    RETIRED (is_active = false) rather than row-deleted, so a historical line
//    that still carries its name is never orphaned, and creating it again
//    later reactivates the same row instead of colliding with the
//    case-insensitive unique index.
//
// Category matching is CASE-INSENSITIVE throughout ("Civil" and "civil" are
// one category to any human reading the report, and treating them as two
// would split one subtotal in half) but the stored casing is always the
// customer's own -- nothing here case-folds a name it is storing.
import { constructionBoqCategories, constructionBoqLineItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { requireConstructionEnabled } from "./construction-enablement-service"
export { ServiceError }

export type BoqCategoryRow = typeof constructionBoqCategories.$inferSelect

/**
 * The seven categories a contractor org starts with. Mirrors the seed in
 * drizzle/0532_r67_i05_boq_line_category.sql exactly -- that migration seeds
 * orgs that ALREADY have construction data (code cannot reach them), this
 * constant is what a caller with an empty list can offer.
 */
export const DEFAULT_BOQ_CATEGORIES: readonly string[] = [
  "Civil", "Gypsum", "Joinery", "Paint", "Electrical", "Plumbing", "Misc",
]

/** Trim, and treat blank as absent. Single source of truth for what a category name may be. */
export function normalizeCategoryName(name: unknown): string {
  if (typeof name !== "string") return ""
  return name.trim()
}

export async function listBoqCategories(
  ctx: { orgId: string },
  options: { includeInactive?: boolean } = {}
): Promise<BoqCategoryRow[]> {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionBoqCategories.findMany({
      where: options.includeInactive
        ? eq(constructionBoqCategories.orgId, ctx.orgId)
        : and(eq(constructionBoqCategories.orgId, ctx.orgId), eq(constructionBoqCategories.isActive, true)),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.name)],
    })
  )
}

/**
 * Adds a category, or REACTIVATES a retired one with the same name. The
 * reactivation branch is not a nicety: the unique index is on
 * (org_id, lower(name)), so a plain insert after a retire would fail with a
 * raw constraint violation, and the user's mental model ("I deleted Paint,
 * now I want it back") would be met with a database error.
 */
export async function createBoqCategory(ctx: { orgId: string }, rawName: string): Promise<BoqCategoryRow> {
  await requireConstructionEnabled(ctx.orgId)
  const name = normalizeCategoryName(rawName)
  if (!name) throw new ServiceError("Category name is required", 400)
  if (name.length > 80) throw new ServiceError("Category name must be 80 characters or fewer", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionBoqCategories.findFirst({
      where: and(
        eq(constructionBoqCategories.orgId, ctx.orgId),
        sql`lower(${constructionBoqCategories.name}) = lower(${name})`
      ),
    })
    if (existing?.isActive) throw new ServiceError(`"${existing.name}" is already a category`, 409)
    if (existing) {
      const [reactivated] = await db.update(constructionBoqCategories)
        .set({ isActive: true, name, updatedAt: new Date() })
        .where(eq(constructionBoqCategories.id, existing.id))
        .returning()
      return reactivated
    }

    const [maxRow] = await db.select({ maxSort: sql<number>`coalesce(max(${constructionBoqCategories.sortOrder}), 0)` })
      .from(constructionBoqCategories)
      .where(eq(constructionBoqCategories.orgId, ctx.orgId))
    const [created] = await db.insert(constructionBoqCategories).values({
      orgId: ctx.orgId,
      name,
      sortOrder: Number(maxRow?.maxSort ?? 0) + 1,
    }).returning()
    return created
  })
}

export type RenameBoqCategoryResult = { category: BoqCategoryRow; lineItemsUpdated: number }

/**
 * Renames the category identified by `categoryId` and rewrites every BOQ line
 * that carries its CURRENT name. See this module's header for why the old name
 * is read from the row rather than taken from the caller.
 */
export async function renameBoqCategory(
  ctx: { orgId: string },
  categoryId: string,
  rawName: string
): Promise<RenameBoqCategoryResult> {
  await requireConstructionEnabled(ctx.orgId)
  const name = normalizeCategoryName(rawName)
  if (!name) throw new ServiceError("Category name is required", 400)
  if (name.length > 80) throw new ServiceError("Category name must be 80 characters or fewer", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const category = await db.query.constructionBoqCategories.findFirst({
      where: and(eq(constructionBoqCategories.id, categoryId), eq(constructionBoqCategories.orgId, ctx.orgId)),
    })
    if (!category) throw new ServiceError("Category not found", 404)

    const clash = await db.query.constructionBoqCategories.findFirst({
      where: and(
        eq(constructionBoqCategories.orgId, ctx.orgId),
        sql`lower(${constructionBoqCategories.name}) = lower(${name})`,
        sql`${constructionBoqCategories.id} <> ${categoryId}`
      ),
    })
    if (clash) throw new ServiceError(`"${clash.name}" is already a category`, 409)

    const previousName = category.name
    const [updated] = await db.update(constructionBoqCategories)
      .set({ name, updatedAt: new Date() })
      .where(eq(constructionBoqCategories.id, categoryId))
      .returning()

    // Same case-insensitive match the rest of this module uses -- a line
    // stored as "civil" by an import must follow a rename of "Civil", or it
    // silently falls out of the group it belongs to.
    const rewritten = await db.update(constructionBoqLineItems)
      .set({ category: name })
      .where(and(
        eq(constructionBoqLineItems.orgId, ctx.orgId),
        sql`lower(${constructionBoqLineItems.category}) = lower(${previousName})`
      ))
      .returning({ id: constructionBoqLineItems.id })

    return { category: updated, lineItemsUpdated: rewritten.length }
  })
}

/** How many BOQ lines in this org currently carry `name` (case-insensitively). */
export async function countLineItemsUsingCategory(ctx: { orgId: string }, name: string): Promise<number> {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.select({ count: sql<number>`count(*)` })
      .from(constructionBoqLineItems)
      .where(and(
        eq(constructionBoqLineItems.orgId, ctx.orgId),
        sql`lower(${constructionBoqLineItems.category}) = lower(${name})`
      ))
    return Number(row?.count ?? 0)
  })
}

/**
 * The exact refusal message the item specifies. Pure and exported so the
 * wording is asserted in one place by the test rather than re-typed at each
 * call site. Singular for one line -- "Used by 1 BOQ lines" is the kind of
 * detail that makes a product feel unfinished.
 */
export function categoryInUseMessage(count: number): string {
  return `Used by ${count} BOQ ${count === 1 ? "line" : "lines"}`
}

/**
 * Retires a category. Refused outright if any BOQ line still carries it --
 * never a cascade and never a silent re-categorisation, both of which would
 * change money figures in an already-shipped report.
 */
export async function deleteBoqCategory(ctx: { orgId: string }, categoryId: string): Promise<BoqCategoryRow> {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const category = await db.query.constructionBoqCategories.findFirst({
      where: and(eq(constructionBoqCategories.id, categoryId), eq(constructionBoqCategories.orgId, ctx.orgId)),
    })
    if (!category) throw new ServiceError("Category not found", 404)

    const [row] = await db.select({ count: sql<number>`count(*)` })
      .from(constructionBoqLineItems)
      .where(and(
        eq(constructionBoqLineItems.orgId, ctx.orgId),
        sql`lower(${constructionBoqLineItems.category}) = lower(${category.name})`
      ))
    const inUse = Number(row?.count ?? 0)
    if (inUse > 0) throw new ServiceError(categoryInUseMessage(inUse), 409)

    const [retired] = await db.update(constructionBoqCategories)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(constructionBoqCategories.id, categoryId))
      .returning()
    return retired
  })
}
