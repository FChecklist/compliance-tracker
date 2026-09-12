/// <reference types="bun-types" />
// Split out of construction-reports-service.test.ts (seq4/c5 de-share,
// 2026-09-11): that file cited 5 requirements (R-33, R-44, R-45, R-52,
// R-C11) over the 3-per-file cap. This file carries R-44/R-45, moved
// verbatim -- both were already a clean, self-contained 2-requirement
// describe block with no DB mocking, so no further splitting was needed.
//
// R75 Part 2 Phase 3 (R-44/R-45): explicit, standalone checks of the two
// invariants computeEarnedValue() must hold -- direct assertions of the
// formulas themselves, not regression-oracle reproductions of a historical
// bug.
import { describe, expect, test } from "bun:test"
import { computeEarnedValue, type EvLineItem } from "./construction-reports-service"

describe("computeEarnedValue -- R-44/R-45 explicit invariant checks", () => {
  test("R-44: a parent's cumulative quantity equals the sum of each child's cumulative quantity x that child's breakdownPercentage/100", () => {
    const items: EvLineItem[] = [
      { id: "root1", parentLineItemId: null, rate: 1, amount: 1000, breakdownPercentage: null },
      { id: "childA", parentLineItemId: "root1", rate: 1, amount: 600, breakdownPercentage: 60 },
      { id: "childB", parentLineItemId: "root1", rate: 1, amount: 400, breakdownPercentage: 40 },
    ]
    // root1 itself has no measured quantity and no percentComplete, so it
    // contributes nothing on its own here -- isolating the children-only
    // sum. rootRate=1 on every line so earnedValue reads as pure quantity.
    const qtyByItem = new Map([
      ["childA", 30], // childA's own cumulative quantity
      ["childB", 20], // childB's own cumulative quantity
    ])
    const result = computeEarnedValue(items, qtyByItem, new Map())
    // 30 x 60/100 + 20 x 40/100 = 18 + 8 = 26
    expect(result.earnedValue).toBe(26)
  })

  test("R-45: the parent percent complete equals the parent's cumulative amount divided by its total contracted amount", () => {
    const items: EvLineItem[] = [{ id: "root1", parentLineItemId: null, rate: 25, amount: 800, breakdownPercentage: null }]
    const qtyByItem = new Map([["root1", 16]]) // root1's own cumulative quantity
    const result = computeEarnedValue(items, qtyByItem, new Map())
    expect(result.earnedValue).toBe(400) // 16 x 25 -- the parent's cumulative amount
    expect(result.contractValue).toBe(800) // the parent's total contracted amount
    expect(result.percentByValue).toBe(50) // 400 / 800 x 100
  })
})
