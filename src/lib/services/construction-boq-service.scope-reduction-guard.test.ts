/// <reference types="bun-types" />
// Split out of construction-boq-service.test.ts (seq4/c5 de-share,
// 2026-09-11): that file cited 9 requirements over the 3-per-file cap.
// This file carries R-22/R-23, moved verbatim -- already a clean,
// self-contained describe block with no DB mocking, both requirements
// covered by adjacent tests within it. Verified against the real
// requirement text in platform.sumeet_requirements: R-22 "Removing a line
// WITH progress is BLOCKED", R-23 "Reducing qty on a line WITH progress is
// BLOCKED" -- distinct from R-C13 (construction-boq-service.revision-
// integration.test.ts), which is the full end-to-end createBoqRevision()
// acceptance test of the same rule; these are the pure-function-level guard
// tests it's built from.
//
// The literal text "R12 point 7 (Option B)" appears in this file's own
// header comment immediately above this describe block, in the original
// file -- that refers to a DIFFERENT, unrelated internal numbering scheme,
// not Sumeet's R-12 (verified: R-12's real text is about weighted sub-task
// pricing, covered in construction-boq-service.weighted-subtask-pricing.test.ts).
import { describe, test, expect } from "bun:test"
import { findScopeReductionViolations, type ChangedLineItem, type BoqLineItemRow } from "./construction-boq-service"

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

describe("findScopeReductionViolations -- the Owner's hard-block rule for descoping completed work", () => {
  test("a positive variation on a line item with completed progress is never a violation", () => {
    const changed: ChangedLineItem[] = [{
      key: "M1", previous: row({ id: "p1", activityId: "act-1" }), current: row({ id: "c1", activityId: "act-1" }),
      quantityChange: 10, rateChange: 0, breakdownPercentageChange: 0, netVariation: 500, isSubItem: false,
    }]
    const violations = findScopeReductionViolations({ removed: [], changed }, new Map([["c1", 60]]))
    expect(violations).toHaveLength(0)
  })

  test("R-22: removing a line item entirely is blocked when the resolver found it >0% complete", () => {
    const removed = [row({ id: "r1", description: "Brickwork", activityId: "act-1" })]
    const violations = findScopeReductionViolations({ removed, changed: [] }, new Map([["r1", 25]]))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("Brickwork")
  })

  test("R-23: a negative variation (reduced quantity/amount) on a line item is blocked when the resolver found it >0% complete", () => {
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
    const violations = findScopeReductionViolations({ removed, changed }, new Map([["r1", 0]]))
    expect(violations).toHaveLength(0)
  })

  test("a line item with no entry in the resolved progress map at all can never be blocked", () => {
    const removed = [row({ id: "r1", activityId: null })]
    const violations = findScopeReductionViolations({ removed, changed: [] }, new Map([["some-other-item", 90]]))
    expect(violations).toHaveLength(0)
  })
})
