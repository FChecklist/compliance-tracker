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
})
