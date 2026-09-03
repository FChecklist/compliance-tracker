// R67 E-07 (R-114): the Budget Summary / Cost Variance report's printed form.
//
// Cost Variance shipped with BOTH header actions hard-coded to
// "(Not yet available)" -- a deliberate stub, not a data condition. This is
// the half of the fix that makes Export real, in the repo that is allowed to
// have a PDF library: PROJEXA must not gain one, so the bytes are made here
// and its route only relays them (the same division the WPR PDF already
// ships).
//
// Same shape as material-cost-report-pdf.ts and work-progress-report-pdf.ts,
// deliberately: a pure function over a plain data object returning an
// ArrayBuffer, testable with no DB and no tenant context.
//
// NOTHING IS RECOMPUTED HERE. The rows, the per-line variance and the totals
// arrive already computed by construction-reports-service.ts
// #boqBudgetVarianceReport, which is the one place this report's arithmetic
// lives. A PDF that re-added a column would be a second summation path, and
// the whole point of R-108/R-114 is that one number means one thing.
import { createBrandedDocument, drawDocumentHeader, drawSectionLabel, drawFooterNote, pdfToBuffer, autoTable } from "@/lib/pdf-generator"

/** Exactly the fields the printed table uses -- structurally satisfied by boqBudgetVarianceReport()'s own line shape. */
export type BudgetVariancePdfLine = {
  sNo: number | null
  isRootLine: boolean
  category: string | null
  code: string | null
  description: string
  quantity: number
  rate: number
  amount: number
  budget: number
  vendorName: string | null
  vendorAmount: number | null
  variance: number | null
}

export type BudgetVarianceReportPdfData = {
  org: { name: string; address?: string | null; gstin?: string | null }
  projectName: string
  boqTitle: string | null
  /** ISO code, e.g. "AED". Null when the org has no base currency -- then the money columns carry no token at all rather than a guessed one. */
  currency: string | null
  lines: BudgetVariancePdfLine[]
  // R67 D-26: `variance` is null when NOT ONE line has been costed -- the same
  // "nothing to measure" state totals.budget already carried for "no BOQ".
  // Both print as an en dash rather than a 0 that reads like a real figure.
  totals: { budget: number | null; vendorAmount: number; variance: number | null }
  /** What the reader filtered to, printed under the title so a shared file says what it is a report OF. */
  filters: { categories: string[]; vendorName: string | null }
}

/** Two decimals, grouped, no currency token -- the code goes in the column header, once. */
function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** The en dash. "We do not have this figure" is not "this figure is zero". */
const EMPTY = "–"

/** The filter line printed under the title, and the same words the empty state uses. */
export function filterLabel(filters: { categories: string[]; vendorName: string | null }): string {
  const parts: string[] = []
  parts.push(filters.categories.length > 0 ? `Category: ${filters.categories.join(", ")}` : "Category: All")
  parts.push(filters.vendorName ? `Vendor: ${filters.vendorName}` : "Vendor: All")
  return parts.join(" · ")
}

export function generateBudgetVarianceReportPdf(data: BudgetVarianceReportPdfData): ArrayBuffer {
  const unit = data.currency ? ` (${data.currency})` : ""
  // The root lines are the contract lines, and they are what the totals total
  // -- a weighted sub-task's amount is derived from its parent, so printing
  // both would show a table that does not add up to its own last row.
  const rows = data.lines.filter((l) => l.isRootLine)
  const subTaskCount = data.lines.length - rows.length

  const doc = createBrandedDocument({ orientation: "l" }) // nine columns need the width
  let y = drawDocumentHeader(doc, {
    orgName: data.org.name,
    orgAddress: data.org.address,
    orgGstin: data.org.gstin,
    documentTitle: "Budget Summary / Cost Variance",
    documentSubtitle: `${data.projectName}${data.boqTitle ? ` · BOQ ${data.boqTitle}` : ""}`,
  })
  y += 16

  doc.setFontSize(9)
  doc.setTextColor(100, 100, 100)
  doc.setFont("helvetica", "normal")
  doc.text(filterLabel(data.filters), 32, y)
  y += 18

  drawSectionLabel(doc, "Budget by BOQ line", 32, y)
  y += 8

  if (rows.length === 0) {
    // A filter that matches nothing is a real answer, not an error -- the same
    // rule the sibling report PDFs state. Still a valid PDF, never a 4xx.
    doc.setFont("helvetica", "italic")
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text(`No BOQ lines for ${filterLabel(data.filters)}.`, 32, y + 14)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(28, 43, 58)
  } else {
    autoTable(doc, {
      startY: y,
      head: [[
        "S.No", "Category", "Code", "Description", "Qty", `Rate${unit}`,
        `Amt${unit}`, `Budget${unit}`, "Vendor", `Vendor Amt${unit}`, `Variance${unit}`,
      ]],
      body: [
        ...rows.map((r) => [
          r.sNo === null ? EMPTY : String(r.sNo),
          r.category ?? EMPTY,
          r.code ?? EMPTY,
          r.description,
          r.quantity.toLocaleString("en-US"),
          money(r.rate),
          money(r.amount),
          money(r.budget),
          r.vendorName ?? EMPTY,
          r.vendorAmount === null ? EMPTY : money(r.vendorAmount),
          r.variance === null ? EMPTY : money(r.variance),
        ]),
        // The grand total is a row of the table rather than a line underneath
        // it, so it can never be cut off a page break separately from the rows
        // it totals.
        [
          "Grand Total", "", "", "", "", "", "",
          data.totals.budget === null ? EMPTY : money(data.totals.budget),
          "", money(data.totals.vendorAmount), data.totals.variance === null ? EMPTY : money(data.totals.variance),
        ],
      ],
      styles: { fontSize: 7.5, cellPadding: 3 },
      headStyles: { fillColor: [28, 43, 58] },
      columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 9: { halign: "right" }, 10: { halign: "right" } },
      margin: { left: 32, right: 32 },
    })
  }

  // R67 D-26 changed what `variance` MEANS on this report: it is budget minus
  // committed cost, so a POSITIVE figure is budget remaining and a NEGATIVE one
  // is an overrun. The printed sheet has to say which, because a signed number
  // with no stated convention is the defect this whole report is about.
  const SIGN_NOTE = "Variance is budget remaining: a negative figure is over budget."
  drawFooterNote(
    doc,
    subTaskCount > 0
      ? `${subTaskCount} weighted sub-task line${subTaskCount === 1 ? "" : "s"} are included in their parent line's figures. ${SIGN_NOTE} Generated by VERIDIAN AI.`
      : `${SIGN_NOTE} Generated by VERIDIAN AI.`
  )
  return pdfToBuffer(doc)
}
