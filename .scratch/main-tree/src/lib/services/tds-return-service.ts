// Aggregates real, already-computed TDS data (erp_purchase_invoices.
// tds_amount, erp_payslip_lines' TDS deduction line) into Form 26Q/24Q
// quarterly return data -- see tds-return-generator.ts for the pure
// shaping functions and its header comment for the challan-tracking gap.
// Computed at read time, not persisted -- same posture as
// erp-financial-report-service.ts's balanceSheet/profitAndLoss (a report,
// not a stored document).
import { erpPurchaseInvoices, erpSuppliers, erpTaxWithholdingCategories, erpPayslips, erpPayrollRuns, erpPayslipLines, employeeProfiles, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, lte, gt, inArray, like } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { generateForm26Q, generateForm24Q, quarterDateRange, type Form26QDeducteeInput, type Form24QDeducteeInput } from "@/lib/tds/tds-return-generator"

export { quarterDateRange }

export async function generateForm26QReport(ctx: { orgId: string }, financialYearStart: number, quarter: 1 | 2 | 3 | 4) {
  const { start, end, label } = quarterDateRange(financialYearStart, quarter)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpPurchaseInvoices.findMany({
      where: and(eq(erpPurchaseInvoices.orgId, ctx.orgId), eq(erpPurchaseInvoices.status, "submitted"), gte(erpPurchaseInvoices.postingDate, start), lte(erpPurchaseInvoices.postingDate, end), gt(erpPurchaseInvoices.tdsAmount, "0")),
    })
    if (invoices.length === 0) throw new ServiceError(`No TDS-withheld purchase invoices found for ${label}`, 400)

    const supplierIds = Array.from(new Set(invoices.map(i => i.supplierId)))
    const suppliers = await db.query.erpSuppliers.findMany({ where: inArray(erpSuppliers.id, supplierIds) })
    const supplierById = new Map(suppliers.map(s => [s.id, s]))

    const categoryIds = Array.from(new Set(suppliers.map(s => s.taxWithholdingCategoryId).filter((id): id is string => !!id)))
    const categories = categoryIds.length > 0 ? await db.query.erpTaxWithholdingCategories.findMany({ where: inArray(erpTaxWithholdingCategories.id, categoryIds) }) : []
    const categoryById = new Map(categories.map(c => [c.id, c]))

    const rows: Form26QDeducteeInput[] = invoices.map(inv => {
      const supplier = supplierById.get(inv.supplierId)
      const category = supplier?.taxWithholdingCategoryId ? categoryById.get(supplier.taxWithholdingCategoryId) : undefined
      return {
        supplierName: supplier?.supplierName ?? "Unknown supplier", pan: supplier?.panNumber ?? null, section: category?.categoryName ?? null,
        taxableAmount: Number(inv.subtotal), tdsAmount: Number(inv.tdsAmount), invoiceDate: inv.postingDate,
      }
    })

    return generateForm26Q(label, `${financialYearStart}-${financialYearStart + 1}`, null, rows)
  })
}

export async function generateForm24QReport(ctx: { orgId: string }, financialYearStart: number, quarter: 1 | 2 | 3 | 4) {
  const { start, end, label } = quarterDateRange(financialYearStart, quarter)
  const startMonth = new Date(start).getMonth() + 1, startYear = new Date(start).getFullYear()
  const endMonth = new Date(end).getMonth() + 1, endYear = new Date(end).getFullYear()

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const payrollRuns = await db.query.erpPayrollRuns.findMany({ where: eq(erpPayrollRuns.orgId, ctx.orgId) })
    const runsInQuarter = payrollRuns.filter(r => {
      const ym = r.year * 12 + r.month
      return ym >= startYear * 12 + startMonth && ym <= endYear * 12 + endMonth
    })
    if (runsInQuarter.length === 0) throw new ServiceError(`No payroll runs found for ${label}`, 400)

    const runIds = runsInQuarter.map(r => r.id)
    const runById = new Map(runsInQuarter.map(r => [r.id, r]))
    const payslips = await db.query.erpPayslips.findMany({ where: and(eq(erpPayslips.orgId, ctx.orgId), eq(erpPayslips.status, "finalized"), inArray(erpPayslips.payrollRunId, runIds)) })
    if (payslips.length === 0) throw new ServiceError(`No finalized payslips found for ${label}`, 400)

    const payslipIds = payslips.map(p => p.id)
    const tdsLines = await db.query.erpPayslipLines.findMany({ where: and(inArray(erpPayslipLines.payslipId, payslipIds), like(erpPayslipLines.label, "TDS%")) })
    const tdsByPayslip = new Map(tdsLines.map(l => [l.payslipId, Number(l.amount)]))

    const employeeIds = Array.from(new Set(payslips.map(p => p.employeeId)))
    const employeeRows = await db.query.employeeProfiles.findMany({ where: inArray(employeeProfiles.id, employeeIds) })
    const userIds = employeeRows.map(e => e.userId)
    const userRows = userIds.length > 0 ? await db.query.users.findMany({ where: inArray(users.id, userIds) }) : []
    const userById = new Map(userRows.map(u => [u.id, u]))
    const employeeById = new Map(employeeRows.map(e => [e.id, e]))

    const rows: Form24QDeducteeInput[] = payslips
      .map(p => {
        const tdsAmount = tdsByPayslip.get(p.id) ?? 0
        if (tdsAmount <= 0) return null
        const employee = employeeById.get(p.employeeId)
        const user = employee ? userById.get(employee.userId) : undefined
        const run = runById.get(p.payrollRunId)!
        return { employeeName: user?.name ?? "Unknown employee", pan: null, month: run.month, grossEarnings: Number(p.grossEarnings), tdsAmount } as Form24QDeducteeInput
      })
      .filter((r): r is Form24QDeducteeInput => r !== null)

    if (rows.length === 0) throw new ServiceError(`No employees had TDS withheld for ${label}`, 400)
    return generateForm24Q(label, `${financialYearStart}-${financialYearStart + 1}`, null, rows)
  })
}
