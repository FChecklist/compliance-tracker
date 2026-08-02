// Phase 0 HR gap-closure (2026-07-27): Employee Expense Claims /
// Reimbursement. Real gap re-confirmed by reading this schema fresh before
// writing this file: `constructionExpenseEntries` is PROJEXA project-cost
// tracking against a construction project's budget, a distinct domain --
// nothing here touches it. There was no way for a general office employee
// to submit "I spent money on the company's behalf, pay me back."
//
// Workflow: employee submits a claim (pending) -> manager approves/rejects
// -> an approved-but-unpaid claim is picked up by erp-payroll-service.ts's
// processPayrollRun() as a real payslip EARNING line (paid), the mirror
// image of hr-loan-service.ts's deduction integration -- see schema.ts's
// own comment on hrExpenseClaims for why this reuses the payroll run
// rather than a separate payment record.
import { hrExpenseClaims } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type HrExpenseContext = { orgId: string; userId: string }

export async function listExpenseClaims(ctx: { orgId: string }, filters?: { userId?: string; status?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(hrExpenseClaims.orgId, ctx.orgId)]
    if (filters?.userId) conditions.push(eq(hrExpenseClaims.userId, filters.userId))
    if (filters?.status) conditions.push(eq(hrExpenseClaims.status, filters.status as typeof hrExpenseClaims.$inferSelect.status))
    return db.query.hrExpenseClaims.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function createExpenseClaim(
  ctx: HrExpenseContext,
  input: { category: string; amount: number; expenseDate: string; description?: string; receiptUrl?: string; companyId?: string }
) {
  if (!input.category?.trim()) throw new ServiceError("category is required", 400)
  if (!input.amount || input.amount <= 0) throw new ServiceError("amount must be greater than 0", 400)
  if (!input.expenseDate) throw new ServiceError("expenseDate is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [created] = await db.insert(hrExpenseClaims).values({
      orgId: ctx.orgId, userId: ctx.userId, companyId: input.companyId,
      category: input.category, amount: input.amount.toString(), expenseDate: input.expenseDate,
      description: input.description, receiptUrl: input.receiptUrl,
    }).returning()
    return created
  })
}

export async function decideExpenseClaim(
  ctx: HrExpenseContext,
  claimId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.hrExpenseClaims.findFirst({ where: and(eq(hrExpenseClaims.id, claimId), eq(hrExpenseClaims.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Expense claim not found", 404)
    if (existing.status !== "pending") throw new ServiceError("Only a pending claim can be approved or rejected", 400)
    if (decision === "rejected" && !rejectionReason?.trim()) throw new ServiceError("rejectionReason is required when rejecting", 400)

    const [updated] = await db.update(hrExpenseClaims).set({
      status: decision, approverId: ctx.userId, approvedAt: new Date(),
      rejectionReason: decision === "rejected" ? rejectionReason : null,
      updatedAt: new Date(),
    }).where(eq(hrExpenseClaims.id, claimId)).returning()
    return updated
  })
}
