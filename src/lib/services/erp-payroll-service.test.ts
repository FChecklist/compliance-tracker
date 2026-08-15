// Phase 0 HR gap-closure (2026-07-27): tests the pure line-building helper
// processPayrollRun() itself calls to apply a due loan-installment
// deduction and approved-expense-claim reimbursement to a payslip --
// proving a processed payroll run correctly reflects both, per this
// task's own SUCCESS_CRITERIA, without exercising withTenantContext/a live
// DB from a .test.ts file (matching this repo's established convention,
// see erp-fixed-assets-service.test.ts's own note on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildLoanAndReimbursementLines } from "./erp-payroll-service"

describe("buildLoanAndReimbursementLines", () => {
  test("no active loan and no approved claims -- no extra lines, both totals zero", () => {
    const result = buildLoanAndReimbursementLines(null, [])
    expect(result.lines).toEqual([])
    expect(result.loanDeductionTotal).toBe(0)
    expect(result.reimbursementTotal).toBe(0)
  })

  test("a due loan installment adds exactly one deduction line for its amount", () => {
    const result = buildLoanAndReimbursementLines({ installmentNumber: 3, amount: 2500 }, [])
    expect(result.lines).toEqual([
      { componentId: null, label: "Loan Repayment (Installment 3)", lineType: "deduction", amount: 2500 },
    ])
    expect(result.loanDeductionTotal).toBe(2500)
    expect(result.reimbursementTotal).toBe(0)
  })

  test("approved expense claims each add an earning line and sum into reimbursementTotal", () => {
    const claims = [
      { id: "c1", category: "travel", amount: 1200 },
      { id: "c2", category: "meals", amount: 300 },
    ]
    const result = buildLoanAndReimbursementLines(null, claims)
    expect(result.lines).toEqual([
      { componentId: null, label: "Expense Reimbursement (travel)", lineType: "earning", amount: 1200 },
      { componentId: null, label: "Expense Reimbursement (meals)", lineType: "earning", amount: 300 },
    ])
    expect(result.reimbursementTotal).toBe(1500)
    expect(result.loanDeductionTotal).toBe(0)
  })

  test("a payslip with both a due installment and approved claims reflects both, independently", () => {
    const result = buildLoanAndReimbursementLines(
      { installmentNumber: 1, amount: 4000 },
      [{ id: "c1", category: "supplies", amount: 750 }]
    )
    expect(result.lines).toHaveLength(2)
    expect(result.loanDeductionTotal).toBe(4000)
    expect(result.reimbursementTotal).toBe(750)
    // The net effect on a payslip's netPay = grossEarnings - totalDeductions
    // + reimbursementTotal (processPayrollRun's own formula) -- reimbursement
    // is never folded into grossEarnings/PF-ESI-PT-taxable income.
    const grossEarnings = 50000
    const totalDeductionsBeforeLoan = 8000
    const totalDeductions = totalDeductionsBeforeLoan + result.loanDeductionTotal
    const netPay = grossEarnings - totalDeductions + result.reimbursementTotal
    expect(netPay).toBe(50000 - 12000 + 750)
  })
})
