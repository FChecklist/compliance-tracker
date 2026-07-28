// Wave 174: tests the pure budget-markup math (computeBudgetAmount /
// buildBudgetSummary) directly -- no withTenantContext/live DB, matching
// this repo's established pattern (see erp-fixed-assets-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeBudgetAmount, buildBudgetSummary, DEFAULT_MARKUP_PERCENT } from "./construction-budget-service"

describe("computeBudgetAmount", () => {
  test("null markupPercent falls back to the Owner's default 25%", () => {
    expect(computeBudgetAmount(100000, null)).toBeCloseTo(125000)
  })
  test("undefined markupPercent also falls back to the default", () => {
    expect(computeBudgetAmount(100000, undefined)).toBeCloseTo(125000)
  })
  test("an explicit override percent is used instead of the default", () => {
    expect(computeBudgetAmount(100000, 30)).toBeCloseTo(130000)
  })
  test("a 0% override is honored, not treated as falsy-and-defaulted", () => {
    expect(computeBudgetAmount(100000, 0)).toBeCloseTo(100000)
  })
})

describe("buildBudgetSummary -- default-25%-but-overridable-per-line", () => {
  const lineItems = [
    { id: "li-1", itemCode: "C-101", description: "Excavation", quantity: "100", rate: "500", amount: "50000", activityId: "act-1" },
    { id: "li-2", itemCode: "C-102", description: "Brickwork", quantity: "200", rate: "300", amount: "60000", activityId: "act-2" },
  ]
  const activitiesById = new Map([
    ["act-1", { categoryId: "cat-civil" }],
    ["act-2", { categoryId: "cat-civil" }],
  ])
  const categoriesById = new Map([["cat-civil", { name: "Civil" }]])

  test("one line with no config row defaults to 25%, one line explicitly overridden to 30% -- both compute correctly", () => {
    const configsByLineItemId = new Map([
      // li-1 has no config row at all -- exercises the "absence of a row" default path.
      ["li-2", { markupPercent: "30", vendorName: "Acme Builders", vendorAmount: "62000" }],
    ])

    const rows = buildBudgetSummary(lineItems, configsByLineItemId, activitiesById, categoriesById)
    expect(rows).toHaveLength(2)

    const [defaulted, overridden] = rows
    expect(defaulted.sNo).toBe(1)
    expect(defaulted.category).toBe("Civil")
    expect(defaulted.code).toBe("C-101")
    expect(defaulted.amount).toBeCloseTo(50000)
    expect(defaulted.markupPercent).toBe(DEFAULT_MARKUP_PERCENT)
    expect(defaulted.budgetAmount).toBeCloseTo(62500) // 50000 * 1.25
    expect(defaulted.vendor1).toBeNull()
    expect(defaulted.vendorAmount).toBeNull()

    expect(overridden.sNo).toBe(2)
    expect(overridden.amount).toBeCloseTo(60000)
    expect(overridden.markupPercent).toBe(30)
    expect(overridden.budgetAmount).toBeCloseTo(78000) // 60000 * 1.30
    expect(overridden.vendor1).toBe("Acme Builders")
    expect(overridden.vendorAmount).toBeCloseTo(62000)
  })

  test("a config row present but with markupPercent left null still defaults to 25% (a row can exist purely to carry vendor info)", () => {
    const configsByLineItemId = new Map([
      ["li-1", { markupPercent: null, vendorName: "Site Vendor Co", vendorAmount: "51000" }],
    ])
    const rows = buildBudgetSummary([lineItems[0]], configsByLineItemId, activitiesById, categoriesById)
    expect(rows[0].markupPercent).toBe(DEFAULT_MARKUP_PERCENT)
    expect(rows[0].budgetAmount).toBeCloseTo(62500)
    expect(rows[0].vendor1).toBe("Site Vendor Co")
  })

  test("a line item with no activity link reports a null category instead of throwing", () => {
    const rows = buildBudgetSummary(
      [{ id: "li-3", itemCode: null, description: "Misc", quantity: "1", rate: "1000", amount: "1000", activityId: null }],
      new Map(), new Map(), new Map()
    )
    expect(rows[0].category).toBeNull()
    expect(rows[0].code).toBeNull()
    expect(rows[0].budgetAmount).toBeCloseTo(1250)
  })
})
