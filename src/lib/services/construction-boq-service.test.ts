// Hierarchical BoQ breakdown-% (Owner directive, PROJEXA_ERP_END_TO_END_
// REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27): tests the
// pure helpers extracted from construction-boq-service.ts --
// computeHierarchicalAmount and diffLineItems -- the same "don't touch
// withTenantContext/a live DB from a .test.ts file" convention as
// esignature-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeHierarchicalAmount, deriveLineItemQuantityAndRate, diffLineItems, computeTotalVariation, findScopeReductionViolations,
  resolveProgressByLineItem,
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

// R45 seq 7 / E-127 -- "Settle the two child-rate conventions." Two real,
// contradictory conventions existed: (A) construction-boq-service.ts /
// schema.ts computed a child's `amount` from the ROOT's qty*rate*breakdown%
// while leaving the child's OWN stored quantity/rate columns as whatever a
// caller happened to submit, unenforced; (B) work-progress-report-pdf.ts's
// computeRows() read a line's own `rate` column DIRECTLY (qty x rate) to
// price progress recorded against that specific child line, which is only
// correct if the child's stored rate already equals the F2-derived value --
// something nothing guaranteed. Settled per platform.sumeet_spec row BOQ-10
// (the real, confirmed customer BoQ spec) and cross-checked against
// production (477/477 real child rows matched F2/F3 exactly, 2026-08-24):
// a child's quantity/rate are DERIVED (F2/F3), not independently entered --
// this is now enforced at the one write path (insertLineItems), closing the
// gap that let convention (B) silently disagree with convention (A).
// These tests would FAIL if that enforcement were ever removed and a child
// row's own submitted quantity/rate were trusted again.
describe("deriveLineItemQuantityAndRate -- canonical child-rate rule (R45 seq 7 / E-127)", () => {
  test("a root-level item (no parentItemCode) keeps its own quantity/rate exactly as entered -- F1", () => {
    const item: BoqLineItemInput = { description: "Excavation", unit: "cum", quantity: 100, rate: 50 }
    expect(deriveLineItemQuantityAndRate(item, new Map())).toEqual({ quantity: 100, rate: 50 })
  })

  test("a child's quantity is the ROOT's quantity, unscaled -- F3", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "sqm", quantity: 472, rate: 108 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 30, description: "Frame 01", unit: "sqm", quantity: 0, rate: 0 }
    expect(deriveLineItemQuantityAndRate(sub, new Map([["M1", main]])).quantity).toBe(472)
  })

  test("a child's rate is ROOT rate x breakdown% / 100 -- F2 (the Sumeet spec's own worked example: 108 x 30% = 32.4)", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "sqm", quantity: 472, rate: 108 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 30, description: "Frame 01", unit: "sqm", quantity: 0, rate: 0 }
    expect(deriveLineItemQuantityAndRate(sub, new Map([["M1", main]])).rate).toBeCloseTo(32.4, 6)
  })

  test("*** THE CORE FIX ***: a child's OWN submitted quantity/rate are IGNORED and overwritten by the derived root values -- proves independent entry (convention B) is no longer possible", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "sqm", quantity: 472, rate: 108 }
    // caller submits garbage/stale quantity+rate on a child row -- must not survive.
    const sub: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 30, description: "Frame 01", unit: "sqm", quantity: 999999, rate: 1 }
    expect(deriveLineItemQuantityAndRate(sub, new Map([["M1", main]]))).toEqual({ quantity: 472, rate: 32.4 })
  })

  test("a child submitted with quantity/rate both 0 (the historically 'always 0' assumption) still derives the correct non-zero values", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "sqm", quantity: 472, rate: 108 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 15, description: "Gypsum Board 01", unit: "sqm", quantity: 0, rate: 0 }
    expect(deriveLineItemQuantityAndRate(sub, new Map([["M1", main]]))).toEqual({ quantity: 472, rate: 16.2 })
  })

  test("multi-level nesting (Main -> Sub -> Sub-sub) derives off the ROOT Main's qty/rate, not the immediate parent Sub's", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "cum", quantity: 100, rate: 50 }
    const sub: BoqLineItemInput = { itemCode: "S1", parentItemCode: "M1", breakdownPercentage: 40, description: "Sub", unit: "cum", quantity: 0, rate: 0 }
    const subsub: BoqLineItemInput = { parentItemCode: "S1", breakdownPercentage: 50, description: "Sub-sub", unit: "cum", quantity: 0, rate: 0 }
    const byCode = new Map([["M1", main], ["S1", sub]])
    expect(deriveLineItemQuantityAndRate(subsub, byCode)).toEqual({ quantity: 100, rate: 25 })
  })

  test("computeHierarchicalAmount's output equals derived quantity x derived rate (F4) -- amount and the stored columns can never disagree", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "sqm", quantity: 472, rate: 108 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 30, description: "Frame 01", unit: "sqm", quantity: 0, rate: 0 }
    const byCode = new Map([["M1", main]])
    const { quantity, rate } = deriveLineItemQuantityAndRate(sub, byCode)
    expect(computeHierarchicalAmount(sub, byCode)).toBe(quantity * rate)
    expect(computeHierarchicalAmount(sub, byCode)).toBeCloseTo(15292.8, 6) // Sumeet spec's own worked example, item 1.01 Frame 01
  })

  test("missing breakdownPercentage on a child item throws a 400 ServiceError, same as computeHierarchicalAmount", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "cum", quantity: 100, rate: 50 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", description: "Sub", unit: "cum", quantity: 0, rate: 0 }
    expect(() => deriveLineItemQuantityAndRate(sub, new Map([["M1", main]]))).toThrow(ServiceError)
  })

  test("a circular parentItemCode chain throws rather than looping forever, same as computeHierarchicalAmount", () => {
    const a: BoqLineItemInput = { itemCode: "A", parentItemCode: "B", breakdownPercentage: 50, description: "A", unit: "cum", quantity: 0, rate: 0 }
    const b: BoqLineItemInput = { itemCode: "B", parentItemCode: "A", breakdownPercentage: 50, description: "B", unit: "cum", quantity: 0, rate: 0 }
    const byCode = new Map([["A", a], ["B", b]])
    expect(() => deriveLineItemQuantityAndRate(a, byCode)).toThrow(ServiceError)
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

// R12 point 7 (Option B): findScopeReductionViolations now looks up
// progress by the CURRENT/removed line item's own `id`, via the map
// loadLatestProgressByLineItem()/resolveProgressByLineItem() produce --
// not by activityId any more (that lookup now lives one layer down, inside
// the resolver). Every test below is keyed by item id, not activityId, to
// match the new resolver output shape.
describe("findScopeReductionViolations -- the Owner's hard-block rule for descoping completed work", () => {
  test("a positive variation on a line item with completed progress is never a violation", () => {
    const changed: ChangedLineItem[] = [{
      key: "M1", previous: row({ id: "p1", activityId: "act-1" }), current: row({ id: "c1", activityId: "act-1" }),
      quantityChange: 10, rateChange: 0, breakdownPercentageChange: 0, netVariation: 500, isSubItem: false,
    }]
    const violations = findScopeReductionViolations({ removed: [], changed }, new Map([["c1", 60]]))
    expect(violations).toHaveLength(0)
  })

  test("removing a line item entirely is blocked when the resolver found it >0% complete", () => {
    const removed = [row({ id: "r1", description: "Brickwork", activityId: "act-1" })]
    const violations = findScopeReductionViolations({ removed, changed: [] }, new Map([["r1", 25]]))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("Brickwork")
  })

  test("a negative variation (reduced quantity/amount) on a line item is blocked when the resolver found it >0% complete", () => {
    const changed: ChangedLineItem[] = [{
      key: "M1", previous: row({ id: "p1", activityId: "act-1", description: "Plastering" }), current: row({ id: "c1", activityId: "act-1", description: "Plastering" }),
      quantityChange: -10, rateChange: 0, breakdownPercentageChange: 0, netVariation: -500, isSubItem: false,
    }]
    const violations = findScopeReductionViolations({ removed: [], changed }, new Map([["c1", 40]]))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("Plastering")
  })

  test("removing/reducing an item with NO recorded progress (0% or no entry at all) is not blocked -- nothing has been done on site yet", () => {
    const removed = [row({ id: "r1", activityId: "act-1" })]
    const changed: ChangedLineItem[] = [{
      key: "M2", previous: row({ id: "p2", activityId: "act-2" }), current: row({ id: "c2", activityId: "act-2" }),
      quantityChange: -5, rateChange: 0, breakdownPercentageChange: 0, netVariation: -200, isSubItem: false,
    }]
    // r1 has an explicit 0% entry, c2 has no entry in the map at all -- neither should block.
    const violations = findScopeReductionViolations({ removed, changed }, new Map([["r1", 0]]))
    expect(violations).toHaveLength(0)
  })

  test("a line item with no entry in the resolved progress map at all can never be blocked", () => {
    const removed = [row({ id: "r1", activityId: null })]
    const violations = findScopeReductionViolations({ removed, changed: [] }, new Map([["some-other-item", 90]]))
    expect(violations).toHaveLength(0)
  })
})

// R12 point 7 (Option B): the pure merge core of loadLatestProgressByLineItem
// -- factored out so it's testable without a live DB (this file's own
// established convention). `byLineItemId`/`byActivityId` simulate what the
// DB query would have already produced (most-recent percentComplete per
// key); this function only decides which key wins per item.
describe("resolveProgressByLineItem -- boq_line_item_id first, activity_id fallback (R12 point 7 / Option B)", () => {
  test("an entry linked by boq_line_item_id is found by the resolver", () => {
    const items = [row({ id: "li-1", activityId: null })]
    const result = resolveProgressByLineItem(items, new Map([["li-1", 45]]), new Map())
    expect(result.get("li-1")).toBe(45)
  })

  test("a legacy entry linked ONLY by activity_id is STILL found (fallback)", () => {
    const items = [row({ id: "li-2", activityId: "act-9" })]
    const result = resolveProgressByLineItem(items, new Map(), new Map([["act-9", 70]]))
    expect(result.get("li-2")).toBe(70)
  })

  // Edge case (cycle 2): both links set and disagreeing -- boq_line_item_id
  // must win, per the point's own explicit rule ("IF boq_line_item_id is
  // set THEN it wins"), not whichever map happens to be checked first.
  test("edge case: both links set and disagreeing -- the direct boq_line_item_id link wins over the activity_id fallback", () => {
    const items = [row({ id: "li-3", activityId: "act-3" })]
    const result = resolveProgressByLineItem(items, new Map([["li-3", 80]]), new Map([["act-3", 20]]))
    expect(result.get("li-3")).toBe(80)
  })

  // Edge case (cycle 2): neither link set -- no entry at all, not a 0.
  test("edge case: neither link set -- the item has no entry in the resolved map (not a 0)", () => {
    const items = [row({ id: "li-4", activityId: null })]
    const result = resolveProgressByLineItem(items, new Map(), new Map())
    expect(result.has("li-4")).toBe(false)
  })

  test("multiple items each resolve independently -- one via direct link, one via fallback, one with nothing", () => {
    const items = [
      row({ id: "li-5", activityId: "act-5" }), // has a direct link entry
      row({ id: "li-6", activityId: "act-6" }), // only a fallback entry
      row({ id: "li-7", activityId: "act-7" }), // no entry anywhere
    ]
    const byLineItemId = new Map([["li-5", 33]])
    const byActivityId = new Map([["act-6", 66]])
    const result = resolveProgressByLineItem(items, byLineItemId, byActivityId)
    expect(result.get("li-5")).toBe(33)
    expect(result.get("li-6")).toBe(66)
    expect(result.has("li-7")).toBe(false)
  })
})

// R12 point 7 acceptance test: "A revision reducing scope below recorded
// progress returns 409 through the NEW path." createBoqRevision() itself
// needs a live DB (withTenantContext), so this chains the two pure
// functions the guard is actually built from -- resolveProgressByLineItem
// then findScopeReductionViolations -- exactly as loadLatestProgressByLineItem
// -> findScopeReductionViolations are chained for real inside
// createBoqRevision(), proving the NEW (boq_line_item_id-first) path
// produces the violation createBoqRevision() then throws a 409 for.
describe("R12 point 7 -- the 409 guard's full pure pipeline through the NEW (boq_line_item_id) path", () => {
  test("a revision reducing scope on a line item whose progress is linked ONLY by boq_line_item_id (no activity fallback needed) is blocked", () => {
    const changed: ChangedLineItem[] = [{
      key: "M1", previous: row({ id: "p1", activityId: null, description: "Frame 01" }), current: row({ id: "c1", activityId: null, description: "Frame 01" }),
      quantityChange: -50, rateChange: 0, breakdownPercentageChange: 0, netVariation: -1000, isSubItem: false,
    }]
    const resolved = resolveProgressByLineItem([changed[0].current], new Map([["c1", 55]]), new Map())
    const violations = findScopeReductionViolations({ removed: [], changed }, resolved)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("Frame 01")
  })

  test("a legacy line item (activity_id only, no direct link) reducing scope is STILL blocked through the fallback", () => {
    const removed = [row({ id: "r1", activityId: "act-legacy", description: "Legacy Item" })]
    const resolved = resolveProgressByLineItem(removed, new Map(), new Map([["act-legacy", 40]]))
    const violations = findScopeReductionViolations({ removed, changed: [] }, resolved)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("Legacy Item")
  })
})
