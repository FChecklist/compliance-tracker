/// <reference types="bun-types" />
// Split out of construction-boq-service.test.ts (seq4/c5 de-share,
// 2026-09-11): that file cited 9 requirements over the 3-per-file cap.
// This file carries R-12/R-13, moved verbatim -- both already a clean,
// self-contained describe block with no DB mocking.
//
// A first attempt at this split (a background agent grepping literal ID
// text in the file) mismatched R-12/R-13 to a DIFFERENT block 130+ lines
// away, because that block happens to contain the coincidental text "R12
// point 7 (Option B)" -- an unrelated internal numbering scheme, not
// Sumeet's R-12. The mapping below was verified against the real
// requirement text in platform.sumeet_requirements instead of grepping IDs:
// R-12 = "Sub-task amount = ROOT qty x ROOT rate x breakdown %", R-13 =
// "Sub-task own QTY and RATE ignored" -- both are exactly what
// deriveLineItemQuantityAndRate's own tests below assert.
import { describe, test, expect } from "bun:test"
import {
  computeHierarchicalAmount, deriveLineItemQuantityAndRate,
  ServiceError, type BoqLineItemInput,
} from "./construction-boq-service"

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

  test("R-12: a child's rate is ROOT rate x breakdown% / 100 -- F2 (the Sumeet spec's own worked example: 108 x 30% = 32.4)", () => {
    const main: BoqLineItemInput = { itemCode: "M1", description: "Main", unit: "sqm", quantity: 472, rate: 108 }
    const sub: BoqLineItemInput = { parentItemCode: "M1", breakdownPercentage: 30, description: "Frame 01", unit: "sqm", quantity: 0, rate: 0 }
    expect(deriveLineItemQuantityAndRate(sub, new Map([["M1", main]])).rate).toBeCloseTo(32.4, 6)
  })

  test("R-13: *** THE CORE FIX ***: a child's OWN submitted quantity/rate are IGNORED and overwritten by the derived root values -- proves independent entry (convention B) is no longer possible", () => {
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
