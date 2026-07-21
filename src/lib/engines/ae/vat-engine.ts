// VCEL UAE VAT Engine. UAE Federal Decree-Law No. 8 of 2017 (Value Added
// Tax) computations, as the second country's statute logic alongside
// src/lib/engines/in/gst-engine.ts. Rates/categories below are STATUTORY
// DATA THAT CHANGES BY FTA CABINET DECISION -- isolated in named constants
// (not scattered through the formulas) specifically so they're a one-place
// update, not a rewrite, when the FTA amends a rate or re-scopes a
// category. Do NOT treat the values below as permanently current -- verify
// against the latest FTA Cabinet Decision / public clarification before
// relying on this for a live filing.
//
// Structural difference from India's GST engine (why UAE gets its own file
// rather than a config flag on gst-engine.ts): UAE VAT is a SINGLE national
// 5% rate with NO CGST/SGST/IGST split (UAE is one tax territory -- there is
// no inter-state vs intra-state distinction, no state codes, no UTGST). The
// shape of the result and the inputs genuinely differ, so a separate engine
// is correct rather than a boolean-flagged branch in India's engine.
import Decimal from "decimal.js"
import type { CalculationBreakdown } from "@/lib/engines/breakdown"

// FTA Cabinet Decision No. 52 of 2017 (as amended) -- the standard UAE VAT
// rate. Single national rate; no reduced rates, no separate inter-state rate.
const VAT_STANDARD_RATE_PERCENT = 5

// Categories that are zero-rated (0% VAT but input tax still recoverable) per
// Decree-Law Art. 45 -- exports of goods/services, international transport,
// certain education/healthcare, first sale of residential property, etc.
// Kept as a Set so isZeroRated() is O(1) and so adding a FTA-notified category
// is a one-line append.
const ZERO_RATED_SUPPLY_CATEGORIES = new Set<string>([
  "export_of_goods",
  "export_of_services",
  "international_transport",
  "international_passenger_transport",
  "first_sale_residential_property",
  "education", // nurseries/pre-school/school/higher-ed operated by recognised bodies
  "healthcare", // preventive/basic treatment by licensed providers
  "precious_metals_investment", // investment-grade gold/silver (Cabinet Decision 52/2017 Art. 14)
])

// Categories that are exempt (no VAT charged AND input tax on related costs is
// NOT recoverable) per Decree-Law Art. 46 -- certain financial services,
// residential rent (other than first sale), bare land sale, local passenger
// transport. Distinct from zero-rated: exempt supplies break the input-tax
// recovery chain.
const EXEMPT_SUPPLY_CATEGORIES = new Set<string>([
  "financial_services_specified",
  "residential_rent",
  "bare_land_sale",
  "local_passenger_transport",
])

export type VatSupplyType = "standard_rated" | "zero_rated" | "exempt"

export type VatCalcInput = {
  taxableAmount: number
  supplyCategory?: string // free-text FTA category key, e.g. "export_of_goods"
  amountIsInclusive?: boolean // true => taxableAmount is VAT-inclusive
}

export type VatCalcResult = {
  supplyType: VatSupplyType
  ratePercent: number
  taxableAmount: number
  vatAmount: number
  totalAmount: number
  // Calculation Explainability (same convention as India's income-tax/gst
  // engines, added 2026-07-18): optional, additive -- existing callers
  // checking only the fields above are unaffected.
  breakdown?: CalculationBreakdown
}

/**
 * Resolve the supply type for a category: zero-rated / exempt / standard.
 * Default (unknown or un-supplied category) is standard-rated 5% -- this is
 * the FTA's own default position (everything is standard-rated unless
 * explicitly notified otherwise), NOT a fabricated guess.
 */
export function resolveSupplyType(supplyCategory?: string): VatSupplyType {
  const cat = supplyCategory?.trim()
  if (cat && ZERO_RATED_SUPPLY_CATEGORIES.has(cat)) return "zero_rated"
  if (cat && EXEMPT_SUPPLY_CATEGORIES.has(cat)) return "exempt"
  return "standard_rated"
}

/**
 * UAE VAT Calculator. Applies the single 5% national rate to standard-rated
 * supplies, returns 0 tax for zero-rated (with recoverable input noted) and
 * exempt (with input NOT recoverable). Handles inclusive/exclusive amounts
 * the same way India's gst-engine does (gstInclusiveToTaxable pattern).
 */
export function calculateVat(input: VatCalcInput): VatCalcResult {
  if (input.taxableAmount < 0) throw new Error("taxableAmount must be non-negative")
  const supplyType = resolveSupplyType(input.supplyCategory)
  const rate = supplyType === "standard_rated" ? VAT_STANDARD_RATE_PERCENT : 0

  const amount = new Decimal(input.taxableAmount)
  let taxable: Decimal
  let vat: Decimal
  if (input.amountIsInclusive && supplyType === "standard_rated") {
    // back-calculate taxable from an inclusive amount (same algebra as
    // gst-engine.ts's gstInclusiveToTaxable)
    taxable = amount.div(new Decimal(1).plus(new Decimal(rate).div(100)))
    vat = amount.minus(taxable)
  } else {
    taxable = amount
    vat = amount.mul(rate).div(100)
  }

  const total = taxable.plus(vat)

  const rateLabel = supplyType === "standard_rated" ? `${rate}% standard` : supplyType
  return {
    supplyType,
    ratePercent: rate,
    taxableAmount: round2(taxable),
    vatAmount: round2(vat),
    totalAmount: round2(total),
    breakdown: {
      steps: [
        { label: `Supply type (${input.supplyCategory ?? "standard"})`, value: rateLabel },
        ...(input.amountIsInclusive && supplyType === "standard_rated"
          ? [{ label: "Taxable (back-calculated from inclusive)", formula: `${input.taxableAmount} / (1 + ${rate}%)`, value: round2(taxable) }]
          : []),
        { label: `VAT @ ${rate}%`, formula: supplyType === "standard_rated" ? `${round2(taxable)} x ${rate}%` : "not applicable", value: round2(vat) },
        { label: "Total amount", formula: `${round2(taxable)} + ${round2(vat)}`, value: round2(total) },
      ],
    },
  }
}

/**
 * Input Tax Recovery Engine (Art. 53-56): input VAT paid on purchases is
 * recoverable in proportion to taxable (standard+zero-rated) supplies, NOT
 * for exempt supplies. This is the structural reason the codebase keeps
 * zero-rated and exempt as distinct supply types (see resolveSupplyType).
 * Apportioned recovery is the standard partial-exemption method.
 */
export function recoverableInputVat(input: {
  inputVatPaid: number
  taxableSuppliesValue: number
  exemptSuppliesValue: number
}): { recoverableInputVat: number; nonRecoverableInputVat: number } {
  if (input.inputVatPaid < 0) throw new Error("inputVatPaid must be non-negative")
  const total = new Decimal(input.taxableSuppliesValue).plus(input.exemptSuppliesValue)
  if (total.lte(0)) {
    return { recoverableInputVat: 0, nonRecoverableInputVat: round2(new Decimal(input.inputVatPaid)) }
  }
  const recoverableRatio = new Decimal(input.taxableSuppliesValue).div(total)
  const recoverable = new Decimal(input.inputVatPaid).mul(recoverableRatio)
  return {
    recoverableInputVat: round2(recoverable),
    nonRecoverableInputVat: round2(new Decimal(input.inputVatPaid).minus(recoverable)),
  }
}

/**
 * Reverse Charge (Art. 48): for imported services / certain designated goods,
 * the recipient (not the supplier) accounts for VAT. Same total as a forward
 * charge but the liability sits with the recipient.
 */
export function calculateReverseChargeVat(taxableAmount: number, supplyCategory?: string): { vatAmount: number; payableBy: "recipient" | "supplier" } {
  const base = calculateVat({ taxableAmount, supplyCategory })
  return { vatAmount: base.vatAmount, payableBy: "recipient" }
}

/**
 * Late-payment penalty (Cabinet Decision 49/2017 Art. 7 as amended): 2%
 * immediate + 4% after 7 days, capped at 300% of the unpaid tax. Simple
  flat-rate model here for the common case; verify the current penalty
  schedule before relying on this for a live assessment.
 */
export function calculateVatLatePaymentPenalty(input: { unpaidTax: number; daysLate: number }): { immediatePenalty: number; furtherPenalty: number; totalPenalty: number } {
  const tax = new Decimal(Math.max(0, input.unpaidTax))
  const immediate = tax.mul(2).div(100)
  const further = input.daysLate > 7 ? tax.mul(4).div(100) : new Decimal(0)
  const total = Decimal.min(immediate.plus(further), tax.mul(300).div(100))
  return { immediatePenalty: round2(immediate), furtherPenalty: round2(further), totalPenalty: round2(total) }
}

/**
 * TRN (Tax Registration Number) format validation. UAE TRNs are 15 digits;
  the FTA publishes a modulus-weights checksum (similar in spirit to GSTIN's
  last-digit check). The digit-length + all-numeric check is verifiable from
  the public format spec; the FTA's full checksum is implementation-detail and
  treated as format-only here (same honesty boundary as India's
  isValidHsnFormat / isValidEwayBillNumberFormat).
 */
export function isValidTrnFormat(trn: string): boolean {
  return /^[0-9]{15}$/.test(trn?.trim() ?? "")
}

/**
 * VAT Return Validation Engine -- structural checks before an FTA return
  submission (same shape as India's validateGstReturn, country-specific fields).
 */
export function validateVatReturn(returnData: { trn: string; period: string; totalStandardRatedSales: number; totalOutputVat: number; lineItems: unknown[] }): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!returnData.trn) errors.push("TRN is required")
  else if (!isValidTrnFormat(returnData.trn)) errors.push("TRN must be 15 digits")
  if (!returnData.period) errors.push("Return period is required")
  if (returnData.totalStandardRatedSales < 0) errors.push("totalStandardRatedSales cannot be negative")
  if (returnData.totalOutputVat < 0) errors.push("totalOutputVat cannot be negative")
  if (!returnData.lineItems?.length) errors.push("At least one line item is required")
  return { valid: errors.length === 0, errors }
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
