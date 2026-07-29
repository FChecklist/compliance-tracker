/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeBlendedOwnerCostPerToken,
  computeAiTokenRate,
  computeBillableTokensForTask,
  aggregateBillableTokensForOrg,
  computeAiUsageBillForOrg,
  computeBaseInfraBillableBeforeMargin,
  computeBaseInfraBill,
  computeCustomerBillForOrg,
  type PlatformPeriodOwnerCostTotals,
  type OrgEndUserTasks,
} from "./ai-usage-billing"
import {
  PLATFORM_DEFAULT_PRICING_CONFIG,
  MARGIN_MULTIPLIER,
  ESTIMATION_BUFFER,
  COMMISSION_RATE,
  deriveMarginMultiplierFromBusinessRule,
  type PricingConfig,
} from "./pricing-config"

const CONFIG: PricingConfig = PLATFORM_DEFAULT_PRICING_CONFIG // basePrice=99, includedUsersInBase=5, pricePerExtraUser=15

describe("Step 1: computeBlendedOwnerCostPerToken", () => {
  test("blends fixed-cost and variable-cost owner spend into one platform-wide per-token rate", () => {
    const totals: PlatformPeriodOwnerCostTotals = {
      fixedCostUsdPaid: 100,
      fixedCostTokensDelivered: 800_000,
      variableCostUsdPaid: 100,
      variableCostTokensDelivered: 200_000,
    }
    // (100 + 100) / (800000 + 200000) = 200 / 1000000 = 0.0002
    expect(computeBlendedOwnerCostPerToken(totals)).toBeCloseTo(0.0002, 10)
  })

  test("throws rather than dividing by zero when no real tokens were delivered", () => {
    expect(() =>
      computeBlendedOwnerCostPerToken({
        fixedCostUsdPaid: 0,
        fixedCostTokensDelivered: 0,
        variableCostUsdPaid: 0,
        variableCostTokensDelivered: 0,
      }),
    ).toThrow()
  })
})

describe("Step 2: computeAiTokenRate -- margin applied exactly once", () => {
  test("multiplies blended owner cost by the margin multiplier", () => {
    expect(computeAiTokenRate(0.0002, 4.0)).toBeCloseTo(0.0008, 10)
  })

  test("defaults to the real MARGIN_MULTIPLIER (4.0) when not overridden", () => {
    expect(computeAiTokenRate(0.0002)).toBeCloseTo(0.0002 * MARGIN_MULTIPLIER, 10)
  })

  test("REGRESSION: scaling the margin multiplier by factor N scales AI_TOKEN_RATE by exactly N (no hidden compounding)", () => {
    const base = computeAiTokenRate(0.0002, 4.0)
    const scaled = computeAiTokenRate(0.0002, 4.0 * 3)
    expect(scaled).toBeCloseTo(base * 3, 10)
  })
})

describe("Step 3: computeBillableTokensForTask -- padding only for fixed_estimated", () => {
  test("fixed_estimated: applies the estimation buffer", () => {
    expect(computeBillableTokensForTask({ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }, 1.2)).toBeCloseTo(12_000, 6)
  })

  test("metered_actual: passes through with NO padding, regardless of the buffer value in effect", () => {
    const withDefaultBuffer = computeBillableTokensForTask({ costModelType: "metered_actual", actualTokensUsed: 9_000 }, 1.2)
    const withHugeBuffer = computeBillableTokensForTask({ costModelType: "metered_actual", actualTokensUsed: 9_000 }, 5.0)
    expect(withDefaultBuffer).toBe(9_000)
    expect(withHugeBuffer).toBe(9_000)
  })

  test("fixed_estimated: result scales with whatever buffer is passed (proves the buffer is genuinely applied, not a no-op)", () => {
    const atBaseline = computeBillableTokensForTask({ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }, 1.2)
    const atDoubleBuffer = computeBillableTokensForTask({ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }, 2.4)
    expect(atDoubleBuffer).toBeCloseTo(atBaseline * 2, 6)
  })

  test("throws when guesstimatedTokens is missing for a fixed_estimated task", () => {
    expect(() => computeBillableTokensForTask({ costModelType: "fixed_estimated" })).toThrow()
  })

  test("throws when actualTokensUsed is missing for a metered_actual task", () => {
    expect(() => computeBillableTokensForTask({ costModelType: "metered_actual" })).toThrow()
  })
})

describe("Step 4: aggregateBillableTokensForOrg", () => {
  test("sums Step 3 across every end user in the org", () => {
    const endUsers: OrgEndUserTasks[] = [
      { userId: "u1", tasks: [{ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }] }, // -> 12000
      { userId: "u2", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 9_000 }] }, // -> 9000
    ]
    expect(aggregateBillableTokensForOrg(endUsers, 1.2)).toBeCloseTo(21_000, 6)
  })
})

describe("Step 5: computeAiUsageBillForOrg", () => {
  test("multiplies total billable tokens by the AI token rate", () => {
    expect(computeAiUsageBillForOrg(21_000, 0.0008)).toBeCloseTo(16.8, 6)
  })
})

describe("base/infra component", () => {
  test("no extra-user charge when real_user_count is within includedUsersInBase", () => {
    expect(computeBaseInfraBillableBeforeMargin(CONFIG, 3)).toBe(99) // 3 <= 5 included
  })

  test("charges price_per_extra_user for each seat beyond includedUsersInBase", () => {
    expect(computeBaseInfraBillableBeforeMargin(CONFIG, 7)).toBe(99 + 2 * 15) // 2 extra seats
  })

  test("applies margin exactly once to the base/infra component", () => {
    expect(computeBaseInfraBill(CONFIG, 7, 4.0)).toBeCloseTo((99 + 30) * 4.0, 6)
  })
})

describe("Scenario (a): all-fixed-cost-model usage within one org", () => {
  test("end-to-end bill matches the hand-computed expected value", () => {
    const totals: PlatformPeriodOwnerCostTotals = {
      fixedCostUsdPaid: 100,
      fixedCostTokensDelivered: 1_000_000,
      variableCostUsdPaid: 0,
      variableCostTokensDelivered: 0,
    }
    // blended = 100 / 1,000,000 = 0.0001 ; rate = 0.0001 * 4 = 0.0004
    const orgEndUserTasks: OrgEndUserTasks[] = [
      { userId: "u1", tasks: [{ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }] }, // 12000
      { userId: "u2", tasks: [{ costModelType: "fixed_estimated", guesstimatedTokens: 5_000 }] }, // 6000
    ]
    // total billable = 18000 ; aiUsageBill = 18000 * 0.0004 = 7.2
    // realUserCount 3 <= included 5 -> baseInfraBeforeMargin = 99 -> *4 = 396
    // total = 7.2 + 396 = 403.2
    const result = computeCustomerBillForOrg({
      pricingConfig: CONFIG,
      realUserCount: 3,
      platformPeriodOwnerCostTotals: totals,
      orgEndUserTasks,
    })
    expect(result.blendedOwnerCostPerToken).toBeCloseTo(0.0001, 10)
    expect(result.aiTokenRate).toBeCloseTo(0.0004, 10)
    expect(result.totalBillableTokensForOrg).toBeCloseTo(18_000, 6)
    expect(result.aiUsageBillUsd).toBeCloseTo(7.2, 6)
    expect(result.baseInfraBillUsd).toBeCloseTo(396, 6)
    expect(result.totalBillUsd).toBeCloseTo(403.2, 6)
  })
})

describe("Scenario (b): all-variable/metered-model usage within one org", () => {
  test("end-to-end bill matches the hand-computed expected value, with no estimation padding anywhere", () => {
    const totals: PlatformPeriodOwnerCostTotals = {
      fixedCostUsdPaid: 0,
      fixedCostTokensDelivered: 0,
      variableCostUsdPaid: 80,
      variableCostTokensDelivered: 400_000,
    }
    // blended = 80 / 400,000 = 0.0002 ; rate = 0.0002 * 4 = 0.0008
    const orgEndUserTasks: OrgEndUserTasks[] = [
      { userId: "u1", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 20_000 }] },
      { userId: "u2", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 15_000 }] },
      { userId: "u3", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 5_000 }] },
    ]
    // total billable = 40000 (no padding) ; aiUsageBill = 40000 * 0.0008 = 32
    // realUserCount 7 -> 2 extra seats -> baseInfraBeforeMargin = 99 + 30 = 129 -> *4 = 516
    // total = 32 + 516 = 548
    const result = computeCustomerBillForOrg({
      pricingConfig: CONFIG,
      realUserCount: 7,
      platformPeriodOwnerCostTotals: totals,
      orgEndUserTasks,
    })
    expect(result.aiTokenRate).toBeCloseTo(0.0008, 10)
    expect(result.totalBillableTokensForOrg).toBeCloseTo(40_000, 6)
    expect(result.aiUsageBillUsd).toBeCloseTo(32, 6)
    expect(result.baseInfraBillUsd).toBeCloseTo(516, 6)
    expect(result.totalBillUsd).toBeCloseTo(548, 6)
  })
})

describe("Scenario (c): a real mix of fixed and metered usage across multiple end users in one org", () => {
  test("end-to-end bill matches the hand-computed expected value", () => {
    const totals: PlatformPeriodOwnerCostTotals = {
      fixedCostUsdPaid: 100,
      fixedCostTokensDelivered: 800_000,
      variableCostUsdPaid: 100,
      variableCostTokensDelivered: 200_000,
    }
    // blended = 200 / 1,000,000 = 0.0002 ; rate = 0.0002 * 4 = 0.0008
    const orgEndUserTasks: OrgEndUserTasks[] = [
      { userId: "userA", tasks: [{ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }] }, // 12000
      { userId: "userB", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 9_000 }] }, // 9000
      { userId: "userC", tasks: [{ costModelType: "fixed_estimated", guesstimatedTokens: 5_000 }] }, // 6000
      { userId: "userD", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 1_000 }] }, // 1000
    ]
    // total billable = 12000+9000+6000+1000 = 28000 ; aiUsageBill = 28000 * 0.0008 = 22.4
    // realUserCount 6 -> 1 extra seat -> baseInfraBeforeMargin = 99 + 15 = 114 -> *4 = 456
    // total = 22.4 + 456 = 478.4
    const result = computeCustomerBillForOrg({
      pricingConfig: CONFIG,
      realUserCount: 6,
      platformPeriodOwnerCostTotals: totals,
      orgEndUserTasks,
    })
    expect(result.totalBillableTokensForOrg).toBeCloseTo(28_000, 6)
    expect(result.aiUsageBillUsd).toBeCloseTo(22.4, 6)
    expect(result.baseInfraBillUsd).toBeCloseTo(456, 6)
    expect(result.totalBillUsd).toBeCloseTo(478.4, 6)
  })

  test("a single end user with BOTH a fixed and a metered task in the same period is aggregated correctly", () => {
    const orgEndUserTasks: OrgEndUserTasks[] = [
      {
        userId: "userMixed",
        tasks: [
          { costModelType: "fixed_estimated", guesstimatedTokens: 1_000 }, // 1200
          { costModelType: "metered_actual", actualTokensUsed: 500 }, // 500
        ],
      },
    ]
    expect(aggregateBillableTokensForOrg(orgEndUserTasks, 1.2)).toBeCloseTo(1_700, 6)
  })
})

describe("REGRESSION: margin is applied exactly once end-to-end (no hidden compounding)", () => {
  test("scaling MARGIN_MULTIPLIER by factor N scales the final total bill by exactly factor N", () => {
    const totals: PlatformPeriodOwnerCostTotals = {
      fixedCostUsdPaid: 100,
      fixedCostTokensDelivered: 800_000,
      variableCostUsdPaid: 100,
      variableCostTokensDelivered: 200_000,
    }
    const orgEndUserTasks: OrgEndUserTasks[] = [
      { userId: "userA", tasks: [{ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }] },
      { userId: "userB", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 9_000 }] },
    ]
    const N = 3

    const baseline = computeCustomerBillForOrg({
      pricingConfig: CONFIG,
      realUserCount: 6,
      platformPeriodOwnerCostTotals: totals,
      orgEndUserTasks,
    })
    const scaledConfig: PricingConfig = { ...CONFIG, marginMultiplier: CONFIG.marginMultiplier * N }
    const scaled = computeCustomerBillForOrg({
      pricingConfig: scaledConfig,
      realUserCount: 6,
      platformPeriodOwnerCostTotals: totals,
      orgEndUserTasks,
    })

    expect(scaled.aiUsageBillUsd).toBeCloseTo(baseline.aiUsageBillUsd * N, 6)
    expect(scaled.baseInfraBillUsd).toBeCloseTo(baseline.baseInfraBillUsd * N, 6)
    expect(scaled.totalBillUsd).toBeCloseTo(baseline.totalBillUsd * N, 6)
  })

  test("the naive literal formula (re-multiplying the summed pre-margined components by marginMultiplier) is NOT what this engine computes -- it would double the margin on the AI portion", () => {
    const totals: PlatformPeriodOwnerCostTotals = {
      fixedCostUsdPaid: 100,
      fixedCostTokensDelivered: 800_000,
      variableCostUsdPaid: 100,
      variableCostTokensDelivered: 200_000,
    }
    const orgEndUserTasks: OrgEndUserTasks[] = [
      { userId: "userA", tasks: [{ costModelType: "fixed_estimated", guesstimatedTokens: 10_000 }] },
      { userId: "userB", tasks: [{ costModelType: "metered_actual", actualTokensUsed: 9_000 }] },
    ]
    const realUserCount = 6

    const engineResult = computeCustomerBillForOrg({
      pricingConfig: CONFIG,
      realUserCount,
      platformPeriodOwnerCostTotals: totals,
      orgEndUserTasks,
    })

    const baseInfraBeforeMargin = computeBaseInfraBillableBeforeMargin(CONFIG, realUserCount)
    // Naive/buggy formula, mirroring the literally-stated
    // "(base + extra + BILLING_TO_CUSTOMER_FOR_AI) x margin_multiplier":
    // aiUsageBillUsd here already has margin baked in once (Step 2), so
    // multiplying the sum by marginMultiplier again re-applies it.
    const naiveDoubleMarginedTotal = (baseInfraBeforeMargin + engineResult.aiUsageBillUsd) * CONFIG.marginMultiplier

    expect(engineResult.totalBillUsd).not.toBeCloseTo(naiveDoubleMarginedTotal, 6)
    expect(naiveDoubleMarginedTotal).toBeGreaterThan(engineResult.totalBillUsd)
    // The naive total's excess over the correct total is exactly the
    // extra, wrongly-reapplied margin on the AI portion:
    // aiUsageBillUsd * (marginMultiplier - 1).
    expect(naiveDoubleMarginedTotal - engineResult.totalBillUsd).toBeCloseTo(
      engineResult.aiUsageBillUsd * (CONFIG.marginMultiplier - 1),
      6,
    )
  })
})

describe("MARGIN_MULTIPLIER derivation (real, confirmed constant)", () => {
  test("50% commission + 100%-of-cost profit target reconciles to exactly 4.0", () => {
    expect(deriveMarginMultiplierFromBusinessRule(COMMISSION_RATE, 1)).toBe(4.0)
    expect(MARGIN_MULTIPLIER).toBe(4.0)
  })
})

describe("ESTIMATION_BUFFER / MARGIN_MULTIPLIER real-constant sanity", () => {
  test("real constants match the Owner-confirmed values", () => {
    expect(COMMISSION_RATE).toBe(0.5)
    expect(MARGIN_MULTIPLIER).toBe(4.0)
    expect(ESTIMATION_BUFFER).toBe(1.2)
  })
})
