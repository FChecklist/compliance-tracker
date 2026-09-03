// R67 E-28 (R-244 / R-254). The Work Progress Report's XLSX half.
//
// WHY THIS FILE EXISTS. The WPR header offers Export PDF and Export XLSX.
// PROJEXA must not gain a PDF or an XLSX library (it is a thin client of this
// API), so both are rendered HERE and streamed back. The PDF already had a
// generator; XLSX did not, and building one in the browser was the only
// alternative -- which is how "Export XLSX" came to be a CSV wearing the wrong
// label.
//
// WHY IT REUSES computeRows(). The one rule that matters for an export is that
// the file and the screen say the same thing. computeRows() is the report's
// own arithmetic (Previous / Current / Total-or-Balance per BOQ line, the
// WPR-06 child-blanking rule included) and it is what the PDF prints, so the
// spreadsheet is built from the same rows rather than a second, drifting
// derivation.
//
// WHAT A CELL HOLDS. Raw numbers, never formatted strings. The whole point of
// exporting a report a QS is going to check is that they can sum a column
// themselves; "AED 20,833.20" is text Excel cannot add. The currency belongs
// in the column header, and that is where it goes.
import { computeRows, type WorkProgressReportPdfData } from "@/lib/pdf/work-progress-report-pdf"
import type { ExportRow } from "@/lib/report-export-shared"

/**
 * WPR-06, the same display rule the screen and the PDF both apply: percentages
 * are PARENT-only. A sub-task's percent cells are BLANK, not 0 -- "this line
 * does not carry a percentage" and "this line is 0% done" are different facts.
 * An empty string is the spreadsheet's own blank cell.
 */
function percentCell(value: number, isChild: boolean): number | string {
  return isChild ? "" : value
}

export type WorkProgressExportOptions = {
  mode?: "total" | "balance"
  /** ISO code for the money column headers, e.g. "AED". Omitted when the org has none -- never guessed. */
  currency?: string | null
}

/**
 * The sheet, one row per BOQ line plus a Grand Total row.
 *
 * THE GRAND TOTAL SUMS PARENT ROWS ONLY, for the contracted amount -- the same
 * rule as the screen's computeGrandTotal, earnedValueReport's contractValue and
 * E-26's own roots-only fix. A sub-task's contract amount is a slice of its
 * parent's, so summing both counts the same money twice; the progress amounts
 * (Previous / Current / Total-or-Balance) legitimately sum over every row,
 * because those are recorded against the line that did the work.
 */
export function workProgressExportRows(
  data: WorkProgressReportPdfData,
  options: WorkProgressExportOptions = {}
): ExportRow[] {
  const mode = options.mode ?? data.mode ?? "total"
  const thirdLabel = mode === "balance" ? "Balance" : "Total"
  const unit = options.currency ? ` (${options.currency})` : ""
  const rows = computeRows(data, mode)

  const sheet: ExportRow[] = rows.map((row, index) => ({
    "S.No": index + 1,
    Category: row.categoryName,
    Code: row.code,
    Description: row.isChild ? `-- ${row.description}` : row.description,
    Unit: row.unit,
    // Named for what it is: there is no purchase-order quantity in this
    // schema. See ComputedRow.boqQty's own comment.
    "BOQ Qty": row.boqQty,
    [`Rate${unit}`]: row.rate,
    [`Amount${unit}`]: row.contractAmt,
    "% Previous": percentCell(row.prevPct, row.isChild),
    "% Current": percentCell(row.currentPct, row.isChild),
    [`% ${thirdLabel}`]: percentCell(row.thirdPct, row.isChild),
    "Qty Previous": row.prevQty,
    "Qty Current": row.currentQty,
    [`Qty ${thirdLabel}`]: row.thirdQty,
    [`Amt Previous${unit}`]: row.prevAmt,
    [`Amt Current${unit}`]: row.currentAmt,
    [`Amt ${thirdLabel}${unit}`]: row.thirdAmt,
  }))

  if (rows.length === 0) return sheet

  const parents = rows.filter((r) => !r.isChild)
  sheet.push({
    "S.No": "",
    Category: "",
    Code: "",
    Description: "Grand Total",
    Unit: "",
    "BOQ Qty": "",
    [`Rate${unit}`]: "",
    [`Amount${unit}`]: parents.reduce((s, r) => s + r.contractAmt, 0),
    "% Previous": "",
    "% Current": "",
    [`% ${thirdLabel}`]: "",
    "Qty Previous": "",
    "Qty Current": "",
    [`Qty ${thirdLabel}`]: "",
    [`Amt Previous${unit}`]: rows.reduce((s, r) => s + r.prevAmt, 0),
    [`Amt Current${unit}`]: rows.reduce((s, r) => s + r.currentAmt, 0),
    [`Amt ${thirdLabel}${unit}`]: rows.reduce((s, r) => s + r.thirdAmt, 0),
  })

  return sheet
}

/** `Cedar-Heights-work-progress-2026-08-01-to-2026-08-31.xlsx`, safe on every filesystem. */
export function workProgressExportFilename(projectName: string, from: string, to: string, extension: "xlsx" | "pdf"): string {
  const slug = projectName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "project"
  return `${slug}-work-progress-${from}-to-${to}.${extension}`
}
