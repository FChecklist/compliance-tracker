// VCEL UAE Corporate Tax Engine. UAE Federal Decree-Law No. 47 of 2022
// (Corporate Tax on Business Profits) computations, as the second country's
// statute logic alongside src/lib/engines/in/income-tax-engine.ts. Rates /
// thresholds below are STATUTORY DATA THAT CHANGES BY FTA CABINET DECISION /
// Ministerial Decision -- isolated in named constants (not scattered through
// the formulas) specifically so they're a one-place update, not a rewrite,
// when the FTA amends a rate or re-scopes a threshold. Do NOT treat the
// values below as permanently current -- verify against the latest FTA
// decision before relying on this for a live filing.
//
// Structural difference from India's income-tax engine (why UAE gets its own
// file rather than a config flag on income-tax-engine.ts): UAE Corporate Tax
// is a TWO-RATE national system (0% under the threshold, 9% above) with a
// separate Qualifying Free-Zone Person (QFZP) regime and a Pillar Two
// minimum-tax overlay -- NOT India's seven-slab progressive structure with a
// Section 87A rebate and a Health & Education Cess. The inputs, the rate
// logic, and the result shape genuinely differ, so a separate engine is
// correct rather than a boolean-flagged branch in India's engine.
import Decimal from "decimal.js"
import type { CalculationBreakdown } from "@/lib/engines/breakdown"
import { isValidTrnFormat } from "@/lib/engines/ae/vat-engine"

// Federal Decree-Law No. 47 of 2022 Art. 3 -- the 0% threshold: taxable
// income up to AED 375,000 is taxed at 0%. Introduced to shield small
// businesses; Cabinet Decision No. 49 of 2022 Art. 2 set this figure.
const CT_ZERO_RATE_THRESHOLD = 375000

// Federal Decree-Law No. 47 of 2022 Art. 3 -- the standard UAE Corporate
// Tax rate on taxable income above the threshold. Single national rate; no
// higher bands (unlike India's progressive slabs).
const CT_STANDARD_RATE_PERCENT = 9

// Art. 3(3) + Cabinet Decision No. 55 of 2023 -- Qualifying Free-Zone Persons
// (QFZPs) pay 0% on "Qualifying Income" and 9% on non-qualifying income. The
// 9% here is the same standard rate applied only to the non-qualifying slice.
const CT_QFZP_NON_QUALIFYING_RATE_PERCENT = 9

// Art. 4 -- Qualifying Income categories (illustrative, the FTA's exhaustive
// list): qualifying dividends and other distributions; qualifying capital
// gains; income from the provision of "Qualifying Activities" listed in the
// Cabinet Decision; income from ships/aircraft used internationally; etc.
const QUALIFYING_INCOME_CATEGORIES = new Set<string>([
  "qualifying_dividends",
  "qualifying_capital_gains",
  "qualifying_activity_income", // the Cabinet Decision's named activity list
  "international_transport_income",
  "qualifying_ip_income", // minor part of qualifying IP income, post-exclusion
])

// Pillar Two (OECD Model GloBE Rules), adopted in the UAE as a Domestic
// Minimum Top-up Tax (DMTT) per FTA guidance -- multinational enterprises
// (MNEs) with consolidated revenue >= EUR 750M pay a 15% effective minimum
// on their UAE profits where the blended rate falls below 15%. This is a
// top-up, not a replacement for the 9% above: the engine computes the 9%
// liability first, then the top-up only if the effective rate is under 15%
// AND the MNE revenue threshold is met.
const PILLAR_TWO_EFFECTIVE_MIN_RATE_PERCENT = 15
const PILLAR_TWO_MNE_REVENUE_THRESHOLD_EUR = 750_000_000

export type CtRegime = "standard" | "qualifying_free_zone"

export type CtCalcInput = {
  taxableIncome: number
  regime?: CtRegime
  // For QFZPs: the slice of income that is NOT "Qualifying Income" (taxed at
  // 9%); the rest is 0%. Ignored under the standard regime.
  nonQualifyingIncome?: number
  // Pillar Two overlay (optional -- only relevant for large MNEs).
  isMneSubjectToPillarTwo?: boolean
  mneConsolidatedRevenueEur?: number
}

export type CtCalcResult = {
  regime: CtRegime
  ratePercent: number // the marginal headline rate that applied
  taxableIncome: number
  taxBeforePillarTwo: number
  pillarTwoTopUp: number
  totalTaxPayable: number
  // Calculation Explainability (same convention as the income-tax / vat
  // engines, added 2026-07-18): optional, additive -- existing callers
  // checking only the fields above are unaffected.
  breakdown?: CalculationBreakdown
}

/**
 * UAE Corporate Tax Calculator. Standard regime: 0% up to AED 375,000, 9%
 * above. QFZP regime: 0% on qualifying income, 9% on the non-qualifying
 * slice (no threshold on the non-qualifying slice -- the threshold is a
 * standard-regime relief). Pillar Two top-up applies only to in-scope MNEs
 * whose effective UAE rate is under 15%.
 */
export function calculateCorporateTax(input: CtCalcInput): CtCalcResult {
  if (input.taxableIncome < 0) throw new Error("taxableIncome must be non-negative")
  const regime = input.regime ?? "standard"

  let tax: Decimal
  let headlineRate: number
  const steps: { label: string; formula?: string; value: number | string }[] = []

  if (regime === "qualifying_free_zone") {
    const nonQualifying = Math.max(0, input.nonQualifyingIncome ?? 0)
    if (nonQualifying > input.taxableIncome) {
      throw new Error("nonQualifyingIncome cannot exceed taxableIncome")
    }
    headlineRate = CT_QFZP_NON_QUALIFYING_RATE_PERCENT
    tax = new Decimal(nonQualifying).mul(CT_QFZP_NON_QUALIFYING_RATE_PERCENT).div(100)
    steps.push(
      { label: "Regime", value: "Qualifying Free-Zone Person (Art. 4)" },
      { label: "Qualifying income (0%)", formula: `${round2(new Decimal(input.taxableIncome).minus(nonQualifying))} @ 0%`, value: 0 },
      { label: "Non-qualifying income (9%)", formula: `${round2(new Decimal(nonQualifying))} x ${CT_QFZP_NON_QUALIFYING_RATE_PERCENT}%`, value: round2(tax) },
    )
  } else {
    // Standard regime: 0% under the threshold, 9% only on the excess.
    const aboveThreshold = Math.max(0, input.taxableIncome - CT_ZERO_RATE_THRESHOLD)
    headlineRate = CT_STANDARD_RATE_PERCENT
    tax = new Decimal(aboveThreshold).mul(CT_STANDARD_RATE_PERCENT).div(100)
    steps.push(
      { label: "Regime", value: "Standard (Art. 3)" },
      { label: `Taxable income up to AED ${CT_ZERO_RATE_THRESHOLD.toLocaleString("en-IN")} (0%)`, formula: `${Math.min(input.taxableIncome, CT_ZERO_RATE_THRESHOLD).toLocaleString("en-IN")} @ 0%`, value: 0 },
      { label: `Taxable income above AED ${CT_ZERO_RATE_THRESHOLD.toLocaleString("en-IN")} (${CT_STANDARD_RATE_PERCENT}%)`, formula: `${round2(new Decimal(aboveThreshold)).toLocaleString("en-IN")} x ${CT_STANDARD_RATE_PERCENT}%`, value: round2(tax) },
    )
  }

  // Pillar Two top-up: only for in-scope MNEs whose effective rate is below
  // the 15% minimum. The top-up brings the effective rate up to 15% on the
  // full taxable income (a floor, not an additional layer).
  let topUp = new Decimal(0)
  if (input.isMneSubjectToPillarTwo && (input.mneConsolidatedRevenueEur ?? 0) >= PILLAR_TWO_MNE_REVENUE_THRESHOLD_EUR) {
    const effectiveRate = input.taxableIncome > 0 ? tax.div(input.taxableIncome).mul(100) : new Decimal(0)
    if (effectiveRate.lt(PILLAR_TWO_EFFECTIVE_MIN_RATE_PERCENT)) {
      const minTax = new Decimal(input.taxableIncome).mul(PILLAR_TWO_EFFECTIVE_MIN_RATE_PERCENT).div(100)
      topUp = Decimal.max(0, minTax.minus(tax))
      steps.push(
        { label: "Pillar Two check (MNE >= EUR 750M)", formula: `effective ${round2(effectiveRate)}% < ${PILLAR_TWO_EFFECTIVE_MIN_RATE_PERCENT}%`, value: "top-up applies" },
        { label: `Pillar Two top-up to ${PILLAR_TWO_EFFECTIVE_MIN_RATE_PERCENT}% effective`, formula: `${round2(minTax)} - ${round2(tax)}`, value: round2(topUp) },
      )
    } else {
      steps.push({ label: "Pillar Two check", formula: `effective ${round2(effectiveRate)}% >= ${PILLAR_TWO_EFFECTIVE_MIN_RATE_PERCENT}%`, value: "no top-up" })
    }
  }

  const total = tax.plus(topUp)
  steps.push({ label: "Total tax payable", formula: `${round2(tax)} + ${round2(topUp)}`, value: round2(total) })

  return {
    regime,
    ratePercent: headlineRate,
    taxableIncome: input.taxableIncome,
    taxBeforePillarTwo: round2(tax),
    pillarTwoTopUp: round2(topUp),
    totalTaxPayable: round2(total),
    breakdown: { steps },
  }
}

/**
 * Qualifying Income classifier (Art. 4) -- mirrors the vat-engine's
 * resolveSupplyType pattern: a category set, default false. Used by callers
 * that want to split a QFZP's income into qualifying vs non-qualifying slices
 * before calling calculateCorporateTax with nonQualifyingIncome.
 */
export function isQualifyingIncome(incomeCategory?: string): boolean {
  const cat = incomeCategory?.trim()
  return cat ? QUALIFYING_INCOME_CATEGORIES.has(cat) : false
}

/**
 * Late-filing / late-payment penalty (Cabinet Decision No. 49 of 2022 Art. 9
 * as amended): a fixed AED amount for failure to file/notify, distinct from
 * the unpaid-tax-based penalty. The figures below are the standard notified
 * fixed amounts for the common failure-to-file case; verify the current
 * schedule (which varies by breach type and amendment date) before relying
 * on this for a live assessment.
 */
export function calculateCtLateFilingPenalty(input: { unpaidTax: number; daysLate: number }): { immediatePenalty: number; totalPenalty: number } {
  const tax = new Decimal(Math.max(0, input.unpaidTax))
  // Fixed AED 500 immediate for failure to file + AED 50/day, capped at 10x
  // the unpaid tax (Art. 9's standard cap pattern -- penalties don't exceed a
  // multiple of the underlying tax).
  const immediate = new Decimal(500)
  const perDay = new Decimal(50).mul(Math.max(0, Math.ceil(input.daysLate)))
  const cap = tax.mul(10)
  const total = Decimal.min(immediate.plus(perDay), cap)
  return { immediatePenalty: round2(immediate), totalPenalty: round2(total) }
}

/**
 * Corporate Tax Return Validation Engine -- structural checks before an FTA
 * return submission (same shape as the vat/gst engines' validate*Return,
 * country-specific fields). Reuses isValidTrnFormat from the VAT engine so
 * the 15-digit TRN check lives in one place across the UAE tax types.
 */
export function validateCorporateTaxReturn(returnData: { trn: string; period: string; totalTaxableIncome: number; totalTaxPayable: number; lineItems: unknown[] }): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!returnData.trn) errors.push("TRN is required")
  else if (!isValidTrnFormat(returnData.trn)) errors.push("TRN must be 15 digits")
  if (!returnData.period) errors.push("Return period is required")
  if (returnData.totalTaxableIncome < 0) errors.push("totalTaxableIncome cannot be negative")
  if (returnData.totalTaxPayable < 0) errors.push("totalTaxPayable cannot be negative")
  if (!returnData.lineItems?.length) errors.push("At least one line item is required")
  return { valid: errors.length === 0, errors }
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
