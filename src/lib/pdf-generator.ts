// Priority 15 Wave 2 (PROJEXA HR & Payroll follow-up): the FIRST real usage
// of the already-installed jspdf/jspdf-autotable dependencies in this
// codebase (confirmed via grep before this wave -- both listed in
// package.json since before this wave, zero prior call sites). Kept
// deliberately generic -- createBrandedDocument()/drawDocumentHeader() have
// no payslip-specific knowledge -- so any other module that later needs a
// real generated PDF (quotations, invoices, etc.) can reuse this instead of
// each building its own jsPDF setup from scratch. If a concurrent wave adds
// its own PDF helper first, prefer consolidating onto theirs over keeping
// two.
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
export { autoTable }
export type { jsPDF }

const BRAND_NAVY = "#1C2B3A"
const BRAND_TEAL = "#0E7C6E"
const BRAND_MUTED = "#6b7280"

export function createBrandedDocument(opts?: { orientation?: "p" | "l" }): jsPDF {
  const doc = new jsPDF({ orientation: opts?.orientation ?? "p", unit: "pt", format: "a4" })
  doc.setFont("helvetica", "normal")
  return doc
}

/** Draws a navy header band with org identity (left) + document title (right). Returns the y-offset content should start at. */
export function drawDocumentHeader(
  doc: jsPDF,
  opts: { orgName: string; orgAddress?: string | null; orgGstin?: string | null; documentTitle: string; documentSubtitle?: string }
): number {
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFillColor(BRAND_NAVY)
  doc.rect(0, 0, pageWidth, 72, "F")

  doc.setTextColor("#FFFFFF")
  doc.setFontSize(15)
  doc.setFont("helvetica", "bold")
  doc.text(opts.orgName, 32, 30)

  doc.setFontSize(8.5)
  doc.setFont("helvetica", "normal")
  let subY = 44
  if (opts.orgAddress) { doc.text(opts.orgAddress, 32, subY); subY += 11 }
  if (opts.orgGstin) { doc.text(`GSTIN: ${opts.orgGstin}`, 32, subY) }

  doc.setFontSize(13)
  doc.setFont("helvetica", "bold")
  doc.text(opts.documentTitle, pageWidth - 32, 30, { align: "right" })
  if (opts.documentSubtitle) {
    doc.setFontSize(9)
    doc.setFont("helvetica", "normal")
    doc.text(opts.documentSubtitle, pageWidth - 32, 46, { align: "right" })
  }

  doc.setTextColor(BRAND_NAVY)
  return 100
}

export function drawSectionLabel(doc: jsPDF, label: string, x: number, y: number): void {
  doc.setTextColor(BRAND_TEAL)
  doc.setFontSize(9)
  doc.setFont("helvetica", "bold")
  doc.text(label.toUpperCase(), x, y)
  doc.setTextColor(BRAND_NAVY)
}

export function drawFooterNote(doc: jsPDF, note: string): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setTextColor(BRAND_MUTED)
  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.text(note, pageWidth / 2, pageHeight - 24, { align: "center" })
}

// Returns a plain ArrayBuffer (not Buffer/Uint8Array) -- this project's TS
// lib config treats Buffer/Uint8Array as generic over ArrayBufferLike
// (which includes SharedArrayBuffer), which doesn't structurally satisfy
// NextResponse's BodyInit or Blob's BlobPart types. A plain ArrayBuffer is
// unambiguously valid for both.
export function pdfToBuffer(doc: jsPDF): ArrayBuffer {
  return doc.output("arraybuffer") as ArrayBuffer
}
