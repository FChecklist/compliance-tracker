/// <reference types="bun-types" />
// R67 E-05 (R-103). Same two things work-progress-report-pdf.test.ts proves,
// for the same reasons: (a) a real, non-empty binary PDF comes out, including
// for the empty-period case, which is a legitimate answer rather than an
// error; and (b) the period wording is right, because that sentence is what
// the empty state says to a reader who would otherwise see a blank card.
import { describe, expect, test } from "bun:test"
import { generateMaterialCostReportPdf, periodLabel, type MaterialCostReportPdfData } from "./material-cost-report-pdf"
import type { MaterialCostReport } from "@/lib/services/construction-materials-service"

const ORG = { name: "Meridian Construction Co.", address: "123 Site Road", gstin: "27AAAAA0000A1Z5" }

const REPORT: MaterialCostReport = {
  rows: [
    {
      key: "m-cement", materialId: "m-cement", name: "OPC Cement 53 Grade", spec: "53 Grade",
      vendorId: "v-alpha", vendorName: "Alpha Trading LLC", unit: "bag",
      totalQuantityReceived: 200, totalCost: 5000, averageUnitCost: 25, masterUnitCost: 24, variance: 1,
    },
    {
      key: "m-steel", materialId: "m-steel", name: "TMT Steel 12mm", spec: null,
      vendorId: null, vendorName: "No vendor recorded", unit: "kg",
      totalQuantityReceived: 1000, totalCost: 3600, averageUnitCost: 3.6, masterUnitCost: null, variance: null,
    },
  ],
  totals: { quantity: 1200, cost: 8600 },
  params: { projectId: "p1", from: "2026-01-01", to: "2026-09-02", groupBy: "material" },
}

function baseData(overrides: Partial<MaterialCostReportPdfData> = {}): MaterialCostReportPdfData {
  return { org: ORG, projectName: "Riverside Business Park - Tower B", currency: "AED", report: REPORT, ...overrides }
}

describe("generateMaterialCostReportPdf", () => {
  test("produces a real, non-empty PDF with a valid %PDF header", () => {
    const buffer = generateMaterialCostReportPdf(baseData())
    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })

  test("a period with no receipts is still a valid PDF, not an error", () => {
    const buffer = generateMaterialCostReportPdf(
      baseData({ report: { rows: [], totals: { quantity: 0, cost: 0 }, params: REPORT.params } })
    )
    expect(buffer.byteLength).toBeGreaterThan(1000)
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })

  test("an org with no base currency still prints -- the money columns just carry no guessed token", () => {
    const buffer = generateMaterialCostReportPdf(baseData({ currency: null }))
    expect(Buffer.from(buffer.slice(0, 5)).toString("ascii")).toBe("%PDF-")
  })
})

describe("periodLabel", () => {
  test("both bounds read as a range", () => {
    expect(periodLabel("2026-01-01", "2026-09-02")).toBe("2026-01-01 to 2026-09-02")
  })

  test("one bound says which bound it is, rather than implying the other", () => {
    expect(periodLabel("2026-01-01", null)).toBe("from 2026-01-01")
    expect(periodLabel(null, "2026-09-02")).toBe("up to 2026-09-02")
  })

  test("no bounds says so in words -- never an empty sentence fragment", () => {
    expect(periodLabel(null, null)).toBe("all recorded receipts")
  })
})
