/// <reference types="bun-types" />
// R67 E-12 (R-136). The schema-driven PDF: that real bytes come out (including
// for the legitimately-empty case), and that the two rules a printed table lives
// or dies by are right -- a money column is labelled with the currency exactly
// once, and a column's TYPE decides its formatting rather than its position.
import { describe, expect, test } from "bun:test"
import { formatPdfCell, generateReportDocumentPdf, pdfHeadRow, type ReportDocumentPdfData } from "./report-document-pdf"
import { EMPTY, reportExportSchema } from "@/lib/services/report-export"

const SCHEMA = reportExportSchema("project-status")!

const ORG = { name: "Meridian Construction Co.", address: "123 Site Road", gstin: "27AAAAA0000A1Z5" }

const ROWS = [
  { category: "Civil", code: "C-01", description: "Blockwork to villa ground floor", budget: 1350, vendorName: "Alpha Contracting LLC", vendorAmount: 1500 },
  { category: null, code: null, description: "Site clearance", budget: 843.75, vendorName: null, vendorAmount: null },
]

function baseData(overrides: Partial<ReportDocumentPdfData> = {}): ReportDocumentPdfData {
  return {
    org: ORG,
    projectName: "Cedar Heights Villa - Phase 1",
    subtitle: "BOQ Main BOQ v2",
    currency: "AED",
    rows: ROWS,
    totals: { budget: 2193.75, vendorAmount: 1500 },
    ...overrides,
  }
}

describe("the schema-driven report PDF (R67 E-12)", () => {
  test("produces a real, non-empty PDF", () => {
    const buffer = generateReportDocumentPdf(SCHEMA, baseData())
    expect(buffer.byteLength).toBeGreaterThan(1000)
    // %PDF-, the file's own magic number.
    expect(new TextDecoder().decode(new Uint8Array(buffer).slice(0, 5))).toBe("%PDF-")
  })

  test("a report with no rows is still a valid PDF, because 'nothing matched' is an answer and not an error", () => {
    const buffer = generateReportDocumentPdf(SCHEMA, baseData({ rows: [], totals: undefined, emptyMessage: "No budget lines yet." }))
    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(new TextDecoder().decode(new Uint8Array(buffer).slice(0, 5))).toBe("%PDF-")
  })

  test("the currency code is on the money columns ONLY, and appears once per column rather than once per cell", () => {
    expect(pdfHeadRow(SCHEMA, "AED")).toEqual([
      "Category", "Code", "Description", "Budget (AED)", "Vendor", "Vendor amount (AED)",
    ])
  })

  test("an org with no base currency gets bare numbers, never a guessed code", () => {
    expect(pdfHeadRow(SCHEMA, null)).toEqual(["Category", "Code", "Description", "Budget", "Vendor", "Vendor amount"])
  })

  test("a column's TYPE decides its formatting -- money is grouped to two decimals, a count is not", () => {
    expect(formatPdfCell(1234.5, "money")).toBe("1,234.50")
    expect(formatPdfCell(1234.5, "number")).toBe("1,234.5")
    expect(formatPdfCell(62.25, "percent")).toBe("62.3%")
    expect(formatPdfCell("Blockwork", "text")).toBe("Blockwork")
  })

  test("absent is the en dash in every type, so 'not recorded' can never print as a zero", () => {
    expect(formatPdfCell(null, "money")).toBe(EMPTY)
    expect(formatPdfCell(undefined, "number")).toBe(EMPTY)
    expect(formatPdfCell("", "text")).toBe(EMPTY)
    expect(formatPdfCell(Number.NaN, "money")).toBe(EMPTY)
    // ...and a real zero is still a real zero.
    expect(formatPdfCell(0, "money")).toBe("0.00")
  })
})
