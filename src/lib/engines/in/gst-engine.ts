// VCEL GST Engine (computation_engines: gst_split_engine, gst_calculation_engine,
// cgst_engine, sgst_engine, igst_engine). Deterministic CGST/SGST vs IGST split
// based on supplier/buyer state codes -- the actual computation the existing
// erp-invoicing-service.ts tax-template system does NOT do (it's user-configured
// tax lines, not a computed split). GSTIN's first 2 digits are the state code
// (standard GSTN convention), used here rather than a separate state field.
import Decimal from "decimal.js"
import type { CalculationBreakdown } from "@/lib/engines/breakdown"

export type GstSplitInput = { taxableAmount: number; gstRatePercent: number; supplierStateCode: string; buyerStateCode: string }
export type GstSplitResult = {
  cgst: number; sgst: number; igst: number; totalTax: number; totalAmount: number; isInterState: boolean
  // Calculation Explainability (VERIDIAN Review Framework gap closure,
  // 2026-07-18): optional, additive -- see income-tax-engine.ts's
  // IncomeTaxResult for the same convention.
  breakdown?: CalculationBreakdown
}

export function splitGst(input: GstSplitInput): GstSplitResult {
  const { taxableAmount, gstRatePercent, supplierStateCode, buyerStateCode } = input
  if (taxableAmount < 0) throw new Error("taxableAmount must be non-negative")
  if (gstRatePercent < 0) throw new Error("gstRatePercent must be non-negative")

  const amount = new Decimal(taxableAmount)
  const totalTax = amount.mul(gstRatePercent).div(100)
  const isInterState = supplierStateCode?.trim() !== buyerStateCode?.trim()

  if (isInterState) {
    return {
      cgst: 0, sgst: 0, igst: round2(totalTax),
      totalTax: round2(totalTax), totalAmount: round2(amount.plus(totalTax)), isInterState: true,
      breakdown: {
        steps: [
          { label: "Total GST (inter-state, IGST only)", formula: `${taxableAmount} x ${gstRatePercent}%`, value: round2(totalTax) },
          { label: "IGST", value: round2(totalTax) },
          { label: "Total amount", formula: `${taxableAmount} + ${round2(totalTax)}`, value: round2(amount.plus(totalTax)) },
        ],
      },
    }
  }

  const half = totalTax.div(2)
  return {
    cgst: round2(half), sgst: round2(half), igst: 0,
    totalTax: round2(totalTax), totalAmount: round2(amount.plus(totalTax)), isInterState: false,
    breakdown: {
      steps: [
        { label: "Total GST (intra-state, CGST+SGST)", formula: `${taxableAmount} x ${gstRatePercent}%`, value: round2(totalTax) },
        { label: "CGST (half)", formula: `${round2(totalTax)} / 2`, value: round2(half) },
        { label: "SGST (half)", formula: `${round2(totalTax)} / 2`, value: round2(half) },
        { label: "Total amount", formula: `${taxableAmount} + ${round2(totalTax)}`, value: round2(amount.plus(totalTax)) },
      ],
    },
  }
}

// Extract state code from a GSTIN's first 2 digits (per GSTN convention),
// so callers with GSTINs on file don't need to separately track state.
export function stateCodeFromGstin(gstin: string): string {
  return gstin?.trim().slice(0, 2) ?? ""
}

function round2(d: Decimal): number {
  return d.toDecimalPlaces(2).toNumber()
}

// GST state codes for Union Territories WITHOUT their own legislature --
// these use UTGST instead of SGST on intra-territory supply (CGST Act
// Sec 2, UTGST Act 2017). Codes per the standard GSTN state-code list.
const UT_WITHOUT_LEGISLATURE_CODES = new Set(["04", "26", "31", "35", "97"]) // Chandigarh, DNH&DD, Lakshadweep, A&N Islands, Other Territory

// GST Inclusive Engine -- back-calculate taxable value from a tax-inclusive amount
export function gstInclusiveToTaxable(inclusiveAmount: number, gstRatePercent: number): { taxableAmount: number; taxAmount: number } {
  const taxable = new Decimal(inclusiveAmount).div(new Decimal(1).plus(new Decimal(gstRatePercent).div(100)))
  return { taxableAmount: round2(taxable), taxAmount: round2(new Decimal(inclusiveAmount).minus(taxable)) }
}

// GST Exclusive Engine -- forward-calculate tax-inclusive amount from taxable value
export function gstExclusiveToInclusive(taxableAmount: number, gstRatePercent: number): { inclusiveAmount: number; taxAmount: number } {
  const tax = new Decimal(taxableAmount).mul(gstRatePercent).div(100)
  return { inclusiveAmount: round2(new Decimal(taxableAmount).plus(tax)), taxAmount: round2(tax) }
}

// UTGST Engine -- like splitGst but for Union Territories without legislature
export function splitGstWithUtgst(input: GstSplitInput): GstSplitResult & { utgst: number } {
  const supplierIsUt = UT_WITHOUT_LEGISLATURE_CODES.has(input.supplierStateCode?.trim())
  const base = splitGst(input)
  if (!input.supplierStateCode || input.supplierStateCode.trim() === input.buyerStateCode?.trim()) {
    if (supplierIsUt) {
      return { ...base, cgst: base.cgst, sgst: 0, utgst: base.sgst } // SGST half becomes UTGST for UTs
    }
  }
  return { ...base, utgst: 0 }
}

// Reverse Charge Engine -- Sec 9(3)/9(4): recipient (not supplier) is liable to pay GST
export function computeReverseChargeLiability(input: GstSplitInput & { isReverseCharge: boolean }): GstSplitResult & { payableBy: "supplier" | "recipient" } {
  const base = splitGst(input)
  return { ...base, payableBy: input.isReverseCharge ? "recipient" : "supplier" }
}

// ITC (Input Tax Credit) Calculation Engine -- Sec 16/17: eligible ITC minus
// blocked-credit categories (Sec 17(5)) and proportionate reversal for exempt-supply ratio
export function calculateEligibleItc(input: { totalItcAvailable: number; blockedCreditAmount: number; exemptSupplyRatio?: number }): { eligibleItc: number; reversedItc: number } {
  const net = new Decimal(input.totalItcAvailable).minus(input.blockedCreditAmount)
  const reversed = input.exemptSupplyRatio ? net.mul(input.exemptSupplyRatio) : new Decimal(0)
  return { eligibleItc: round2(net.minus(reversed)), reversedItc: round2(reversed) }
}

// GST Interest Engine -- Sec 50: 18% p.a. on late tax payment, 24% p.a. on
// excess/ineligible ITC claimed. Rates per CGST Act as of 2026; verify current
// notified rate before relying on this for a live filing.
export function calculateGstInterest(input: { taxAmount: number; daysLate: number; isExcessItcClaim?: boolean }): number {
  const annualRate = input.isExcessItcClaim ? 24 : 18
  return round2(new Decimal(input.taxAmount).mul(annualRate).div(100).mul(input.daysLate).div(365))
}

// GST Late Fee Engine -- Sec 47: Rs 50/day (25 CGST + 25 SGST) for regular
// returns, Rs 20/day (10+10) for nil returns; current standard rates, no cap
// modeled here (turnover-based caps were notified separately and can change).
export function calculateGstLateFee(input: { daysLate: number; isNilReturn?: boolean }): { cgstLateFee: number; sgstLateFee: number; totalLateFee: number } {
  const perDay = input.isNilReturn ? 20 : 50
  const total = Math.max(0, input.daysLate) * perDay
  return { cgstLateFee: total / 2, sgstLateFee: total / 2, totalLateFee: total }
}

// GST Return Validation Engine -- structural checks before filing
export function validateGstReturn(returnData: { gstin: string; period: string; totalTaxableValue: number; totalTaxPaid: number; lineItems: unknown[] }): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!returnData.gstin) errors.push("GSTIN is required")
  if (!returnData.period) errors.push("Return period is required")
  if (returnData.totalTaxableValue < 0) errors.push("totalTaxableValue cannot be negative")
  if (returnData.totalTaxPaid < 0) errors.push("totalTaxPaid cannot be negative")
  if (!returnData.lineItems?.length) errors.push("At least one line item is required")
  return { valid: errors.length === 0, errors }
}

// HSN Validation Engine -- HSN codes are 4/6/8-digit numeric per CBIC's
// mandated-digit rules (turnover-tiered); format-only, no public checksum.
export function isValidHsnFormat(hsn: string): boolean {
  return /^[0-9]{4}([0-9]{2}){0,2}$/.test(hsn?.trim() ?? "")
}

// SAC Validation Engine -- Services Accounting Codes are 6-digit numeric, always prefixed "99"
export function isValidSacFormat(sac: string): boolean {
  return /^99[0-9]{4}$/.test(sac?.trim() ?? "")
}

// GST Calculation Engine -- the composite entry point: split tax + inclusive/
// exclusive conversion in one call, i.e. the full "calculate GST" operation
// this registry category is named for.
export function calculateGst(input: GstSplitInput & { amountIsInclusive?: boolean }): GstSplitResult & { taxableAmount: number } {
  const taxable = input.amountIsInclusive ? gstInclusiveToTaxable(input.taxableAmount, input.gstRatePercent).taxableAmount : input.taxableAmount
  return { ...splitGst({ ...input, taxableAmount: taxable }), taxableAmount: taxable }
}

// E-Way Bill Validation Engine -- EBN is a 12-digit numeric identifier
// generated by the government e-way bill portal; format-only (no public
// checksum), true validity requires the government e-way bill API.
export function isValidEwayBillNumberFormat(ebn: string): boolean {
  return /^[0-9]{12}$/.test(ebn?.trim() ?? "")
}
