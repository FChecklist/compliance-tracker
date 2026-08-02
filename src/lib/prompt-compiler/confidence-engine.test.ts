/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-confidence multi-signal tests.
import { describe, expect, test } from "bun:test"
import { computeConfidence } from "./confidence-engine"
import type { AssembledContext, Classification, IntentLevel } from "./types"

const FULL_CONTEXT: AssembledContext = {
  business: { orgId: "org1", orgName: "Acme", country: "IN" },
  user: { userId: "u1", displayName: "Alex", roles: [] },
  sessionMessages: [{ role: "user", content: "hi", id: "m1" }],
  pruneStats: { messagesBefore: 1, messagesAfter: 1, tokensBefore: 5, tokensAfter: 5, reductionPct: 0 },
  hydratedTemplate: null,
}

const EMPTY_CONTEXT: AssembledContext = {
  business: { orgId: null, orgName: null, country: null },
  user: { userId: "", displayName: null, roles: [] },
  sessionMessages: [],
  pruneStats: { messagesBefore: 0, messagesAfter: 0, tokensBefore: 0, tokensAfter: 0, reductionPct: 0 },
  hydratedTemplate: null,
}

const CLASSIFICATION: Classification = { category: "CODE", confidence: 0.8, scores: {}, keywordsFound: [], patternsMatched: [] }
const RESOLVED_INTENT: IntentLevel = { primary: "FIX", secondary: null, implicit: null }
const UNKNOWN_INTENT: IntentLevel = { primary: "UNKNOWN", secondary: null, implicit: "TASK" }

describe("computeConfidence", () => {
  test("full context + resolved intent + cache hit + model ready scores highest", () => {
    const best = computeConfidence({ classification: CLASSIFICATION, intent: RESOLVED_INTENT, context: FULL_CONTEXT, cacheMatchScore: 1, modelReady: true })
    const worst = computeConfidence({ classification: CLASSIFICATION, intent: UNKNOWN_INTENT, context: EMPTY_CONTEXT, cacheMatchScore: 0, modelReady: false })
    expect(best.composite).toBeGreaterThan(worst.composite)
  })

  test("composite is bounded to [0,1]", () => {
    const result = computeConfidence({ classification: CLASSIFICATION, intent: RESOLVED_INTENT, context: FULL_CONTEXT, cacheMatchScore: 1, modelReady: true })
    expect(result.composite).toBeLessThanOrEqual(1)
    expect(result.composite).toBeGreaterThanOrEqual(0)
  })

  test("every signal is reported with its own name and weight", () => {
    const result = computeConfidence({ classification: CLASSIFICATION, intent: RESOLVED_INTENT, context: FULL_CONTEXT, cacheMatchScore: 0.5, modelReady: true })
    const names = result.signals.map((s) => s.name)
    expect(names).toEqual(["intent_clarity", "cache_match", "context_completeness", "model_readiness"])
  })

  test("cache match score is clamped into [0,1] even if given out of range", () => {
    const result = computeConfidence({ classification: CLASSIFICATION, intent: RESOLVED_INTENT, context: FULL_CONTEXT, cacheMatchScore: 5, modelReady: true })
    const cacheSignal = result.signals.find((s) => s.name === "cache_match")
    expect(cacheSignal?.value).toBe(1)
  })
})
