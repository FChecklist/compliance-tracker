/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { reportTitleFromSlug, schemaFromTable, xlsxSafeRows } from "./report-table-document"

describe("report-table-document (Sumeet R-C15 / R-C11)", () => {
  test("titles come from the slug", () => {
    expect(reportTitleFromSlug("manpower-daily-summary")).toBe("Manpower Daily Summary")
  })

  test("a table's units become document column types, totals get a label column", () => {
    const schema = schemaFromTable("manpower-cost", {
      columns: [
        { key: "trade", label: "Trade", unit: "text", align: "left" },
        { key: "workerDays", label: "Worker-days", unit: "number", align: "right" },
        { key: "totalCost", label: "Cost", unit: "currency", align: "right" },
        { key: "pct", label: "Done", unit: "percent", align: "right" },
      ],
      totals: { workerDays: 4, totalCost: 720, notAColumn: 9 },
    })
    expect(schema.columns.map((c) => c.type)).toEqual(["text", "number", "money", "percent"])
    expect(schema.totals).toEqual(["workerDays", "totalCost"])
    expect(schema.totalLabelColumn).toBe("trade")
    expect(schema.sheetName).toBe("Manpower Cost")
  })

  test("a table with no totals has no total row", () => {
    const schema = schemaFromTable("kpi", { columns: [{ key: "a", label: "A", unit: "text", align: "left" }] })
    expect(schema.totals).toBeUndefined()
  })

  test("text starting with = + - @ is guarded for the spreadsheet; numbers are left alone", () => {
    expect(xlsxSafeRows([{ a: "=SUM(A1)", b: "+1", c: "-x", d: "@y", e: "plain", f: -5 }])).toEqual([
      { a: "'=SUM(A1)", b: "'+1", c: "'-x", d: "'@y", e: "plain", f: -5 },
    ])
  })
})
