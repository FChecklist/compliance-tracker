// VERIDIAN Review Framework remediation (AI Cost Governance & FinOps):
// unit tests for the PURE-COMPUTE half of ai-cost-finops-service.ts --
// detectSpendAnomalies (ratio-vs-baseline), projectMonthEndSpend (linear
// run-rate), reconcileForecastVsActual, reconcileFinOpsClaim, and
// classifyIdleCapacity. No DB access: every function under test here is
// deliberately DB-free so it's testable in isolation, matching this
// codebase's established erp-fixed-assets-service.test.ts /
// permission-service.test.ts convention of not exercising a live Postgres
// from a .test.ts file. The DB-query half (detectSpendAnomaliesFromDb etc.)
// is exercised by tracing the route -> service -> DB path, not by a unit
// test that would have to stand up a real multi-org ledger.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  detectSpendAnomalies,
  projectMonthEndSpend,
  reconcileForecastVsActual,
  reconcileFinOpsClaim,
  classifyIdleCapacity,
  DEFAULT_ANOMALY_THRESHOLDS,
  type SpendBucket,
} from "./ai-cost-finops-service"

function bucket(over: Partial<SpendBucket> & { groupKey: string; dimension: SpendBucket["dimension"] }): SpendBucket {
  return {
    currentSpendUsd: 0,
    currentRequests: 0,
    baselineSpendUsd: 0,
    baselineRequests: 0,
    ...over,
  }
}

// ─── detectSpendAnomalies ───────────────────────────────────────────────
describe("detectSpendAnomalies", () => {
  test("flags a tenant whose spend spiked well above its own baseline", () => {
    const out = detectSpendAnomalies([
      bucket({ groupKey: "org-a", dimension: "org", currentSpendUsd: 100, currentRequests: 50, baselineSpendUsd: 10, baselineRequests: 50 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].groupKey).toBe("org-a")
    expect(out[0].ratio).toBe(10) // 100/10
    expect(out[0].deltaUsd).toBe(90)
    expect(out[0].severity).toBe("critical") // 10x >= criticalRatio(5)
  })

  test("does NOT flag a bucket with no baseline history (below minBaselineRequests)", () => {
    const out = detectSpendAnomalies([
      bucket({ groupKey: "new-org", dimension: "org", currentSpendUsd: 500, currentRequests: 50, baselineSpendUsd: 0, baselineRequests: 2 }),
    ])
    expect(out).toHaveLength(0)
  })

  test("does NOT flag a high ratio that is a tiny absolute delta (under minDeltaUsd)", () => {
    // 100x spike but only $0.50 over baseline -- not worth flagging.
    const out = detectSpendAnomalies([
      bucket({ groupKey: "org-x", dimension: "org", currentSpendUsd: 0.55, currentRequests: 50, baselineSpendUsd: 0.05, baselineRequests: 50 }),
    ])
    expect(out).toHaveLength(0)
  })

  test("does NOT flag spend that dropped below baseline (negative delta)", () => {
    const out = detectSpendAnomalies([
      bucket({ groupKey: "org-y", dimension: "org", currentSpendUsd: 5, currentRequests: 50, baselineSpendUsd: 50, baselineRequests: 50 }),
    ])
    expect(out).toHaveLength(0)
  })

  test("severity bands: warning vs critical thresholds", () => {
    const warning = detectSpendAnomalies([
      bucket({ groupKey: "w", dimension: "org", currentSpendUsd: 30, currentRequests: 10, baselineSpendUsd: 10, baselineRequests: 10 }), // 3x >= 2.5 warning, < 5 critical
    ])
    expect(warning[0].severity).toBe("warning")
    const critical = detectSpendAnomalies([
      bucket({ groupKey: "c", dimension: "org", currentSpendUsd: 60, currentRequests: 10, baselineSpendUsd: 10, baselineRequests: 10 }), // 6x >= 5 critical
    ])
    expect(critical[0].severity).toBe("critical")
  })

  test("treats a spike on a zero-spend baseline as Infinity ratio (new-but-voluminous)", () => {
    const out = detectSpendAnomalies([
      bucket({ groupKey: "org-z", dimension: "org", currentSpendUsd: 50, currentRequests: 100, baselineSpendUsd: 0, baselineRequests: 50 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].ratio).toBe(Infinity)
    expect(out[0].severity).toBe("critical")
  })

  test("orders findings by absolute delta USD (most material first)", () => {
    const out = detectSpendAnomalies([
      bucket({ groupKey: "small", dimension: "org", currentSpendUsd: 30, currentRequests: 10, baselineSpendUsd: 5, baselineRequests: 10 }), // +25
      bucket({ groupKey: "big", dimension: "org", currentSpendUsd: 200, currentRequests: 10, baselineSpendUsd: 40, baselineRequests: 10 }), // +160
    ])
    expect(out[0].groupKey).toBe("big")
    expect(out[1].groupKey).toBe("small")
  })

  test("respects custom thresholds", () => {
    const out = detectSpendAnomalies(
      [bucket({ groupKey: "org-a", dimension: "org", currentSpendUsd: 20, currentRequests: 50, baselineSpendUsd: 10, baselineRequests: 50 })], // 2x
      { ...DEFAULT_ANOMALY_THRESHOLDS, warningRatio: 1.5, criticalRatio: 3 },
    )
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe("warning")
  })

  test("across dimensions: org / role / model all classified independently", () => {
    const out = detectSpendAnomalies([
      bucket({ groupKey: "org-1", dimension: "org", currentSpendUsd: 100, currentRequests: 50, baselineSpendUsd: 10, baselineRequests: 50 }),
      bucket({ groupKey: "role-1", dimension: "role", currentSpendUsd: 80, currentRequests: 50, baselineSpendUsd: 10, baselineRequests: 50 }),
      bucket({ groupKey: "model-1", dimension: "model", currentSpendUsd: 12, currentRequests: 50, baselineSpendUsd: 10, baselineRequests: 50 }), // not an anomaly
    ])
    expect(out).toHaveLength(2)
    expect(out.map((a) => a.dimension).sort()).toEqual(["org", "role"])
  })
})

// ─── projectMonthEndSpend ───────────────────────────────────────────────
describe("projectMonthEndSpend", () => {
  // June 2026: 30 days. Halfway through (day 15) = 0.5 elapsed.
  test("linear run-rate: half a month spent at $50 projects to $100 month-end", () => {
    const monthStart = "2026-06-01T00:00:00.000Z"
    const now = "2026-06-16T00:00:00.000Z" // 15 days elapsed
    const out = projectMonthEndSpend({ monthStartIso: monthStart, nowIso: now, spendSoFarUsd: 50 })
    expect(out.daysInMonth).toBe(30)
    expect(out.fractionElapsed).toBe(0.5)
    expect(out.projectedMonthEndUsd).toBe(100)
  })

  test("returns null projection when no spend has accrued yet", () => {
    const out = projectMonthEndSpend({ monthStartIso: "2026-06-01T00:00:00.000Z", nowIso: "2026-06-10T00:00:00.000Z", spendSoFarUsd: 0 })
    expect(out.projectedMonthEndUsd).toBeNull()
  })

  test("capComparison: flags when projection would exceed the cap", () => {
    const out = projectMonthEndSpend(
      { monthStartIso: "2026-06-01T00:00:00.000Z", nowIso: "2026-06-16T00:00:00.000Z", spendSoFarUsd: 60 }, // projects to 120
      100,
    )
    expect(out.capComparison).not.toBeNull()
    expect(out.capComparison!.wouldExceedCap).toBe(true)
    expect(out.capComparison!.projectedVsCapRatio).toBe(1.2)
  })

  test("capComparison: null when no cap is set", () => {
    const out = projectMonthEndSpend({ monthStartIso: "2026-06-01T00:00:00.000Z", nowIso: "2026-06-16T00:00:00.000Z", spendSoFarUsd: 50 })
    expect(out.capComparison).toBeNull()
  })

  test("daysElapsed is clamped to [0, daysInMonth] (no negative or overflow)", () => {
    const before = projectMonthEndSpend({ monthStartIso: "2026-06-10T00:00:00.000Z", nowIso: "2026-06-01T00:00:00.000Z", spendSoFarUsd: 0 })
    expect(before.daysElapsed).toBe(0)
    const after = projectMonthEndSpend({ monthStartIso: "2026-06-01T00:00:00.000Z", nowIso: "2026-07-15T00:00:00.000Z", spendSoFarUsd: 50 })
    expect(after.daysElapsed).toBe(after.daysInMonth)
  })

  test("handles February (28 days) correctly", () => {
    const out = projectMonthEndSpend({ monthStartIso: "2026-02-01T00:00:00.000Z", nowIso: "2026-02-15T00:00:00.000Z", spendSoFarUsd: 14 })
    expect(out.daysInMonth).toBe(28)
    // 14 days / 28 = 0.5 -> projects to 28
    expect(out.fractionElapsed).toBe(0.5)
    expect(out.projectedMonthEndUsd).toBe(28)
  })
})

// ─── reconcileForecastVsActual ──────────────────────────────────────────
describe("reconcileForecastVsActual", () => {
  test("accurate when actual is within 15% of projection", () => {
    const out = reconcileForecastVsActual({ projectedUsd: 100, actualUsd: 108 })
    expect(out.accuracyVerdict).toBe("accurate")
    expect(out.variancePct).toBe(0.08)
  })

  test("under_projected when actual exceeds projection by > 15%", () => {
    const out = reconcileForecastVsActual({ projectedUsd: 100, actualUsd: 120 })
    expect(out.accuracyVerdict).toBe("under_projected")
    expect(out.varianceUsd).toBe(20)
  })

  test("over_projected when projection exceeded actual by > 15%", () => {
    const out = reconcileForecastVsActual({ projectedUsd: 100, actualUsd: 80 })
    expect(out.accuracyVerdict).toBe("over_projected")
    expect(out.varianceUsd).toBe(-20)
  })

  test("no_projection verdict when there was no forecast to compare", () => {
    const out = reconcileForecastVsActual({ projectedUsd: null, actualUsd: 50 })
    expect(out.accuracyVerdict).toBe("no_projection")
    expect(out.variancePct).toBeNull()
  })

  test("boundary: exactly 15% drift is still accurate (inclusive)", () => {
    const out = reconcileForecastVsActual({ projectedUsd: 100, actualUsd: 115 })
    expect(out.accuracyVerdict).toBe("accurate")
  })
})

// ─── reconcileFinOpsClaim ───────────────────────────────────────────────
describe("reconcileFinOpsClaim", () => {
  test("no_finance_figure when Finance ledger not entered", () => {
    const out = reconcileFinOpsClaim({ engineeringClaimUsd: 100, financeLedgerUsd: null, billingMonthIso: "2026-06-01" })
    expect(out.verdict).toBe("no_finance_figure")
    expect(out.varianceUsd).toBeNull()
  })

  test("balanced when within 10%", () => {
    const out = reconcileFinOpsClaim({ engineeringClaimUsd: 100, financeLedgerUsd: 105, billingMonthIso: "2026-06-01" })
    expect(out.verdict).toBe("balanced")
    expect(out.varianceUsd).toBe(5)
  })

  test("platform_under_reports when Finance shows MORE than the ledger tracked", () => {
    const out = reconcileFinOpsClaim({ engineeringClaimUsd: 100, financeLedgerUsd: 140, billingMonthIso: "2026-06-01" })
    expect(out.verdict).toBe("platform_under_reports")
    expect(out.varianceUsd).toBe(40) // Finance - engineering = +40
  })

  test("platform_over_reports when the ledger's estimate exceeds the invoice", () => {
    const out = reconcileFinOpsClaim({ engineeringClaimUsd: 100, financeLedgerUsd: 70, billingMonthIso: "2026-06-01" })
    expect(out.verdict).toBe("platform_over_reports")
    expect(out.varianceUsd).toBe(-30)
  })

  test("boundary: exactly 10% drift is still balanced (inclusive)", () => {
    const out = reconcileFinOpsClaim({ engineeringClaimUsd: 100, financeLedgerUsd: 110, billingMonthIso: "2026-06-01" })
    expect(out.verdict).toBe("balanced")
  })
})

// ─── classifyIdleCapacity ───────────────────────────────────────────────
describe("classifyIdleCapacity", () => {
  test("flags an active BYO config with zero calls in the window", () => {
    const out = classifyIdleCapacity({
      byoConfigs: [{ id: "c1", orgId: "org-1", provider: "openrouter", modelName: "z-ai/glm-5.2", layerKey: "chat_oa", requestsInWindow: 0 }],
      orgFloorTierActivity: [],
      windowDays: 90,
    })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("unused_byo_config")
    expect(out[0].orgId).toBe("org-1")
    expect(out[0].model).toBe("z-ai/glm-5.2")
  })

  test("does NOT flag a BYO config that's being exercised", () => {
    const out = classifyIdleCapacity({
      byoConfigs: [{ id: "c1", orgId: "org-1", provider: "openrouter", modelName: "z-ai/glm-5.2", layerKey: "chat_oa", requestsInWindow: 142 }],
      orgFloorTierActivity: [],
      windowDays: 90,
    })
    expect(out).toHaveLength(0)
  })

  test("flags a floor-tier org with zero product AI calls", () => {
    const out = classifyIdleCapacity({
      byoConfigs: [],
      orgFloorTierActivity: [{ orgId: "org-2", model: "openai/gpt-oss-120b", provider: "groq", requestsInWindow: 0 }],
      windowDays: 90,
    })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("dormant_floor_tier_org")
    expect(out[0].orgId).toBe("org-2")
  })

  test("does NOT flag a floor-tier org that's actively using AI", () => {
    const out = classifyIdleCapacity({
      byoConfigs: [],
      orgFloorTierActivity: [{ orgId: "org-2", model: "openai/gpt-oss-120b", provider: "groq", requestsInWindow: 30 }],
      windowDays: 90,
    })
    expect(out).toHaveLength(0)
  })

  test("both kinds can coexist in one pass", () => {
    const out = classifyIdleCapacity({
      byoConfigs: [{ id: "c1", orgId: "org-1", provider: "openrouter", modelName: null, layerKey: null, requestsInWindow: 0 }],
      orgFloorTierActivity: [{ orgId: "org-2", model: "openai/gpt-oss-120b", provider: "groq", requestsInWindow: 0 }],
      windowDays: 90,
    })
    expect(out).toHaveLength(2)
    expect(out.map((f) => f.kind).sort()).toEqual(["dormant_floor_tier_org", "unused_byo_config"])
  })

  test("custom thresholds: a config with a few calls can still count as unused", () => {
    const out = classifyIdleCapacity({
      byoConfigs: [{ id: "c1", orgId: "org-1", provider: "openrouter", modelName: "z-ai/glm-5.2", layerKey: "chat_oa", requestsInWindow: 2 }],
      orgFloorTierActivity: [],
      windowDays: 90,
      unusedConfigMaxRequests: 5,
    })
    expect(out).toHaveLength(1)
  })
})
