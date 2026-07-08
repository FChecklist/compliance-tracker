// VCEL GST Engine (computation_engines: gst_split_engine, gst_calculation_engine,
// cgst_engine, sgst_engine, igst_engine). Deterministic CGST/SGST vs IGST split
// based on supplier/buyer state codes -- the actual computation the existing
// erp-invoicing-service.ts tax-template system does NOT do (it's user-configured
// tax lines, not a computed split). GSTIN's first 2 digits are the state code
// (standard GSTN convention), used here rather than a separate state field.
import Decimal from "decimal.js"

export type GstSplitInput = { taxableAmount: number; gstRatePercent: number; supplierStateCode: string; buyerStateCode: string }
export type GstSplitResult = { cgst: number; sgst: number; igst: number; totalTax: number; totalAmount: number; isInterState: boolean }

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
    }
  }

  const half = totalTax.div(2)
  return {
    cgst: round2(half), sgst: round2(half), igst: 0,
    totalTax: round2(totalTax), totalAmount: round2(amount.plus(totalTax)), isInterState: false,
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
