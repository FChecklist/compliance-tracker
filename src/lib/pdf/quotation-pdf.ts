// Priority 15, Wave 2: the first real PDF-generation call site in either
// repo. jspdf/jspdf-autotable have been installed dependencies in
// package.json (^4.2.1 / ^5.0.8) since an earlier wave with zero prior
// usage anywhere -- confirmed via a full-repo grep before writing this file.
// This is NOT a print-styled HTML page: doc.output("arraybuffer") produces a
// real binary PDF file, returned as-is by the route that calls this.
//
// jspdf-autotable v5's functional API (`autoTable(doc, options)`, the
// documented replacement for the old `doc.autoTable(options)` plugin-mutation
// style) still stamps `doc.lastAutoTable.finalY` onto the document instance
// for backward-compatible "where did the table end" positioning -- confirmed
// in the installed package's own dist source (jspdf.plugin.autotable.mjs) --
// but the published .d.ts doesn't type-augment jsPDF with it, hence the one
// narrow local cast below rather than `any`.
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import type { getQuotationForPdf } from "@/lib/services/erp-selling-service"

type QuotationPdfData = Awaited<ReturnType<typeof getQuotationForPdf>>

const NAVY: [number, number, number] = [28, 43, 58] // #1C2B3A, this codebase's design-token navy
const MUTED: [number, number, number] = [100, 100, 100]

function formatMoney(value: string | number): string {
  return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function generateQuotationPdf({ quotation, org }: QuotationPdfData): ArrayBuffer {
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const marginX = 40
  let y = 50

  // ── Company header (letterhead) ──────────────────────────────────────
  doc.setTextColor(...NAVY)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.text(org.name, marginX, y)
  y += 18

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  if (org.address) {
    doc.text(org.address, marginX, y)
    y += 12
  }
  const orgMeta = [org.gstin ? `GSTIN: ${org.gstin}` : null, org.panNumber ? `PAN: ${org.panNumber}` : null]
    .filter(Boolean)
    .join("    ")
  if (orgMeta) {
    doc.text(orgMeta, marginX, y)
    y += 12
  }
  const leftBlockEnd = y

  // ── Document title + metadata (right-aligned) ────────────────────────
  let ry = 50
  doc.setTextColor(...NAVY)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.text("QUOTATION", pageWidth - marginX, ry, { align: "right" })
  ry += 20

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  const revisionSuffix = quotation.revisionOf ? ` (Rev v${quotation.version})` : ""
  const metaLines = [
    `Quotation #: ${quotation.quotationNumber}${revisionSuffix}`,
    `Date: ${quotation.quotationDate}`,
    quotation.validTill ? `Valid Till: ${quotation.validTill}` : null,
    `Status: ${quotation.status.replace(/_/g, " ").toUpperCase()}`,
  ].filter((l): l is string => !!l)
  for (const line of metaLines) {
    doc.text(line, pageWidth - marginX, ry, { align: "right" })
    ry += 14
  }

  y = Math.max(leftBlockEnd, ry) + 16

  // ── Divider ───────────────────────────────────────────────────────────
  doc.setDrawColor(210, 210, 210)
  doc.line(marginX, y, pageWidth - marginX, y)
  y += 22

  // ── Customer block ────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(...NAVY)
  doc.text("Bill To", marginX, y)
  y += 14

  doc.setFont("helvetica", "normal")
  doc.setTextColor(0, 0, 0)
  doc.text(quotation.customer?.customerName ?? "(No customer on file -- lead-only quotation)", marginX, y)
  y += 13
  const custMeta = [
    quotation.customer?.gstin ? `GSTIN: ${quotation.customer.gstin}` : null,
    quotation.customer?.panNumber ? `PAN: ${quotation.customer.panNumber}` : null,
  ]
    .filter(Boolean)
    .join("    ")
  if (custMeta) {
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text(custMeta, marginX, y)
    y += 12
  }

  y += 14

  // ── Line items table ──────────────────────────────────────────────────
  const rows = quotation.items.map((item) => [
    item.description,
    Number(item.quantity).toLocaleString("en-IN"),
    formatMoney(item.rate),
    formatMoney(item.amount),
  ])

  autoTable(doc, {
    startY: y,
    head: [["Description", "Qty", "Rate", "Amount"]],
    body: rows,
    margin: { left: marginX, right: marginX },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 6, textColor: [0, 0, 0] },
    columnStyles: {
      1: { halign: "right", cellWidth: 60 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 90 },
    },
  })

  const tableEndY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40

  // ── Totals ────────────────────────────────────────────────────────────
  let ty = tableEndY + 24
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(...NAVY)
  doc.text(`Grand Total: Rs. ${formatMoney(quotation.grandTotal)}`, pageWidth - marginX, ty, { align: "right" })
  ty += 30

  // ── Footer ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text(
    "This is a system-generated quotation and does not require a physical signature.",
    marginX,
    doc.internal.pageSize.getHeight() - 30
  )

  // ArrayBuffer, not Buffer/Uint8Array -- NextResponse's BodyInit type
  // rejects both Node's Buffer subtype and TS 5.7+'s Uint8Array<ArrayBufferLike>
  // generic (real tsc errors caught on the route, not a style preference).
  // doc.output("arraybuffer") already returns a plain ArrayBuffer, which
  // BodyInit accepts natively.
  return doc.output("arraybuffer")
}
