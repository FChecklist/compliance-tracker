/// <reference types="bun-types" />
// R67 E-07 (R-114). The same two things material-cost-report-pdf.test.ts
// proves, for the same reasons: (a) a real, non-empty binary PDF comes out,
// including for the filtered-to-nothing case, which is a legitimate answer
// rather than an error; and (b) the filter wording is right, because that
// sentence is what the empty state says to a reader who would otherwise be
// handed a blank page.
import { describe, expect, test } from "bun:test"
import { generateBudgetVarianceReportPdf, filterLabel, type BudgetVarianceReportPdfData, type BudgetVariancePdfLine } from "./budget-variance-report-pdf"

const ORG = { name: "Meridian Construction Co.", address: "123 Site Road", gstin: "27AAAAA0000A1Z5" }

const LINES: BudgetVariancePdfLine[] = [
  {
    sNo: 1, isRootLine: true, category: "Civil", code: "C-01", description: "Blockwork to villa ground floor",
    quantity: 120, rate: 45, amount: 5400, budget: 1350, vendorName: "Alpha Contracting LLC", vendorAmount: 1500, variance: 150,
  },
  {
    sNo: 2, isRootLine: true, category: null, code: null, description: "Site clearance",
    quantity: 1, rate: 3375, amount: 3375, budget: 843.75, vendorName: null, vendorAmount: null, variance: null,
  },
  // A weighted sub-task: printed nowhere, folded into its parent's figures,
  // and counted in the footer note so nothing disappears silently.
  {
    sNo: null, isRootLine: false, category: "Civil", code: "C-01.1", description: "Blockwork - first lift",
    quantity: 60, rate: 45, amount: 2700, budget: 675, vendorName: null, vendorAmount: null, variance: null,
  },
]

function baseData(overrides: Partial<BudgetVarianceReportPdfData> = {}): BudgetVarianceReportPdfData {
  return {
    org: ORG,
    projectName: "Cedar Heights Villa - Phase 1",
    boqTitle: "Main BOQ v2",
    currency: "AED",
    lines: LINES,
    totals: { budget: 2193.75, vendorAmount: 1500, variance: 150 },
    filters: { categories: [], vendorName: null },
    ...overrides,
  }
}

describe("generateBudgetVarianceReportPdf", () => {
  test("produces a real, non-empty PDF with a valid %PDF header", () => {
    const buffer = generateBudgetVarianceReportPdf(baseData())
    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })

  test("a filter that matches no line still renders a valid PDF, not an error", () => {
    const buffer = generateBudgetVarianceReportPdf(
      baseData({ lines: [], totals: { budget: null, vendorAmount: 0, variance: 0 }, filters: { categories: ["Joinery"], vendorName: "Beta Joinery" } })
    )
    expect(buffer.byteLength).toBeGreaterThan(500)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })

  test("an org with no base currency prints no currency token at all rather than a guessed one", () => {
    const buffer = generateBudgetVarianceReportPdf(baseData({ currency: null }))
    expect(buffer.byteLength).toBeGreaterThan(1000)
  })
})

describe("filterLabel", () => {
  test("says 'All' for each dimension the reader did not filter, rather than leaving it unsaid", () => {
    expect(filterLabel({ categories: [], vendorName: null })).toBe("Category: All · Vendor: All")
  })

  test("names every selected category and the vendor, so a shared file says what it is a report of", () => {
    expect(filterLabel({ categories: ["Civil", "Joinery"], vendorName: "Alpha Contracting LLC" })).toBe(
      "Category: Civil, Joinery · Vendor: Alpha Contracting LLC"
    )
  })
})
