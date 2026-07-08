// Adapter for excel_generic / csv_generic / busy / zoho_books -- all four
// arrive as tabular rows (Busy and Zoho Books both export Sales/Purchase
// registers as Excel/CSV; their headers differ slightly from a generic
// export but are covered by CANONICAL_FIELD_ALIASES), so they share one
// adapter that reuses the existing src/lib/ingest/parser.ts xlsx/csv
// parsing rather than re-implementing it.
import type { ParseResult } from "@/lib/ingest/types"
import { autoMapColumns, applyMapping, parseAmount, parseDateToIso, type ColumnMapping, type MappingConfidence } from "@/lib/gst/column-mapper"
import type { CanonicalInvoiceDraft, StagedRow } from "@/lib/gst/canonical-types"
import { stateCodeFromGstin } from "@/lib/engines/gst-engine"

// Exported separately so a corrected mapping (after user review) can be
// re-applied to already-staged raw rows without re-parsing the source file.
export function mapRowToDraft(raw: Record<string, unknown>, mapping: ColumnMapping): CanonicalInvoiceDraft {
  const mapped = applyMapping(raw, mapping)

  const taxableValue = parseAmount(mapped.taxableValue)
  const cgstAmount = parseAmount(mapped.cgstAmount)
  const sgstAmount = parseAmount(mapped.sgstAmount)
  const igstAmount = parseAmount(mapped.igstAmount)
  const cessAmount = parseAmount(mapped.cessAmount)
  const totalValueRaw = parseAmount(mapped.totalValue)
  const totalValue = totalValueRaw || (taxableValue + cgstAmount + sgstAmount + igstAmount + cessAmount)
  const gstin = mapped.counterpartyGstin ? String(mapped.counterpartyGstin).trim().toUpperCase() : null

  return {
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
      quantity: parseAmount(mapped.quantity) || 1,
      rate: parseAmount(mapped.rate),
      taxableValue,
      gstRatePercent: parseAmount(mapped.gstRatePercent),
      cgstAmount, sgstAmount, igstAmount,
    }],
  }
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

  const rows: StagedRow[] = parsed.rows.map((raw, idx) => ({
    sourceRow: idx + 1,
    rawData: raw as Record<string, unknown>,
    mappedData: mapRowToDraft(raw as Record<string, unknown>, mapping),
    mappingConfidence,
  }))

  return { mapping, confidence, rows }
}
