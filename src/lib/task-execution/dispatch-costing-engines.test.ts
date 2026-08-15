/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchCostingEngines } from "./dispatch-costing-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchCostingEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchCostingEngines("basic_arithmetic_engine", {})).toBe(NOT_HANDLED)
  })

  test("job_costing_engine dispatches and sums the three cost components", async () => {
    const result = await dispatchCostingEngines("job_costing_engine", { directMaterial: 100, directLabor: 50, overheadAllocated: 25 }) as { result: number }
    expect(result.result).toBe(175)
  })

  test("activity_based_costing_engine rejects a non-array costPools", async () => {
    expect(dispatchCostingEngines("activity_based_costing_engine", { costPools: "nope", objectDriverUsage: {} }))
      .rejects.toThrow("costPools must be an array")
  })

  test("activity_based_costing_engine rejects a non-object objectDriverUsage", async () => {
    expect(dispatchCostingEngines("activity_based_costing_engine", { costPools: [], objectDriverUsage: ["nope"] }))
      .rejects.toThrow("objectDriverUsage must be an object")
  })

  test("cost_allocation_engine rejects a non-array allocationBasis", async () => {
    expect(dispatchCostingEngines("cost_allocation_engine", { pool: 100, allocationBasis: "nope" }))
      .rejects.toThrow("allocationBasis must be an array")
  })

  test("variance_analysis_engine defaults higherIsFavorable to true when omitted or blank", async () => {
    const withOmitted = await dispatchCostingEngines("variance_analysis_engine", { actual: 110, budget: 100 }) as Record<string, unknown>
    const withBlank = await dispatchCostingEngines("variance_analysis_engine", { actual: 110, budget: 100, higherIsFavorable: "" }) as Record<string, unknown>
    expect(withOmitted).toEqual(withBlank)
  })

  test("variance_analysis_engine respects an explicit higherIsFavorable=false", async () => {
    const favorable = await dispatchCostingEngines("variance_analysis_engine", { actual: 110, budget: 100, higherIsFavorable: "true" }) as { favorable: boolean }
    const unfavorable = await dispatchCostingEngines("variance_analysis_engine", { actual: 110, budget: 100, higherIsFavorable: "false" }) as { favorable: boolean }
    expect(favorable.favorable).not.toBe(unfavorable.favorable)
  })
})
