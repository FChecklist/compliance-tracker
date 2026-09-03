// R67 E-12 (R-136): the printed form of the ONE report document.
//
// Every report before this either had a bespoke PDF generator or had no PDF at
// all, which is why the Reports screen's Export button said "(Not yet
// available)" for sixteen of the seventeen. This renderer takes the SAME
// ReportExportSchema the .xlsx and the on-screen table are built from, so a
// report gains a printed form by being described rather than by someone writing
// a fourth opinion about its columns.
//
// NOTHING IS RECOMPUTED HERE. Rows and totals arrive already computed by the
// report services -- a PDF that re-added a column would be a second summation
// path, and the point of R-108/R-114/R-136 is that one number means one thing.
import { createBrandedDocument, drawDocumentHeader, drawSectionLabel, drawFooterNote, pdfToBuffer, autoTable } from "@/lib/pdf-generator"
import { EMPTY, type ReportExportSchema } from "@/lib/services/report-export"

export type ReportDocumentPdfData = {
  org: { name: string; address?: string | null; gstin?: string | null }
  /** Named above the table, so a shared file says what it is a report OF. */
  projectName: string
  /** The second line of the subtitle -- a BOQ title, a period, whatever identifies this run. */
  subtitle?: string | null
  /** ISO code, e.g. "AED". Null when the org has no base currency: then the money columns carry no token at all rather than a guessed one. */
  currency: string | null
  rows: Record<string, unknown>[]
  /** Single-rounded totals from the service. A column absent here is left blank on the total row. */
  totals?: Record<string, number | null>
  /** What the reader filtered to. Printed under the title and reused by the empty state. */
  filterLine?: string | null
  /** The words under an empty table. A filter that matches nothing is an answer, not an error. */
  emptyMessage?: string
  footerNote?: string
}

/** Two decimals, grouped, no currency token -- the code goes in the column header, once. */
function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * One cell, formatted by its column's declared TYPE -- which is the whole
 * reason the schema carries a type. A quantity of 3 is three of something and
 * AED 3.00 is a price; a renderer that cannot tell them apart prints a currency
 * header over a count.
 */
export function formatPdfCell(value: unknown, type: ReportExportSchema["columns"][number]["type"]): string {
  if (value === null || value === undefined || value === "" || value === EMPTY) return EMPTY
  if (typeof value !== "number") return String(value)
  if (!Number.isFinite(value)) return EMPTY
  if (type === "money") return money(value)
  if (type === "percent") return `${value.toFixed(1)}%`
  return value.toLocaleString("en-US")
}

/** The head row: the schema's labels, with the currency code appended once to each money column. */
export function pdfHeadRow(schema: ReportExportSchema, currency: string | null): string[] {
  const unit = currency ? ` (${currency})` : ""
  return schema.columns.map((c) => (c.type === "money" ? `${c.label}${unit}` : c.label))
}

export function generateReportDocumentPdf(schema: ReportExportSchema, data: ReportDocumentPdfData): ArrayBuffer {
  // Six columns fit portrait; anything wider needs the landscape width, the
  // same rule budget-variance-report-pdf.ts applies to its eleven.
  const doc = createBrandedDocument({ orientation: schema.columns.length > 6 ? "l" : "p" })
  let y = drawDocumentHeader(doc, {
    orgName: data.org.name,
    orgAddress: data.org.address,
    orgGstin: data.org.gstin,
    documentTitle: schema.title,
    documentSubtitle: `${data.projectName}${data.subtitle ? ` · ${data.subtitle}` : ""}`,
  })
  y += 16

  if (data.filterLine) {
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.setFont("helvetica", "normal")
    doc.text(data.filterLine, 32, y)
    y += 18
  }

  drawSectionLabel(doc, schema.title, 32, y)
  y += 8

  if (data.rows.length === 0) {
    doc.setFont("helvetica", "italic")
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text(data.emptyMessage ?? "No rows for this report.", 32, y + 14)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(28, 43, 58)
  } else {
    const body = data.rows.map((row) => schema.columns.map((c) => formatPdfCell(row[c.key], c.type)))

    if (schema.totals && schema.totals.length > 0) {
      // The grand total is a ROW of the table rather than a line underneath it,
      // so a page break can never separate it from the rows it totals.
      body.push(
        schema.columns.map((c) => {
          if (c.key === schema.totalLabelColumn) return "Grand Total"
          if (!schema.totals!.includes(c.key)) return ""
          const total = data.totals?.[c.key]
          return total === null || total === undefined ? EMPTY : formatPdfCell(total, c.type)
        })
      )
    }

    const columnStyles: Record<number, { halign: "right" }> = {}
    schema.columns.forEach((c, i) => {
      if (c.align === "right") columnStyles[i] = { halign: "right" }
    })

    autoTable(doc, {
      startY: y,
      head: [pdfHeadRow(schema, data.currency)],
      body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [28, 43, 58] },
      columnStyles,
      margin: { left: 32, right: 32 },
    })
  }

  drawFooterNote(doc, data.footerNote ?? "Generated by VERIDIAN AI.")
  return pdfToBuffer(doc)
}
