// Hierarchical BoQ breakdown-% (Owner directive, PROJEXA_ERP_END_TO_END_
// REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27): tests the
// pure helpers extracted from construction-boq-service.ts --
// computeHierarchicalAmount and diffLineItems -- the same "don't touch
// withTenantContext/a live DB from a .test.ts file" convention as
// esignature-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeHierarchicalAmount, diffLineItems, ServiceError, type BoqLineItemInput, type BoqLineItemRow } from "./construction-boq-service"

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
    createdAt: new Date("2026-07-27T00:00:00Z"),
    ...overrides,
  }
}

describe("computeHierarchicalAmount -- Sub-Task Amount = Main QTY * Main RATE * Breakdown %", () => {
  test("a plain top-level item (no parent) is just quantity * rate, unchanged from pre-hierarchy behavior", () => {
    const item: BoqLineItemInput = { description: "Excavation", unit: "cum", quantity: 100, rate: 50 }
    expect(computeHierarchicalAmount(item, new Map())).toBe(5000)
  })

  test("the Owner's exact example: Main QTY=100 RATE=50 (amount 5000), 3 sub-tasks at 40%/35%/25% sum back to the main amount", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "cum", quantity: 100, rate: 50 }
    const byCode = new Map([["M1", main]])

    const sub40: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 40, description: "Sub A", unit: "cum", quantity: 0, rate: 0 }
    const sub35: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 35, description: "Sub B", unit: "cum", quantity: 0, rate: 0 }
    const sub25: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 25, description: "Sub C", unit: "cum", quantity: 0, rate: 0 }

    const amounts = [sub40, sub35, sub25].map((s) => computeHierarchicalAmount(s, byCode))
    expect(amounts).toEqual([2000, 1750, 1250])
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(5000)
  })

  test("a sub-task's OWN quantity/rate are ignored for amount purposes -- only the root Main's qty/rate count", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "cum", quantity: 100, rate: 50 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 40, description: "Sub", unit: "cum", quantity: 999, rate: 999 }
    expect(computeHierarchicalAmount(sub, new Map([["M1", main]]))).toBe(2000)
  })

  test("multi-level nesting (Main -> Sub -> Sub-sub) still prices off the ROOT Main's qty/rate, not the immediate parent", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "cum", quantity: 100, rate: 50 } // amount 5000
    const sub: BoqLineItemInput = { itemCode: "S1", parentItemCode: "M1", breakdownPercentage: 40, description: "Sub", unit: "cum", quantity: 0, rate: 0 } // 2000
    const subsub: BoqLineItemInput = { parentItemCode: "S1", breakdownPercentage: 50, description: "Sub-sub", unit: "cum", quantity: 0, rate: 0 }
    const byCode = new Map([["M1", main], ["S1", sub]])
    // 50% of Main (100*50), NOT 50% of Sub's own 2000 -- root-based, per the formula's literal "Main QTY * Main RATE" wording.
    expect(computeHierarchicalAmount(subsub, byCode)).toBe(2500)
  })

  test("missing breakdownPercentage on a child item throws a 400 ServiceError", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "cum", quantity: 100, rate: 50 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", description: "Sub", unit: "cum", quantity: 0, rate: 0 }
    expect(() => computeHierarchicalAmount(sub, new Map([["M1", main]]))).toThrow(ServiceError)
  })

  test("a parentItemCode that matches nothing in the submission throws a 400 ServiceError", () => {
    const sub: BoqLineItemInput = { parentItemCode: "GHOST", breakdownPercentage: 40, description: "Sub", unit: "cum", quantity: 0, rate: 0 }
    expect(() => computeHierarchicalAmount(sub, new Map())).toThrow(ServiceError)
  })

  test("a circular parentItemCode chain (A -> B -> A) throws rather than looping forever", () => {
    const a: BoqLineItemInput = { itemCode: "A", parentItemCode: "B", breakdownPercentage: 50, description: "A", unit: "cum", quantity: 0, rate: 0 }
    const b: BoqLineItemInput = { itemCode: "B", parentItemCode: "A", breakdownPercentage: 50, description: "B", unit: "cum", quantity: 0, rate: 0 }
    const byCode = new Map([["A", a], ["B", b]])
    expect(() => computeHierarchicalAmount(a, byCode)).toThrow(ServiceError)
  })
})

describe("diffLineItems -- hierarchy-aware revision comparison", () => {
  test("qty/rate unchanged, only breakdownPercentage moved -- now flagged as changed (previously invisible to the diff)", () => {
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
