// Adapter for excel_generic / csv_generic / busy / zoho_books -- all four
// arrive as tabular rows (Busy and Zoho Books both export Sales/Purchase
// registers as Excel/CSV; their headers differ slightly from a generic
// export but are covered by CANONICAL_FIELD_ALIASES), so they share one
// adapter that reuses the existing src/lib/ingest/parser.ts xlsx/csv
// parsing rather than re-implementing it.
import type { ParseResult } from "@/lib/ingest/types"
import { autoMapColumns, applyMapping, parseAmount, parseDateToIso, isMalformedNumericCell, type ColumnMapping, type MappingConfidence } from "@/lib/gst/column-mapper"
import type { CanonicalInvoiceDraft, StagedRow } from "@/lib/gst/canonical-types"
import { stateCodeFromGstin } from "@/lib/engines/in/gst-engine"

// E-43: parses one mapped cell as an amount AND, in the same pass, records a
// warning when the raw cell was genuinely unparseable (as opposed to blank,
// or already a real number from xlsx) rather than letting it silently become
// 0. A cell already typed `number` (a real Excel numeric cell) can never be
// "malformed" -- only a string cell can hold garbage text -- so the check is
// skipped for that case, same early-return parseAmount() itself takes.
function readAmount(rawValue: unknown, label: string, warnings: string[]): number {
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim()
    if (isMalformedNumericCell(trimmed)) warnings.push(`${label} "${trimmed}" is not a number -- imported as 0`)
  }
  return parseAmount(rawValue)
}

// Exported separately so a corrected mapping (after user review) can be
// re-applied to already-staged raw rows without re-parsing the source file.
export function mapRowToDraft(raw: Record<string, unknown>, mapping: ColumnMapping): { draft: CanonicalInvoiceDraft; warnings: string[] } {
  const mapped = applyMapping(raw, mapping)
  const warnings: string[] = []

  const taxableValue = readAmount(mapped.taxableValue, "Taxable value", warnings)
  const cgstAmount = readAmount(mapped.cgstAmount, "CGST amount", warnings)
  const sgstAmount = readAmount(mapped.sgstAmount, "SGST amount", warnings)
  const igstAmount = readAmount(mapped.igstAmount, "IGST amount", warnings)
  const cessAmount = readAmount(mapped.cessAmount, "Cess amount", warnings)
  const totalValueRaw = readAmount(mapped.totalValue, "Total value", warnings)
  const totalValue = totalValueRaw || (taxableValue + cgstAmount + sgstAmount + igstAmount + cessAmount)
  const gstin = mapped.counterpartyGstin ? String(mapped.counterpartyGstin).trim().toUpperCase() : null

  const draft: CanonicalInvoiceDraft = {
    counterpartyGstin: gstin,
    counterpartyName: mapped.counterpartyName ? String(mapped.counterpartyName).trim() : null,
    invoiceNumber: mapped.invoiceNumber ? String(mapped.invoiceNumber).trim() : null,
    invoiceDate: parseDateToIso(mapped.invoiceDate),
    placeOfSupply: mapped.placeOfSupply ? String(mapped.placeOfSupply).trim() : (gstin ? stateCodeFromGstin(gstin) : null),
    invoiceType: mapped.invoiceType ? String(mapped.invoiceType).trim().toLowerCase() : "b2b",
    taxableValue, cgstAmount, sgstAmount, igstAmount, cessAmount, totalValue,
    items: [{
      hsnSacCode: mapped.hsnSacCode ? String(mapped.hsnSacCode).trim() : null,
      description: mapped.description ? String(mapped.description).trim() : null,
      quantity: readAmount(mapped.quantity, "Quantity", warnings) || 1,
      rate: readAmount(mapped.rate, "Rate", warnings),
      taxableValue,
      gstRatePercent: readAmount(mapped.gstRatePercent, "GST rate", warnings),
      cgstAmount, sgstAmount, igstAmount,
    }],
  }
  return { draft, warnings }
}

export function adaptSpreadsheet(parsed: ParseResult, savedMapping?: ColumnMapping): {
  mapping: ColumnMapping
  confidence: MappingConfidence
  rows: StagedRow[]
} {
  const { mapping, confidence } = autoMapColumns(parsed.headers, savedMapping)
  const mappedFieldCount = Object.keys(mapping).length
  const confidenceSum = Object.values(confidence).reduce((s, v) => s + (v ?? 0), 0)
  const mappingConfidence = mappedFieldCount > 0 ? confidenceSum / mappedFieldCount : 0

  const rows: StagedRow[] = parsed.rows.map((raw, idx) => {
    const { draft, warnings } = mapRowToDraft(raw as Record<string, unknown>, mapping)
    return {
      sourceRow: idx + 1,
      rawData: raw as Record<string, unknown>,
      mappedData: draft,
      mappingConfidence,
      warnings,
    }
  })

  return { mapping, confidence, rows }
}
