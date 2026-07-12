/// <reference types="bun-types" />
// GAP-MODEL-SCORECARD: tests mergeScorecardGroups() directly, the pure
// aggregation core getModelScorecard() delegates to -- matching this repo's
// established pattern of not touching withTenantContext/a live DB from a
// .test.ts file (task-service.test.ts's own note; see also
// ai-performance-report-service.ts's computeFailureRate/averageNumericColumn
// for the same pure-core/DB-shell split).
import { describe, expect, test } from "bun:test"
import { mergeScorecardGroups, ITERATION_COUNT_NOTE, type ScorecardGroupRow } from "./model-scorecard-service"

const resolveModel = (roleKey: string | null): string => {
  const roster: Record<string, string> = {
    ceo_technical_director: "z-ai/glm-5.2",
    senior_backend_engineer: "z-ai/glm-5.2",
    tool_integration_engineer: "openai/gpt-oss-120b",
    governance_backend_engineer: "deepseek/deepseek-v4-pro",
  }
  return roleKey ? (roster[roleKey] ?? "unclassified") : "unclassified"
}

function row(overrides: Partial<ScorecardGroupRow>): ScorecardGroupRow {
  return {
    roleKey: null,
    complexityTier: null,
    dispatchCount: 0,
    terminalCount: 0,
    successCount: 0,
    failureCount: 0,
    durationMsSum: 0,
    durationMsSampleCount: 0,
    reviewedCount: 0,
    auditFindingCount: 0,
    ...overrides,
  }
}

describe("mergeScorecardGroups -- dispatch count / success rate", () => {
  test("empty input produces an empty scorecard", () => {
    expect(mergeScorecardGroups([], resolveModel)).toEqual([])
  })

  test("a single group resolves model via roster and computes success rate", () => {
    const rows = [
      row({ roleKey: "ceo_technical_director", complexityTier: "judgment", dispatchCount: 10, terminalCount: 8, successCount: 6, failureCount: 2 }),
    ]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.model).toBe("z-ai/glm-5.2")
    expect(entry.complexityTier).toBe("judgment")
    expect(entry.dispatchCount).toBe(10)
    expect(entry.terminalCount).toBe(8)
    expect(entry.successRate).toBeCloseTo(6 / 8)
  })

  test("successRate is null (not 0 or NaN) when nothing has reached a terminal stage yet", () => {
    const rows = [row({ roleKey: "ceo_technical_director", complexityTier: "judgment", dispatchCount: 3, terminalCount: 0 })]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.successRate).toBeNull()
  })

  test("two role_keys sharing one model+tier are merged into a single scorecard row, not two", () => {
    const rows = [
      row({ roleKey: "ceo_technical_director", complexityTier: "judgment", dispatchCount: 5, terminalCount: 5, successCount: 5 }),
      row({ roleKey: "senior_backend_engineer", complexityTier: "judgment", dispatchCount: 7, terminalCount: 7, successCount: 4, failureCount: 3 }),
    ]
    const entries = mergeScorecardGroups(rows, resolveModel)
    expect(entries).toHaveLength(1)
    expect(entries[0].model).toBe("z-ai/glm-5.2")
    expect(entries[0].dispatchCount).toBe(12)
    expect(entries[0].successCount).toBe(9)
    expect(entries[0].terminalCount).toBe(12)
    expect(entries[0].successRate).toBeCloseTo(9 / 12)
  })

  test("different complexity tiers for the same model stay separate rows", () => {
    const rows = [
      row({ roleKey: "ceo_technical_director", complexityTier: "judgment", dispatchCount: 4, terminalCount: 4, successCount: 4 }),
      row({ roleKey: "ceo_technical_director", complexityTier: "integrative", dispatchCount: 2, terminalCount: 2, successCount: 1, failureCount: 1 }),
    ]
    const entries = mergeScorecardGroups(rows, resolveModel)
    expect(entries).toHaveLength(2)
    const tiers = entries.map((e) => e.complexityTier).sort()
    expect(tiers).toEqual(["integrative", "judgment"])
  })

  test("null complexity_tier (rows recorded before the migration, or a rejected-before-validation dispatch) buckets as 'unknown', not dropped", () => {
    const rows = [row({ roleKey: "ceo_technical_director", complexityTier: null, dispatchCount: 1, terminalCount: 1, failureCount: 1 })]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.complexityTier).toBe("unknown")
    expect(entry.dispatchCount).toBe(1)
  })

  test("a null role_key (rejected before classification) buckets under 'unclassified', not dropped or crashing", () => {
    const rows = [row({ roleKey: null, complexityTier: "mechanical", dispatchCount: 2, terminalCount: 2, failureCount: 2 })]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.model).toBe("unclassified")
  })

  test("results are sorted highest dispatch count first", () => {
    const rows = [
      row({ roleKey: "tool_integration_engineer", complexityTier: "mechanical", dispatchCount: 3 }),
      row({ roleKey: "ceo_technical_director", complexityTier: "judgment", dispatchCount: 20 }),
      row({ roleKey: "governance_backend_engineer", complexityTier: "integrative", dispatchCount: 9 }),
    ]
    const entries = mergeScorecardGroups(rows, resolveModel)
    expect(entries.map((e) => e.dispatchCount)).toEqual([20, 9, 3])
  })
})

describe("mergeScorecardGroups -- avgDurationMs (exact merge, not average-of-averages)", () => {
  test("merges two groups' duration sums/sample-counts exactly rather than averaging their per-group averages", () => {
    // Group A: 2 samples averaging 100ms (sum 200). Group B: 1 sample of 1000ms.
    // A naive avg-of-avgs would give (100+1000)/2 = 550. The real combined
    // average across all 3 samples is (200+1000)/3 = 400.
    const rows = [
      row({ roleKey: "ceo_technical_director", complexityTier: "judgment", durationMsSum: 200, durationMsSampleCount: 2 }),
      row({ roleKey: "senior_backend_engineer", complexityTier: "judgment", durationMsSum: 1000, durationMsSampleCount: 1 }),
    ]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.avgDurationMs).toBeCloseTo(400)
  })

  test("avgDurationMs is null when no dispatch in the group recorded a duration", () => {
    const rows = [row({ roleKey: "ceo_technical_director", complexityTier: "judgment", dispatchCount: 1 })]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.avgDurationMs).toBeNull()
  })
})

describe("mergeScorecardGroups -- audit-finding-rate (from real review_decision rows, AGENTS.md Rule 7c)", () => {
  test("auditFindingRate is rejectedCount / reviewedCount", () => {
    const rows = [row({ roleKey: "governance_backend_engineer", complexityTier: "integrative", reviewedCount: 4, auditFindingCount: 1 })]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.auditFindingRate).toBeCloseTo(0.25)
  })

  test("auditFindingRate is null (no signal) when nothing has been reviewed yet, not 0", () => {
    const rows = [row({ roleKey: "governance_backend_engineer", complexityTier: "integrative", dispatchCount: 5, reviewedCount: 0 })]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.auditFindingRate).toBeNull()
  })

  test("reviewedCount/auditFindingCount merge additively across role_keys sharing a model", () => {
    const rows = [
      row({ roleKey: "ceo_technical_director", complexityTier: "judgment", reviewedCount: 3, auditFindingCount: 1 }),
      row({ roleKey: "senior_backend_engineer", complexityTier: "judgment", reviewedCount: 5, auditFindingCount: 2 }),
    ]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.reviewedCount).toBe(8)
    expect(entry.auditFindingCount).toBe(3)
    expect(entry.auditFindingRate).toBeCloseTo(3 / 8)
  })
})

describe("mergeScorecardGroups -- iteration count (honestly not fabricated)", () => {
  test("every entry reports iterationCount.avg as null with the real infrastructure-gap explanation, never a fabricated number", () => {
    const rows = [row({ roleKey: "tool_integration_engineer", complexityTier: "mechanical", dispatchCount: 6 })]
    const [entry] = mergeScorecardGroups(rows, resolveModel)
    expect(entry.iterationCount.avg).toBeNull()
    expect(entry.iterationCount.note).toBe(ITERATION_COUNT_NOTE)
    expect(entry.iterationCount.note.length).toBeGreaterThan(20)
  })
})
