/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchSalesEngines } from "./dispatch-sales-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchSalesEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchSalesEngines("customer_health_score", {})).toBe(NOT_HANDLED)
  })

  test("markup_calculator's mode field branches between markupPercent and price_from_markup", async () => {
    const markup = await dispatchSalesEngines("markup_calculator", { sellingPrice: 150, cost: 100 })
    expect(markup).toHaveProperty("markupPercent")
    const price = await dispatchSalesEngines("markup_calculator", { cost: 100, markupPercent: 50, mode: "price_from_markup" })
    expect(price).toHaveProperty("price")
  })

  test("sales_incentive_calculator rejects a non-array slabs", async () => {
    expect(dispatchSalesEngines("sales_incentive_calculator", { achievedSales: 1, targetSales: 1, slabs: "nope" })).rejects.toThrow("slabs must be an array")
  })

  test("sales_forecast_engine rejects a non-array historicalValues", async () => {
    expect(dispatchSalesEngines("sales_forecast_engine", { historicalValues: "nope", periodsAhead: 1 })).rejects.toThrow("historicalValues must be an array")
  })

  test("pipeline_probability_engine rejects a non-array deals", async () => {
    expect(dispatchSalesEngines("pipeline_probability_engine", { deals: "nope" })).rejects.toThrow("deals must be an array")
  })

  test("margin_calculator dispatches a pure formula", async () => {
    expect(await dispatchSalesEngines("margin_calculator", { sellingPrice: 200, cost: 150 })).toEqual({ marginPercent: 25 })
  })
})
