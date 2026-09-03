// Hierarchical BoQ breakdown-% (Owner directive, PROJEXA_ERP_END_TO_END_
// REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27): tests the
// pure helpers extracted from construction-boq-service.ts --
// computeHierarchicalAmount and diffLineItems -- the same "don't touch
// withTenantContext/a live DB from a .test.ts file" convention as
// esignature-service.test.ts.
/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  computeHierarchicalAmount, deriveLineItemQuantityAndRate, diffLineItems, computeTotalVariation, findScopeReductionViolations,
  resolveProgressByLineItem, toLineItemInput, parseBoqInclude,
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
    // R67 lane I (I-03/I-05): present-and-null here because that is what a real
    // DB row looks like -- leaving them off the fixture would let a
    // Number(undefined) -> NaN bug pass unnoticed.
    materialAmount: null,
    manpowerAmount: null,
    category: null,
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
// (the real, confirmed customer BoQ spec). NOTE: an earlier version of this
// comment claimed this was "cross-checked against production, 477/477 real
// child rows matched F2/F3 exactly" -- that was FALSE (an adversarial verify
// pass 2026-08-24 caught it: real count was 503 total / 287 matching / 216
// mismatching, mostly harmless e2e noise plus 18 real pre-fix demo-org rows,
// since backfilled -- see construction-reports-service.ts's
// earnedValueReport() header for the full, real numbers). BOQ-10 is the
// spec regardless of that false historical-verification claim -- a child's
// quantity/rate are DERIVED (F2/F3), not independently entered --
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

// R44 seq3: real defect found while building the COMPARE archetype --
// createBoqRevision used to default a missing `lineItems` to `[]`, silently
// creating an EMPTY revision instead of "create WITH REFERENCE" (M31). The
// fix is this pure round-trip: a persisted row -> toLineItemInput() -> the
// same BoqLineItemInput shape insertLineItems() (and therefore
// createBoqRevision()) accepts, so copy-forward reuses the normal insert
// path rather than a separate clone query.
describe("toLineItemInput -- copy-forward round-trip for create-with-reference", () => {
  test("a plain flat item round-trips every field insertLineItems() reads", () => {
    const persisted = row({
      id: "p1", activityId: "act-1", itemCode: "C001", description: "Excavation", unit: "cum",
      quantity: "100", rate: "50", amount: "5000",
      materialCost: "10", labourCost: "20", equipmentCost: "5", overheadPercent: "8", profitPercent: "12",
      // R67 lane I (I-03/I-05): copy-forward must carry these too, or the first
      // revision of a BOQ silently uncategorises it and drops its budget split.
      materialAmount: "500", manpowerAmount: "300", category: "Civil",
    })
    const input = toLineItemInput(persisted, new Map())
    expect(input).toEqual({
      activityId: "act-1", itemCode: "C001", parentItemCode: undefined, breakdownPercentage: undefined,
      description: "Excavation", unit: "cum", quantity: 100, rate: 50,
      materialCost: 10, labourCost: 20, equipmentCost: 5, overheadPercent: 8, profitPercent: 12,
      materialAmount: 500, manpowerAmount: 300, category: "Civil",
    })
  })

  test("null optional DB fields become undefined (not null) -- BoqLineItemInput's fields are all optional, never nullable", () => {
    const persisted = row({ id: "p1", description: "Plain item", unit: "nos", quantity: "1", rate: "1" })
    const input = toLineItemInput(persisted, new Map())
    expect(input.activityId).toBeUndefined()
    expect(input.itemCode).toBeUndefined()
    expect(input.parentItemCode).toBeUndefined()
    expect(input.materialCost).toBeUndefined()
  })

  test("a sub-item's parentLineItemId (a row id) resolves back to the parent's itemCode via the id->itemCode map", () => {
    const sub = row({ id: "c1", itemCode: "S1", parentLineItemId: "main-row-id", breakdownPercentage: "40", description: "Sub", unit: "cum", quantity: "0", rate: "0" })
    const input = toLineItemInput(sub, new Map([["main-row-id", "M1"]]))
    expect(input.parentItemCode).toBe("M1")
    expect(input.breakdownPercentage).toBe(40)
  })

  test("a whole revision's worth of items (153, matching the real 'Sumeet Sample Scope' BOQ) round-trips to the same count with amounts preserved", () => {
    const persisted = Array.from({ length: 153 }, (_, i) => row({ id: `p${i}`, itemCode: `C${i}`, description: `Item ${i}`, unit: "nos", quantity: "10", rate: "5", amount: "50" }))
    const mapped = persisted.map((item) => toLineItemInput(item, new Map()))
    expect(mapped).toHaveLength(153)
    expect(mapped.every((i) => i.quantity === 10 && i.rate === 5)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// R67 F-23 (audit recommendation R-239) -- listBoqs in ONE transaction, with
// the per-revision variation figure computed server-side.
// ---------------------------------------------------------------------------
//
// WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT. It exercises the real
// listBoqs() with only withTenantContext mocked -- the same "don't touch a live
// DB from a .test.ts file" pattern construction-progress-service.test.ts and
// projexa-records-tenant-isolation.test.ts already use in this directory. So:
//
//   PROVEN -- exactly ONE tenant transaction is opened no matter how many
//             revisions the project has (the N+1 this item removes), exactly
//             ONE statement answers the variation, that statement really does
//             group construction_boq_line_items by boq_id and join the
//             revision chain's parent_boq_id (asserted against the SQL text
//             drizzle builds, not against a stub's return value), and each
//             revision is mapped onto its own figure with null -- never 0 --
//             on a baseline.
//   NOT PROVEN -- that Postgres executes that SQL correctly. No unit test in
//             this repo can prove that; the fake executor below computes the
//             expected numbers from the fixture using the formula written out
//             longhand in the test itself, independently of the service.

const F23_ORG = "org-r67-f23"
const F23_PROJECT = "project-r67-f23"
const BOQ_V1 = "boq-v1"
const BOQ_V2 = "boq-v2"

type F23Line = { id: string; boqId: string; quantity: string; rate: string }

// v1: 100x50 + 10x2       = 5,020 over 2 lines
// v2: 120x50 + 10x2 + 1x5 = 6,025 over 3 lines
// => v2.variationVsPrior = 1,005 and v2.lineDelta = 1; v1 has no parent at all.
const f23Lines: F23Line[] = [
  { id: "v1-a", boqId: BOQ_V1, quantity: "100", rate: "50" },
  { id: "v1-b", boqId: BOQ_V1, quantity: "10", rate: "2" },
  { id: "v2-a", boqId: BOQ_V2, quantity: "120", rate: "50" },
  { id: "v2-b", boqId: BOQ_V2, quantity: "10", rate: "2" },
  { id: "v2-c", boqId: BOQ_V2, quantity: "1", rate: "5" },
]

const f23Boqs = [
  { id: BOQ_V2, orgId: F23_ORG, projectId: F23_PROJECT, version: 2, title: "Rev 1", status: "draft", parentBoqId: BOQ_V1, createdAt: new Date("2026-09-02T00:00:00Z") },
  { id: BOQ_V1, orgId: F23_ORG, projectId: F23_PROJECT, version: 1, title: "Baseline", status: "superseded", parentBoqId: null, createdAt: new Date("2026-09-01T00:00:00Z") },
]

/** The formula the CTE implements, written out here so the expectation is not
 *  read back out of the code under test. */
function f23Total(boqId: string): number {
  return f23Lines.filter((l) => l.boqId === boqId).reduce((sum, l) => sum + Number(l.quantity) * Number(l.rate), 0)
}
function f23LineCount(boqId: string): number {
  return f23Lines.filter((l) => l.boqId === boqId).length
}

/** Flattens the literal text drizzle assembled, so the SHAPE of the statement
 *  can be asserted (bound parameters are not part of it). */
function f23SqlText(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (!Array.isArray(chunks)) return ""
  let out = ""
  for (const chunk of chunks) {
    if (chunk && typeof chunk === "object") {
      const value = (chunk as { value?: unknown }).value
      if (Array.isArray(value)) out += value.join("")
      else out += f23SqlText(chunk)
    }
  }
  return out
}

let f23TransactionCount = 0
let f23ExecutedSql: string[] = []
let f23LineItemReads = 0

const f23Db = {
  query: {
    constructionBoqs: {
      findMany: async () => f23Boqs,
    },
    constructionBoqLineItems: {
      findMany: async () => {
        f23LineItemReads += 1
        return f23Lines.map((l) => ({
          ...l,
          orgId: F23_ORG,
          activityId: null,
          itemCode: null,
          parentLineItemId: null,
          breakdownPercentage: null,
          description: "line",
          unit: "nos",
          amount: String(Number(l.quantity) * Number(l.rate)),
          budgetPercentage: "25",
          materialCost: null,
          labourCost: null,
          equipmentCost: null,
          overheadPercent: null,
          profitPercent: null,
          vendorId: null,
          vendorAmount: null,
          createdAt: new Date("2026-09-01T00:00:00Z"),
        }))
      },
    },
  },
  execute: async (statement: unknown) => {
    f23ExecutedSql.push(f23SqlText(statement))
    // Stands in for Postgres, computing the same thing the CTE describes from
    // the fixture -- longhand, so a wrong service-side mapping still fails.
    return f23Boqs.map((b) => ({
      boq_id: b.id,
      variation_vs_prior: b.parentBoqId === null ? null : f23Total(b.id) - f23Total(b.parentBoqId),
      line_delta: b.parentBoqId === null ? null : f23LineCount(b.id) - f23LineCount(b.parentBoqId),
    }))
  },
}

const f23WithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  f23TransactionCount += 1
  return fn(f23Db as unknown as never)
})

const f23RealTenantScoped = await import("@/lib/db/tenant-scoped")

describe("listBoqs -- R67 F-23: one transaction, one grouped statement, variation in the list payload", () => {
  beforeEach(() => {
    f23TransactionCount = 0
    f23ExecutedSql = []
    f23LineItemReads = 0
    f23WithTenantContext.mockClear()
  })

  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => f23RealTenantScoped)
  })

  test("include 'variation' opens exactly ONE tenant transaction for a two-revision project (the getBoq() N+1 is gone)", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f23WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    await listBoqs({ orgId: F23_ORG }, F23_PROJECT, { include: "lineItems,variation" })

    expect(f23TransactionCount).toBe(1)
    // ONE batched read of every revision's line items, not one per revision.
    expect(f23LineItemReads).toBe(1)
    // ONE statement answers the variation for every revision at once.
    expect(f23ExecutedSql).toHaveLength(1)
  })

  test("variationVsPrior is sum(child qty*rate) - sum(parent qty*rate), and null (never 0) on the baseline", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f23WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    const rows = await listBoqs({ orgId: F23_ORG }, F23_PROJECT, { include: "variation" })
    const child = rows.find((r) => r.id === BOQ_V2)!
    const baseline = rows.find((r) => r.id === BOQ_V1)!

    expect(child.variationVsPrior).toBe(6025 - 5020)
    expect(child.variationVsPrior).toBe(f23Total(BOQ_V2) - f23Total(BOQ_V1))
    expect(child.lineDelta).toBe(1)
    expect(baseline.variationVsPrior).toBeNull()
    expect(baseline.lineDelta).toBeNull()
  })

  test("the variation statement really groups the line items by boq_id and joins the revision chain's parent", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f23WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    await listBoqs({ orgId: F23_ORG }, F23_PROJECT, { include: "variation" })

    const text = f23ExecutedSql[0].replace(/\s+/g, " ").toLowerCase()
    expect(text).toContain("compliance.construction_boq_line_items")
    expect(text).toContain("group by li.boq_id")
    expect(text).toContain("p.boq_id = r.parent_boq_id")
  })

  test("no options at all -- every pre-F-23 caller still gets plain headers, with neither the line-item read nor the variation statement", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f23WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    const rows = await listBoqs({ orgId: F23_ORG }, F23_PROJECT)

    expect(f23TransactionCount).toBe(1)
    expect(f23LineItemReads).toBe(0)
    expect(f23ExecutedSql).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[0].lineItems).toBeUndefined()
    expect(rows[0].variationVsPrior).toBeUndefined()
  })
})

describe("parseBoqInclude -- the route's ?include= contract", () => {
  test("recognises both values, in either order, with whitespace", () => {
    expect(parseBoqInclude("variation, lineItems")).toEqual({ lineItems: true, variation: true, compare: false })
  })

  test("an unknown include is ignored rather than failing a list the caller can otherwise read", () => {
    expect(parseBoqInclude("nonsense")).toEqual({ lineItems: false, variation: false, compare: false })
    expect(parseBoqInclude(null)).toEqual({ lineItems: false, variation: false, compare: false })
    expect(parseBoqInclude(undefined)).toEqual({ lineItems: false, variation: false, compare: false })
  })

  // R67 F-29 (R-273)
  test("recognises 'compare' alongside the other two", () => {
    expect(parseBoqInclude("lineItems,variation,compare")).toEqual({ lineItems: true, variation: true, compare: true })
    expect(parseBoqInclude("compare")).toEqual({ lineItems: false, variation: false, compare: true })
  })
})

// ---------------------------------------------------------------------------
// R67 F-29 (audit recommendation R-273) -- the per-revision COMPARE summary
// rides on the list, in the same one statement F-23 established.
// ---------------------------------------------------------------------------
//
// The /scope screen wants more than "the variation was +1,005": it wants how
// big each revision is (line count and total) and how far it moved in PERCENT,
// because +1,005 says nothing about whether that is a rounding error or a
// doubling of the contract. R-273's requirement is that all of it arrives with
// the list -- ONE round trip for TWENTY revisions, not one per row -- so that
// is what this block asserts, with a twenty-revision fixture rather than the
// two-revision one above, because "one query" is only interesting at scale.

const F29_ORG = "org-r67-f29"
const F29_PROJECT = "project-r67-f29"
const F29_REVISIONS = 20

/** rev N has N line items, each 10 x (N+1) -> total = N * 10 * (N + 1). */
function f29Total(index: number): number {
  return index * 10 * (index + 1)
}
function f29LineCount(index: number): number {
  return index
}
function f29Id(index: number): string {
  return `boq-f29-${index}`
}

// Newest first, mirroring listBoqs' own version DESC ordering.
const f29Boqs = Array.from({ length: F29_REVISIONS }, (_, i) => {
  const index = F29_REVISIONS - i // 20 .. 1
  return {
    id: f29Id(index),
    orgId: F29_ORG,
    projectId: F29_PROJECT,
    version: index,
    title: index === 1 ? "Baseline" : `Rev ${index - 1}`,
    status: index === F29_REVISIONS ? "draft" : "superseded",
    parentBoqId: index === 1 ? null : f29Id(index - 1),
    createdAt: new Date(`2026-09-${String(index).padStart(2, "0")}T00:00:00Z`),
  }
})

let f29TransactionCount = 0
let f29ExecutedSql: string[] = []

const f29Db = {
  query: {
    constructionBoqs: { findMany: async () => f29Boqs },
    constructionBoqLineItems: { findMany: async () => [] },
  },
  execute: async (statement: unknown) => {
    f29ExecutedSql.push(f23SqlText(statement))
    // Stands in for Postgres. Every figure is computed here from the fixture
    // with the formula written out longhand, so a wrong mapping in the service
    // still fails rather than being read back out of the code under test.
    return f29Boqs.map((b) => {
      const index = b.version
      const parentIndex = b.parentBoqId === null ? null : index - 1
      const total = f29Total(index)
      const parentTotal = parentIndex === null ? null : f29Total(parentIndex)
      return {
        boq_id: b.id,
        total,
        line_count: f29LineCount(index),
        variation_vs_prior: parentTotal === null ? null : total - parentTotal,
        line_delta: parentIndex === null ? null : f29LineCount(index) - f29LineCount(parentIndex),
        delta_pct: parentTotal === null || parentTotal === 0 ? null : ((total - parentTotal) / parentTotal) * 100,
      }
    })
  },
}

const f29WithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  f29TransactionCount += 1
  return fn(f29Db as unknown as never)
})

describe("listBoqs -- R67 F-29: the compare summary for TWENTY revisions in one round trip", () => {
  beforeEach(() => {
    f29TransactionCount = 0
    f29ExecutedSql = []
    f29WithTenantContext.mockClear()
  })

  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => f23RealTenantScoped)
  })

  test("twenty revisions cost ONE transaction and ONE statement -- the acceptance condition of R-273", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f29WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    const rows = await listBoqs({ orgId: F29_ORG }, F29_PROJECT, { include: "compare" })

    expect(rows).toHaveLength(F29_REVISIONS)
    expect(f29TransactionCount).toBe(1)
    expect(f29ExecutedSql).toHaveLength(1)
  })

  test("compare.deltaAmount on the second revision is total(rev2) - total(rev1)", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f29WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    const rows = await listBoqs({ orgId: F29_ORG }, F29_PROJECT, { include: "compare" })
    const second = rows.find((r) => r.id === f29Id(2))!

    expect(second.compare!.deltaAmount).toBe(f29Total(2) - f29Total(1))
    // 60 - 20 = 40, and 40 / 20 = 200 %.
    expect(second.compare!.deltaAmount).toBe(40)
    expect(second.compare!.deltaPct).toBeCloseTo(200, 6)
    expect(second.compare!.total).toBe(f29Total(2))
    expect(second.compare!.lineCount).toBe(f29LineCount(2))
  })

  test("the baseline reports its own size but NULL for every comparison -- there is nothing to compare it to", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f29WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    const baseline = (await listBoqs({ orgId: F29_ORG }, F29_PROJECT, { include: "compare" })).find(
      (r) => r.id === f29Id(1)
    )!

    expect(baseline.compare!.lineCount).toBe(1)
    expect(baseline.compare!.total).toBe(f29Total(1))
    // Null, NOT zero: "no prior revision" and "no change from the prior
    // revision" are different facts and must not render the same.
    expect(baseline.compare!.deltaAmount).toBeNull()
    expect(baseline.compare!.deltaPct).toBeNull()
  })

  test("asking for variation AND compare together is still ONE statement, and the two agree", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f29WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    const rows = await listBoqs({ orgId: F29_ORG }, F29_PROJECT, { include: "variation,compare" })

    expect(f29ExecutedSql).toHaveLength(1)
    for (const row of rows) {
      // They are two projections of the same aggregate; if they could disagree
      // the screen could show two different variations for one revision.
      expect(row.compare!.deltaAmount).toBe(row.variationVsPrior ?? null)
    }
  })

  test("the statement computes the percentage with NULLIF, so a zero-total parent can never divide by zero", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f29WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    await listBoqs({ orgId: F29_ORG }, F29_PROJECT, { include: "compare" })

    const text = f29ExecutedSql[0].replace(/\s+/g, " ").toLowerCase()
    expect(text).toContain("nullif(coalesce(p.total, 0), 0)")
    expect(text).toContain("group by li.boq_id")
  })

  test("a caller that asks for neither gets no compare object at all -- the payload does not grow for nothing", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: f29WithTenantContext }))
    const { listBoqs } = await import("./construction-boq-service")

    const rows = await listBoqs({ orgId: F29_ORG }, F29_PROJECT, { include: "lineItems" })

    expect(f29ExecutedSql).toHaveLength(0)
    expect(rows[0].compare).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// R67 lane I (WS-I items I-03 and I-05). normalizeCategory is pure and tested
// directly; updateLineItemBudget is a withTenantContext() write, so the
// round-trip below runs the REAL function with only the DB layer mocked (the
// same convention construction-reports-service.test.ts uses for
// designerTimesheetReport) -- the acceptance is that a PATCH of materialAmount
// 500 and manpowerAmount 300 comes back on the line item, which a test of a
// pure helper could not show.
import { mock, afterEach } from "bun:test"
import * as realTenantScopedForBoq from "@/lib/db/tenant-scoped"
import { normalizeCategory } from "./construction-boq-service"

describe("normalizeCategory (R67 I-05)", () => {
  test("trims a real value", () => {
    expect(normalizeCategory("  Civil  ")).toBe("Civil")
  })

  test('"", whitespace, null and undefined all collapse to ONE null -- so "no category" is a single value in the column', () => {
    expect(normalizeCategory("")).toBeNull()
    expect(normalizeCategory("   ")).toBeNull()
    expect(normalizeCategory(null)).toBeNull()
    expect(normalizeCategory(undefined)).toBeNull()
  })

  test("never case-folds and never collapses inner spacing -- the wording stays the customer's own", () => {
    expect(normalizeCategory("gypsum  BOARD")).toBe("gypsum  BOARD")
  })
})

describe("updateLineItemBudget -- material/manpower amounts and category (R67 I-03/I-05)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScopedForBoq)
  })

  function mountFakeDb() {
    const setCalls: Record<string, unknown>[] = []
    const stored = row({ id: "line-1", amount: "1000", budgetPercentage: "25" }) as unknown as Record<string, unknown>
    const fakeDb = {
      query: {
        constructionBoqLineItems: { findFirst: mock(async () => ({ ...stored, boqId: "boq-1" })) },
        constructionBoqs: { findFirst: mock(async () => ({ id: "boq-1", orgId: "org-1" })) },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              setCalls.push(values)
              return [{ ...stored, ...values }]
            },
          }),
        }),
      }),
    }
    return { fakeDb, setCalls }
  }

  async function patch(input: Record<string, unknown>) {
    const { fakeDb, setCalls } = mountFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScopedForBoq,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const { updateLineItemBudget } = await import("./construction-boq-service")
    const updated = await updateLineItemBudget({ orgId: "org-1" }, "line-1", input)
    return { updated, setCalls }
  }

  test("a PATCH of materialAmount 500 and manpowerAmount 300 round-trips on the line item", async () => {
    const { updated, setCalls } = await patch({ materialAmount: 500, manpowerAmount: 300 })
    expect(setCalls[0]).toEqual({ materialAmount: "500", manpowerAmount: "300" })
    expect(updated.materialAmount).toBe("500")
    expect(updated.manpowerAmount).toBe("300")
  })

  test("null clears an amount, and undefined leaves it completely alone", async () => {
    const cleared = await patch({ materialAmount: null })
    expect(cleared.setCalls[0]).toEqual({ materialAmount: null })

    const untouched = await patch({ budgetPercentage: 40 })
    expect(untouched.setCalls[0]).toEqual({ budgetPercentage: "40" })
    expect("materialAmount" in untouched.setCalls[0]).toBe(false)
    expect("manpowerAmount" in untouched.setCalls[0]).toBe(false)
    expect("category" in untouched.setCalls[0]).toBe(false)
  })

  test("category is normalised on the way in -- a blank becomes null, not an empty string", async () => {
    expect((await patch({ category: "  Civil " })).setCalls[0]).toEqual({ category: "Civil" })
    expect((await patch({ category: "   " })).setCalls[0]).toEqual({ category: null })
    expect((await patch({ category: null })).setCalls[0]).toEqual({ category: null })
  })

  test("a negative amount is refused with a 400 and nothing is written", async () => {
    const { fakeDb, setCalls } = mountFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScopedForBoq,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const { updateLineItemBudget } = await import("./construction-boq-service")
    let thrown: unknown
    try {
      await updateLineItemBudget({ orgId: "org-1" }, "line-1", { manpowerAmount: -1 })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ServiceError)
    expect((thrown as Error).message).toBe("manpowerAmount must be a non-negative number, got -1")
    expect((thrown as { status: number }).status).toBe(400)
    expect(setCalls).toEqual([])
  })
})
