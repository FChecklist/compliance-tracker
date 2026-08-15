/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchMarketingEngines } from "./dispatch-marketing-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchMarketingEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchMarketingEngines("route_optimization_engine", {})).toBe(NOT_HANDLED)
  })

  test("marketing_roi_calculator, cac_calculator, and roas_calculator dispatch to distinct pure formulas", async () => {
    expect(await dispatchMarketingEngines("marketing_roi_calculator", { revenueGenerated: 200, marketingSpend: 100 })).toEqual({ roiPercent: 100 })
    expect(await dispatchMarketingEngines("cac_calculator", { totalAcquisitionSpend: 1000, newCustomersAcquired: 10 })).toEqual({ cac: 100 })
    expect(await dispatchMarketingEngines("roas_calculator", { revenueFromAds: 500, adSpend: 100 })).toEqual({ roas: 5 })
  })

  test("attribution_engine rejects a non-array touchpoints", async () => {
    expect(dispatchMarketingEngines("attribution_engine", { touchpoints: "nope", conversionValue: 100 })).rejects.toThrow("touchpoints must be an array")
  })

  test("funnel_conversion_calculator rejects a non-array stageCounts", async () => {
    expect(dispatchMarketingEngines("funnel_conversion_calculator", { stageCounts: "nope" })).rejects.toThrow("stageCounts must be an array")
  })

  test("campaign_scoring_engine accepts an optional weights object", async () => {
    const withoutWeights = await dispatchMarketingEngines("campaign_scoring_engine", { reachScore: 50, engagementScore: 50, conversionScore: 50 })
    const withWeights = await dispatchMarketingEngines("campaign_scoring_engine", { reachScore: 50, engagementScore: 50, conversionScore: 50, weights: { reach: 1, engagement: 1, conversion: 1 } })
    expect(withoutWeights).toBeTruthy()
    expect(withWeights).toBeTruthy()
  })
})
