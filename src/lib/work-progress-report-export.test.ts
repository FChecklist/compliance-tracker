/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { workProgressExportFilename, workProgressExportRows } from "./work-progress-report-export"
import type { WorkProgressReportPdfData } from "./pdf/work-progress-report-pdf"

// A root line and one of its sub-tasks, plus one progress entry in the window
// and one before it -- the smallest fixture that exercises every rule this
// export has to keep: Previous vs Current, the parent-only percentages, and
// the parents-only contract total.
const data: WorkProgressReportPdfData = {
  org: { name: "Skyline Builders", address: null, gstin: null },
  projectName: "Cedar Heights Villa - Phase 1",
  boqTitle: "BOQ v3",
  from: "2026-08-01",
  to: "2026-08-31",
  lineItems: [
    { id: "root", itemCode: "1", description: "Blockwork", unit: "m2", quantity: 100, rate: 65, amount: 6500, activityId: "a1", parentLineItemId: null },
    { id: "child", itemCode: "1.1", description: "Blockwork -- labour", unit: "m2", quantity: 100, rate: 22.75, amount: 2275, activityId: "a1", parentLineItemId: "root" },
  ],
  activities: [{ id: "a1", categoryId: "c1", name: "Masonry" }],
  categories: [{ id: "c1", name: "Civil" }],
  entries: [
    { activityId: "a1", boqLineItemId: "root", entryDate: "2026-07-15", quantityDone: 20 },
    { activityId: "a1", boqLineItemId: "root", entryDate: "2026-08-10", quantityDone: 30 },
  ],
}

describe("workProgressExportRows", () => {
  const rows = workProgressExportRows(data, { currency: "AED" })

  test("one row per BOQ line plus a Grand Total", () => {
    expect(rows).toHaveLength(3)
    expect(rows[2].Description).toBe("Grand Total")
  })

  test("the currency goes in the money HEADERS, never repeated down the rows", () => {
    expect(Object.keys(rows[0])).toContain("Amount (AED)")
    expect(Object.keys(rows[0])).toContain("Amt Current (AED)")
    expect(rows[0]["Amount (AED)"]).toBe(6500)
  })

  test("with no currency set, no currency is claimed", () => {
    const bare = workProgressExportRows(data)
    expect(Object.keys(bare[0])).toContain("Amount")
    expect(Object.keys(bare[0])).not.toContain("Amount (AED)")
  })

  test("cells are raw numbers, so a QS can sum the column themselves", () => {
    expect(rows[0]["Qty Previous"]).toBe(20)
    expect(rows[0]["Qty Current"]).toBe(30)
    expect(rows[0]["Amt Current (AED)"]).toBe(30 * 65)
  })

  test("the BOQ's own contracted quantity is carried, under its real name", () => {
    expect(rows[0]["BOQ Qty"]).toBe(100)
    expect(Object.keys(rows[0])).not.toContain("PO Qty")
  })

  test("WPR-06: a sub-task's percent cells are BLANK, not 0", () => {
    expect(rows[1].Description).toBe("-- Blockwork -- labour")
    expect(rows[1]["% Previous"]).toBe("")
    expect(rows[1]["% Total"]).toBe("")
    expect(rows[0]["% Total"]).toBe(50) // 50 of 100 m2 done, on the parent
  })

  test("the contract Grand Total sums PARENT rows only -- a sub-task is a slice of its parent", () => {
    expect(rows[2]["Amount (AED)"]).toBe(6500)
  })

  test("balance mode renames the third band and reports the balance", () => {
    const balance = workProgressExportRows(data, { mode: "balance", currency: "AED" })
    expect(Object.keys(balance[0])).toContain("Qty Balance")
    expect(balance[0]["Qty Balance"]).toBe(50) // 100 contracted - 50 done
  })

  test("an empty BOQ exports no rows and no Grand Total over nothing", () => {
    expect(workProgressExportRows({ ...data, lineItems: [] })).toEqual([])
  })
})

describe("workProgressExportFilename", () => {
  test("a project name becomes a filename that is safe on every filesystem", () => {
    expect(workProgressExportFilename("Cedar Heights Villa - Phase 1", "2026-08-01", "2026-08-31", "xlsx")).toBe(
      "cedar-heights-villa-phase-1-work-progress-2026-08-01-to-2026-08-31.xlsx"
    )
  })

  test("a name with nothing usable in it still produces a filename", () => {
    expect(workProgressExportFilename("///", "2026-08-01", "2026-08-31", "pdf")).toBe(
      "project-work-progress-2026-08-01-to-2026-08-31.pdf"
    )
  })
})
