// Wave 70 (Budgeting) -- per COMPARISON_CSV_GAP_ANALYSIS.md, Finance>Budgeting
// was a complete gap with no schema or service at all. Independently
// designed to match this codebase's own conventions (erp-financial-report-
// service.ts's accountBalancesInRange, erp-buying-service.ts's Vendor
// Scorecard read-time aggregation) -- no third-party code copied.
import { erpBudgets, erpBudgetLineItems, erpAccounts, erpJournalEntries, erpJournalEntryLines, erpFiscalYears } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, lte, gte, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requireErpEnabled } from "./erp-enablement-service"

type BudgetLineItemInput = { accountId: string; annualAmount: number }
type BudgetAction = "ignore" | "warn" | "stop"

// Priority 17 remaining gap: companyId is an optional equality filter --
// erp_budgets.companyId has existed since Wave 70 (createBudget already
// accepted it), this was the one real gap: listBudgets never let a caller
// filter by it, so PROJEXA's Budgets page had no way to scope the list even
// though the data already supported it. Omitted means "no filter", same
// unchanged-by-default convention as every other companyId filter added
// this wave.
export async function listBudgets(ctx: { orgId: string }, filters?: { companyId?: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(erpBudgets.orgId, ctx.orgId)]
    if (filters?.companyId) conditions.push(eq(erpBudgets.companyId, filters.companyId))
    return db.query.erpBudgets.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function getBudget(ctx: { orgId: string }, budgetId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const budget = await db.query.erpBudgets.findFirst({ where: and(eq(erpBudgets.id, budgetId), eq(erpBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)
    const lineItems = await db.query.erpBudgetLineItems.findMany({ where: eq(erpBudgetLineItems.budgetId, budgetId) })
    return { ...budget, lineItems }
  })
}

export async function createBudget(
  ctx: { orgId: string; userId: string },
  data: { fiscalYearId: string; companyId?: string; costCenterId?: string; name: string; actionIfExceeded?: BudgetAction; lineItems: BudgetLineItemInput[] }
) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const fy = await db.query.erpFiscalYears.findFirst({ where: and(eq(erpFiscalYears.id, data.fiscalYearId), eq(erpFiscalYears.orgId, ctx.orgId)) })
    if (!fy) throw new ServiceError("Fiscal year not found", 404)
    if (!data.name?.trim()) throw new ServiceError("Budget name is required", 400)
    if (!data.lineItems?.length) throw new ServiceError("At least one budget line item is required", 400)

    const [budget] = await db
      .insert(erpBudgets)
      .values({
        orgId: ctx.orgId,
        fiscalYearId: data.fiscalYearId,
        companyId: data.companyId ?? null,
        costCenterId: data.costCenterId ?? null,
        name: data.name,
        actionIfExceeded: data.actionIfExceeded ?? "warn",
        createdById: ctx.userId,
      })
      .returning()

    const lineItems = await db
      .insert(erpBudgetLineItems)
      .values(data.lineItems.map((li) => ({ budgetId: budget.id, accountId: li.accountId, annualAmount: String(li.annualAmount) })))
      .returning()

    return { ...budget, lineItems }
  })
}

export async function updateBudgetLineItems(ctx: { orgId: string }, budgetId: string, lineItems: BudgetLineItemInput[]) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const budget = await db.query.erpBudgets.findFirst({ where: and(eq(erpBudgets.id, budgetId), eq(erpBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)
    if (budget.status !== "draft") throw new ServiceError("Only draft budgets can be edited", 409)
    if (!lineItems?.length) throw new ServiceError("At least one budget line item is required", 400)

    await db.delete(erpBudgetLineItems).where(eq(erpBudgetLineItems.budgetId, budgetId))
    return db.insert(erpBudgetLineItems).values(lineItems.map((li) => ({ budgetId, accountId: li.accountId, annualAmount: String(li.annualAmount) }))).returning()
  })
}

export async function submitBudget(ctx: { orgId: string; userId: string }, budgetId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const budget = await db.query.erpBudgets.findFirst({ where: and(eq(erpBudgets.id, budgetId), eq(erpBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)
    if (budget.status !== "draft") throw new ServiceError("Only draft budgets can be submitted", 409)
    const [updated] = await db.update(erpBudgets).set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() }).where(eq(erpBudgets.id, budgetId)).returning()
    return updated
  })
}

export async function cancelBudget(ctx: { orgId: string }, budgetId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const budget = await db.query.erpBudgets.findFirst({ where: and(eq(erpBudgets.id, budgetId), eq(erpBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)
    if (budget.status === "cancelled") throw new ServiceError("Budget is already cancelled", 409)
    const [updated] = await db.update(erpBudgets).set({ status: "cancelled", updatedAt: new Date() }).where(eq(erpBudgets.id, budgetId)).returning()
    return updated
  })
}

export type BudgetVarianceLine = {
  accountId: string
  accountName: string
  annualAmount: number
  actualAmount: number
  varianceAmount: number
  variancePercent: number | null
  isOverBudget: boolean
}

/**
 * Budget vs Actual: reads live off erp_journal_entry_lines (submitted
 * entries only) between the budget's fiscal-year start and asOfDate,
 * scoped to the budget's cost center if one is set -- never a duplicated
 * actuals ledger, matching erp-financial-report-service.ts's own
 * accountBalancesInRange precedent exactly.
 */
export async function getBudgetVariance(ctx: { orgId: string }, budgetId: string, asOfDate?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const budget = await db.query.erpBudgets.findFirst({ where: and(eq(erpBudgets.id, budgetId), eq(erpBudgets.orgId, ctx.orgId)) })
    if (!budget) throw new ServiceError("Budget not found", 404)
    const fy = await db.query.erpFiscalYears.findFirst({ where: eq(erpFiscalYears.id, budget.fiscalYearId) })
    if (!fy) throw new ServiceError("Fiscal year not found", 404)
    const effectiveAsOf = asOfDate && asOfDate <= fy.endDate ? asOfDate : fy.endDate

    const lineItems = await db.query.erpBudgetLineItems.findMany({ where: eq(erpBudgetLineItems.budgetId, budgetId) })
    if (lineItems.length === 0) return { budget, asOfDate: effectiveAsOf, lines: [] as BudgetVarianceLine[], totalBudget: 0, totalActual: 0 }

    const accountIds = lineItems.map((li) => li.accountId)
    const conditions = [
      eq(erpJournalEntries.orgId, ctx.orgId),
      eq(erpJournalEntries.status, "submitted"),
      gte(erpJournalEntries.postingDate, fy.startDate),
      lte(erpJournalEntries.postingDate, effectiveAsOf),
      inArray(erpJournalEntryLines.accountId, accountIds),
    ]
    if (budget.costCenterId) conditions.push(eq(erpJournalEntryLines.costCenterId, budget.costCenterId))

    const actuals = await db
      .select({
        accountId: erpAccounts.id,
        totalDebit: sql<string>`coalesce(sum(${erpJournalEntryLines.debit}), 0)`,
        totalCredit: sql<string>`coalesce(sum(${erpJournalEntryLines.credit}), 0)`,
      })
      .from(erpJournalEntryLines)
      .innerJoin(erpJournalEntries, eq(erpJournalEntryLines.journalEntryId, erpJournalEntries.id))
      .innerJoin(erpAccounts, eq(erpJournalEntryLines.accountId, erpAccounts.id))
      .where(and(...conditions))
      .groupBy(erpAccounts.id)

    const actualsByAccount = new Map(actuals.map((a) => [a.accountId, Number(a.totalDebit) - Number(a.totalCredit)]))
    const accountRows = await db.query.erpAccounts.findMany({ where: inArray(erpAccounts.id, accountIds) })
    const accountsById = new Map(accountRows.map((a) => [a.id, a]))

    const lines: BudgetVarianceLine[] = lineItems.map((li) => {
      const annualAmount = Number(li.annualAmount)
      const actualAmount = actualsByAccount.get(li.accountId) ?? 0
      return {
        accountId: li.accountId,
        accountName: accountsById.get(li.accountId)?.accountName ?? "Unknown",
        annualAmount,
        actualAmount,
        varianceAmount: annualAmount - actualAmount,
        variancePercent: annualAmount !== 0 ? (actualAmount / annualAmount) * 100 : null,
        isOverBudget: actualAmount > annualAmount,
      }
    })

    return { budget, asOfDate: effectiveAsOf, lines, totalBudget: lines.reduce((s, l) => s + l.annualAmount, 0), totalActual: lines.reduce((s, l) => s + l.actualAmount, 0) }
  })
}
