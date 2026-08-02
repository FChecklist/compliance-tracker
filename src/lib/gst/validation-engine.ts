// Deterministic GST validation engine -- no AI, no network calls. Runs
// against already-confirmed gst_canonical_invoices rows and produces
// gst_validation_findings. Reuses the existing VCEL engines (data-quality-
// engine.ts, gst-engine.ts) rather than re-implementing GSTIN checksum or
// CGST/SGST/IGST split math.
import { isValidGstinChecksum, isValidGstinFormat } from "@/lib/engines/data-quality-engine"
import { splitGst, stateCodeFromGstin, isValidHsnFormat, isValidSacFormat } from "@/lib/engines/in/gst-engine"
import Decimal from "decimal.js"

export type ValidationInvoiceItem = {
  hsnSacCode: string | null
  taxableValue: string | number
  gstRatePercent: string | number
}

export type ValidationInvoice = {
  id: string
  direction: "sales" | "purchase" | "gstr2b"
  counterpartyGstin: string | null
  invoiceNumber: string
  invoiceDate: string
  placeOfSupply: string | null
  invoiceType: string
  taxableValue: string | number
  cgstAmount: string | number
  sgstAmount: string | number
  igstAmount: string | number
  totalValue: string | number
  items: ValidationInvoiceItem[]
}

export type ValidationFinding = {
  invoiceId: string | null
  ruleCode: string
  severity: "error" | "warning" | "info"
  message: string
  suggestedFix: string | null
}

const AMOUNT_TOLERANCE = 1 // rupees -- rounding-safe tolerance for computed-vs-entered comparisons
const num = (v: string | number) => (typeof v === "number" ? v : parseFloat(v) || 0)

function checkGstin(invoice: ValidationInvoice): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  const gstin = invoice.counterpartyGstin
  if (!gstin) {
    if (invoice.invoiceType === "b2b") {
      findings.push({ invoiceId: invoice.id, ruleCode: "missing_gstin", severity: "error", message: `Invoice ${invoice.invoiceNumber}: B2B invoice has no counterparty GSTIN.`, suggestedFix: "Add the counterparty's GSTIN or reclassify as B2C." })
    }
    return findings
  }
  if (!isValidGstinFormat(gstin)) {
    findings.push({ invoiceId: invoice.id, ruleCode: "gstin_format_invalid", severity: "error", message: `Invoice ${invoice.invoiceNumber}: GSTIN "${gstin}" doesn't match the 15-character GSTIN format.`, suggestedFix: "Re-check the GSTIN against the counterparty's registration certificate." })
  } else if (!isValidGstinChecksum(gstin)) {
    findings.push({ invoiceId: invoice.id, ruleCode: "gstin_checksum_failed", severity: "error", message: `Invoice ${invoice.invoiceNumber}: GSTIN "${gstin}" fails the checksum digit -- likely a typo.`, suggestedFix: "Verify the GSTIN with the counterparty; one character is likely mistyped." })
  }
  return findings
}

function checkDuplicates(invoices: ValidationInvoice[]): ValidationFinding[] {
  const seen = new Map<string, ValidationInvoice>()
  const findings: ValidationFinding[] = []
  for (const inv of invoices) {
    const key = `${inv.counterpartyGstin ?? ""}|${inv.invoiceNumber.trim().toLowerCase()}|${inv.invoiceDate}`
    const prior = seen.get(key)
    if (prior) {
      findings.push({ invoiceId: inv.id, ruleCode: "duplicate_invoice", severity: "error", message: `Invoice ${inv.invoiceNumber} (${inv.invoiceDate}) appears more than once for the same counterparty.`, suggestedFix: "Remove the duplicate row or confirm it's a genuinely separate invoice with a different number." })
    } else {
      seen.set(key, inv)
    }
  }
  return findings
}

// Only meaningful for the org's OWN sales register (an org's own invoice
// numbering should be sequential); purchase/2B rows come from many different
// counterparties' own sequences and a "gap" there is meaningless.
function checkInvoiceNumberGaps(invoices: ValidationInvoice[]): ValidationFinding[] {
  const numeric = invoices
    .map(inv => ({ inv, n: parseInt(inv.invoiceNumber.replace(/\D/g, ""), 10) }))
    .filter((x): x is { inv: ValidationInvoice; n: number } => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n)

  const findings: ValidationFinding[] = []
  for (let i = 1; i < numeric.length; i++) {
    const gap = numeric[i].n - numeric[i - 1].n
    if (gap > 1 && gap <= 50) { // cap at 50 -- larger gaps are likely a numbering-scheme change, not missing invoices
      findings.push({
        invoiceId: numeric[i].inv.id, ruleCode: "invoice_number_gap", severity: "warning",
        message: `Invoice numbers jump from ${numeric[i - 1].inv.invoiceNumber} to ${numeric[i].inv.invoiceNumber} -- ${gap - 1} number(s) missing.`,
        suggestedFix: "Confirm the missing invoice(s) were cancelled, or import them if they were left out of this file.",
      })
    }
  }
  return findings
}

function checkHsn(invoice: ValidationInvoice, knownHsnCodes: Set<string>): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  for (const item of invoice.items) {
    const code = item.hsnSacCode?.trim()
    if (!code) {
      findings.push({ invoiceId: invoice.id, ruleCode: "hsn_missing", severity: "warning", message: `Invoice ${invoice.invoiceNumber}: a line item has no HSN/SAC code.`, suggestedFix: "Add the HSN (goods) or SAC (services, prefixed 99) code -- mandatory above the turnover-tiered digit thresholds." })
      continue
    }
    const validFormat = isValidHsnFormat(code) || isValidSacFormat(code)
    if (!validFormat) {
      findings.push({ invoiceId: invoice.id, ruleCode: "hsn_format_invalid", severity: "error", message: `Invoice ${invoice.invoiceNumber}: HSN/SAC "${code}" isn't a valid 4/6/8-digit HSN or 6-digit "99"-prefixed SAC.`, suggestedFix: "Correct the code -- check the item's actual HSN/SAC master." })
    } else if (!knownHsnCodes.has(code)) {
      findings.push({ invoiceId: invoice.id, ruleCode: "hsn_unknown", severity: "info", message: `Invoice ${invoice.invoiceNumber}: HSN/SAC "${code}" isn't in the reference master -- format is valid but rate couldn't be cross-checked.`, suggestedFix: null })
    }
  }
  return findings
}

function checkTaxCalculation(invoice: ValidationInvoice, ownGstin: string | null): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  const entered = { cgst: num(invoice.cgstAmount), sgst: num(invoice.sgstAmount), igst: num(invoice.igstAmount) }

  // Interstate/intrastate scheme-mixing check (doesn't need a GST rate --
  // CGST+SGST and IGST must never both be non-zero on the same invoice).
  if (entered.igst > 0 && (entered.cgst > 0 || entered.sgst > 0)) {
    findings.push({ invoiceId: invoice.id, ruleCode: "interstate_split_error", severity: "error", message: `Invoice ${invoice.invoiceNumber}: both IGST and CGST/SGST are non-zero -- an invoice must use one scheme, not both.`, suggestedFix: "Determine whether this is an interstate (IGST only) or intrastate (CGST+SGST only) supply and correct the split." })
  }

  // Recompute the expected split from place-of-supply vs the org's own GSTIN
  // state, when both are known, and compare against what was entered.
  const supplierState = invoice.direction === "sales" ? (ownGstin ? stateCodeFromGstin(ownGstin) : null) : (invoice.counterpartyGstin ? stateCodeFromGstin(invoice.counterpartyGstin) : null)
  const buyerState = invoice.placeOfSupply ?? (invoice.direction === "sales" ? (invoice.counterpartyGstin ? stateCodeFromGstin(invoice.counterpartyGstin) : null) : (ownGstin ? stateCodeFromGstin(ownGstin) : null))

  for (const item of invoice.items) {
    const rate = num(item.gstRatePercent)
    if (rate <= 0 || !supplierState || !buyerState) continue
    const expected = splitGst({ taxableAmount: num(item.taxableValue), gstRatePercent: rate, supplierStateCode: supplierState, buyerStateCode: buyerState })
    const expectedTotal = new Decimal(expected.cgst).plus(expected.sgst).plus(expected.igst)
    const enteredTotal = new Decimal(entered.cgst).plus(entered.sgst).plus(entered.igst)
    if (expectedTotal.minus(enteredTotal).abs().greaterThan(AMOUNT_TOLERANCE)) {
      findings.push({
        invoiceId: invoice.id, ruleCode: "tax_mismatch", severity: "warning",
        message: `Invoice ${invoice.invoiceNumber}: expected tax ~₹${expectedTotal.toFixed(2)} at ${rate}% on ₹${num(item.taxableValue)}, but ₹${enteredTotal.toFixed(2)} was entered.`,
        suggestedFix: "Recheck the GST rate applied and the taxable value on this line.",
      })
      break // one finding per invoice for this rule, not per line item
    }
  }

  // Total-value consistency: taxable + all tax components should equal the recorded total.
  const computedTotal = new Decimal(num(invoice.taxableValue)).plus(entered.cgst).plus(entered.sgst).plus(entered.igst)
  if (computedTotal.minus(num(invoice.totalValue)).abs().greaterThan(AMOUNT_TOLERANCE)) {
    findings.push({ invoiceId: invoice.id, ruleCode: "total_value_mismatch", severity: "warning", message: `Invoice ${invoice.invoiceNumber}: taxable value + tax (₹${computedTotal.toFixed(2)}) doesn't match the recorded total (₹${num(invoice.totalValue)}).`, suggestedFix: "Check for a transcription error in one of the amount columns." })
  }

  return findings
}

/**
 * Runs every deterministic rule against a batch of confirmed invoices.
 * `knownHsnCodes` should be the current gst_hsn_master codes; `ownGstin` is
 * the filing org/client's own GSTIN (organisations.gstin or clients.gstin),
 * used to determine supplier/buyer state for the interstate-split check --
 * rules that need it degrade gracefully (skipped, not falsely flagged) when
 * it isn't available.
 */
export function runValidation(invoices: ValidationInvoice[], knownHsnCodes: Set<string>, ownGstin: string | null): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  for (const invoice of invoices) {
    findings.push(...checkGstin(invoice))
    findings.push(...checkHsn(invoice, knownHsnCodes))
    findings.push(...checkTaxCalculation(invoice, ownGstin))
  }
  findings.push(...checkDuplicates(invoices))
  if (invoices.length > 0 && invoices[0].direction === "sales") {
    findings.push(...checkInvoiceNumberGaps(invoices))
  }
  return findings
}
