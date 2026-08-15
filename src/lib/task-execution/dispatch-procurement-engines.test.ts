/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchProcurementEngines } from "./dispatch-procurement-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchProcurementEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchProcurementEngines("emi_calculator", {})).toBe(NOT_HANDLED)
  })

  test("vendor_comparison_engine rejects a non-array vendors", async () => {
    expect(dispatchProcurementEngines("vendor_comparison_engine", { vendors: "nope" })).rejects.toThrow("vendors must be an array")
  })

  test("bid_evaluation_engine rejects a non-array bids", async () => {
    expect(dispatchProcurementEngines("bid_evaluation_engine", { bids: "nope", minTechnicalScore: 50 })).rejects.toThrow("bids must be an array")
  })

  test("freight_allocation_engine rejects a non-array lineItems", async () => {
    expect(dispatchProcurementEngines("freight_allocation_engine", { lineItems: "nope", totalFreightCost: 100 })).rejects.toThrow("lineItems must be an array")
  })

  test("freight_allocation_engine rejects a basis outside weight/value", async () => {
    expect(dispatchProcurementEngines("freight_allocation_engine", { lineItems: [], totalFreightCost: 100, basis: "volume" }))
      .rejects.toThrow("basis must be weight or value")
  })

  test("purchase_cost_calculator dispatches a pure numeric formula", async () => {
    expect(await dispatchProcurementEngines("purchase_cost_calculator", { unitPrice: 10, quantity: 5 })).toEqual({ purchaseCost: 50 })
  })
})
