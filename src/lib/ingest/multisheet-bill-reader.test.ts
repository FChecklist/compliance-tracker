/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-01, register row AW-101: the raw ZOOMIES workbook is read by the deterministic multi-sheet reader with no
// model. 50 priced lines totalling 1,388,480 plus 3 flagged lump-sum lines totalling 207,800 reconcile to the file's own grand
// total of 1,596,280 (before VAT; 1,676,094 with VAT is printed on the summary sheet and is not a line).
//
// The workbook is a client document and is not in the repository. zoomies-digest.json (scripts/gen-zoomies-fixture.mjs) holds
// its sheet structure, descriptions, units, quantities, rates and subtotals, without the contractor's contact details, the payment
// terms and bank details, or the client's company name.
import { describe, expect, test } from "bun:test"
import fixture from "./__fixtures__/zoomies-digest.json"
import { readMultisheetBills, toBoqLineItems, parseNumberText } from "./multisheet-bill-reader"
import type { WorkbookGrid } from "./types"

const GRID = fixture as unknown as WorkbookGrid
const result = readMultisheetBills(GRID)
const sum = (values: number[]) => Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100

/** A copy of the fixture with one cell changed (sheet name, printed row number, cell index). */
function tampered(sheet: string, row: number, cell: number, text: string): WorkbookGrid {
  const copy = JSON.parse(JSON.stringify(GRID)) as WorkbookGrid
  const r = copy.sheets.find((s) => s.name === sheet)!.rows.find((x) => x.row === row)!
  r.cells[cell] = text
  return copy
}

describe("ZOOMIES workbook, read without a model", () => {
  test("50 priced lines total 1,388,480", () => {
    expect(result.lines).toHaveLength(50)
    expect(sum(result.lines.map((l) => l.amount))).toBe(1388480)
  })

  test("3 flagged lump-sum lines total 207,800: Bill 1A 175,000, Bill 1B 22,000, Play Bill 7 10,800", () => {
    expect(result.lumpSums).toHaveLength(3)
    expect(result.lumpSums.every((l) => l.flag === "lump_sum_from_total" && l.unit === "LS" && l.quantity === 1)).toBe(true)
    expect(result.lumpSums.map((l) => [l.area, l.bill, l.amount])).toEqual([
      ["Play Area", "1A", 175000],
      ["Play Area", "1B", 22000],
      ["Play Area", "7", 10800],
    ])
    expect(sum(result.lumpSums.map((l) => l.amount))).toBe(207800)
  })

  test("lines and lump sums add up to the grand total the file prints, 1,596,280, and the reader says so", () => {
    const all = sum([...result.lines.map((l) => l.amount), ...result.lumpSums.map((l) => l.amount)])
    expect(all).toBe(1596280)
    expect(result.totals.grand).toEqual({ computed: 1596280, declared: 1596280, reconciled: true })
    expect(result.totals.byArea.map((a) => [a.area, a.computed, a.declaredMain, a.declaredSubtotal])).toEqual([
      ["Play Area", 1343445, 1343445, 1343445],
      ["Vet Area", 252835, 252835, 252835],
    ])
    expect(result.reconciled).toBe(true)
    expect(result.diffs).toEqual([])
    expect(result.totals.checks).toBeGreaterThan(30)
  })

  test("VAT is read from the summary and checked: 5% of 1,596,280 is 79,814, and 1,676,094 with VAT is not a line", () => {
    expect(result.totals.vat).toEqual({ ratePercent: 5, amount: 79814, totalIncVat: 1676094, computedAmount: 79814, reconciled: true })
    const lineTotal = sum([...result.lines.map((l) => l.amount), ...result.lumpSums.map((l) => l.amount)])
    expect(lineTotal).not.toBe(1676094)
  })

  test("the two areas are ONE BOQ: categories carry the area and every item code is unique across sheets, with no dot", () => {
    const items = toBoqLineItems(result)
    expect(items).toHaveLength(53)
    const codes = items.map((i) => i.itemCode)
    expect(new Set(codes).size).toBe(codes.length)
    // A dot in an item code would make createBoq infer a parent line.
    expect(codes.some((c) => c!.includes("."))).toBe(false)
    expect(items.every((i) => i.parentItemCode === undefined)).toBe(true)
    expect(items.every((i) => /^(Play|Vet) Area - /.test(i.category!))).toBe(true)
    expect(new Set(items.map((i) => i.category!.split(" - ")[0]))).toEqual(new Set(["Play Area", "Vet Area"]))
    // Bill 3 exists in both areas and both restart their numbering at 1.
    expect(codes).toContain("PLAY-B3-01")
    expect(codes).toContain("VET-B3-01")
  })

  test("a line whose quantity has no rate is never created as a zero-priced line: it is a question", () => {
    expect(result.lines.every((l) => l.quantity > 0 && l.rate > 0 && l.amount > 0)).toBe(true)
    const noRate = result.questions.filter((q) => q.kind === "no_rate")
    expect(noRate).toHaveLength(21)
    expect(noRate.every((q) => q.itemCode !== null && (q.quantity ?? 0) > 0)).toBe(true)
    // "By Main Contractor", "Excluded", "Details required" are shown to the person as the sheet printed them.
    const details = new Set(noRate.map((q) => q.detail.toLowerCase()))
    expect(details.has("by main contractor")).toBe(true)
    expect(details.has("details required")).toBe(true)
    expect(details.has("excluded")).toBe(true)
    // None of them reached the lines or the lump sums' codes.
    const lineCodes = new Set(result.lines.map((l) => l.itemCode))
    expect(noRate.some((q) => lineCodes.has(q.itemCode!))).toBe(false)
  })

  test("22 rows with a quantity and no rate outside Bill 1A: 21 questions plus 1 covered by the Play Bill 7 lump sum; Bill 1A's 9 sit under its lump sum", () => {
    const glass = result.lumpSums.find((l) => l.bill === "7")!
    const prelim = result.lumpSums.find((l) => l.bill === "1A")!
    expect(glass.notItemised).toHaveLength(1)
    expect(prelim.notItemised).toHaveLength(9)
    expect(result.questions.filter((q) => q.kind === "no_rate").length + glass.notItemised.length).toBe(22)
    // One question per lump sum asks the person to confirm it.
    expect(result.questions.filter((q) => q.kind === "lump_sum")).toHaveLength(3)
  })

  test("cells that hold several lines pressed together are reported, never guessed", () => {
    expect(result.questions.filter((q) => q.kind === "packed_cell")).toHaveLength(2)
    const packedSheet = result.questions.filter((q) => q.kind === "packed_sheet")
    expect(packedSheet).toHaveLength(1)
    expect(packedSheet[0].bill).toBe("9")
  })

  test("a quantity typed with a stray character (` 13.20) reads as 13.2 and says it did", () => {
    const line = result.lines.find((l) => l.source.sheet === "Table 17" && l.source.row === 9)!
    expect(line.quantity).toBe(13.2)
    expect(line.amount).toBe(1452)
    expect(result.warnings.some((w) => w.source.sheet === "Table 17" && w.source.row === 9 && /stray character/.test(w.message))).toBe(true)
  })

  test("a description that runs over several rows is one line, and a level heading is kept with the lines under it", () => {
    const line = result.lines.find((l) => l.itemCode === "PLAY-B3-01")!
    expect(line.description).toContain("Acoustic Wall full height (floor to roof)")
    expect(line.description).toContain("125mm thick double layer")
    expect(line.description).toContain("Height: 8.5m")
    expect(line.description.startsWith("Ground Floor - ")).toBe(true)
    const mezzanine = result.lines.find((l) => l.itemCode === "PLAY-B3-08")!
    expect(mezzanine.description.startsWith("Mezzanine Floor - ")).toBe(true)
    // 12 priced lines in Bill 3 (Play), 2 unpriced ones: no description line became a line of its own.
    expect(result.lines.filter((l) => l.itemCode.startsWith("PLAY-B3-"))).toHaveLength(12)
  })

  test("Bill 4 continues over two sheets and is one bill; a bill the sheet numbers 1 but the summary calls 1A is read as 1A", () => {
    const bill4 = result.totals.byBill.find((b) => b.area === "Play Area" && b.bill === "4")!
    expect(bill4.sheets).toEqual(["Table 8", "Table 9"])
    expect(bill4.pricedLines).toBe(10)
    expect(bill4.computed).toBe(296920)
    expect(result.sheets.find((s) => s.name === "Table 4")!.bill).toBe("1A")
    expect(result.warnings.some((w) => w.source.sheet === "Table 4" && /read as Bill 1A/.test(w.message))).toBe(true)
  })

  test("the fixture holds no contact or bank details", () => {
    const text = JSON.stringify(fixture)
    expect(text).not.toMatch(/iban|a\/c|bank|swift|tel\.?\s*no|p\.?\s?o\.?\s?box|@|l\.l\.c|\bllc\b|adcb|accepted by/i)
  })

  test("a workbook whose lines do not add up to the printed totals is NOT reconciled and names the bill", () => {
    // Table 7 row 5 is Play Bill 3 item 1: quantity 351 changed to 350 takes 230 off the bill.
    const broken = readMultisheetBills(tampered("Table 7", 5, 3, "350"))
    expect(broken.reconciled).toBe(false)
    expect(broken.totals.grand.computed).toBe(1596050)
    const bill3 = broken.diffs.filter((d) => d.scope === "bill" && d.ref.startsWith("Bill 3 (Play Area)"))
    expect(bill3.length).toBeGreaterThan(0)
    expect(bill3.every((d) => d.difference === -230)).toBe(true)
    expect(broken.diffs.some((d) => d.scope === "grand" && d.expected === 1596280 && d.actual === 1596050)).toBe(true)
    // The reader does not bend a line to make the number match.
    expect(broken.lines.find((l) => l.itemCode === "PLAY-B3-01")!.quantity).toBe(350)
  })
})

describe("number cells typed as text", () => {
  test.each([
    ["351", 351, false],
    ["22,000.00", 22000, false],
    ["13.20", 13.2, false],
    ["` 13.20", 13.2, true],
    ["1 452", 1452, false],
  ])("%p reads as %p", (text, value, cleaned) => {
    expect(parseNumberText(text)).toEqual({ value, cleaned })
  })

  test.each(["-", "", "Excluded", "By Main Contractor", "Details required", "130.00\n111.00", "#VALUE!"])("%p is not a number", (text) => {
    expect(parseNumberText(text)).toBeNull()
  })
})
