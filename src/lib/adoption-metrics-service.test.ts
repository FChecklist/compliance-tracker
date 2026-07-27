/// <reference types="bun-types" />
// V2-13 (SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md C4, CSV rows
// #16/#17/#20 "Mode Pills"): computeModePillUsageRate() is the pure rate
// function computeOrgAdoptionMetrics() feeds its two real DB counts into --
// tested here without a DB, matching chain-usage-ranking.test.ts's own
// established split between pure computation and DB aggregation.
import { describe, expect, test } from "bun:test"
import { computeModePillUsageRate } from "./adoption-metrics-service"

describe("computeModePillUsageRate -- V2-13 mode-pill vs free-text analytics", () => {
  test("no conversation has reached the Chain Selector decision point yet -- null, not fabricated as 0%", () => {
    expect(computeModePillUsageRate(0, 0)).toBeNull()
  })

  test("every decided conversation used a mode pill -- 100%", () => {
    expect(computeModePillUsageRate(10, 0)).toBe(100)
  })

  test("every decided conversation explicitly skipped to free text -- 0%", () => {
    expect(computeModePillUsageRate(0, 10)).toBe(0)
  })

  test("mixed usage is rounded to one decimal place", () => {
    expect(computeModePillUsageRate(1, 2)).toBeCloseTo(33.3, 1)
  })

  test("even split is exactly 50%", () => {
    expect(computeModePillUsageRate(5, 5)).toBe(50)
  })
})
