// Phase 0 HR gap-closure (2026-07-27): Employee Loans / Salary Advances.
// Confirmed absent by grepping "loan"/"advance" across schema.ts before
// writing this file -- the only "loan" hit anywhere is a generic
// EMI/amortization calculation-engine tool, not an actual employee-loan
// ledger.
//
// Workflow: request (pending) -> approve (approved -- generates the full
// installment schedule up front, see createLoanInstallments below) ->
// erp-payroll-service.ts's processPayrollRun() deducts the next due
// installment on every processed run (active) -> outstandingBalance
// reaches 0 (closed).
import { hrEmployeeLoans, hrLoanInstallments, employeeProfiles } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type HrLoanContext = { orgId: string; userId: string }

/**
 * Pure helper (no DB access -- exported so it can be unit-tested directly,
 * matching this codebase's established convention): splits `principal`
 * into `numInstallments` equal installments, folding any rounding
 * remainder into the LAST installment so the sum always exactly equals the
 * principal (never silently over/under-collects a few cents/rupees across
 * the schedule).
 */
export function computeLoanInstallmentSchedule(principal: number, numInstallments: number): number[] {
  if (numInstallments < 1) throw new ServiceError("numInstallments must be at least 1", 400)
  const base = Math.floor((principal / numInstallments) * 100) / 100
  const installments = new Array(numInstallments).fill(base)
  const roundingRemainder = Math.round((principal - base * numInstallments) * 100) / 100
  installments[numInstallments - 1] = Math.round((base + roundingRemainder) * 100) / 100
  return installments
}

/**
 * Pure helper: given a loan's approval month/year, returns the [month,
 * year] pairs for each installment, starting the month AFTER approval (the
 * first payroll run following approval is when disbursement/deduction
 * actually begins) and rolling over into the next year past December.
 */
export function computeInstallmentDueDates(approvalMonth: number, approvalYear: number, numInstallments: number): { month: number; year: number }[] {
  const dueDates: { month: number; year: number }[] = []
  let month = approvalMonth
  let year = approvalYear
  for (let i = 0; i < numInstallments; i++) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
    dueDates.push({ month, year })
  }
  return dueDates
}

export async function listLoans(ctx: { orgId: string }, filters?: { employeeId?: string; status?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(hrEmployeeLoans.orgId, ctx.orgId)]
    if (filters?.employeeId) conditions.push(eq(hrEmployeeLoans.employeeId, filters.employeeId))
    if (filters?.status) conditions.push(eq(hrEmployeeLoans.status, filters.status as typeof hrEmployeeLoans.$inferSelect.status))
    return db.query.hrEmployeeLoans.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function listLoanInstallments(ctx: { orgId: string }, loanId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const loan = await db.query.hrEmployeeLoans.findFirst({ where: and(eq(hrEmployeeLoans.id, loanId), eq(hrEmployeeLoans.orgId, ctx.orgId)) })
    if (!loan) throw new ServiceError("Loan not found", 404)
    return db.query.hrLoanInstallments.findMany({ where: eq(hrLoanInstallments.loanId, loanId), orderBy: (t, { asc }) => asc(t.installmentNumber) })
  })
}

export async function requestLoan(
  ctx: HrLoanContext,
  input: { employeeId: string; loanType?: "loan" | "advance"; principalAmount: number; numInstallments: number; reason?: string }
) {
  if (!input.principalAmount || input.principalAmount <= 0) throw new ServiceError("principalAmount must be greater than 0", 400)
  if (!input.numInstallments || input.numInstallments < 1) throw new ServiceError("numInstallments must be at least 1", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const profile = await db.query.employeeProfiles.findFirst({ where: and(eq(employeeProfiles.id, input.employeeId), eq(employeeProfiles.orgId, ctx.orgId)) })
    if (!profile) throw new ServiceError("Employee profile not found", 404)
    const [created] = await db.insert(hrEmployeeLoans).values({
      orgId: ctx.orgId, employeeId: input.employeeId, loanType: input.loanType ?? "loan",
      principalAmount: input.principalAmount.toString(), numInstallments: input.numInstallments,
      reason: input.reason, createdById: ctx.userId,
    }).returning()
    return created
  })
}

export async function decideLoan(ctx: HrLoanContext, loanId: string, decision: "approved" | "rejected", rejectionReason?: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const loan = await db.query.hrEmployeeLoans.findFirst({ where: and(eq(hrEmployeeLoans.id, loanId), eq(hrEmployeeLoans.orgId, ctx.orgId)) })
    if (!loan) throw new ServiceError("Loan not found", 404)
    if (loan.status !== "pending") throw new ServiceError("Only a pending loan can be approved or rejected", 400)
    if (decision === "rejected" && !rejectionReason?.trim()) throw new ServiceError("rejectionReason is required when rejecting", 400)

    if (decision === "rejected") {
      const [updated] = await db.update(hrEmployeeLoans).set({
        status: "rejected", approverId: ctx.userId, approvedAt: new Date(), rejectionReason, updatedAt: new Date(),
      }).where(eq(hrEmployeeLoans.id, loanId)).returning()
      return updated
    }

    const principal = Number(loan.principalAmount)
    const schedule = computeLoanInstallmentSchedule(principal, loan.numInstallments)
    const now = new Date()
    const dueDates = computeInstallmentDueDates(now.getMonth() + 1, now.getFullYear(), loan.numInstallments)

    const [updated] = await db.update(hrEmployeeLoans).set({
      status: "approved", approverId: ctx.userId, approvedAt: now,
      installmentAmount: schedule[0].toString(), outstandingBalance: principal.toString(),
      disbursedAt: now, updatedAt: now,
    }).where(eq(hrEmployeeLoans.id, loanId)).returning()

    await db.insert(hrLoanInstallments).values(schedule.map((amount, i) => ({
      loanId, installmentNumber: i + 1, dueMonth: dueDates[i].month, dueYear: dueDates[i].year, amount: amount.toString(),
    })))

    // Approval immediately activates the loan -- the first payroll run
    // on/after this point deducts installment #1 (see
    // erp-payroll-service.ts's processPayrollRun), there is no separate
    // "disbursement" step distinct from approval in this pass.
    const [active] = await db.update(hrEmployeeLoans).set({ status: "active", updatedAt: new Date() }).where(eq(hrEmployeeLoans.id, loanId)).returning()
    return active ?? updated
  })
}
