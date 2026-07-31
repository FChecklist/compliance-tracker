/// <reference types="bun-types" />
// Task #46 (CRM Campaigns gap-closure, 2026-07-31): marketing-engine.ts had
// zero test coverage before this -- all 6 exports are pure functions, so
// tested directly rather than via the withTenantContext/live-DB-backed
// campaign CRUD (crm-campaigns-service.ts), matching this repo's own
// per-engine .test.ts convention (see analytics-engine.test.ts). Covers
// calculateCampaignScore specifically because Task #46's spec calls for
// campaign scoring to be "wired to the existing marketing-engine.ts
// formula" (already true via task-execution-engine.ts) -- these tests
// pin that formula's real behavior.
import { describe, expect, test } from "bun:test"
import {
  calculateMarketingRoi,
  calculateCac,
  calculateRoas,
  attributeConversionLinear,
  calculateCampaignScore,
  calculateFunnelConversion,
} from "./marketing-engine"

describe("calculateMarketingRoi", () => {
  test("positive ROI when revenue exceeds spend", () => {
    expect(calculateMarketingRoi(15000, 5000)).toBe(200)
  })

  test("negative ROI when revenue is below spend", () => {
    expect(calculateMarketingRoi(2000, 5000)).toBe(-60)
  })

  test("throws when marketingSpend is zero or negative", () => {
    expect(() => calculateMarketingRoi(1000, 0)).toThrow()
    expect(() => calculateMarketingRoi(1000, -100)).toThrow()
  })
})

describe("calculateCac", () => {
  test("divides total spend by new customers acquired", () => {
    expect(calculateCac(10000, 40)).toBe(250)
  })

  test("throws when newCustomersAcquired is zero or negative", () => {
    expect(() => calculateCac(10000, 0)).toThrow()
    expect(() => calculateCac(10000, -5)).toThrow()
  })
})

describe("calculateRoas", () => {
  test("divides ad-driven revenue by ad spend", () => {
    expect(calculateRoas(8000, 2000)).toBe(4)
  })

  test("throws when adSpend is zero or negative", () => {
    expect(() => calculateRoas(8000, 0)).toThrow()
    expect(() => calculateRoas(8000, -1)).toThrow()
  })
})

describe("attributeConversionLinear", () => {
  test("splits conversion value evenly across touchpoints", () => {
    const result = attributeConversionLinear(
      [{ channel: "email" }, { channel: "social" }, { channel: "search" }],
      300
    )
    expect(result).toEqual({ email: 100, social: 100, search: 100 })
  })

  test("sums repeated touches on the same channel", () => {
    const result = attributeConversionLinear(
      [{ channel: "email" }, { channel: "email" }],
      100
    )
    expect(result).toEqual({ email: 100 })
  })

  test("returns an empty object for an empty conversion path", () => {
    expect(attributeConversionLinear([], 500)).toEqual({})
  })
})

describe("calculateCampaignScore", () => {
  test("applies the default reach/engagement/conversion weights (0.2/0.3/0.5)", () => {
    const score = calculateCampaignScore({ reachScore: 80, engagementScore: 60, conversionScore: 90 })
    // 80*0.2 + 60*0.3 + 90*0.5 = 16 + 18 + 45 = 79
    expect(score).toBe(79)
  })

  test("scores a perfect campaign at 100", () => {
    expect(calculateCampaignScore({ reachScore: 100, engagementScore: 100, conversionScore: 100 })).toBe(100)
  })

  test("scores a zero-performance campaign at 0", () => {
    expect(calculateCampaignScore({ reachScore: 0, engagementScore: 0, conversionScore: 0 })).toBe(0)
  })

  test("honors custom weights when supplied", () => {
    const score = calculateCampaignScore(
      { reachScore: 50, engagementScore: 50, conversionScore: 50 },
      { reach: 1, engagement: 0, conversion: 0 }
    )
    expect(score).toBe(50)
  })
})

describe("calculateFunnelConversion", () => {
  test("computes stage-over-stage conversion rates, first stage has no prior rate", () => {
    const result = calculateFunnelConversion([
      { stage: "visitors", count: 1000 },
      { stage: "leads", count: 200 },
      { stage: "customers", count: 50 },
    ])
    expect(result).toEqual([
      { stage: "visitors", count: 1000, conversionFromPrevious: null },
      { stage: "leads", count: 200, conversionFromPrevious: 20 },
      { stage: "customers", count: 50, conversionFromPrevious: 25 },
    ])
  })

  test("a zero-count stage makes the next stage's rate null instead of dividing by zero", () => {
    const result = calculateFunnelConversion([
      { stage: "visitors", count: 0 },
      { stage: "leads", count: 10 },
    ])
    expect(result[1].conversionFromPrevious).toBeNull()
  })

  test("empty funnel returns an empty array", () => {
    expect(calculateFunnelConversion([])).toEqual([])
  })
})
