// Hierarchical BoQ breakdown-% (Owner directive, PROJEXA_ERP_END_TO_END_
// REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27): tests the
// pure helpers extracted from construction-boq-service.ts --
// computeHierarchicalAmount and diffLineItems -- the same "don't touch
// withTenantContext/a live DB from a .test.ts file" convention as
// esignature-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeHierarchicalAmount, diffLineItems, computeTotalVariation, findScopeReductionViolations,
  ServiceError, type BoqLineItemInput, type BoqLineItemRow, type ChangedLineItem,
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

describe("computeTotalVariation -- the running total variation value across a revision", () => {
  test("a positive variation: one added line item, nothing removed or changed", () => {
    const added = [row({ id: "n1", itemCode: "N1", quantity: "10", rate: "100", amount: "1000" })]
    expect(computeTotalVariation({ added, removed: [], changed: [] })).toBe(1000)
  })

  test("a negative variation: one removed line item nets out negative", () => {
    const removed = [row({ id: "r1", itemCode: "R1", quantity: "10", rate: "100", amount: "1000" })]
    expect(computeTotalVariation({ added: [], removed, changed: [] })).toBe(-1000)
  })

  test("added, removed and changed combine into one net total", () => {
    const added = [row({ id: "a1", amount: "500" })]
    const removed = [row({ id: "r1", amount: "200" })]
    const changed: ChangedLineItem[] = [{
      key: "M1", previous: row({ id: "p1" }), current: row({ id: "c1" }),
      quantityChange: 0, rateChange: 0, breakdownPercentageChange: 0, netVariation: 300, isSubItem: false,
    }]
    // +500 (added) - 200 (removed) + 300 (changed) = 600
    expect(computeTotalVariation({ added, removed, changed })).toBe(600)
  })
})

describe("findScopeReductionViolations -- the Owner's hard-block rule for descoping completed work", () => {
  test("a positive variation on a line item with completed progress is never a violation", () => {
    const changed: ChangedLineItem[] = [{
      key: "M1", previous: row({ id: "p1", activityId: "act-1" }), current: row({ id: "c1", activityId: "act-1" }),
      quantityChange: 10, rateChange: 0, breakdownPercentageChange: 0, netVariation: 500, isSubItem: false,
    }]
    const violations = findScopeReductionViolations({ removed: [], changed }, new Map([["act-1", 60]]))
    expect(violations).toHaveLength(0)
  })

  test("removing a line item entirely is blocked when its activity has any recorded completed progress", () => {
    const removed = [row({ id: "r1", description: "Brickwork", activityId: "act-1" })]
    const violations = findScopeReductionViolations({ removed, changed: [] }, new Map([["act-1", 25]]))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("Brickwork")
  })

  test("a negative variation (reduced quantity/amount) on a line item is blocked when its activity has completed progress", () => {
    const changed: ChangedLineItem[] = [{
      key: "M1", previous: row({ id: "p1", activityId: "act-1", description: "Plastering" }), current: row({ id: "c1", activityId: "act-1", description: "Plastering" }),
      quantityChange: -10, rateChange: 0, breakdownPercentageChange: 0, netVariation: -500, isSubItem: false,
    }]
    const violations = findScopeReductionViolations({ removed: [], changed }, new Map([["act-1", 40]]))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("Plastering")
  })

  test("removing/reducing an item with NO recorded progress (0% or no entry at all) is not blocked -- nothing has been done on site yet", () => {
    const removed = [row({ id: "r1", activityId: "act-1" })]
    const changed: ChangedLineItem[] = [{
      key: "M2", previous: row({ id: "p2", activityId: "act-2" }), current: row({ id: "c2", activityId: "act-2" }),
      quantityChange: -5, rateChange: 0, breakdownPercentageChange: 0, netVariation: -200, isSubItem: false,
    }]
    // act-1 has an explicit 0% entry, act-2 has no entry in the map at all -- neither should block.
    const violations = findScopeReductionViolations({ removed, changed }, new Map([["act-1", 0]]))
    expect(violations).toHaveLength(0)
  })

  test("a line item with no activityId at all can never be blocked -- there is no progress source to check it against", () => {
    const removed = [row({ id: "r1", activityId: null })]
    const violations = findScopeReductionViolations({ removed, changed: [] }, new Map([["act-1", 90]]))
    expect(violations).toHaveLength(0)
  })
})
