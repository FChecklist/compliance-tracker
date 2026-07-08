// Wave 120 (PROJEXA foundation) service layer -- expense-head
// classification (material/labour/transport/subcontractor/equipment/misc)
// per project. A thin rollup layer: entries optionally point back at their
// real source row (erp_purchase_invoice / erp_cash_voucher /
// construction_attendance) via linkedEntityType/linkedEntityId, but this
// table is never the source of truth for the underlying transaction.
import { constructionExpenseEntries, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ExpenseEntryInput = {
  projectId: string
  expenseHead: string
  description?: string
  amount: number
  expenseDate: string
  linkedEntityType?: string
  linkedEntityId?: string
}

const VALID_HEADS = ["material", "labour", "transport", "subcontractor", "equipment", "misc"]

export async function listExpenseEntries(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionExpenseEntries.findMany({
      where: and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.expenseDate),
    })
  )
}

export async function createExpenseEntry(ctx: { orgId: string; userId: string }, input: ExpenseEntryInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!VALID_HEADS.includes(input.expenseHead)) throw new ServiceError(`expenseHead must be one of: ${VALID_HEADS.join(", ")}`, 400)
  if (!input.expenseDate) throw new ServiceError("expenseDate is required", 400)
  if (!(input.amount > 0)) throw new ServiceError("amount must be positive", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [row] = await db.insert(constructionExpenseEntries).values({
      orgId: ctx.orgId, projectId: input.projectId,
      expenseHead: input.expenseHead as typeof constructionExpenseEntries.$inferInsert.expenseHead,
      description: input.description || null, amount: String(input.amount), expenseDate: input.expenseDate,
      linkedEntityType: input.linkedEntityType || null, linkedEntityId: input.linkedEntityId || null,
      recordedById: ctx.userId,
    }).returning()
    return row
  })
}

/** Sum of expense amounts for a project, grouped by expense head -- the building block for the Expense Report (Wave 122) and the project dashboard's `expenses` figure (Wave 121). */
export async function getExpenseSummaryByHead(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.select({
      expenseHead: constructionExpenseEntries.expenseHead,
      total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float`,
    })
      .from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId)))
      .groupBy(constructionExpenseEntries.expenseHead)
  )
}
