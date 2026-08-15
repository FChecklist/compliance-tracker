/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchInventoryEngines } from "./dispatch-inventory-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchInventoryEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchInventoryEngines("gratuity_calculator", {})).toBe(NOT_HANDLED)
  })

  test("fifo_engine and fefo_engine both reject a non-array lots", async () => {
    expect(dispatchInventoryEngines("fifo_engine", { lots: "nope", quantityToConsume: 1 })).rejects.toThrow("lots must be an array")
    expect(dispatchInventoryEngines("fefo_engine", { lots: "nope", quantityToConsume: 1 })).rejects.toThrow("lots must be an array")
  })

  test("stock_valuation_engine rejects a method outside fifo/weighted_average", async () => {
    expect(dispatchInventoryEngines("stock_valuation_engine", { lots: [], method: "lifo" })).rejects.toThrow("method must be fifo or weighted_average")
  })

  test("stock_valuation_engine accepts an omitted method", async () => {
    const result = await dispatchInventoryEngines("stock_valuation_engine", { lots: [{ quantity: 10, unitCost: 5 }] }) as { stockValue: number }
    expect(result.stockValue).toBe(50)
  })

  test("inventory_aging_engine rejects a non-array buckets when provided", async () => {
    expect(dispatchInventoryEngines("inventory_aging_engine", { lots: [], asOfDate: "2026-01-01", buckets: "nope" }))
      .rejects.toThrow("buckets must be an array of numbers if provided")
  })

  test("cycle_counting_engine rejects an abcClass outside A/B/C", async () => {
    expect(dispatchInventoryEngines("cycle_counting_engine", { abcClass: "D" })).rejects.toThrow("abcClass must be A, B, or C")
  })

  test("abc_analysis_engine, xyz_analysis_engine, slow_moving_inventory_engine, and dead_stock_engine each reject a non-array items", async () => {
    expect(dispatchInventoryEngines("abc_analysis_engine", { items: "nope" })).rejects.toThrow("items must be an array")
    expect(dispatchInventoryEngines("xyz_analysis_engine", { items: "nope" })).rejects.toThrow("items must be an array")
    expect(dispatchInventoryEngines("slow_moving_inventory_engine", { items: "nope" })).rejects.toThrow("items must be an array")
    expect(dispatchInventoryEngines("dead_stock_engine", { items: "nope" })).rejects.toThrow("items must be an array")
  })

  test("eoq_calculator dispatches to a pure numeric formula", async () => {
    const result = await dispatchInventoryEngines("eoq_calculator", { annualDemand: 1000, orderingCostPerOrder: 50, holdingCostPerUnitPerYear: 2 }) as { eoq: number }
    expect(result.eoq).toBeGreaterThan(0)
  })
})
