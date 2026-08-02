/// <reference types="bun-types" />
// GAP-AI-WORKFORCE-GOVERNANCE (Agent Review Registry): tests
// computeReviewVerdict()/computeReviewRates() directly, the pure decision
// core runAgentReviewCycle() delegates to -- matching this repo's
// established pattern of not touching withTenantContext/a live DB from a
// .test.ts file (model-scorecard-service.test.ts's own header, task-
// service.test.ts's precedent).
import { describe, expect, test } from "bun:test"
import {
  computeReviewRates,
  computeReviewVerdict,
  reviewableRoleKeys,
  MIN_DISPATCHES_FOR_VERDICT,
  MIN_DISPATCHES_FOR_PROMOTE,
  type ReviewMetrics,
} from "./agent-review-service"

function metrics(overrides: Partial<ReviewMetrics>): ReviewMetrics {
  return {
    dispatchCount: 0,
    terminalCount: 0,
    successCount: 0,
    failureCount: 0,
    reviewedCount: 0,
    auditFindingCount: 0,
    escalationCount: 0,
    ...overrides,
  }
}

describe("computeReviewRates -- null (not 0) when the denominator is 0", () => {
  test("all three rates are null with zero data", () => {
    const rates = computeReviewRates(metrics({}))
    expect(rates.successRate).toBeNull()
    expect(rates.auditFindingRate).toBeNull()
    expect(rates.escalationRate).toBeNull()
  })

  test("successRate is successCount/terminalCount", () => {
    const rates = computeReviewRates(metrics({ terminalCount: 10, successCount: 8 }))
    expect(rates.successRate).toBeCloseTo(0.8)
  })

  test("auditFindingRate is auditFindingCount/reviewedCount", () => {
    const rates = computeReviewRates(metrics({ reviewedCount: 4, auditFindingCount: 1 }))
    expect(rates.auditFindingRate).toBeCloseTo(0.25)
  })

  test("escalationRate is escalationCount/dispatchCount", () => {
    const rates = computeReviewRates(metrics({ dispatchCount: 20, escalationCount: 2 }))
    expect(rates.escalationRate).toBeCloseTo(0.1)
  })
})

describe("computeReviewVerdict -- insufficient data", () => {
  test("fewer than MIN_DISPATCHES_FOR_VERDICT always maintains, never fabricates promote/deprecate", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: MIN_DISPATCHES_FOR_VERDICT - 1, terminalCount: 1, successCount: 0 }), false)
    expect(result.verdict).toBe("maintain")
    expect(result.verdictReason).toContain("Insufficient data")
    expect(result.trustTierFlag).toBeNull()
  })
})

describe("computeReviewVerdict -- deprecate", () => {
  test("success rate below 50% deprecates", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: 10, terminalCount: 10, successCount: 3, failureCount: 7 }), false)
    expect(result.verdict).toBe("deprecate")
    expect(result.verdictReason).toContain("deprecate threshold")
  })

  test("audit finding rate above 50% deprecates even with a high raw success rate", () => {
    const result = computeReviewVerdict(
      metrics({ dispatchCount: 10, terminalCount: 10, successCount: 9, failureCount: 1, reviewedCount: 4, auditFindingCount: 3 }),
      false
    )
    expect(result.verdict).toBe("deprecate")
  })

  test("deprecate on a currently judgment-eligible model flags consider_revoking_judgment_tier_trust", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: 10, terminalCount: 10, successCount: 2, failureCount: 8 }), true)
    expect(result.trustTierFlag).toBe("consider_revoking_judgment_tier_trust")
  })

  test("deprecate on a non-judgment-eligible model does NOT flag a trust-tier change (nothing to revoke)", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: 10, terminalCount: 10, successCount: 2, failureCount: 8 }), false)
    expect(result.trustTierFlag).toBeNull()
  })
})

describe("computeReviewVerdict -- retrain", () => {
  test("success rate below 80% (but at/above 50%) retrains, does not deprecate", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: 10, terminalCount: 10, successCount: 6, failureCount: 4 }), false)
    expect(result.verdict).toBe("retrain")
  })

  test("escalation rate above 20% retrains even with a good success rate", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: 10, terminalCount: 10, successCount: 10, escalationCount: 3 }), false)
    expect(result.verdict).toBe("retrain")
    expect(result.verdictReason).toContain("escalationRate")
  })

  test("retrain never sets a trust-tier flag -- that's reserved for the promote/deprecate extremes", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: 10, terminalCount: 10, successCount: 6, failureCount: 4 }), true)
    expect(result.trustTierFlag).toBeNull()
  })
})

describe("computeReviewVerdict -- promote", () => {
  test("meets the promote bar: high volume, high success, low audit-finding and escalation rate", () => {
    const result = computeReviewVerdict(
      metrics({ dispatchCount: MIN_DISPATCHES_FOR_PROMOTE, terminalCount: MIN_DISPATCHES_FOR_PROMOTE, successCount: MIN_DISPATCHES_FOR_PROMOTE, reviewedCount: 10, auditFindingCount: 0 }),
      false
    )
    expect(result.verdict).toBe("promote")
  })

  test("high success rate but below MIN_DISPATCHES_FOR_PROMOTE volume does not promote (stays maintain)", () => {
    const result = computeReviewVerdict(
      metrics({ dispatchCount: MIN_DISPATCHES_FOR_PROMOTE - 1, terminalCount: MIN_DISPATCHES_FOR_PROMOTE - 1, successCount: MIN_DISPATCHES_FOR_PROMOTE - 1 }),
      false
    )
    expect(result.verdict).toBe("maintain")
  })

  test("promote on a model NOT yet judgment-eligible flags consider_promoting_to_judgment_tier", () => {
    const result = computeReviewVerdict(
      metrics({ dispatchCount: MIN_DISPATCHES_FOR_PROMOTE, terminalCount: MIN_DISPATCHES_FOR_PROMOTE, successCount: MIN_DISPATCHES_FOR_PROMOTE }),
      false
    )
    expect(result.trustTierFlag).toBe("consider_promoting_to_judgment_tier")
  })

  test("promote on an already judgment-eligible model does NOT re-flag (nothing to promote further)", () => {
    const result = computeReviewVerdict(
      metrics({ dispatchCount: MIN_DISPATCHES_FOR_PROMOTE, terminalCount: MIN_DISPATCHES_FOR_PROMOTE, successCount: MIN_DISPATCHES_FOR_PROMOTE }),
      true
    )
    expect(result.trustTierFlag).toBeNull()
  })
})

describe("computeReviewVerdict -- maintain (the default, no threshold crossed)", () => {
  test("solid mid-range performance maintains", () => {
    const result = computeReviewVerdict(metrics({ dispatchCount: 10, terminalCount: 10, successCount: 9, failureCount: 1 }), false)
    expect(result.verdict).toBe("maintain")
    expect(result.verdictReason).toContain("no deprecate/retrain/promote threshold crossed")
  })
})

describe("reviewableRoleKeys -- excludes human and code-only/model-less roles", () => {
  test("returns a non-empty list and never includes a known human role", () => {
    const keys = reviewableRoleKeys()
    expect(keys.length).toBeGreaterThan(0)
    expect(keys).not.toContain("founder_ceo")
    expect(keys).not.toContain("super_boss")
  })
})
