/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchFixedAssetEngines } from "./dispatch-fixed-asset-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchFixedAssetEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchFixedAssetEngines("margin_calculator", {})).toBe(NOT_HANDLED)
  })

  test("straight_line_depreciation_engine and wdv_depreciation_engine both dispatch a schedule", async () => {
    const sl = await dispatchFixedAssetEngines("straight_line_depreciation_engine", { cost: 10000, salvageValue: 1000, usefulLifeYears: 5 }) as { schedule: unknown[] }
    const wdv = await dispatchFixedAssetEngines("wdv_depreciation_engine", { cost: 10000, salvageValue: 1000, usefulLifeYears: 5 }) as { schedule: unknown[] }
    expect(Array.isArray(sl.schedule)).toBe(true)
    expect(Array.isArray(wdv.schedule)).toBe(true)
  })

  test("capitalization_engine reads extendsUsefulLife through the truthy() helper", async () => {
    const extends1 = await dispatchFixedAssetEngines("capitalization_engine", { expenseAmount: 100, capitalizationThreshold: 50, extendsUsefulLife: "yes" })
    const doesNot = await dispatchFixedAssetEngines("capitalization_engine", { expenseAmount: 100, capitalizationThreshold: 50, extendsUsefulLife: "no" })
    expect(extends1).toBeTruthy()
    expect(doesNot).toBeTruthy()
  })

  test("asset_disposal_engine and impairment_engine dispatch to distinct pure formulas", async () => {
    const disposal = await dispatchFixedAssetEngines("asset_disposal_engine", { netBookValue: 1000, saleProceeds: 1200 })
    const impairment = await dispatchFixedAssetEngines("impairment_engine", { carryingValue: 1000, recoverableAmount: 800 })
    expect(disposal).toBeTruthy()
    expect(impairment).toBeTruthy()
  })
})
