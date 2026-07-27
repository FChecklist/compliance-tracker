// Excel BoQ importer (Owner directive, PROJEXA_ERP_END_TO_END_REQUIREMENT_
// ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27). parseBoqSpreadsheet
// only touches xlsx parsing (src/lib/ingest/parser.ts's parseFile, already
// covered by its own tests elsewhere) and pure row-mapping -- no DB access
// at all, so this test builds a REAL xlsx buffer in-memory (via the `xlsx`
// package, already a real dependency) and runs it through the actual parser,
// rather than mocking anything.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { parseBoqSpreadsheet, mapBoqHeaders, mapRowsToLineItems } from "./construction-boq-import-service"

function buildXlsxBuffer(rows: Record<string, string | number>[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, "BoQ")
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("mapBoqHeaders", () => {
  test("maps a realistic BoQ header row (S.No/Description/Unit/Qty/Rate/Breakdown %)", () => {
    const mapping = mapBoqHeaders(["S.No", "Description", "Unit", "Qty", "Rate", "Breakdown %"])
    expect(mapping).toEqual({ itemCode: "S.No", description: "Description", unit: "Unit", quantity: "Qty", rate: "Rate", breakdownPercentage: "Breakdown %" })
  })
})

describe("mapRowsToLineItems -- dot-delimited item-code hierarchy inference", () => {
  test("sub-tasks under a main item (code '2.1'/'2.2' under '2') get parentItemCode inferred with no explicit parent column", () => {
    const rows = [
      { code: "2", desc: "Main: RCC Column Work", unit: "cum", qty: 100, rate: 50 },
      { code: "2.1", desc: "Sub: Formwork", unit: "cum", qty: 0, rate: 0, pct: 40 },
      { code: "2.2", desc: "Sub: Concreting", unit: "cum", qty: 0, rate: 0, pct: 60 },
    ]
    const mapping = { itemCode: "code", description: "desc", unit: "unit", quantity: "qty", rate: "rate", breakdownPercentage: "pct" } as const
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)

    expect(warnings).toHaveLength(0)
    expect(lineItems).toHaveLength(3)
    expect(lineItems[0]).toMatchObject({ itemCode: "2", parentItemCode: undefined, quantity: 100, rate: 50 })
    expect(lineItems[1]).toMatchObject({ itemCode: "2.1", parentItemCode: "2", breakdownPercentage: 40 })
    expect(lineItems[2]).toMatchObject({ itemCode: "2.2", parentItemCode: "2", breakdownPercentage: 60 })
  })

  test("a row with no description is skipped with a warning, not silently dropped", () => {
    const rows = [{ desc: "Real item", unit: "nos", qty: 1, rate: 100 }, { desc: "", unit: "nos", qty: 1, rate: 100 }]
    const mapping = { description: "desc", unit: "unit", quantity: "qty", rate: "rate" }
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)
    expect(lineItems).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("skipped")
  })

  test("missing a Description/Quantity/Rate column throws a clear 400 error rather than silently producing garbage", () => {
    expect(() => mapRowsToLineItems([{ a: 1 }], { quantity: "a", rate: "a" })).toThrow(/Description/)
    expect(() => mapRowsToLineItems([{ a: 1 }], { description: "a", rate: "a" })).toThrow(/Quantity/)
    expect(() => mapRowsToLineItems([{ a: 1 }], { description: "a", quantity: "a" })).toThrow(/Rate/)
  })
})

describe("parseBoqSpreadsheet -- real xlsx buffer end to end", () => {
  test("a realistic hierarchical BoQ workbook (Owner's 'Sample Scope with Sub Task' shape) parses into correct hierarchical line items", async () => {
    const buffer = buildXlsxBuffer([
      { "S.No": "1", "Description": "Excavation", "Unit": "cum", "Qty": 500, "Rate": 120 },
      { "S.No": "2", "Description": "RCC Column Work", "Unit": "cum", "Qty": 100, "Rate": 50 },
      { "S.No": "2.1", "Description": "Formwork", "Unit": "cum", "Qty": 0, "Rate": 0, "Breakdown %": 40 },
      { "S.No": "2.2", "Description": "Reinforcement", "Unit": "cum", "Qty": 0, "Rate": 0, "Breakdown %": 35 },
      { "S.No": "2.3", "Description": "Concreting", "Unit": "cum", "Qty": 0, "Rate": 0, "Breakdown %": 25 },
    ])

    const result = await parseBoqSpreadsheet(buffer, "sample-scope-with-sub-task.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    expect(result.totalRows).toBe(5)
    expect(result.warnings).toHaveLength(0)
    expect(result.lineItems).toHaveLength(5)

    const main = result.lineItems.find((i) => i.itemCode === "2")!
    expect(main.parentItemCode).toBeUndefined()
    expect(main.quantity).toBe(100)
    expect(main.rate).toBe(50)

    const subs = result.lineItems.filter((i) => i.itemCode?.startsWith("2."))
    expect(subs).toHaveLength(3)
    for (const sub of subs) expect(sub.parentItemCode).toBe("2")
    expect(subs.map((s) => s.breakdownPercentage)).toEqual([40, 35, 25])

    const topLevel = result.lineItems.find((i) => i.itemCode === "1")!
    expect(topLevel.parentItemCode).toBeUndefined()
  })
})
