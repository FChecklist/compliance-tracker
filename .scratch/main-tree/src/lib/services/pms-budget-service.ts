// Wave 28 (VERIDIAN AI PMS) service layer -- project budgeting
// (OpenProject's unique contribution among the 3 studied tools). Budgets/
// line items are the stored, planned figures; actuals are computed live
// by summing pmsTimeEntries x pmsBillableRates at read time, never a
// duplicated ledger. Callers must have already passed
// requirePmsEnabled() (enforced at the route layer).
import { pmsBudgets, pmsBudgetLineItems, pmsTimeEntries, pmsIssues, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"
import { resolveBillableRate } from "./pms-time-service"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listBudgets(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsBudgets.findMany({ where: and(eq(pmsBudgets.orgId, ctx.orgId), eq(pmsBudgets.projectId, projectId)), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function createBudget(ctx: PmsContext, projectId: string, input: { name: string; fixedDate?: string }) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [budget] = await db.insert(pmsBudgets).values({
      orgId: ctx.orgId, projectId, name, fixedDate: input.fixedDate || null, authorId: ctx.userId,
    }).returning()
    return budget
  })
}

export async function addBudgetLineItem(
  ctx: { orgId: string },
  budgetId: string,
  input: { kind: string; description?: string; amount: string; userId?: string; hours?: string }
) {
  if (input.kind !== "labor" && input.kind !== "material") throw new ServiceError("kind must be 'labor' or 'material'", 400)
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount < 0) throw new ServiceError("amount must be a non-negative number", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const budget = await db.query.pmsBudgets.findFirst({ where: and(eq(pmsBudgets.id, budgetId), eq(pmsBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)

    const [row] = await db.insert(pmsBudgetLineItems).values({
      budgetId, kind: input.kind as "labor" | "material", description: input.description || null,
      amount: input.amount, userId: input.userId || null, hours: input.hours || null,
    }).returning()
    return row
  })
}

export async function getBudget(ctx: { orgId: string }, budgetId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const budget = await db.query.pmsBudgets.findFirst({ where: and(eq(pmsBudgets.id, budgetId), eq(pmsBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)
    const lineItems = await db.query.pmsBudgetLineItems.findMany({ where: eq(pmsBudgetLineItems.budgetId, budgetId) })
    const plannedTotal = lineItems.reduce((sum, li) => sum + Number(li.amount), 0)
    return { ...budget, lineItems, plannedTotal }
  })
}

/**
 * Actual spend to date for the budget's project -- sums every logged
 * pmsTimeEntry for the project's issues, each priced at the rate that
 * applied on the day it was logged. Computed live, never stored.
 */
export async function getBudgetActuals(ctx: { orgId: string }, budgetId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const budget = await db.query.pmsBudgets.findFirst({ where: and(eq(pmsBudgets.id, budgetId), eq(pmsBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)

    const issues = await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, budget.projectId)), columns: { id: true } })
    const issueIds = issues.map((i) => i.id)
    if (issueIds.length === 0) return { actualLaborCost: 0, totalHours: 0 }

    const entries = await db.query.pmsTimeEntries.findMany({ where: (t, { inArray }) => inArray(t.issueId, issueIds) })

    let actualLaborCost = 0
    let totalHours = 0
    for (const entry of entries) {
      const rate = await resolveBillableRate({ orgId: ctx.orgId }, entry.userId, entry.spentOn)
      actualLaborCost += rate * Number(entry.hours)
      totalHours += Number(entry.hours)
    }
    return { actualLaborCost, totalHours }
  })
}
