/// <reference types="bun-types" />
// Split out of construction-boq-service.test.ts (seq4/c5 de-share,
// 2026-09-11): that file cited 9 requirements over the 3-per-file cap.
// This file carries R-21/R-24, both verified against the real requirement
// text in platform.sumeet_requirements before moving (not a literal-ID
// grep, which missed both of these entirely -- neither is labeled with its
// own ID in the source file):
// R-24 "Percentage-only change detected as variation" -> diffLineItems'
//   "only breakdownPercentage moved -- now flagged as changed" test
// R-21 "Revision variation vs prior shown" -> buildBoqListRows' totalVariation
//   (vs immediate parent) / totalVariationVsOriginal (walked to root) tests
import { describe, test, expect } from "bun:test"
import {
  diffLineItems, computeTotalVariation, buildBoqListRows,
  type BoqLineItemRow, type ChangedLineItem,
} from "./construction-boq-service"

function row(overrides: Partial<BoqLineItemRow>): BoqLineItemRow {
  return {
    id: overrides.id ?? "row-id",
    boqId: "boq-1",
    activityId: null,
    itemCode: null,
    description: "line item",
    unit: "nos",
    quantity: "0",
    rate: "0",
    amount: "0",
    parentLineItemId: null,
    breakdownPercentage: null,
    materialCost: null,
    labourCost: null,
    equipmentCost: null,
    overheadPercent: null,
    profitPercent: null,
    materialAmount: null,
    manpowerAmount: null,
    category: null,
    createdAt: new Date("2026-07-27T00:00:00Z"),
    ...overrides,
  }
}

function boq(id: string, parentBoqId: string | null = null) {
  return { id, parentBoqId }
}

function itemAt(boqId: string, itemCode: string, amount: number, extras: Partial<BoqLineItemRow> = {}): BoqLineItemRow {
  return row({ id: `${boqId}-${itemCode}`, boqId, itemCode, amount: String(amount), ...extras })
}

describe("diffLineItems -- hierarchy-aware revision comparison (R-24)", () => {
  test("R-24: qty/rate unchanged, only breakdownPercentage moved -- now flagged as changed (previously invisible to the diff)", () => {
    const prev = [row({ id: "p1", itemCode: "S1", parentLineItemId: "main-id", quantity: "0", rate: "0", breakdownPercentage: "40", amount: "2000" })]
    const curr = [row({ id: "c1", itemCode: "S1", parentLineItemId: "main-id", quantity: "0", rate: "0", breakdownPercentage: "55", amount: "2750" })]
    const { changed } = diffLineItems(prev, curr)
    expect(changed).toHaveLength(1)
    expect(changed[0].breakdownPercentageChange).toBe(15)
    expect(changed[0].quantityChange).toBe(0)
    expect(changed[0].rateChange).toBe(0)
    expect(changed[0].netVariation).toBe(750)
    expect(changed[0].isSubItem).toBe(true)
  })

  test("a main item's own quantity/rate change is still detected exactly as before, isSubItem false", () => {
    const prev = [row({ id: "p1", itemCode: "M1", quantity: "100", rate: "50", amount: "5000" })]
    const curr = [row({ id: "c1", itemCode: "M1", quantity: "120", rate: "50", amount: "6000" })]
    const { changed } = diffLineItems(prev, curr)
    expect(changed[0].quantityChange).toBe(20)
    expect(changed[0].netVariation).toBe(1000)
    expect(changed[0].isSubItem).toBe(false)
  })

  test("nothing changed -- diff is empty, no spurious breakdownPercentage noise from null vs null", () => {
    const prev = [row({ id: "p1", itemCode: "M1", quantity: "100", rate: "50", amount: "5000" })]
    const curr = [row({ id: "c1", itemCode: "M1", quantity: "100", rate: "50", amount: "5000" })]
    expect(diffLineItems(prev, curr).changed).toHaveLength(0)
  })

  test("a brand-new sub-task added in this revision shows up in `added`, not `changed`", () => {
    const prev = [row({ id: "p1", itemCode: "M1", quantity: "100", rate: "50", amount: "5000" })]
    const curr = [
      row({ id: "c1", itemCode: "M1", quantity: "100", rate: "50", amount: "5000" }),
      row({ id: "c2", itemCode: "S1", parentLineItemId: "c1", breakdownPercentage: "40", amount: "2000" }),
    ]
    const { added, changed } = diffLineItems(prev, curr)
    expect(added).toHaveLength(1)
    expect(added[0].itemCode).toBe("S1")
    expect(changed).toHaveLength(0)
  })
})

describe("buildBoqListRows -- variation per revision, computed in one pass (R-21)", () => {
  test("a baseline BOQ (no parent) reports null for BOTH figures, never 0", () => {
    const rows = buildBoqListRows([boq("rev0")], [itemAt("rev0", "A", 1000)])

    expect(rows).toHaveLength(1)
    expect(rows[0].totalVariation).toBeNull()
    expect(rows[0].totalVariationVsOriginal).toBeNull()
  })

  test("each row carries its own line items, grouped from the single flat query", () => {
    const rows = buildBoqListRows(
      [boq("rev1", "rev0"), boq("rev0")],
      [itemAt("rev0", "A", 1000), itemAt("rev1", "A", 1200), itemAt("rev1", "B", 300)]
    )

    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get("rev0")!.lineItems.map((i) => i.itemCode)).toEqual(["A"])
    expect(byId.get("rev1")!.lineItems.map((i) => i.itemCode)).toEqual(["A", "B"])
    expect(byId.get("rev1")!.lineItems[0]).toHaveProperty("computedBudget")
  })

  test("R-21: totalVariation is the change against the IMMEDIATE parent", () => {
    // rev1 raises A by 200 and adds B worth 300 => +500 vs rev0
    const rows = buildBoqListRows(
      [boq("rev1", "rev0"), boq("rev0")],
      [
        itemAt("rev0", "A", 1000, { quantity: "10", rate: "100" }),
        itemAt("rev1", "A", 1200, { quantity: "10", rate: "120" }),
        itemAt("rev1", "B", 300, { quantity: "3", rate: "100" }),
      ]
    )

    expect(rows.find((r) => r.id === "rev1")!.totalVariation).toBe(500)
  })

  test("R-21: totalVariationVsOriginal walks the chain back to Rev0, not just one hop", () => {
    // rev0 A=1000 -> rev1 A=1200 (+200) -> rev2 A=1500 (+300)
    const rows = buildBoqListRows(
      [boq("rev2", "rev1"), boq("rev1", "rev0"), boq("rev0")],
      [
        itemAt("rev0", "A", 1000, { quantity: "10", rate: "100" }),
        itemAt("rev1", "A", 1200, { quantity: "10", rate: "120" }),
        itemAt("rev2", "A", 1500, { quantity: "10", rate: "150" }),
      ]
    )

    const rev2 = rows.find((r) => r.id === "rev2")!
    expect(rev2.totalVariation).toBe(300) // vs rev1
    expect(rev2.totalVariationVsOriginal).toBe(500) // vs rev0
  })

  test("the figure equals what compareBoq() would return for the same pair", () => {
    const previous = [itemAt("rev0", "A", 1000, { quantity: "10", rate: "100" })]
    const current = [itemAt("rev1", "A", 800, { quantity: "8", rate: "100" })]

    const rows = buildBoqListRows([boq("rev1", "rev0"), boq("rev0")], [...previous, ...current])
    const viaCompare = computeTotalVariation(diffLineItems(previous, current))

    expect(rows.find((r) => r.id === "rev1")!.totalVariation).toBe(viaCompare)
    expect(viaCompare).toBe(-200)
  })

  test("a parent outside this project's list degrades to null instead of guessing", () => {
    const rows = buildBoqListRows([boq("rev1", "not-in-this-project")], [itemAt("rev1", "A", 1200)])

    expect(rows[0].totalVariation).toBeNull()
    expect(rows[0].totalVariationVsOriginal).toBeNull()
  })

  test("a cyclic parent chain terminates instead of hanging the list", () => {
    const rows = buildBoqListRows(
      [boq("a", "b"), boq("b", "a")],
      [itemAt("a", "A", 100), itemAt("b", "A", 100)]
    )

    expect(rows).toHaveLength(2)
    for (const r of rows) expect(typeof r.totalVariation === "number" || r.totalVariation === null).toBe(true)
  })

  test("a revision with no line items at all still produces a row", () => {
    const rows = buildBoqListRows([boq("rev1", "rev0"), boq("rev0")], [itemAt("rev0", "A", 1000)])

    const rev1 = rows.find((r) => r.id === "rev1")!
    expect(rev1.lineItems).toEqual([])
    expect(rev1.totalVariation).toBe(-1000)
  })
})
