/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchCrmEngines } from "./dispatch-crm-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchCrmEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchCrmEngines("critical_path_engine", {})).toBe(NOT_HANDLED)
  })

  test("rfm_scoring_engine rejects a non-array customers", async () => {
    expect(dispatchCrmEngines("rfm_scoring_engine", { customers: "nope" })).rejects.toThrow("customers must be an array")
  })

  test("customer_lifetime_value_calculator dispatches a pure formula", async () => {
    const result = await dispatchCrmEngines("customer_lifetime_value_calculator", { avgOrderValue: 100, purchaseFrequencyPerYear: 4, customerLifespanYears: 3 }) as { clv: number }
    expect(result.clv).toBe(1200)
  })

  test("customer_health_score accepts an optional weights object", async () => {
    const withoutWeights = await dispatchCrmEngines("customer_health_score", { usageScore: 80, supportScore: 70, paymentScore: 90 })
    const withWeights = await dispatchCrmEngines("customer_health_score", { usageScore: 80, supportScore: 70, paymentScore: 90, weights: { usage: 1, support: 1, payment: 1 } })
    expect(withoutWeights).toBeTruthy()
    expect(withWeights).toBeTruthy()
  })
})
