/// <reference types="bun-types" />
// R67 E-12 (R-136). The report document, asserted on the REAL bytes: what the
// header row of a generated .xlsx actually says, in what order, and what the
// grand-total row carries.
import { describe, expect, test } from "bun:test"
import {
  EMPTY,
  REPORT_EXPORT_SCHEMAS,
  buildExportRows,
  reportCsv,
  reportExportSchema,
  reportXlsxBuffer,
  schemaColumnLabels,
  sumColumn,
  xlsxRows,
} from "./report-export"

// Two BOQ lines, shaped exactly as boqBudgetVarianceReport projects them.
const LINES = [
  {
    sNo: 1, category: "Civil", code: "1.1", description: "Excavation in ordinary soil",
    quantity: 120, rate: 45, amount: 5400, budget: 4320,
    vendorId: "v-1", vendorName: "Alpha Contracting", vendorAmount: 4500, variance: 180,
  },
  {
    sNo: 2, category: "Paint", code: "2.1", description: "Two coats emulsion, internal",
    quantity: 300, rate: 12, amount: 3600, budget: 2880,
    vendorId: null, vendorName: null, vendorAmount: null, variance: null,
  },
]

describe("the project-status document (R67 E-12)", () => {
  test("ACCEPTANCE: the xlsx export's first row is exactly the schema's column labels", () => {
    const schema = reportExportSchema("project-status")!
    const buffer = reportXlsxBuffer(schema, LINES)
    const rows = xlsxRows(buffer)

    expect(rows[0]).toEqual(["Category", "Code", "Description", "Budget", "Vendor", "Vendor amount"])
    // ...and that IS the schema, not a coincidence of this fixture.
    expect(rows[0]).toEqual(schemaColumnLabels(schema))
  })

  test("the rows under that header are the lines, in schema order, with a grand total last", () => {
    const schema = reportExportSchema("project-status")!
    const rows = xlsxRows(reportXlsxBuffer(schema, LINES))

    expect(rows[1]).toEqual(["Civil", "1.1", "Excavation in ordinary soil", 4320, "Alpha Contracting", 4500])
    // An absent vendor is the en dash, never 0 and never blank -- "not let" and
    // "let for nothing" are different facts about a BOQ line.
    expect(rows[2]).toEqual(["Paint", "2.1", "Two coats emulsion, internal", 2880, EMPTY, EMPTY])
    expect(rows[3]).toEqual(["Grand Total", "", "", 7200, "", 4500])
  })

  test("a total the service already single-rounded is used AS GIVEN, never re-summed from the display figures", () => {
    const schema = reportExportSchema("project-status")!
    // The service's own totalBudget, which rounds once at the end over raw
    // values; re-adding the rounded per-line figures would drift from it.
    const rows = buildExportRows(schema, LINES, { budget: 7199.99, vendorAmount: 4500 })
    expect(rows[rows.length - 1]).toMatchObject({ Budget: 7199.99, "Vendor amount": 4500 })
  })
})

describe("the budget-variance document keeps Sumeet 6.png II(iii)'s columns (R67 E-12)", () => {
  test("its header is the eleven columns the Cost Variance table shows, in the same order", () => {
    const schema = reportExportSchema("budget-variance")!
    expect(xlsxRows(reportXlsxBuffer(schema, LINES))[0]).toEqual([
      "S.No", "Category", "Code", "Description", "Qty", "Rate", "Amt", "Budget", "Vendor", "Vendor Amt", "Variance",
    ])
  })

  test("its grand total carries the words in the S.No column and totals only the money columns", () => {
    const schema = reportExportSchema("budget-variance")!
    const rows = buildExportRows(schema, LINES)
    expect(rows[rows.length - 1]).toEqual({
      "S.No": "Grand Total", Category: "", Code: "", Description: "", Qty: "", Rate: "", Amt: "",
      Budget: 7200, Vendor: "", "Vendor Amt": 4500, Variance: 180,
    })
  })

  test("the CSV is the same document -- same header, same order, same grand total", () => {
    const schema = reportExportSchema("budget-variance")!
    const lines = reportCsv(schema, LINES).split("\n")
    expect(lines[0]).toBe("S.No,Category,Code,Description,Qty,Rate,Amt,Budget,Vendor,Vendor Amt,Variance")
    expect(lines[lines.length - 1]).toBe("Grand Total,,,,,,,7200,,4500,180")
  })
})

describe("the rules the documents share (R67 E-12)", () => {
  test("no column label is a camelCase key -- that defect is what the schema exists to close", () => {
    for (const schema of Object.values(REPORT_EXPORT_SCHEMAS)) {
      for (const column of schema.columns) {
        expect(column.label).not.toMatch(/^[a-z]+[A-Z]/)
        expect(column.label.length).toBeGreaterThan(0)
      }
    }
  })

  test("every totalled column really exists on the schema, so a total can never be orphaned", () => {
    for (const schema of Object.values(REPORT_EXPORT_SCHEMAS)) {
      const keys = new Set(schema.columns.map((c) => c.key))
      for (const key of schema.totals ?? []) expect(keys.has(key)).toBe(true)
      if (schema.totalLabelColumn) expect(keys.has(schema.totalLabelColumn)).toBe(true)
    }
  })

  test("a row missing a schema key still fills the column, so the header can never shift under the data", () => {
    const schema = reportExportSchema("project-status")!
    const rows = xlsxRows(reportXlsxBuffer(schema, [{ code: "9.9" }]))
    expect(rows[0]).toEqual(schemaColumnLabels(schema))
    expect(rows[1]).toEqual([EMPTY, "9.9", EMPTY, EMPTY, EMPTY, EMPTY])
  })

  test("a column with no figure anywhere totals to null, not to zero", () => {
    expect(sumColumn([{ vendorAmount: null }, { vendorAmount: null }], "vendorAmount")).toBeNull()
    expect(sumColumn([{ vendorAmount: 1.005 }, { vendorAmount: 2.005 }], "vendorAmount")).toBe(3.01)
  })

  test("an unknown slug has no schema, and says so rather than inventing one", () => {
    expect(reportExportSchema("not-a-report")).toBeNull()
  })
})
