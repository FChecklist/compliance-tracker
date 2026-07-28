// Wave 174 (PROJEXA Owner resource-management spec, item 9: Budget) --
// per-scope-line-item markup, defaulting to 25% but overridable per line
// (constructionBudgetLineItems.markupPercent, null = "use the default").
// Tracked against vendor name/amount per line, matching the Owner's exact
// summary report columns. Always resolved against the CURRENT BOQ revision
// (construction-boq-service.ts's getCurrentBoq), not the original baseline --
// per the Owner's explicit cross-dependency requirement now that
// scope-of-work revisioning is real.
import {
  constructionBoqLineItems, constructionBudgetLineItems,
  constructionActivities, constructionCategories, projects,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { getCurrentBoq } from "./construction-boq-service"
export { ServiceError }

export const DEFAULT_MARKUP_PERCENT = 25

export type BudgetLineConfigInput = {
  projectId: string
  boqLineItemId: string
  markupPercent?: number | null
  vendorName?: string | null
  vendorAmount?: number | null
}

export async function upsertBudgetLineConfig(ctx: { orgId: string }, input: BudgetLineConfigInput) {
  if (!input.boqLineItemId) throw new ServiceError("boqLineItemId is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const lineItem = await db.query.constructionBoqLineItems.findFirst({ where: eq(constructionBoqLineItems.id, input.boqLineItemId) })
    if (!lineItem) throw new ServiceError("BOQ line item not found", 404)

    const existing = await db.query.constructionBudgetLineItems.findFirst({
      where: and(eq(constructionBudgetLineItems.orgId, ctx.orgId), eq(constructionBudgetLineItems.boqLineItemId, input.boqLineItemId)),
    })

    const values = {
      markupPercent: input.markupPercent === undefined ? undefined : input.markupPercent === null ? null : String(input.markupPercent),
      vendorName: input.vendorName === undefined ? undefined : (input.vendorName || null),
      vendorAmount: input.vendorAmount === undefined ? undefined : input.vendorAmount === null ? null : String(input.vendorAmount),
    }

    if (existing) {
      const [row] = await db.update(constructionBudgetLineItems).set({ ...values, updatedAt: new Date() }).where(eq(constructionBudgetLineItems.id, existing.id)).returning()
      return row
    }

    const [row] = await db.insert(constructionBudgetLineItems).values({
      orgId: ctx.orgId, projectId: input.projectId, boqLineItemId: input.boqLineItemId,
      markupPercent: values.markupPercent ?? null, vendorName: values.vendorName ?? null, vendorAmount: values.vendorAmount ?? null,
    }).returning()
    return row
  })
}

export type BudgetSummaryRow = {
  sNo: number
  category: string | null
  code: string | null
  description: string
  qty: number
  rate: number
  amount: number
  markupPercent: number
  budgetAmount: number
  vendor1: string | null
  vendorAmount: number | null
}

/** amount * (1 + markupPercent/100) -- markupPercent null/undefined falls back to DEFAULT_MARKUP_PERCENT. Exported pure so the "default 25% but overridable per line" behavior is directly testable without a DB. */
export function computeBudgetAmount(amount: number, markupPercent: number | null | undefined): number {
  const pct = markupPercent ?? DEFAULT_MARKUP_PERCENT
  return amount * (1 + pct / 100)
}

/** Pure report builder, exported for direct testing (no DB). One row per BOQ line item of the current revision, joined against its (optional) budget config, activity, and category. */
export function buildBudgetSummary(
  lineItems: { id: string; itemCode: string | null; description: string; quantity: string | number; rate: string | number; amount: string | number; activityId: string | null }[],
  configsByLineItemId: Map<string, { markupPercent: string | number | null; vendorName: string | null; vendorAmount: string | number | null }>,
  activitiesById: Map<string, { categoryId: string }>,
  categoriesById: Map<string, { name: string }>
): BudgetSummaryRow[] {
  return lineItems.map((item, i) => {
    const config = configsByLineItemId.get(item.id)
    const markupPercent = config?.markupPercent !== undefined && config?.markupPercent !== null ? Number(config.markupPercent) : null
    const amount = Number(item.amount)
    const activity = item.activityId ? activitiesById.get(item.activityId) : undefined
    const category = activity ? categoriesById.get(activity.categoryId) : undefined

    return {
      sNo: i + 1,
      category: category?.name ?? null,
      code: item.itemCode,
      description: item.description,
      qty: Number(item.quantity),
      rate: Number(item.rate),
      amount,
      markupPercent: markupPercent ?? DEFAULT_MARKUP_PERCENT,
      budgetAmount: computeBudgetAmount(amount, markupPercent),
      vendor1: config?.vendorName ?? null,
      vendorAmount: config?.vendorAmount !== undefined && config?.vendorAmount !== null ? Number(config.vendorAmount) : null,
    }
  })
}

export async function getBudgetSummary(ctx: { orgId: string }, projectId: string): Promise<BudgetSummaryRow[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const currentBoq = await getCurrentBoq(ctx, projectId)
    if (!currentBoq) return []

    const lineItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, currentBoq.id) })
    if (lineItems.length === 0) return []

    const lineItemIds = lineItems.map((li) => li.id)
    const configs = await db.query.constructionBudgetLineItems.findMany({
      where: and(eq(constructionBudgetLineItems.orgId, ctx.orgId), inArray(constructionBudgetLineItems.boqLineItemId, lineItemIds)),
    })
    const configsByLineItemId = new Map(configs.map((c) => [c.boqLineItemId, c]))

    const activityIds = [...new Set(lineItems.map((li) => li.activityId).filter((v): v is string => !!v))]
    const activities = activityIds.length > 0 ? await db.query.constructionActivities.findMany({ where: inArray(constructionActivities.id, activityIds) }) : []
    const activitiesById = new Map(activities.map((a) => [a.id, a]))

    const categoryIds = [...new Set(activities.map((a) => a.categoryId))]
    const categories = categoryIds.length > 0 ? await db.query.constructionCategories.findMany({ where: inArray(constructionCategories.id, categoryIds) }) : []
    const categoriesById = new Map(categories.map((c) => [c.id, c]))

    return buildBudgetSummary(lineItems, configsByLineItemId, activitiesById, categoriesById)
  })
}
