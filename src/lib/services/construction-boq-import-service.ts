// Excel BoQ importer (Owner directive, PROJEXA_ERP_END_TO_END_REQUIREMENT_
// ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27). Reuses the existing,
// working xlsx/csv parsing in src/lib/ingest/parser.ts (parseFile) rather
// than inventing a new parsing path -- same reuse discipline as
// src/lib/gst/adapters/spreadsheet-adapter.ts. Column auto-mapping here is a
// small, BoQ-specific alias table (not gst/column-mapper.ts's
// CANONICAL_FIELD_ALIASES, which is a different, GST-specific field set) but
// reuses parseAmount() for numeric parsing.
//
// Hierarchy: a real BoQ/WBS spreadsheet (the Owner's own "Sample Scope with
// Sub Task.xlsx") numbers sub-tasks with a dot-delimited item code under
// their main item (e.g. main "2", sub-tasks "2.1"/"2.2") -- parentItemCode
// is inferred from that convention when no explicit "Parent Code" column is
// present, so a realistic BoQ export needs zero extra columns to import
// correctly.
import { parseFile } from "@/lib/ingest/parser"
import { parseAmount } from "@/lib/gst/column-mapper"
import type { BoqLineItemInput } from "./construction-boq-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type BoqFieldKey = "itemCode" | "parentItemCode" | "description" | "subTask" | "unit" | "quantity" | "rate" | "breakdownPercentage"

// Alias order within each field is a PRIORITY order, not just a membership
// list: mapBoqHeaders resolves a field by trying its aliases in order and
// taking the first one that matches an unused header, rather than just
// taking the first header (in sheet order) that matches any alias. This
// matters for real prospect BoQ exports (Sl No/Category/Dwg Code/
// Description (Task)/Sub Task/...) which have BOTH a "Category" column
// (grouping label, e.g. "PARTITION AND LINING") and a "Description (Task)"
// column (the actual per-row task text) -- "category" is kept as a last-
// resort fallback alias for simple sheets that only have a Category column
// acting as the description, but must never win over a real Description
// column when both are present.
export const BOQ_FIELD_ALIASES: Record<BoqFieldKey, string[]> = {
  itemCode: ["s no", "sno", "sl no", "sr no", "item code", "code", "item no", "bill no"],
  parentItemCode: ["parent code", "parent item code", "main item code", "main item"],
  description: ["description", "description task", "particulars", "item description", "scope of work", "scope", "category"],
  // Real prospect BoQ exports leave Sl No/Description (Task) blank on
  // sub-task rows and instead name the sub-task here (e.g. "Frame", "Gypsum
  // Board") -- mapRowsToLineItems falls back to this column when the
  // Description column is blank for a given row.
  subTask: ["sub task", "subtask", "sub-task"],
  unit: ["unit", "uom", "unit of measure"],
  quantity: ["qty", "quantity"],
  rate: ["rate", "unit rate", "unit price"],
  breakdownPercentage: ["breakdown %", "breakdown percentage", "break up %", "break-up %", "split %"],
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim().replace(/\s+/g, " ")
}

export type BoqColumnMapping = Partial<Record<BoqFieldKey, string>>

export function mapBoqHeaders(headers: string[]): BoqColumnMapping {
  const mapping: BoqColumnMapping = {}
  const used = new Set<string>()
  for (const field of Object.keys(BOQ_FIELD_ALIASES) as BoqFieldKey[]) {
    let match: string | undefined
    for (const alias of BOQ_FIELD_ALIASES[field]) {
      match = headers.find((h) => !used.has(h) && normalizeHeader(h) === alias)
      if (match) break
    }
    if (match) { mapping[field] = match; used.add(match) }
  }
  return mapping
}

/**
 * Pure, no DB/xlsx access -- independently unit-testable. Converts already-
 * parsed spreadsheet rows into BoqLineItemInput[], inferring parentItemCode
 * from a dot-delimited itemCode (e.g. "2.1" under "2") when no explicit
 * parent-code column was mapped.
 */
export function mapRowsToLineItems(rows: Record<string, unknown>[], mapping: BoqColumnMapping): { lineItems: BoqLineItemInput[]; warnings: string[] } {
  if (!mapping.description && !mapping.subTask) throw new ServiceError("Could not find a Description column in this spreadsheet", 400)
  if (!mapping.quantity) throw new ServiceError("Could not find a Quantity column in this spreadsheet", 400)
  if (!mapping.rate) throw new ServiceError("Could not find a Rate column in this spreadsheet", 400)

  const warnings: string[] = []
  // isUnlabeledSubTask marks a row whose description came from the Sub Task
  // column, not the Description column -- the real signature (real prospect
  // BoQ exports) of a sub-task row that has no itemCode of its own and needs
  // its parentItemCode inferred positionally, from the nearest preceding row
  // that did have an itemCode (see the positional-fallback comment below).
  const rawItems: { itemCode?: string; explicitParentCode?: string; description: string; unit: string; quantity: number; rate: number; breakdownPercentage?: number; isUnlabeledSubTask: boolean }[] = []

  rows.forEach((row, idx) => {
    const descriptionRaw = mapping.description ? String(row[mapping.description] ?? "").trim() : ""
    const subTaskRaw = mapping.subTask ? String(row[mapping.subTask] ?? "").trim() : ""
    const description = descriptionRaw || subTaskRaw
    if (!description) { warnings.push(`Row ${idx + 2}: skipped (no description)`); return }

    const itemCode = mapping.itemCode ? String(row[mapping.itemCode] ?? "").trim() || undefined : undefined
    const explicitParentCode = mapping.parentItemCode ? String(row[mapping.parentItemCode] ?? "").trim() || undefined : undefined
    const unit = mapping.unit ? String(row[mapping.unit] ?? "").trim() : ""
    const quantity = parseAmount(row[mapping.quantity!])
    const rate = parseAmount(row[mapping.rate!])
    const breakdownPercentage = mapping.breakdownPercentage ? parseAmount(row[mapping.breakdownPercentage]) : undefined

    rawItems.push({ itemCode, explicitParentCode, description, unit, quantity, rate, breakdownPercentage: breakdownPercentage || undefined, isUnlabeledSubTask: !descriptionRaw && !!subTaskRaw })
  })

  const allItemCodes = new Set(rawItems.filter((i) => i.itemCode).map((i) => i.itemCode!))

  let lastItemCode: string | undefined
  const lineItems: BoqLineItemInput[] = rawItems.map((i) => {
    let parentItemCode = i.explicitParentCode
    if (!parentItemCode && i.itemCode) {
      const lastDot = i.itemCode.lastIndexOf(".")
      if (lastDot > 0) {
        const prefix = i.itemCode.slice(0, lastDot)
        if (allItemCodes.has(prefix)) parentItemCode = prefix
      }
    }
    // Positional fallback: a real prospect BoQ export's sub-task rows (Frame/
    // Gypsum Board/Rockwool/...) carry no itemCode of their own -- they're
    // just the next rows after their parent task row, identified only by
    // having a Sub Task value (not a Description) and a Breakdown %. Attach
    // them to the itemCode of the nearest preceding row that had one.
    if (!parentItemCode && !i.itemCode && i.isUnlabeledSubTask && i.breakdownPercentage != null && lastItemCode) {
      parentItemCode = lastItemCode
    }
    if (i.itemCode) lastItemCode = i.itemCode
    return {
      itemCode: i.itemCode, parentItemCode,
      breakdownPercentage: parentItemCode ? i.breakdownPercentage : undefined,
      description: i.description, unit: i.unit, quantity: i.quantity, rate: i.rate,
    }
  })

  return { lineItems, warnings }
}

/** Parses an uploaded BoQ spreadsheet (xlsx/xls/csv) into hierarchical BoqLineItemInput[], ready for createBoq/createBoqRevision. */
export async function parseBoqSpreadsheet(buffer: Buffer, fileName: string, mimeType: string): Promise<{ lineItems: BoqLineItemInput[]; warnings: string[]; mapping: BoqColumnMapping; totalRows: number }> {
  const parsed = await parseFile(buffer, fileName, mimeType)
  const mapping = mapBoqHeaders(parsed.headers)
  const { lineItems, warnings } = mapRowsToLineItems(parsed.rows as Record<string, unknown>[], mapping)
  return { lineItems, warnings, mapping, totalRows: parsed.totalRows }
}
