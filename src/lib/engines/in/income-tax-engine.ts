// VCEL Income Tax Engine. Indian Income Tax Act computations. Slab rates are
// STATUTORY DATA THAT CHANGES EVERY UNION BUDGET -- they are isolated in
// TAX_SLABS_NEW_REGIME below (not scattered through the formulas) specifically
// so they're a one-place update, not a rewrite, when a new Finance Act passes.
// Do NOT treat the rates below as permanently current -- verify against the
// latest Finance Act before relying on this for a live filing.
import Decimal from "decimal.js"
import type { CalculationBreakdown } from "@/lib/engines/breakdown"

// New tax regime slabs (default regime from FY 2023-24 onward), as of Budget 2026.
const TAX_SLABS_NEW_REGIME: { upTo: number; rate: number }[] = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 5 },
  { upTo: 1200000, rate: 10 },
  { upTo: 1600000, rate: 15 },
  { upTo: 2000000, rate: 20 },
  { upTo: 2400000, rate: 25 },
  { upTo: Infinity, rate: 30 },
]
const HEALTH_EDUCATION_CESS_PERCENT = 4
const SECTION_87A_REBATE_LIMIT_INCOME = 1200000 // full rebate up to this income under new regime
const SECTION_87A_MAX_REBATE = 60000

export type IncomeTaxResult = {
  grossTax: number; rebate87A: number; taxAfterRebate: number; cess: number; totalTaxPayable: number
  // Calculation Explainability (VERIDIAN Review Framework gap closure,
  // 2026-07-18): optional so every existing caller checking only the
  // fields above is unaffected. Populated with the real per-slab
  // computation plus the rebate/cess steps, not a re-derivation.
  breakdown?: CalculationBreakdown
}

// 1. Income Tax Calculator
export function calculateIncomeTax(taxableIncome: number, slabs: { upTo: number; rate: number }[] = TAX_SLABS_NEW_REGIME): IncomeTaxResult {
  if (taxableIncome < 0) throw new Error("taxableIncome must be non-negative")

  let tax = new Decimal(0)
  let lowerBound = 0
  const slabSteps: { label: string; formula?: string; value: number }[] = []
  for (const slab of slabs) {
    if (taxableIncome <= lowerBound) break
    const slabIncome = Math.min(taxableIncome, slab.upTo) - lowerBound
    const slabTax = new Decimal(slabIncome).mul(slab.rate).div(100)
    tax = tax.plus(slabTax)
    const upper = slab.upTo === Infinity ? "and above" : slab.upTo.toLocaleString("en-IN")
    slabSteps.push({
      label: `Slab ${lowerBound.toLocaleString("en-IN")}-${upper} @ ${slab.rate}%`,
      formula: `${slabIncome.toLocaleString("en-IN")} x ${slab.rate}%`,
      value: round2(slabTax),
    })
    lowerBound = slab.upTo
  }

  const rebate = taxableIncome <= SECTION_87A_REBATE_LIMIT_INCOME ? Decimal.min(tax, SECTION_87A_MAX_REBATE) : new Decimal(0)
  const afterRebate = tax.minus(rebate)
  const cess = afterRebate.mul(HEALTH_EDUCATION_CESS_PERCENT).div(100)

  return {
    grossTax: round2(tax), rebate87A: round2(rebate), taxAfterRebate: round2(afterRebate),
    cess: round2(cess), totalTaxPayable: round2(afterRebate.plus(cess)),
    breakdown: {
      steps: [
        ...slabSteps,
        { label: "Gross tax (sum of slabs)", value: round2(tax) },
        { label: "Section 87A rebate", value: round2(rebate) },
        { label: "Tax after rebate", formula: `${round2(tax)} - ${round2(rebate)}`, value: round2(afterRebate) },
        { label: `Health & Education Cess @ ${HEALTH_EDUCATION_CESS_PERCENT}%`, value: round2(cess) },
        { label: "Total tax payable", formula: `${round2(afterRebate)} + ${round2(cess)}`, value: round2(afterRebate.plus(cess)) },
      ],
    },
  }
}

// 2. Advance Tax Calculator -- Sec 211: 15%/45%/75%/100% cumulative by installment
const ADVANCE_TAX_CUMULATIVE_PERCENT = { q1: 15, q2: 45, q3: 75, q4: 100 } as const
export function calculateAdvanceTaxInstallment(estimatedAnnualTax: number, quarter: keyof typeof ADVANCE_TAX_CUMULATIVE_PERCENT, alreadyPaid: number): number {
  const cumulativeDue = new Decimal(estimatedAnnualTax).mul(ADVANCE_TAX_CUMULATIVE_PERCENT[quarter]).div(100)
  return round2(Decimal.max(0, cumulativeDue.minus(alreadyPaid)))
}

// 3. Self Assessment Tax Calculator -- Sec 140A: balance after TDS/advance tax + interest
export function calculateSelfAssessmentTax(totalTaxLiability: number, tdsDeducted: number, advanceTaxPaid: number, interestDue = 0): number {
  return round2(Decimal.max(0, new Decimal(totalTaxLiability).minus(tdsDeducted).minus(advanceTaxPaid).plus(interestDue)))
}

// 4. Interest Calculator (Income Tax) -- Sec 234A (late filing), 234B (short advance tax), 234C (deferred installment); 1% p.m. simple interest, standard rate across all three sections
export function calculateIncomeTaxInterest(unpaidAmount: number, monthsDelayed: number, section: "234A" | "234B" | "234C" = "234B"): number {
  void section // rate is the same 1%/month for all three; kept for caller clarity/reporting
  return round2(new Decimal(unpaidAmount).mul(1).div(100).mul(Math.max(0, Math.ceil(monthsDelayed))))
}

// 5. Penalty Calculator (Income Tax) -- Sec 234F: late filing fee (flat, not %-based)
export function calculateLateFilingPenalty(totalIncome: number, filedAfterDueDate: boolean): number {
  if (!filedAfterDueDate) return 0
  return totalIncome <= 500000 ? 1000 : 5000
}

// 6. Capital Gains Calculator -- Sec 111A/112A style flat-rate short/long term split
export function calculateCapitalGains(input: { saleValue: number; costOfAcquisition: number; costOfImprovement?: number; expensesOnTransfer?: number; isLongTerm: boolean; assetType?: "equity" | "other" }): { capitalGain: number; taxRatePercent: number; tax: number } {
  const gain = new Decimal(input.saleValue)
    .minus(input.costOfAcquisition).minus(input.costOfImprovement ?? 0).minus(input.expensesOnTransfer ?? 0)
  const rate = input.isLongTerm ? (input.assetType === "equity" ? 12.5 : 20) : (input.assetType === "equity" ? 20 : 30)
  return { capitalGain: round2(gain), taxRatePercent: rate, tax: round2(Decimal.max(0, gain).mul(rate).div(100)) }
}

// 7. Indexation Calculator -- CII-based cost inflation for LTCG on non-equity assets
export function calculateIndexedCost(originalCost: number, costInflationIndexAtPurchase: number, costInflationIndexAtSale: number): number {
  if (costInflationIndexAtPurchase <= 0) throw new Error("costInflationIndexAtPurchase must be positive")
  return round2(new Decimal(originalCost).mul(costInflationIndexAtSale).div(costInflationIndexAtPurchase))
}

// 8. MAT Calculator -- Sec 115JB: companies pay higher of normal tax or 15% of book profit
export function calculateMat(bookProfit: number, normalTaxLiability: number): { matLiability: number; taxPayable: number; matApplicable: boolean } {
  const mat = new Decimal(bookProfit).mul(15).div(100)
  const applicable = mat.gt(normalTaxLiability)
  return { matLiability: round2(mat), taxPayable: applicable ? round2(mat) : round2(new Decimal(normalTaxLiability)), matApplicable: applicable }
}

// 9. AMT Calculator -- Sec 115JC: non-corporate taxpayers claiming certain deductions pay higher of normal tax or 18.5% of adjusted total income
export function calculateAmt(adjustedTotalIncome: number, normalTaxLiability: number): { amtLiability: number; taxPayable: number; amtApplicable: boolean } {
  const amt = new Decimal(adjustedTotalIncome).mul(18.5).div(100)
  const applicable = amt.gt(normalTaxLiability)
  return { amtLiability: round2(amt), taxPayable: applicable ? round2(amt) : round2(new Decimal(normalTaxLiability)), amtApplicable: applicable }
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
