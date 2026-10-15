/// <reference types="bun-types" />
// The revise form gives a line that was saved with NO item code an invented one,
// `_row_<id>` (PROJEXA boq-helpers toDrafts, this app's scope page toDraft), and the
// revision stores it. diffLineItems keyed the old row by its description and the new
// row by `_row_<id>`, so a revision that changed NOTHING read as "removes the whole
// line" and was hard-blocked whenever that line had progress (found live 2026-10-13,
// Sumeet R-22/R-23, "'Brick partition 230mm' ... would be removed entirely").
// These are the pure-function tests; each one fails on the pre-fix diffLineItems.
import { describe, test, expect } from "bun:test"
import { diffLineItems, findScopeReductionViolations, type BoqLineItemRow } from "./construction-boq-service"

function row(overrides: Partial<BoqLineItemRow>): BoqLineItemRow {
  return {
    id: overrides.id ?? "row-id",
    boqId: "boq-1",
    activityId: null,
    itemCode: null,
    description: "Brick partition 230mm",
    unit: "sqm",
    quantity: "100",
    rate: "50",
    amount: "5000",
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
    createdAt: new Date("2026-10-13T00:00:00Z"),
    ...overrides,
  }
}

const previous = [row({ id: "aw0wynqx3448vfbem18jgwyy" })]

describe("diffLineItems -- a line without an item code survives a revision under its invented _row_ code", () => {
  test("an unchanged revision changes nothing: no removed line, no added line, no change", () => {
    const current = [row({ id: "new1", itemCode: "_row_aw0wynqx3448vfbem18jgwyy" })]
    const diff = diffLineItems(previous, current)
    expect(diff.removed).toHaveLength(0)
    expect(diff.added).toHaveLength(0)
    expect(diff.changed).toHaveLength(0)
  })

  test("raising the quantity is one changed line, never a removal plus an addition", () => {
    const current = [row({ id: "new1", itemCode: "_row_aw0wynqx3448vfbem18jgwyy", quantity: "120", amount: "6000" })]
    const diff = diffLineItems(previous, current)
    expect(diff.removed).toHaveLength(0)
    expect(diff.added).toHaveLength(0)
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].previous.id).toBe("aw0wynqx3448vfbem18jgwyy")
    expect(diff.changed[0].netVariation).toBe(1000)
  })

  test("a de-duplicated invented code (_row_<id>_x, _row_<id>_1) resolves to the same row", () => {
    for (const code of ["_row_aw0wynqx3448vfbem18jgwyy_x", "_row_aw0wynqx3448vfbem18jgwyy_1"]) {
      const diff = diffLineItems(previous, [row({ id: "new1", itemCode: code })])
      expect(diff.removed).toHaveLength(0)
      expect(diff.added).toHaveLength(0)
    }
  })

  test("the scope-reduction guard does not block an unchanged or increased revision of a line with progress", () => {
    const unchanged = diffLineItems(previous, [row({ id: "new1", itemCode: "_row_aw0wynqx3448vfbem18jgwyy" })])
    expect(findScopeReductionViolations(unchanged, new Map([["aw0wynqx3448vfbem18jgwyy", 95]]))).toHaveLength(0)
    const raised = diffLineItems(previous, [row({ id: "new1", itemCode: "_row_aw0wynqx3448vfbem18jgwyy", quantity: "120", amount: "6000" })])
    expect(findScopeReductionViolations(raised, new Map([["aw0wynqx3448vfbem18jgwyy", 95], ["new1", 95]]))).toHaveLength(0)
  })

  test("the guard still blocks a REAL reduction and a REAL removal of a line with progress", () => {
    const reduced = diffLineItems(previous, [row({ id: "new1", itemCode: "_row_aw0wynqx3448vfbem18jgwyy", quantity: "50", amount: "2500" })])
    expect(reduced.changed).toHaveLength(1)
    expect(findScopeReductionViolations(reduced, new Map([["new1", 95]]))).toHaveLength(1)
    const removed = diffLineItems(previous, [])
    expect(removed.removed).toHaveLength(1)
    expect(findScopeReductionViolations(removed, new Map([["aw0wynqx3448vfbem18jgwyy", 95]]))).toHaveLength(1)
  })

  test("an invented code that names a row with a REAL item code, or a row that does not exist, is just a new line", () => {
    const coded = [row({ id: "p1", itemCode: "A1" })]
    const a = diffLineItems(coded, [row({ id: "n1", itemCode: "_row_p1" })])
    expect(a.added).toHaveLength(1)
    expect(a.removed).toHaveLength(1)
    const b = diffLineItems(previous, [row({ id: "n1", itemCode: "_row_nosuchrow", description: "Other work" })])
    expect(b.added).toHaveLength(1)
    expect(b.removed).toHaveLength(1)
  })

  test("coded lines still match by their own code (no behaviour change for BOQs that have item codes)", () => {
    const coded = [row({ id: "p1", itemCode: "A1" })]
    const diff = diffLineItems(coded, [row({ id: "n1", itemCode: "A1", quantity: "110", amount: "5500" })])
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.changed).toHaveLength(1)
  })
})
