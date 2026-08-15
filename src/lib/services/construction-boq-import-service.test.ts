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

describe("parseBoqSpreadsheet -- real prospect BoQ file shape", () => {
  // task-20260728-050606: reconstructs the structural quirks of a real
  // prospect-supplied BoQ export (Sl No/Category/Dwg Code/Description
  // (Task)/Sub Task/QTY/UNIT/Breakdown %/RATE/AMOUNT columns) -- category
  // header rows with no Sl No, numbered task rows ("1.01") with multi-line
  // descriptions containing an embedded "Location :<name>" annotation, and
  // unlabeled sub-task rows (Frame/Gypsum Board/Rockwool/Taping/Sanding)
  // that carry no Sl No or Description of their own, only a Sub Task label
  // and a Breakdown %. Before this test's fix, the importer mapped
  // "description" to the Category column (ahead of "Description (Task)" in
  // header order) and never recognized "Sl No" as itemCode at all -- it
  // dropped all 9 real task/sub-task rows and kept only 2 garbage rows
  // (the bare category labels, qty=0, rate=0).
  test("category headers skipped, multi-line description with embedded location preserved, unlabeled sub-tasks attached to their parent task with correct breakdown %", async () => {
    const HEADER_ROW = { "Sl No": "", "Category": "", "Dwg Code": "", "Description (Task)": "", "Sub Task": "", "QTY": "", "UNIT": "", "Breakdown %": "", "RATE": "", "AMOUNT": "" }
    const rows = [
      { ...HEADER_ROW, "Category": "PARTITION AND LINING" },
      { ...HEADER_ROW, "Sl No": "1.01", "Dwg Code": "A-101", "Description (Task)": "Providing and fixing partition wall as per drawing and specification.\nLocation :Veterinary Clinic", "QTY": 120, "UNIT": "Sqm", "RATE": 850, "AMOUNT": 102000 },
      { ...HEADER_ROW, "Sub Task": "Frame", "Breakdown %": 20, "AMOUNT": 20400 },
      { ...HEADER_ROW, "Sub Task": "Gypsum Board", "Breakdown %": 30, "AMOUNT": 30600 },
      { ...HEADER_ROW, "Sub Task": "Rockwool", "Breakdown %": 15, "AMOUNT": 15300 },
      { ...HEADER_ROW, "Sub Task": "Taping", "Breakdown %": 20, "AMOUNT": 20400 },
      { ...HEADER_ROW, "Sub Task": "Sanding", "Breakdown %": 15, "AMOUNT": 15300 },
      { ...HEADER_ROW, "Category": "FALSE CEILING" },
      { ...HEADER_ROW, "Sl No": "2.01", "Dwg Code": "A-102", "Description (Task)": "Providing and fixing false ceiling in gypsum board.\nLocation :Reception Area", "QTY": 80, "UNIT": "Sqm", "RATE": 700, "AMOUNT": 56000 },
      { ...HEADER_ROW, "Sub Task": "Frame", "Breakdown %": 40, "AMOUNT": 22400 },
      { ...HEADER_ROW, "Sub Task": "Gypsum Board", "Breakdown %": 60, "AMOUNT": 33600 },
    ]
    const buffer = buildXlsxBuffer(rows)

    const result = await parseBoqSpreadsheet(buffer, "prospect-boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    expect(result.mapping.itemCode).toBe("Sl No")
    expect(result.mapping.description).toBe("Description (Task)")
    expect(result.mapping.subTask).toBe("Sub Task")

    // The 2 category header rows have neither a Description (Task) nor a Sub
    // Task value -- they carry no line-item data and must be skipped, not
    // turned into garbage line items.
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.every((w) => w.includes("skipped"))).toBe(true)
    expect(result.lineItems).toHaveLength(9)

    const task1 = result.lineItems.find((i) => i.itemCode === "1.01")!
    expect(task1.parentItemCode).toBeUndefined()
    expect(task1.quantity).toBe(120)
    expect(task1.rate).toBe(850)
    expect(task1.description).toBe("Providing and fixing partition wall as per drawing and specification.\nLocation :Veterinary Clinic")
    expect(task1.description).toContain("Location :Veterinary Clinic")

    const task1Subs = result.lineItems.filter((i) => i.parentItemCode === "1.01")
    expect(task1Subs.map((s) => s.description)).toEqual(["Frame", "Gypsum Board", "Rockwool", "Taping", "Sanding"])
    expect(task1Subs.map((s) => s.breakdownPercentage)).toEqual([20, 30, 15, 20, 15])
    expect(task1Subs.reduce((sum, s) => sum + (s.breakdownPercentage ?? 0), 0)).toBe(100)

    const task2 = result.lineItems.find((i) => i.itemCode === "2.01")!
    expect(task2.parentItemCode).toBeUndefined()
    expect(task2.description).toContain("Location :Reception Area")

    const task2Subs = result.lineItems.filter((i) => i.parentItemCode === "2.01")
    expect(task2Subs).toHaveLength(2)
    expect(task2Subs.map((s) => s.description)).toEqual(["Frame", "Gypsum Board"])
    expect(task2Subs.map((s) => s.breakdownPercentage)).toEqual([40, 60])

    // Sub-tasks under task 1.01 must never be misattributed to task 2.01 or
    // vice versa -- positional inference must reset at each new task row.
    for (const sub of task1Subs) expect(sub.parentItemCode).not.toBe("2.01")
    for (const sub of task2Subs) expect(sub.parentItemCode).not.toBe("1.01")
  })
})
