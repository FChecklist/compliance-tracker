// Unit tests for action-autonomy-decision.ts's pure decideActionAutonomy().
// No LLM/DB access exercised -- risk-classification.ts and
// confidence-banding.ts are already independently unit-tested; these tests
// exercise the real combination logic (risk-always-wins-over-confidence,
// missing-confidence-is-not-zero) that is genuinely new here.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { decideActionAutonomy } from "./action-autonomy-decision"

describe("decideActionAutonomy -- the 80/20 auto-proceed vs pending_review gate", () => {
  test("low-risk, no confidence signal (a plain deterministic action) auto-proceeds", () => {
    const result = decideActionAutonomy({ riskFactors: {} })
    expect(result.decision).toBe("auto_proceed")
    expect(result.riskLevel).toBe("low")
    expect(result.confidenceBand).toBeNull()
  })

  test("medium-risk (a moderate financial amount) still auto-proceeds when no confidence signal applies", () => {
    const result = decideActionAutonomy({ riskFactors: { financialAmountInr: 15_000 } })
    expect(result.riskLevel).toBe("medium")
    expect(result.decision).toBe("auto_proceed")
  })

  test("high-risk financial amount always requires review, even with perfect confidence", () => {
    const result = decideActionAutonomy({ riskFactors: { financialAmountInr: 150_000 }, confidencePercentage: 100 })
    expect(result.riskLevel).toBe("high")
    expect(result.decision).toBe("pending_review")
    expect(result.reason).toContain("high")
  })

  test("critical-risk (platform blast radius) always requires review", () => {
    const result = decideActionAutonomy({ riskFactors: { blastRadius: "platform" } })
    expect(result.riskLevel).toBe("critical")
    expect(result.decision).toBe("pending_review")
  })

  test("low risk but sub-auto-proceed confidence (below 98%) requires review", () => {
    const result = decideActionAutonomy({ riskFactors: {}, confidencePercentage: 92 })
    expect(result.riskLevel).toBe("low")
    expect(result.confidenceBand).toBe("peer_review_required")
    expect(result.decision).toBe("pending_review")
  })

  test("low risk with 98%+ confidence auto-proceeds", () => {
    const result = decideActionAutonomy({ riskFactors: {}, confidencePercentage: 99 })
    expect(result.confidenceBand).toBe("auto_proceed")
    expect(result.decision).toBe("auto_proceed")
  })

  test("an inherently high-impact category (e.g. payment) forces review regardless of amount", () => {
    const result = decideActionAutonomy({ riskFactors: { highImpactCategory: "payment" } })
    expect(result.riskLevel).toBe("high")
    expect(result.decision).toBe("pending_review")
  })

  test("reason string cites the real contributing factors", () => {
    const result = decideActionAutonomy({ riskFactors: { financialAmountInr: 200_000, isIrreversible: true } })
    // Indian numbering (lakh grouping), matching this codebase's INR
    // convention elsewhere -- (200_000).toLocaleString("en-IN") is "2,00,000".
    expect(result.reason).toContain("2,00,000")
    expect(result.reason).toContain("irreversible")
  })
})
