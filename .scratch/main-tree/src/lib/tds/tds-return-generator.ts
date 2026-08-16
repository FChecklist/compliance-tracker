// Compiles real, filing-ready data for Form 26Q (TDS on non-salary payments
// to residents) and Form 24Q (TDS on salary) from actual per-transaction TDS
// already computed and stored elsewhere in the ERP (erp_purchase_invoices.
// tds_amount via computeVendorTds(), erp_payslip_lines' "TDS..." deduction
// line via the payroll TDS projection) -- this module only aggregates and
// shapes that real data into the field structure NSDL/TRACES' quarterly
// e-TDS return (Form 27A + FVU) actually requires (a public government
// spec). Deliberately stops at data compilation: no challan-payment
// tracking exists anywhere in this codebase yet, so BSR code/challan serial
// number/deposit date are left null for the CA to fill in from their own
// challan records, same honest boundary as every other filing-ready
// generator in this codebase (GST return-generator.ts, mca-form-generator.ts).
export type Form26QDeducteeInput = { supplierName: string; pan: string | null; section: string | null; taxableAmount: number; tdsAmount: number; invoiceDate: string }
export type Form24QDeducteeInput = { employeeName: string; pan: string | null; month: number; grossEarnings: number; tdsAmount: number }

export function generateForm26Q(quarter: string, financialYear: string, deductorTan: string | null, rows: Form26QDeducteeInput[]) {
  const byDeductee = new Map<string, { supplierName: string; pan: string | null; section: string | null; totalTaxable: number; totalTds: number; transactions: { invoiceDate: string; taxableAmount: number; tdsAmount: number }[] }>()
  for (const row of rows) {
    const key = `${row.pan ?? row.supplierName}|${row.section ?? ""}`
    const existing = byDeductee.get(key) ?? { supplierName: row.supplierName, pan: row.pan, section: row.section, totalTaxable: 0, totalTds: 0, transactions: [] }
    existing.totalTaxable += row.taxableAmount
    existing.totalTds += row.tdsAmount
    existing.transactions.push({ invoiceDate: row.invoiceDate, taxableAmount: row.taxableAmount, tdsAmount: row.tdsAmount })
    byDeductee.set(key, existing)
  }
  const deductees = Array.from(byDeductee.values())
  return {
    formType: "26Q",
    quarter, financialYear,
    deductor: { tan: deductorTan },
    challanDetails: { note: "No challan-payment tracking exists yet -- BSR code, challan serial number, and deposit date must be filled in from the CA's own TDS challan records before filing." },
    deductees,
    summary: { deducteeCount: deductees.length, totalTaxableAmount: deductees.reduce((s, d) => s + d.totalTaxable, 0), totalTdsAmount: deductees.reduce((s, d) => s + d.totalTds, 0) },
  }
}

export function generateForm24Q(quarter: string, financialYear: string, deductorTan: string | null, rows: Form24QDeducteeInput[]) {
  const byEmployee = new Map<string, { employeeName: string; pan: string | null; monthlyBreakup: { month: number; grossEarnings: number; tdsAmount: number }[]; totalGross: number; totalTds: number }>()
  for (const row of rows) {
    const key = row.pan ?? row.employeeName
    const existing = byEmployee.get(key) ?? { employeeName: row.employeeName, pan: row.pan, monthlyBreakup: [], totalGross: 0, totalTds: 0 }
    existing.monthlyBreakup.push({ month: row.month, grossEarnings: row.grossEarnings, tdsAmount: row.tdsAmount })
    existing.totalGross += row.grossEarnings
    existing.totalTds += row.tdsAmount
    byEmployee.set(key, existing)
  }
  const employees = Array.from(byEmployee.values())
  return {
    formType: "24Q",
    quarter, financialYear,
    deductor: { tan: deductorTan },
    challanDetails: { note: "No challan-payment tracking exists yet -- BSR code, challan serial number, and deposit date must be filled in from the CA's own TDS challan records before filing." },
    employees,
    summary: { employeeCount: employees.length, totalGrossEarnings: employees.reduce((s, e) => s + e.totalGross, 0), totalTdsAmount: employees.reduce((s, e) => s + e.totalTds, 0) },
  }
}

// Indian FY quarters: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
export function quarterDateRange(financialYearStart: number, quarter: 1 | 2 | 3 | 4): { start: string; end: string; label: string } {
  const ranges: Record<1 | 2 | 3 | 4, [string, string]> = {
    1: [`${financialYearStart}-04-01`, `${financialYearStart}-06-30`],
    2: [`${financialYearStart}-07-01`, `${financialYearStart}-09-30`],
    3: [`${financialYearStart}-10-01`, `${financialYearStart}-12-31`],
    4: [`${financialYearStart + 1}-01-01`, `${financialYearStart + 1}-03-31`],
  }
  const [start, end] = ranges[quarter]
  return { start, end, label: `Q${quarter} FY${financialYearStart}-${String(financialYearStart + 1).slice(2)}` }
}
