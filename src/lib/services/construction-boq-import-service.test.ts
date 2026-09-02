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
import { parseAmount } from "@/lib/gst/column-mapper"
import { deriveLineItemQuantityAndRate, type BoqLineItemInput } from "./construction-boq-service"

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

// RUN R10-21AUG, points 3/4/5: Sumeet's real BoQ export ("Sample Scope with
// Sub Task.xlsx") is NOT the same shape as the prospect-BoQ fixture above.
// That fixture gives category headers a BLANK Description (Task) and puts
// the header's name in Category -- so the pre-existing "no description"
// skip already caught it by accident. Sumeet's headers are the OPPOSITE
// shape: Sl No "1.00", Category blank, Description (Task) carries the
// header name IN CAPS ("PARTITION AND LINING"), QTY/RATE/AMOUNT all blank.
// A header shaped this way carries a description, so it was never caught,
// and imported as a zero-value line item.
//
// The file itself is not checked into either repo and no live server/DB was
// available to this run, so the full-file oracle figures (contract total
// 420,250.00; 33 parent items across 6 categories summing 85,408 / 66,730 /
// 34,320 / 55,577 / 10,800 / 167,415; 120 sub-tasks; 6 headers) could not be
// reproduced end to end here -- see cc_notes on points 1-5 in platform.cc_spec.
// This fixture instead demonstrates the same header/hierarchy mechanics at a
// smaller scale, anchored on the one fully-specified oracle datapoint: item
// 1.01, Frame 01 at a 30% breakdown, rate 108.00 / amount 50,976.00, giving
// Frame's own weighted rate 32.40 and amount 15,292.80.
describe("mapRowsToLineItems / parseBoqSpreadsheet -- Sumeet real-file shape (Sl No 'N.00', Category blank, header label in Description (Task))", () => {
  const HEADER_ROW = { "Sl No": "", "Category": "", "Dwg Code": "", "Description (Task)": "", "Sub Task": "", "QTY": "", "UNIT": "", "Breakdown %": "", "RATE": "", "AMOUNT": "" }

  test("category headers are skipped (not imported as zero-value line items); real tasks and their unlabeled sub-tasks import correctly, including the Frame 01 oracle datapoint", async () => {
    const rows = [
      { ...HEADER_ROW, "Sl No": "1.00", "Description (Task)": "PARTITION AND LINING" },
      { ...HEADER_ROW, "Sl No": "1.01", "Description (Task)": "Partition wall as per drawing and specification.", "QTY": 472, "UNIT": "Sqm", "RATE": 108, "AMOUNT": 50976 },
      { ...HEADER_ROW, "Sub Task": "Frame 01", "Breakdown %": 30, "AMOUNT": 15292.8 },
      { ...HEADER_ROW, "Sub Task": "Gypsum Board", "Breakdown %": 70, "AMOUNT": 35683.2 },
      { ...HEADER_ROW, "Sl No": "2.00", "Description (Task)": "FALSE CEILING" },
      { ...HEADER_ROW, "Sl No": "2.01", "Description (Task)": "False ceiling in gypsum board.", "QTY": 80, "UNIT": "Sqm", "RATE": 700, "AMOUNT": 56000 },
    ]
    const buffer = buildXlsxBuffer(rows)

    const result = await parseBoqSpreadsheet(buffer, "sumeet-boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    // 2 category headers, 2 real tasks, 2 sub-tasks under task 1.01 -- the 2
    // headers must be skipped, not counted among the parents/line items.
    expect(result.warnings.filter((w) => w.includes("category header"))).toHaveLength(2)
    expect(result.lineItems).toHaveLength(4)
    expect(result.lineItems.some((i) => i.description === "PARTITION AND LINING")).toBe(false)
    expect(result.lineItems.some((i) => i.description === "FALSE CEILING")).toBe(false)

    const task1 = result.lineItems.find((i) => i.itemCode === "1.01")!
    expect(task1.parentItemCode).toBeUndefined()
    expect(task1.quantity).toBe(472)
    expect(task1.rate).toBe(108)
    expect(task1.quantity * task1.rate).toBeCloseTo(50976, 5)

    const frame = result.lineItems.find((i) => i.description === "Frame 01")!
    expect(frame.parentItemCode).toBe("1.01")
    expect(frame.breakdownPercentage).toBe(30)
    // Oracle: Frame 01 at 30% on item 1.01 -> rate 32.40, amount 15292.80.
    expect(task1.rate * (frame.breakdownPercentage! / 100)).toBeCloseTo(32.4, 5)
    expect(task1.quantity * task1.rate * (frame.breakdownPercentage! / 100)).toBeCloseTo(15292.8, 5)

    const task2 = result.lineItems.find((i) => i.itemCode === "2.01")!
    expect(task2.parentItemCode).toBeUndefined()
  })

  // E-109: Excel stores a percentage-formatted cell as its underlying
  // fraction (a cell displaying "30%" is really the number 0.3), and that's
  // what a real Sumeet-authored file has -- confirmed directly against the
  // real "Sample Scope with Sub Task.xlsx" via openpyxl(data_only=True):
  // Frame 01's Breakdown % cell under item 1.01 is genuinely the raw value
  // 0.3, not the text "30%" and not the number 30. The plain-number mock
  // rows every other test in this file uses (`"Breakdown %": 30`) never
  // exercised this -- they inject the already-correct value directly,
  // which is why this bug shipped and stayed shipped. This test builds a
  // REAL percentage-formatted cell (number_format "0%") to reproduce it.
  test("a percentage-formatted Breakdown % cell (Excel fraction 0.3, displays as 30%) normalizes to the whole number 30, not 0.3", async () => {
    const rows = [
      { ...HEADER_ROW, "Sl No": "1.01", "Description (Task)": "Partition wall", "QTY": 472, "UNIT": "Sqm", "RATE": 108, "AMOUNT": 50976 },
      { ...HEADER_ROW, "Sub Task": "Frame 01", "AMOUNT": 15292.8 }, // Breakdown % set below as a real formatted cell
    ]
    const sheet = XLSX.utils.json_to_sheet(rows)
    const headerRow = Object.keys(rows[0])
    const breakdownCol = headerRow.indexOf("Breakdown %")
    const cellRef = XLSX.utils.encode_cell({ r: 2, c: breakdownCol }) // row index 2 = second data row (Frame 01)
    sheet[cellRef] = { t: "n", v: 0.3, z: "0%" } // the real Excel representation of a cell showing "30%"
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, "BoQ")
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer

    const result = await parseBoqSpreadsheet(buffer, "sumeet-boq-pct.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    const frame = result.lineItems.find((i) => i.description === "Frame 01")!
    expect(frame.breakdownPercentage).toBe(30)
    expect(frame.breakdownPercentage).not.toBe(0.3)
  })

  // Point 3's own acceptance test: without the header fix, both category
  // headers above would have imported as zero-value root "line items"
  // alongside the 2 real tasks (2 headers + 2 tasks = 4 root-shaped rows
  // instead of 2) -- the same 39-vs-33 inflation Sumeet's real file shows
  // at full scale. Assert the count directly, not just by description.
  test("root-level (parent) item count excludes headers", async () => {
    const rows = [
      { ...HEADER_ROW, "Sl No": "1.00", "Description (Task)": "PARTITION AND LINING" },
      { ...HEADER_ROW, "Sl No": "1.01", "Description (Task)": "Partition wall", "QTY": 472, "RATE": 108, "AMOUNT": 50976 },
      { ...HEADER_ROW, "Sl No": "2.00", "Description (Task)": "FALSE CEILING" },
      { ...HEADER_ROW, "Sl No": "2.01", "Description (Task)": "False ceiling", "QTY": 80, "RATE": 700, "AMOUNT": 56000 },
    ]
    const buffer = buildXlsxBuffer(rows)
    const result = await parseBoqSpreadsheet(buffer, "sumeet-boq-2.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    const roots = result.lineItems.filter((i) => !i.parentItemCode)
    expect(roots).toHaveLength(2) // "1.01" and "2.01" only -- not the 2 headers too
  })

  // Point 4: a header's Sl No cell rendered in "General" number format
  // ("1" instead of "1.00") must still never resolve as item 1.01's parent
  // via the dot-prefix rule, whatever the header's own cell formatting --
  // because the header itself never enters the parent-code candidate pool.
  test("a General-formatted header itemCode never becomes a false parent via dot-prefix inference", () => {
    const rows = [
      { code: "1", desc: "PARTITION AND LINING", qty: "", rate: "" }, // header, bare "1" not "1.00"
      { code: "1.01", desc: "Partition wall", qty: 472, rate: 108 },
    ]
    const mapping = { itemCode: "code", description: "desc", quantity: "qty", rate: "rate" } as const
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)

    expect(warnings.some((w) => w.includes("category header"))).toBe(true)
    expect(lineItems).toHaveLength(1)
    const task1 = lineItems.find((i) => i.itemCode === "1.01")!
    expect(task1.parentItemCode).toBeUndefined() // NOT "1" -- the header was never a candidate
  })

  // Point 5: a blank-Sl-No task row ("Reception Counter") must keep its own
  // unlabeled sub-tasks -- they must not be misattributed to whichever
  // numbered item preceded it (here "5.01"), across an intervening skipped
  // category header ("6.00 JOINERY").
  test("a blank-Sl-No task row keeps its own unlabeled sub-tasks; the preceding numbered item does not gain them", () => {
    const rows = [
      { slNo: "5.01", desc: "Skirting", qty: 40, rate: 60 },
      { slNo: "", desc: "6.00 JOINERY", qty: "", rate: "" }, // category header, skipped
      { slNo: "", desc: "Reception Counter", qty: 1, rate: 25000 }, // blank Sl No, real task
      { slNo: "", desc: "", sub: "Shutter", qty: "", rate: "", pct: 40 },
      { slNo: "", desc: "", sub: "Hardware", qty: "", rate: "", pct: 60 },
    ]
    const mapping = { itemCode: "slNo", description: "desc", subTask: "sub", quantity: "qty", rate: "rate", breakdownPercentage: "pct" } as const
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)

    expect(warnings.some((w) => w.includes("category header"))).toBe(true)

    const item501 = lineItems.find((i) => i.itemCode === "5.01")!
    const receptionCounter = lineItems.find((i) => i.description === "Reception Counter")!
    expect(receptionCounter.itemCode).toBeTruthy() // synthetic-but-stable code assigned
    expect(receptionCounter.itemCode).not.toBe("5.01")

    const subs = lineItems.filter((i) => i.description === "Shutter" || i.description === "Hardware")
    expect(subs).toHaveLength(2)
    for (const sub of subs) expect(sub.parentItemCode).toBe(receptionCounter.itemCode)
    for (const sub of subs) expect(sub.parentItemCode).not.toBe("5.01")

    // item 5.01 itself must not have gained Reception Counter's children.
    expect(lineItems.filter((i) => i.parentItemCode === "5.01")).toHaveLength(0)
    expect(item501.parentItemCode).toBeUndefined()
  })

  // Cycle 2 edge cases -----------------------------------------------------

  // Point 3 edge case: "a header row carrying a stray zero". The blank test
  // is deliberate (conditions: never use the itemCode's number format) --
  // it only catches a BLANK Qty/Rate. A header with a literal typed "0" is,
  // by that same rule, indistinguishable from a real zero-quantity line
  // item and is intentionally NOT skipped -- it still imports (not silently
  // dropped), just as a real zero-value row would.
  test("edge case: a header row with a stray literal '0' in Qty is not blank, so it is not skipped by the header test", () => {
    const rows = [{ code: "1.00", desc: "PARTITION AND LINING", qty: "0", rate: "" }]
    const mapping = { itemCode: "code", description: "desc", quantity: "qty", rate: "rate" } as const
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)
    expect(warnings.filter((w) => w.includes("category header"))).toHaveLength(0)
    expect(lineItems).toHaveLength(1)
    expect(lineItems[0].description).toBe("PARTITION AND LINING")
  })

  // Point 3 edge case: "a section with no items under it" -- two headers
  // back to back, no real task row between them.
  test("edge case: a section with no items under it produces no line items, just two skip warnings", () => {
    const rows = [
      { code: "1.00", desc: "PARTITION AND LINING", qty: "", rate: "" },
      { code: "2.00", desc: "FALSE CEILING", qty: "", rate: "" },
    ]
    const mapping = { itemCode: "code", description: "desc", quantity: "qty", rate: "rate" } as const
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)
    expect(lineItems).toHaveLength(0)
    expect(warnings.filter((w) => w.includes("category header"))).toHaveLength(2)
  })

  // Point 4 edge case: "a three-level BoQ" -- 1 / 1.1 / 1.1.1 -- dot-prefix
  // inference must still chain correctly through an extra level.
  test("edge case: a three-level BoQ (1 / 1.1 / 1.1.1) chains parentItemCode through both levels", () => {
    const rows = [
      { code: "1", desc: "Main", qty: 10, rate: 5 },
      { code: "1.1", desc: "Sub", qty: 4, rate: 5 },
      { code: "1.1.1", desc: "Sub-sub", qty: 1, rate: 5 },
    ]
    const mapping = { itemCode: "code", description: "desc", quantity: "qty", rate: "rate" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)
    expect(lineItems.find((i) => i.itemCode === "1")!.parentItemCode).toBeUndefined()
    expect(lineItems.find((i) => i.itemCode === "1.1")!.parentItemCode).toBe("1")
    expect(lineItems.find((i) => i.itemCode === "1.1.1")!.parentItemCode).toBe("1.1")
  })

  // Point 5 edge case: "two consecutive blank-Sl-No items" -- each gets its
  // own distinct synthetic anchor, and sub-tasks attach to the NEAREST
  // preceding one, not the first.
  test("edge case: two consecutive blank-Sl-No items each get a distinct anchor; sub-tasks attach to the nearest one", () => {
    const rows = [
      { slNo: "", desc: "Reception Counter", qty: 1, rate: 25000 },
      { slNo: "", desc: "Waiting Bench", qty: 2, rate: 8000 },
      { slNo: "", desc: "", sub: "Cushion", qty: "", rate: "", pct: 100 },
    ]
    const mapping = { itemCode: "slNo", description: "desc", subTask: "sub", quantity: "qty", rate: "rate", breakdownPercentage: "pct" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)
    const counter = lineItems.find((i) => i.description === "Reception Counter")!
    const bench = lineItems.find((i) => i.description === "Waiting Bench")!
    const cushion = lineItems.find((i) => i.description === "Cushion")!
    expect(counter.itemCode).not.toBe(bench.itemCode)
    expect(cushion.parentItemCode).toBe(bench.itemCode) // nearest preceding line item, not the first
    expect(cushion.parentItemCode).not.toBe(counter.itemCode)
  })

  // Point 5 edge case: "a sub-task before any line item" -- pre-existing
  // (unchanged) behavior: with no lastItemCode yet, the positional fallback
  // cannot attach it to anything, so it lands as an unparented item rather
  // than crashing or corrupting the rows around it.
  test("edge case: an unlabeled sub-task row before any line item does not crash and does not attach to anything", () => {
    const rows = [
      { slNo: "", desc: "", sub: "Orphan Sub-Task", qty: "", rate: "", pct: 50 },
      { slNo: "1.01", desc: "Real item", qty: 10, rate: 5 },
    ]
    const mapping = { itemCode: "slNo", description: "desc", subTask: "sub", quantity: "qty", rate: "rate", breakdownPercentage: "pct" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)
    expect(lineItems).toHaveLength(2)
    const orphan = lineItems.find((i) => i.description === "Orphan Sub-Task")!
    expect(orphan.parentItemCode).toBeUndefined()
    expect(lineItems.find((i) => i.itemCode === "1.01")!.parentItemCode).toBeUndefined()
  })

  // RUN R11-21AUG point 16: regression guard for R10's header fix (points
  // 3/4/5) -- the case that would have collapsed the contract total to near
  // zero if a header's Sl No happened to render bare ("1", "General" cell
  // format) instead of "1.00": without the fix, a real item "1.01" would
  // resolve its dot-prefix "1" against the (wrongly-imported) header's own
  // itemCode and become ITS child instead of a root item. Checks every line
  // item in the fixture, not just the one item most likely to collide.
  test("REGRESSION GUARD (R10 header fix): no line item ever resolves a skipped, General-formatted category header as its parent", () => {
    const rows = [
      { code: "1", desc: "PARTITION AND LINING", qty: "", rate: "" }, // header, General format "1" not "1.00"
      { code: "1.01", desc: "Partition wall", qty: 472, rate: 108 },
      { code: "1.02", desc: "Another item under the same section", qty: 10, rate: 5 },
    ]
    const mapping = { itemCode: "code", description: "desc", quantity: "qty", rate: "rate" } as const
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)

    expect(warnings.some((w) => w.includes("category header"))).toBe(true)
    expect(lineItems.find((i) => i.itemCode === "1")).toBeUndefined() // the header itself never became a line item
    for (const item of lineItems) expect(item.parentItemCode).not.toBe("1")
  })
})

// E-127 regression guard: the two BOQ write paths (this importer and
// construction-boq-service.ts's insertLineItems) must land on ONE child-rate
// convention, not two. Before the R45 seq 7 / E-127 fix, insertLineItems
// stored a child row's own submitted quantity/rate VERBATIM, so whatever this
// importer happened to parse off a sub-task row's (often blank -> 0) QTY/RATE
// cells could silently become the STORED value -- diverging from the
// Sumeet-confirmed rule (platform.sumeet_spec BOQ-10: QTY_child = QTY_root,
// RATE_child = RATE_root x breakdown%/100) even though AMOUNT stayed correct
// via the separate root-rollup path, exactly the "amount right, stored
// rate/qty wrong" defect real rows in the DB were found with (E-127 finding:
// child_rate=1/child_qty=1 fixture rows whose amount was already the correct
// 2,000/1,750/1,250 -- see the backfill this same closure applied). This test
// exercises the REAL cross-module chain: parse a Sumeet-shaped spreadsheet
// with this importer, then run every parsed child through the exact function
// insertLineItems calls at write time (deriveLineItemQuantityAndRate) -- so a
// future change to either module that lets the two conventions drift apart
// again fails HERE, not silently in production data.
describe("cross-module regression: importer output -> insertLineItems' derivation land on ONE convention (E-127)", () => {
  test("a parsed sub-task row's OWN quantity/rate (as the importer produced them) are irrelevant -- insertLineItems' derivation always recovers the Sumeet-confirmed F2/F3 values from the parsed hierarchy", async () => {
    const HEADER_ROW = { "Sl No": "", "Category": "", "Dwg Code": "", "Description (Task)": "", "Sub Task": "", "QTY": "", "UNIT": "", "Breakdown %": "", "RATE": "", "AMOUNT": "" }
    const rows = [
      { ...HEADER_ROW, "Sl No": "1.01", "Description (Task)": "Partition wall", "QTY": 472, "UNIT": "Sqm", "RATE": 108, "AMOUNT": 50976 },
      { ...HEADER_ROW, "Sub Task": "Frame 01", "Breakdown %": 30, "AMOUNT": 15292.8 },
      { ...HEADER_ROW, "Sub Task": "Gypsum Board 01", "Breakdown %": 15, "AMOUNT": 7646.4 },
    ]
    const buffer = buildXlsxBuffer(rows)
    const { lineItems } = await parseBoqSpreadsheet(buffer, "sumeet-boq-e127.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    // The importer itself parses a blank sub-task QTY/RATE cell as 0 -- this
    // is the exact un-derived state that used to leak into storage.
    const frame = lineItems.find((i) => i.description === "Frame 01")!
    const gypsum = lineItems.find((i) => i.description === "Gypsum Board 01")!
    expect(frame.quantity).toBe(0)
    expect(frame.rate).toBe(0)
    expect(gypsum.quantity).toBe(0)
    expect(gypsum.rate).toBe(0)

    // The same byItemCode map insertLineItems builds from the submission.
    const byItemCode = new Map(lineItems.filter((i) => i.itemCode).map((i) => [i.itemCode!, i] as [string, BoqLineItemInput]))

    const frameDerived = deriveLineItemQuantityAndRate(frame, byItemCode)
    const gypsumDerived = deriveLineItemQuantityAndRate(gypsum, byItemCode)

    // Sumeet-confirmed oracle (platform.sumeet_spec BOQ-10 worked example):
    // Frame 01 @ 30% on item 1.01 (qty 472, rate 108) -> qty 472, rate 32.40.
    expect(frameDerived).toEqual({ quantity: 472, rate: 32.4 })
    expect(gypsumDerived).toEqual({ quantity: 472, rate: 16.2 })

    // F4: amount derived from the WRITE-TIME values must match the sheet's
    // own printed amount -- the one invariant that was already correct
    // before this fix, now joined by F2/F3 holding on the STORED columns too.
    expect(frameDerived.quantity * frameDerived.rate).toBeCloseTo(15292.8, 5)
    expect(gypsumDerived.quantity * gypsumDerived.rate).toBeCloseTo(7646.4, 5)
  })
})

// RUN R11-21AUG point 6a (E-44): parseAmount used to strip only commas/
// whitespace/the rupee glyph -- a non-INR cell (Sumeet's contract is in
// AED) left its currency code in place ("AED50976.00"), parseFloat gave
// NaN, and the function silently returned 0. This directly affects the BOQ
// importer above (parseAmount is what construction-boq-import-service.ts
// uses for every quantity/rate/amount cell), so it's covered here rather
// than in a new, parallel test file for column-mapper.ts (which has none).
describe("parseAmount -- currency-prefix stripping (R11 point 6a / E-44)", () => {
  test("strips a leading currency CODE or symbol, not only the rupee glyph, before parsing", () => {
    expect(parseAmount("AED 50,976.00")).toBe(50976)
    expect(parseAmount("USD 1,200")).toBe(1200)
    expect(parseAmount("$1,200.50")).toBe(1200.5)
    expect(parseAmount("₹50,976.00")).toBe(50976) // existing rupee behaviour unchanged
  })

  test("percent strings are unaffected -- a leading digit is never stripped", () => {
    expect(parseAmount("30%")).toBe(30)
  })

  test("parenthesised negatives still work -- the currency-token strip never eats a leading '('", () => {
    expect(parseAmount("(100)")).toBe(-100)
  })

  // Edge case: a currency prefix AND a parenthesized negative together --
  // the compound case that motivated protecting "(" in the strip regex
  // instead of just reordering the two replace() calls.
  test("edge case: a currency-prefixed parenthesized negative keeps its sign", () => {
    expect(parseAmount("AED (100)")).toBe(-100)
  })

  // Edge case: a currency token with no number after it at all -- must fall
  // back to 0 (the function's existing not-a-number contract), not throw.
  test("edge case: a bare currency token with no number falls back to 0, does not throw", () => {
    expect(() => parseAmount("AED")).not.toThrow()
    expect(parseAmount("AED")).toBe(0)
  })

  test("already-numeric values and blanks are unaffected (return type/behaviour for valid input unchanged)", () => {
    expect(parseAmount(50976)).toBe(50976)
    expect(parseAmount("")).toBe(0)
    expect(parseAmount(undefined)).toBe(0)
    expect(parseAmount(null)).toBe(0)
  })
})

// RUN R11-21AUG point 14 (E-57): the importer has no amount alias -- every
// amount is recomputed as quantity x rate, and a printed amount that
// differs (rounding, a manual override, a discount baked into the sheet's
// own total) used to be silently replaced with no record of the
// difference. The recompute itself is UNCHANGED (still quantity x rate) --
// this only adds a warning when the sheet has an amount-like column and a
// real task row's printed amount doesn't match it.
describe("mapRowsToLineItems -- amount reconciliation warnings (R11 point 14 / E-57)", () => {
  test("a printed amount that differs from quantity x rate produces a warning, imports the recomputed value, and does not throw", () => {
    const rows = [{ slNo: "1.01", desc: "Real item", qty: 2008.0512, rate: 1, amt: 2008.05 }]
    const mapping = { itemCode: "slNo", description: "desc", quantity: "qty", rate: "rate", amount: "amt" } as const

    expect(() => mapRowsToLineItems(rows, mapping)).not.toThrow()
    const { lineItems, warnings } = mapRowsToLineItems(rows, mapping)

    expect(lineItems).toHaveLength(1)
    expect(lineItems[0].quantity).toBe(2008.0512)
    expect(lineItems[0].rate).toBe(1) // recomputed value (quantity x rate) is what's imported, not the printed 2008.05
    expect(warnings.some((w) => w.includes("recomputed") && w.includes("2008.05"))).toBe(true)
  })

  test("a printed amount that matches quantity x rate produces no reconciliation warning", () => {
    const rows = [{ slNo: "1.01", desc: "Real item", qty: 10, rate: 5, amt: 50 }]
    const mapping = { itemCode: "slNo", description: "desc", quantity: "qty", rate: "rate", amount: "amt" } as const
    const { warnings } = mapRowsToLineItems(rows, mapping)
    expect(warnings.filter((w) => w.includes("recomputed"))).toHaveLength(0)
  })

  test("no amount column mapped at all -- no reconciliation attempted, no crash", () => {
    const rows = [{ slNo: "1.01", desc: "Real item", qty: 10, rate: 5 }]
    const mapping = { itemCode: "slNo", description: "desc", quantity: "qty", rate: "rate" } as const
    expect(() => mapRowsToLineItems(rows, mapping)).not.toThrow()
    const { warnings } = mapRowsToLineItems(rows, mapping)
    expect(warnings.filter((w) => w.includes("recomputed"))).toHaveLength(0)
  })

  test("unlabeled sub-task rows are never reconciled against their own printed AMOUNT -- it's a weighted share of the parent's amount, not their own quantity x rate", () => {
    const rows = [
      { slNo: "1.01", desc: "Real item", qty: 100, rate: 10, amt: 1000 },
      { slNo: "", desc: "", sub: "Frame", qty: "", rate: "", pct: 30, amt: 300 }, // weighted share (30% of 1000), qty x rate here is 0
    ]
    const mapping = { itemCode: "slNo", description: "desc", subTask: "sub", quantity: "qty", rate: "rate", breakdownPercentage: "pct", amount: "amt" } as const
    const { warnings } = mapRowsToLineItems(rows, mapping)
    expect(warnings.filter((w) => w.includes("recomputed"))).toHaveLength(0)
  })
})

// RUN R11-21AUG point 15: the synthetic anchor for a blank-Sl-No line item
// (R10 point 5) is WRITTEN to compliance.construction_boq_line_items.
// item_code -- visible to exports and any API consumer of item_code, not
// just an internal join key -- so it must read as a plain generated line
// code, never as a debug artefact.
describe("mapRowsToLineItems -- synthetic anchor codes read as data, not debug artefacts (R11 point 15)", () => {
  test("a blank-Sl-No line item gets a neutral generated itemCode; no stored itemCode ever starts with '__'", () => {
    const rows = [
      { slNo: "5.01", desc: "Skirting", qty: 40, rate: 60 },
      { slNo: "", desc: "Reception Counter", qty: 1, rate: 25000 },
      { slNo: "", desc: "", sub: "Shutter", qty: "", rate: "", pct: 100 },
    ]
    const mapping = { itemCode: "slNo", description: "desc", subTask: "sub", quantity: "qty", rate: "rate", breakdownPercentage: "pct" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)

    for (const item of lineItems) if (item.itemCode) expect(item.itemCode.startsWith("__")).toBe(false)

    const receptionCounter = lineItems.find((i) => i.description === "Reception Counter")!
    expect(receptionCounter.itemCode).toBeTruthy()
    expect(receptionCounter.itemCode!.startsWith("__")).toBe(false)

    const shutter = lineItems.find((i) => i.description === "Shutter")!
    expect(shutter.parentItemCode).toBe(receptionCounter.itemCode) // still resolves correctly, just under the new naming
  })
})

// R67 lane I (WS-I item I-05, R-177): Sumeet's own "Category" header is mapped
// automatically, so an imported BOQ arrives categorised instead of landing
// entirely in the Work Progress Report's "Uncategorized" bucket. The
// declaration ORDER of BOQ_FIELD_ALIASES is load-bearing here -- see the
// service's own comment on the `category` key -- so the two sheet shapes that
// order protects are both pinned below.
describe("mapRowsToLineItems -- Category header mapping (R67 I-05)", () => {
  test("a sheet with BOTH Description and Category maps them to different fields", () => {
    const mapping = mapBoqHeaders(["Sl No", "Category", "Description (Task)", "Unit", "Qty", "Rate"])
    expect(mapping.description).toBe("Description (Task)")
    expect(mapping.category).toBe("Category")
  })

  test("a simple sheet with ONLY a Category column still uses it as the description -- today's behaviour, unchanged", () => {
    const mapping = mapBoqHeaders(["Sl No", "Category", "Unit", "Qty", "Rate"])
    expect(mapping.description).toBe("Category")
    expect(mapping.category).toBeUndefined()
  })

  test("each row's category is carried onto its line item, trimmed, with blank treated as absent", () => {
    const rows = [
      { code: "1", cat: " Civil ", desc: "Blockwork", unit: "sqm", qty: 100, rate: 50 },
      { code: "2", cat: "", desc: "Site clearance", unit: "ls", qty: 1, rate: 900 },
      { code: "3", cat: "Gypsum", desc: "Ceiling", unit: "sqm", qty: 20, rate: 120 },
    ]
    const mapping = { itemCode: "code", category: "cat", description: "desc", unit: "unit", quantity: "qty", rate: "rate" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)

    expect(lineItems.map((l) => l.category)).toEqual(["Civil", undefined, "Gypsum"])
  })

  test("a sub-task with a blank Category cell inherits its parent's, and never splits its parent's group", () => {
    const rows = [
      { code: "2", cat: "Gypsum", desc: "Main: Partition", unit: "sqm", qty: 100, rate: 50 },
      { code: "2.1", cat: "", desc: "Sub: Frame", unit: "sqm", qty: 0, rate: 0, pct: 40 },
      { code: "2.2", cat: "Joinery", desc: "Sub: Board", unit: "sqm", qty: 0, rate: 0, pct: 60 },
    ]
    const mapping = { itemCode: "code", category: "cat", description: "desc", unit: "unit", quantity: "qty", rate: "rate", breakdownPercentage: "pct" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)

    expect(lineItems.map((l) => l.category)).toEqual(["Gypsum", "Gypsum", "Joinery"])
  })

  test("an unlabeled sub-task attached to a SYNTHETIC anchor code still inherits that parent's category", () => {
    const rows = [
      { slNo: "", cat: "Joinery", desc: "Reception Counter", qty: 1, rate: 25000 },
      { slNo: "", cat: "", desc: "", sub: "Shutter", qty: "", rate: "", pct: 100 },
    ]
    const mapping = { itemCode: "slNo", category: "cat", description: "desc", subTask: "sub", quantity: "qty", rate: "rate", breakdownPercentage: "pct" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)

    const shutter = lineItems.find((i) => i.description === "Shutter")!
    expect(shutter.parentItemCode).toBe(lineItems[0].itemCode)
    expect(shutter.category).toBe("Joinery")
  })

  test("a row with no parent is never given another row's category", () => {
    const rows = [
      { code: "1", cat: "Civil", desc: "Blockwork", unit: "sqm", qty: 10, rate: 5 },
      { code: "2", cat: "", desc: "Standalone item", unit: "ls", qty: 1, rate: 100 },
    ]
    const mapping = { itemCode: "code", category: "cat", description: "desc", unit: "unit", quantity: "qty", rate: "rate" } as const
    const { lineItems } = mapRowsToLineItems(rows, mapping)
    expect(lineItems[1].category).toBeUndefined()
  })

  test("end to end through a real xlsx buffer: a Category column arrives on the parsed line items", async () => {
    const buffer = buildXlsxBuffer([
      { "Sl No": "1", Category: "Civil", "Description (Task)": "Blockwork", Unit: "sqm", Qty: 100, Rate: 50 },
      { "Sl No": "2", Category: "Paint", "Description (Task)": "Emulsion", Unit: "sqm", Qty: 200, Rate: 12 },
    ])
    const { lineItems, mapping } = await parseBoqSpreadsheet(buffer, "boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(mapping.category).toBe("Category")
    expect(lineItems.map((l) => l.category)).toEqual(["Civil", "Paint"])
  })
})

// R67 lane D22 (item D-52, rec R-176): the per-row preview the three-step
// import screen prints between "Choose file" and the commit. Pure, so the
// three edge cases the item names are provable without a spreadsheet.
import { analyseBoqPreview } from "./construction-boq-import-service"

describe("analyseBoqPreview (R67 D-52)", () => {
  const base = { description: "Line", unit: "m2", quantity: 2, rate: 100 }

  test("a clean row is 'ok' with no messages, and its amount is quantity x rate", () => {
    const { rows } = analyseBoqPreview([{ ...base, itemCode: "A-1", category: "Civil" }])
    expect(rows[0].status).toBe("ok")
    expect(rows[0].messages).toEqual([])
    expect(rows[0].amount).toBe(200)
  })

  test("a duplicate code flags BOTH occurrences -- one marked row cannot show which two collided", () => {
    const { rows } = analyseBoqPreview([
      { ...base, itemCode: "A-1", category: "Civil" },
      { ...base, itemCode: "B-2", category: "Civil" },
      { ...base, itemCode: "A-1", category: "Civil" },
    ])
    expect(rows.map((r) => r.status)).toEqual(["warning", "ok", "warning"])
    expect(rows[0].messages[0]).toBe("Duplicate code A-1 — appears 2 times")
    expect(rows[2].messages[0]).toBe("Duplicate code A-1 — appears 2 times")
  })

  test("the duplicate check is case-insensitive, so 'a-1' and 'A-1' are one code", () => {
    const { rows } = analyseBoqPreview([
      { ...base, itemCode: "A-1", category: "Civil" },
      { ...base, itemCode: "a-1", category: "Civil" },
    ])
    expect(rows.every((r) => r.status === "warning")).toBe(true)
  })

  test("a parent code appearing after its child is ACCEPTED and said so, not rejected", () => {
    const { rows, willImport } = analyseBoqPreview([
      { ...base, itemCode: "1.1", parentItemCode: "1", breakdownPercentage: 40, category: "Civil" },
      { ...base, itemCode: "1", category: "Civil" },
    ])
    expect(rows[0].messages).toEqual(["Parent code 1 appears later in the file — accepted, resolved after load"])
    expect(willImport).toBe(2)
  })

  test("a parent that already appeared above its child says nothing at all", () => {
    const { rows } = analyseBoqPreview([
      { ...base, itemCode: "1", category: "Civil" },
      { ...base, itemCode: "1.1", parentItemCode: "1", breakdownPercentage: 40, category: "Civil" },
    ])
    expect(rows[1].messages).toEqual([])
  })

  test("a blank category names the real downstream consequence, not just 'missing'", () => {
    const { rows } = analyseBoqPreview([{ ...base, itemCode: "A-1" }])
    expect(rows[0].messages).toEqual(["Category empty - WPR will show Uncategorized"])
    expect(rows[0].status).toBe("warning")
  })

  test("none of the three messages blocks -- every parsed row still imports", () => {
    const { willImport, totalParsed } = analyseBoqPreview([
      { ...base, itemCode: "A-1" },
      { ...base, itemCode: "A-1" },
    ])
    expect(willImport).toBe(2)
    expect(totalParsed).toBe(2)
  })
})

// R67 lane D22 (item D-52): the "Map columns" step's corrections.
import { applyMappingOverride } from "./construction-boq-import-service"

describe("applyMappingOverride (R67 D-52)", () => {
  const headers = ["Ref", "Description", "Qty", "Rate", "Unit"]
  const auto = { description: "Description", quantity: "Qty", rate: "Rate", unit: "Unit" }

  test("a correction is merged over the auto mapping -- the other fields do not have to be restated", () => {
    expect(applyMappingOverride(auto, { itemCode: "Ref" }, headers)).toEqual({ ...auto, itemCode: "Ref" })
  })

  test("an explicit empty string unmaps a field, which is a real thing a user can mean", () => {
    expect(applyMappingOverride(auto, { rate: "" }, headers)).toEqual({ description: "Description", quantity: "Qty", unit: "Unit" })
  })

  test("a correction naming a column that is not in the sheet is IGNORED, never stored", () => {
    // Storing it would make mapRowsToLineItems read row[undefined] for every
    // row and silently import blank descriptions.
    expect(applyMappingOverride(auto, { description: "Nope" }, headers)).toEqual(auto)
  })

  test("no override at all returns the auto mapping unchanged", () => {
    expect(applyMappingOverride(auto, undefined, headers)).toEqual(auto)
  })
})
