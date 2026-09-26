/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-01, register row AW-102: the summary sheets of the ZOOMIES workbook (Table 2, Table 3, Table 14) are never
// read as bills, and each bill's lines reconcile to the subtotal the bill prints ("CARRIED TO COLLECTION") and to the summary.
//
// Why the first half matters: Table 3 and Table 14 print an amount and a cost per m2 in the columns a bill uses for quantity and
// rate. A reader that takes "any row with two numbers in those columns" reads Table 14 as an AED 250 million line.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fixture from "./__fixtures__/zoomies-digest.json"
import { readMultisheetBills } from "./multisheet-bill-reader"
import { readWorkbookGrid } from "./parser"
import type { WorkbookGrid } from "./types"

const GRID = fixture as unknown as WorkbookGrid
const result = readMultisheetBills(GRID)
const GRAND_TOTAL = 1596280

function withCell(grid: WorkbookGrid, sheet: string, row: number, cell: number, text: string): WorkbookGrid {
  const copy = JSON.parse(JSON.stringify(grid)) as WorkbookGrid
  copy.sheets.find((s) => s.name === sheet)!.rows.find((r) => r.row === row)!.cells[cell] = text
  return copy
}

describe("summary sheets are never read as bills", () => {
  test("Table 2, Table 3 and Table 14 are summaries, the cover is a cover, and every other sheet is a bill", () => {
    const kinds = Object.fromEntries(result.sheets.map((s) => [s.name, s.kind]))
    expect(kinds["Table 1"]).toBe("cover")
    expect(kinds["Table 2"]).toBe("summary")
    expect(kinds["Table 3"]).toBe("summary")
    expect(kinds["Table 14"]).toBe("summary")
    const bills = result.sheets.filter((s) => s.kind === "bill").map((s) => s.name)
    expect(bills).toHaveLength(18)
    expect(bills).not.toContain("Table 3")
    expect(bills).not.toContain("Table 14")
  })

  test("no line, lump sum or question comes from a summary sheet, and no line is worth more than the grand total", () => {
    const summarySheets = new Set(["Table 1", "Table 2", "Table 3", "Table 14"])
    expect(result.lines.some((l) => summarySheets.has(l.source.sheet))).toBe(false)
    expect(result.lumpSums.some((l) => summarySheets.has(l.source.sheet))).toBe(false)
    expect(result.questions.some((q) => summarySheets.has(q.source.sheet))).toBe(false)
    expect(Math.max(...result.lines.map((l) => l.amount))).toBeLessThan(GRAND_TOTAL)
    expect(Math.max(...result.lines.map((l) => l.amount))).toBe(98550)
    expect(result.lines.every((l) => l.quantity * l.rate < GRAND_TOTAL)).toBe(true)
  })

  test("a summary-shaped sheet with big numbers in the columns after the description yields nothing", () => {
    const grid: WorkbookGrid = {
      sheets: [
        {
          name: "Roll-up",
          rows: [
            { row: 1, cells: ["GRAND SUMMARY (VET)"] },
            { row: 2, cells: ["ITEM", "DESCRIPTION", "", "TOTAL AMOUNT", "Cost/Sqm"] },
            { row: 3, cells: ["BILL 3", "PARTITION AND LINING", "", "955260089", "266.9"] },
            { row: 4, cells: ["BILL 4", "FLOOR FINISHES", "", "250175997", "208.53"] },
          ],
        },
      ],
    }
    const r = readMultisheetBills(grid)
    expect(r.sheets[0].kind).toBe("summary")
    expect(r.lines).toEqual([])
    expect(r.lumpSums).toEqual([])
  })
})

describe("each bill reconciles to what it prints", () => {
  // area, bill, priced lines, sum of priced lines, lump sum, the bill's own CARRIED TO COLLECTION, the summary sheet's row
  const EXPECTED: [string, string, number, number, number, number | null, number | null][] = [
    ["Play Area", "1A", 0, 0, 175000, null, 175000],
    ["Play Area", "1B", 0, 0, 22000, 22000, 22000],
    ["Play Area", "2", 0, 0, 0, 0, 0],
    ["Play Area", "3", 12, 280570, 0, 280570, 280570],
    ["Play Area", "4", 10, 296920, 0, 296920, 296920],
    ["Play Area", "5", 7, 369010, 0, 369010, 369010],
    ["Play Area", "6", 3, 189145, 0, 189145, 189145],
    ["Play Area", "7", 0, 0, 10800, 10800, 10800],
    ["Play Area", "9", 0, 0, 0, 0, 0],
    ["Vet Area", "1", 0, 0, 0, 0, 0],
    ["Vet Area", "2", 0, 0, 0, 0, 0],
    ["Vet Area", "3", 4, 85408, 0, 85408, 85408],
    ["Vet Area", "4", 6, 66730, 0, 66730, 66730],
    ["Vet Area", "5", 3, 34320, 0, 34320, 34320],
    ["Vet Area", "6", 4, 55577, 0, 55577, 55577],
    ["Vet Area", "7", 1, 10800, 0, 10800, 10800],
    ["Vet Area", "9", 0, 0, 0, 0, 0],
  ]

  test("per-bill totals: priced lines, lump sum, the bill's own subtotal and the summary row", () => {
    expect(result.totals.byBill.map((b) => [b.area, b.bill, b.pricedLines, b.pricedSum, b.lumpSum, b.carried, b.summary])).toEqual(EXPECTED)
    expect(result.totals.byBill.every((b) => b.reconciled)).toBe(true)
    // What a bill prints is what its lines add up to, to the fils.
    for (const b of result.totals.byBill) {
      if (b.carried !== null) expect(b.computed).toBe(b.carried)
      if (b.summary !== null) expect(b.computed).toBe(b.summary)
    }
  })

  test("a bill subtotal the sheet prints differently from its lines is a diff, never adjusted", () => {
    // Table 10 row 40 is Play Bill 5's CARRIED TO COLLECTION, 369,010; the lines add up to that.
    const r = readMultisheetBills(withCell(GRID, "Table 10", 40, 5, "369000"))
    expect(r.reconciled).toBe(false)
    const diff = r.diffs.find((d) => d.scope === "bill" && d.ref === "Bill 5 (Play Area) carried to collection")!
    expect(diff).toMatchObject({ expected: 369000, actual: 369010, difference: 10 })
    expect(r.totals.byBill.find((b) => b.area === "Play Area" && b.bill === "5")!.reconciled).toBe(false)
    // The other bills are unaffected.
    expect(r.totals.byBill.filter((b) => !b.reconciled)).toHaveLength(1)
  })

  test("a summary row that disagrees with the bill is a diff against the summary", () => {
    // Table 14 row 11 is the Vet summary's Bill 3 row (85,408).
    const r = readMultisheetBills(withCell(GRID, "Table 14", 11, 3, "85000"))
    expect(r.reconciled).toBe(false)
    expect(r.diffs.some((d) => d.scope === "bill" && d.ref === "Bill 3 (Vet Area) summary" && d.expected === 85000 && d.actual === 85408)).toBe(true)
  })

  test("a bill the summary prices but that has no sheet is reported", () => {
    const withoutBill3 = JSON.parse(JSON.stringify(GRID)) as WorkbookGrid
    withoutBill3.sheets = withoutBill3.sheets.filter((s) => s.name !== "Table 17")
    const r = readMultisheetBills(withoutBill3)
    expect(r.reconciled).toBe(false)
    expect(r.diffs.some((d) => d.scope === "summary" && d.ref === "Bill 3 (Vet Area)" && d.expected === 85408)).toBe(true)
  })

  test("a grand total that the summary's own area rows contradict is reported", () => {
    const r = readMultisheetBills(withCell(GRID, "Table 2", 10, 3, "1600000"))
    expect(r.diffs.some((d) => d.scope === "summary" && d.ref === "summary sheet" && d.expected === 1600000 && d.actual === GRAND_TOTAL)).toBe(true)
    expect(r.reconciled).toBe(false)
  })

  test("VAT that is not the printed rate of the grand total is reported", () => {
    const r = readMultisheetBills(withCell(GRID, "Table 2", 11, 3, "79000"))
    expect(r.totals.vat!.reconciled).toBe(false)
    expect(r.diffs.some((d) => d.scope === "vat")).toBe(true)
  })
})

describe("reconciled needs something to reconcile against", () => {
  const bill = (carried: string[] | null): WorkbookGrid => ({
    sheets: [
      {
        name: "Bill",
        rows: [
          { row: 1, cells: ["BILL No. 1 - CIVIL"] },
          { row: 2, cells: ["ITEM", "DESCRIPTION", "UNIT", "QUANTITY", "RATE", "AMOUNT"] },
          { row: 3, cells: ["1", "Excavation", "m3", "10", "5", "50"] },
          { row: 4, cells: ["2", "Backfill", "m3", "4", "2.50", "10"] },
          ...(carried ? [{ row: 5, cells: carried }] : []),
        ],
      },
    ],
  })

  test("a bill with its own subtotal and no summary reconciles on that alone", () => {
    const r = readMultisheetBills(bill(["CARRIED TO COLLECTION", "", "", "", "AED", "60"]))
    expect(r.lines.map((l) => [l.itemCode, l.amount])).toEqual([["B1-01", 50], ["B1-02", 10]])
    expect(r.totals.checks).toBe(1)
    expect(r.reconciled).toBe(true)
  })

  test("the same bill with a wrong subtotal is not reconciled", () => {
    const r = readMultisheetBills(bill(["CARRIED TO COLLECTION", "", "", "", "AED", "70"]))
    expect(r.reconciled).toBe(false)
    expect(r.diffs[0]).toMatchObject({ scope: "bill", expected: 70, actual: 60, difference: -10 })
  })

  test("with nothing printed to compare against, the reader does not claim to have reconciled", () => {
    const r = readMultisheetBills(bill(null))
    expect(r.lines).toHaveLength(2)
    expect(r.totals.checks).toBe(0)
    expect(r.reconciled).toBe(false)
  })
})

// The real workbook, read from the local disk. Skipped in CI (the file is a client document and is not in the repository):
//   ZOOMIES_WORKBOOK_PATH="C:\Users\Dell\Downloads\SMD.ZOOMIES, DIP, FP.DUBAI signed.xlsx" bun test --isolate src/lib/ingest/multisheet-bill-reader.reconcile.test.ts
describe.skipIf(!process.env.ZOOMIES_WORKBOOK_PATH)("the real ZOOMIES workbook (local only)", () => {
  test("reads to 50 priced lines and 3 lump sums that reconcile to 1,596,280, and reads the same as the fixture", async () => {
    const grid = await readWorkbookGrid(readFileSync(process.env.ZOOMIES_WORKBOOK_PATH!))
    const real = readMultisheetBills(grid)
    expect(real.lines).toHaveLength(50)
    expect(real.lumpSums).toHaveLength(3)
    expect(real.totals.grand).toEqual({ computed: GRAND_TOTAL, declared: GRAND_TOTAL, reconciled: true })
    expect(real.reconciled).toBe(true)
    // The fixture is the workbook minus contact and bank details and the client's name, so everything else reads the same.
    expect({ ...real, projectName: null }).toEqual({ ...result, projectName: null })
  })
})
