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

export type BoqFieldKey = "itemCode" | "parentItemCode" | "description" | "subTask" | "unit" | "quantity" | "rate" | "breakdownPercentage" | "amount"

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
  // R11 point 14 (E-57): recognized ONLY for reconciliation warnings below --
  // the stored amount is still always quantity x rate (unchanged), never the
  // printed value from this column.
  amount: ["amount", "amt", "value"],
}

// R38 (R-71/TC-51): parseAmount() silently returns 0 for genuine garbage
// text ("not-a-number", "TBD", "N/A") -- indistinguishable, at the call
// site, from a real cell that legitimately says "0". Mirrors parseAmount's
// own cleaning steps (strip commas/currency-glyphs/whitespace, a leading
// currency token, and parentheses-negative syntax) before testing the
// result against a plain numeric pattern, so a genuinely-numeric cell in
// any of parseAmount's own accepted shapes ("5,000", "AED 50", "(100)")
// is never flagged, and only true garbage is.
function isMalformedNumericCell(raw: string): boolean {
  if (raw === "") return false
  const cleaned = raw
    .replace(/[,₹\s]/g, "")
    .replace(/^[^\d.\-(]+/, "")
    .replace(/^\((.*)\)$/, "-$1")
  return !/^-?\d+(\.\d+)?$/.test(cleaned)
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

    // Category-header rows (e.g. Sl No "1.00", Description (Task) "PARTITION
    // AND LINING" in caps, QTY/RATE blank) carry their own description, so
    // the no-description skip above does not catch them. Unlike a real task
    // row, a header has no Sub Task value and BLANK Qty/Rate cells -- not
    // even a typed "0". Test the raw cell strings, not the parsed number:
    // parseAmount("") and parseAmount("0") both come out 0, and a real task
    // row legitimately carrying a stray literal "0" must stay a line item,
    // not get mistaken for a header. Whole-number-looking Sl Nos (7.00,
    // 20.00, ...) are real line items too -- never use the itemCode's number
    // format to decide this, only blank-ness of Qty/Rate.
    const quantityRaw = mapping.quantity ? String(row[mapping.quantity] ?? "").trim() : ""
    const rateRaw = mapping.rate ? String(row[mapping.rate] ?? "").trim() : ""
    if (descriptionRaw && !subTaskRaw && quantityRaw === "" && rateRaw === "") {
      warnings.push(`Row ${idx + 2}: skipped (category header: "${descriptionRaw}")`)
      return
    }

    // R38 (R-71/TC-51): a non-blank Qty or Rate cell that isn't a real
    // number (typo, "TBD", stray text) must be rejected loudly and by row
    // number, not silently imported as a $0 line item -- the failure mode
    // parseAmount()'s own graceful-degradation-to-0 produces if left
    // unchecked here.
    if (isMalformedNumericCell(quantityRaw)) {
      warnings.push(`Row ${idx + 2}: skipped (Quantity "${quantityRaw}" is not a number)`)
      return
    }
    if (isMalformedNumericCell(rateRaw)) {
      warnings.push(`Row ${idx + 2}: skipped (Rate "${rateRaw}" is not a number)`)
      return
    }

    const itemCode = mapping.itemCode ? String(row[mapping.itemCode] ?? "").trim() || undefined : undefined
    const explicitParentCode = mapping.parentItemCode ? String(row[mapping.parentItemCode] ?? "").trim() || undefined : undefined
    const unit = mapping.unit ? String(row[mapping.unit] ?? "").trim() : ""
    const quantity = parseAmount(row[mapping.quantity!])
    const rate = parseAmount(row[mapping.rate!])
    // E-109: xlsx stores a percentage-formatted cell as its underlying
    // fraction (30% -> 0.3), and parseAmount() (shared with plain-number
    // columns, no percent-aware handling) passes that fraction straight
    // through -- the DB then holds 0.3 where every downstream reader
    // (computedBudget(), the UI, Sumeet's own printed sheet) expects the
    // whole number 30. Confirmed directly against the real source cell
    // (openpyxl data_only read): Frame 01 under item 1.01 is genuinely
    // stored as 0.3, not "30%" text and not 30. A real breakdown percentage
    // in this domain is always > 1 (the spec's smallest real example is 5,
    // Sanding) and <= 100, so a parsed value in (0, 1] reliably identifies
    // this fraction-leak rather than a legitimately tiny percentage --
    // multiply back up to the whole-number reading the rest of the app uses.
    const breakdownPercentageRaw = mapping.breakdownPercentage ? parseAmount(row[mapping.breakdownPercentage]) : undefined
    const breakdownPercentage = breakdownPercentageRaw !== undefined && breakdownPercentageRaw > 0 && breakdownPercentageRaw <= 1
      ? breakdownPercentageRaw * 100
      : breakdownPercentageRaw
    const isUnlabeledSubTask = !descriptionRaw && !!subTaskRaw

    // R11 point 14 (E-57): there is no amount ALIAS used for import -- the
    // stored amount is always the recomputed quantity x rate, never this
    // column's printed value (do not change that). This only RECONCILES:
    // if the sheet has an amount-like column and a real task row's own
    // printed amount doesn't match its recomputed quantity x rate (a
    // rounding difference, a manual override, a discount the sheet baked
    // into the total), warn about it -- loudly enough to say plainly that
    // the recomputed value was the one actually imported -- rather than
    // silently overwriting the customer's own number with no record of the
    // difference. Skipped for unlabeled sub-task rows: their printed AMOUNT
    // is a weighted share of the PARENT's amount (breakdownPercentage x
    // parent amount), not their own quantity x rate (they carry no
    // quantity/rate of their own), so comparing the two is meaningless and
    // would warn on nearly every sub-task row.
    const amountPrintedRaw = mapping.amount ? String(row[mapping.amount] ?? "").trim() : ""
    if (amountPrintedRaw && !isUnlabeledSubTask) {
      const printedAmount = parseAmount(row[mapping.amount!])
      const recomputedAmount = quantity * rate
      if (Math.abs(recomputedAmount - printedAmount) > 1e-6) {
        warnings.push(`Row ${idx + 2}: printed amount ${printedAmount} does not match quantity x rate (${recomputedAmount}) -- the recomputed value was used`)
      }
    }

    rawItems.push({ itemCode, explicitParentCode, description, unit, quantity, rate, breakdownPercentage: breakdownPercentage || undefined, isUnlabeledSubTask })
  })

  // Built from rawItems ONLY, which -- thanks to the header skip above --
  // never contains a category header's itemCode, whatever cell format that
  // header's Sl No used. A "General"-formatted header rendering "1" instead
  // of "1.00" therefore still cannot collide with the "1" prefix inferred
  // from a real item "1.01" below: it was never a candidate. Trimmed
  // defensively even though itemCode is already trimmed above.
  const allItemCodes = new Set(rawItems.filter((i) => i.itemCode).map((i) => i.itemCode!.trim()))

  let lastItemCode: string | undefined
  const lineItems: BoqLineItemInput[] = rawItems.map((i, idx) => {
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
    // Anchor must follow the last LINE ITEM, not the last row that happened
    // to carry an Sl No -- otherwise a blank-Sl-No task row (e.g. a
    // "Reception Counter" line with no itemCode of its own) loses its own
    // unlabeled sub-tasks to whatever numbered item came before it. A line
    // item without an itemCode gets a synthetic-but-stable one so it can
    // both anchor its own children AND resolve as their parent downstream --
    // construction-boq-service.ts's parent resolver only matches
    // parentItemCode against an item that itself carries an itemCode.
    // Unlabeled sub-task rows themselves never become anchors -- only rows
    // classified as a task/line item (isUnlabeledSubTask false) do.
    //
    // R11 point 15: this code is WRITTEN to
    // compliance.construction_boq_line_items.item_code and is visible to
    // exports and any API consumer of item_code, so it must read as a
    // plain generated line code, not as a debug artefact -- "LI-<n>" rather
    // than the earlier "__anchor-<n>". Still derived from this item's own
    // position among the parsed line items, so it stays unique and stable
    // within this submission.
    let resolvedItemCode = i.itemCode
    if (!resolvedItemCode && !i.isUnlabeledSubTask) resolvedItemCode = `LI-${String(idx + 1).padStart(4, "0")}`
    if (resolvedItemCode) lastItemCode = resolvedItemCode
    return {
      itemCode: resolvedItemCode, parentItemCode,
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
