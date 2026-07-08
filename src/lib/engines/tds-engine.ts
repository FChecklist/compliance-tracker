// VCEL TDS/TCS Engine -- remaining engines (tds_calculator/payroll TDS is
// already implemented in erp-payroll-service.ts:computeAnnualTds). Section
// rates below are statutory data (Finance Act) -- isolated in
// TDS_SECTION_RATES for one-place updates; verify against the current
// Finance Act before relying on this for a live filing.
import Decimal from "decimal.js"

export const TDS_SECTION_RATES: Record<string, { ratePercent: number; thresholdAmount: number; description: string }> = {
  "194A": { ratePercent: 10, thresholdAmount: 40000, description: "Interest other than securities" },
  "194C": { ratePercent: 2, thresholdAmount: 30000, description: "Payment to contractors" },
  "194H": { ratePercent: 5, thresholdAmount: 15000, description: "Commission or brokerage" },
  "194I": { ratePercent: 10, thresholdAmount: 240000, description: "Rent (land/building/furniture)" },
  "194J": { ratePercent: 10, thresholdAmount: 30000, description: "Professional/technical fees" },
  "194Q": { ratePercent: 0.1, thresholdAmount: 5000000, description: "Purchase of goods" },
}

// 1. TCS Calculator -- Sec 206C, standard flat-rate sale-value collection
export function calculateTcs(saleValue: number, ratePercent: number, thresholdAmount = 0): { tcsAmount: number; applicableValue: number } {
  const applicableValue = Math.max(0, saleValue - thresholdAmount)
  return { tcsAmount: round2(new Decimal(applicableValue).mul(ratePercent).div(100)), applicableValue }
}

// 2. Threshold Checker -- is this payment above the section's TDS threshold?
export function isTdsApplicable(section: string, cumulativePaymentAmount: number): boolean {
  const rule = TDS_SECTION_RATES[section]
  if (!rule) throw new Error(`Unknown TDS section: ${section}`)
  return cumulativePaymentAmount >= rule.thresholdAmount
}

// 3. Section Validation Engine -- computes TDS if applicable, else 0
export function computeTdsForSection(section: string, paymentAmount: number, cumulativePaymentAmount: number, hasPan = true): { tdsAmount: number; ratePercent: number; applicable: boolean } {
  const rule = TDS_SECTION_RATES[section]
  if (!rule) throw new Error(`Unknown TDS section: ${section}`)
  const applicable = cumulativePaymentAmount >= rule.thresholdAmount
  // Sec 206AA: 20% flat rate (or section rate if higher) when payee has no PAN on file.
  const rate = !hasPan ? Math.max(rule.ratePercent, 20) : rule.ratePercent
  return { tdsAmount: applicable ? round2(new Decimal(paymentAmount).mul(rate).div(100)) : 0, ratePercent: rate, applicable }
}

// 4. Interest Engine (TDS) -- Sec 201(1A): 1%/month for late deduction, 1.5%/month for late deposit
export function calculateTdsInterest(tdsAmount: number, monthsDelayed: number, delayType: "late_deduction" | "late_deposit"): number {
  const rate = delayType === "late_deduction" ? 1 : 1.5
  return round2(new Decimal(tdsAmount).mul(rate).div(100).mul(Math.max(0, Math.ceil(monthsDelayed))))
}

// 5. Challan Matching Engine -- matches deducted TDS entries against paid challans by amount+period
export function matchTdsChallans(
  deductions: { id: string; period: string; amount: number }[],
  challans: { id: string; period: string; amount: number }[]
): { matched: { deductionId: string; challanId: string }[]; unmatchedDeductions: string[]; unmatchedChallans: string[] } {
  const matched: { deductionId: string; challanId: string }[] = []
  const usedChallans = new Set<string>()
  const unmatchedDeductions: string[] = []
  for (const d of deductions) {
    const challan = challans.find((c) => !usedChallans.has(c.id) && c.period === d.period && new Decimal(c.amount).minus(d.amount).abs().lt(0.01))
    if (!challan) { unmatchedDeductions.push(d.id); continue }
    usedChallans.add(challan.id)
    matched.push({ deductionId: d.id, challanId: challan.id })
  }
  const unmatchedChallans = challans.filter((c) => !usedChallans.has(c.id)).map((c) => c.id)
  return { matched, unmatchedDeductions, unmatchedChallans }
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
