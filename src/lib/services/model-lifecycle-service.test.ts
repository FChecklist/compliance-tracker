/// <reference types="bun-types" />
// AI Model Lifecycle & Benchmarking: Ongoing Quality Monitoring -- tests
// mergeEscalationByModel()/toLifecycleMetrics() directly, the pure bridge
// runModelLifecycleReviewCycle() delegates to. Deliberately does NOT
// re-test computeReviewRates()/computeReviewVerdict()'s own threshold
// math here -- that's already covered directly in
// agent-review-service.test.ts, and this file reuses those functions
// unmodified rather than re-implementing them (see model-lifecycle-
// service.ts's own header). Matches this repo's established pattern of
// not touching withTenantContext/a live DB from a .test.ts file
// (model-scorecard-service.test.ts's own header).
import { describe, expect, test } from "bun:test"
import { mergeEscalationByModel, toLifecycleMetrics } from "./model-lifecycle-service"
import type { ModelScorecardEntry } from "./model-scorecard-service"

const resolveModel = (roleKey: string | null): string => {
  const roster: Record<string, string> = {
    ceo_technical_director: "z-ai/glm-5.2",
    senior_backend_engineer: "z-ai/glm-5.2",
    tool_integration_engineer: "openai/gpt-oss-120b",
  }
  return roleKey ? (roster[roleKey] ?? "unclassified") : "unclassified"
}

function scorecardEntry(overrides: Partial<ModelScorecardEntry>): ModelScorecardEntry {
  return {
    model: "z-ai/glm-5.2",
    complexityTier: "judgment",
    dispatchCount: 0,
    terminalCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: null,
    avgDurationMs: null,
    reviewedCount: 0,
    auditFindingCount: 0,
    auditFindingRate: null,
    iterationCount: { avg: null, note: "n/a" },
    costUsd: { totalUsd: null, note: "n/a" },
    hallucinationScore: { value: null, note: "n/a" },
    ...overrides,
  }
}

describe("mergeEscalationByModel -- resolves role_key escalation rows to (model, tier) keys", () => {
  test("empty input produces an empty map", () => {
    expect(mergeEscalationByModel([], resolveModel).size).toBe(0)
  })

  test("a single group resolves via roster and keys by model::tier", () => {
    const map = mergeEscalationByModel(
      [{ roleKey: "ceo_technical_director", complexityTier: "judgment", escalationCount: 3 }],
      resolveModel
    )
    expect(map.get("z-ai/glm-5.2::judgment")).toBe(3)
  })

  test("two role_keys sharing one model+tier sum additively, not overwrite", () => {
    const map = mergeEscalationByModel(
      [
        { roleKey: "ceo_technical_director", complexityTier: "judgment", escalationCount: 2 },
        { roleKey: "senior_backend_engineer", complexityTier: "judgment", escalationCount: 5 },
      ],
      resolveModel
    )
    expect(map.get("z-ai/glm-5.2::judgment")).toBe(7)
  })

  test("different tiers for the same model stay separate keys", () => {
    const map = mergeEscalationByModel(
      [
        { roleKey: "ceo_technical_director", complexityTier: "judgment", escalationCount: 1 },
        { roleKey: "ceo_technical_director", complexityTier: "integrative", escalationCount: 4 },
      ],
      resolveModel
    )
    expect(map.get("z-ai/glm-5.2::judgment")).toBe(1)
    expect(map.get("z-ai/glm-5.2::integrative")).toBe(4)
  })

  test("null complexity_tier buckets as 'unknown', matching model-scorecard-service.ts's own convention", () => {
    const map = mergeEscalationByModel(
      [{ roleKey: "tool_integration_engineer", complexityTier: null, escalationCount: 2 }],
      resolveModel
    )
    expect(map.get("openai/gpt-oss-120b::unknown")).toBe(2)
  })

  test("a null role_key buckets under 'unclassified', not dropped or crashing", () => {
    const map = mergeEscalationByModel(
      [{ roleKey: null, complexityTier: "mechanical", escalationCount: 1 }],
      resolveModel
    )
    expect(map.get("unclassified::mechanical")).toBe(1)
  })
})

describe("toLifecycleMetrics -- bridges a scorecard entry + escalation map into ReviewMetrics shape", () => {
  test("carries dispatch/success/audit-finding counts straight through from the scorecard entry", () => {
    const entry = scorecardEntry({ model: "z-ai/glm-5.2", complexityTier: "judgment", dispatchCount: 10, terminalCount: 8, successCount: 6, failureCount: 2, reviewedCount: 4, auditFindingCount: 1 })
    const metrics = toLifecycleMetrics(entry, new Map())
    expect(metrics.dispatchCount).toBe(10)
    expect(metrics.terminalCount).toBe(8)
    expect(metrics.successCount).toBe(6)
    expect(metrics.failureCount).toBe(2)
    expect(metrics.reviewedCount).toBe(4)
    expect(metrics.auditFindingCount).toBe(1)
  })

  test("escalationCount defaults to 0 (a real 'none observed' fact) when no escalation row matched this model+tier", () => {
    const entry = scorecardEntry({ model: "z-ai/glm-5.2", complexityTier: "judgment" })
    const metrics = toLifecycleMetrics(entry, new Map())
    expect(metrics.escalationCount).toBe(0)
  })

  test("escalationCount is pulled from the map by the exact model::tier key", () => {
    const entry = scorecardEntry({ model: "z-ai/glm-5.2", complexityTier: "judgment" })
    const map = new Map([["z-ai/glm-5.2::judgment", 6]])
    const metrics = toLifecycleMetrics(entry, map)
    expect(metrics.escalationCount).toBe(6)
  })

  test("costUsd is carried straight through from the scorecard entry's own costUsd.totalUsd, null included", () => {
    const withCost = scorecardEntry({ costUsd: { totalUsd: 12.5, note: "n/a" } })
    expect(toLifecycleMetrics(withCost, new Map()).costUsd).toBe(12.5)

    const withoutCost = scorecardEntry({ costUsd: { totalUsd: null, note: "n/a" } })
    expect(toLifecycleMetrics(withoutCost, new Map()).costUsd).toBeNull()
  })
})
