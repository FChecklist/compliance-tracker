/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: pipeline-verification (Layer 5) pure
// unit tests.
import { describe, expect, test } from "bun:test"
import { selectModelTier, verify } from "./verification-pipeline"
import type { AssembledContext, Classification, CompiledPrompt, IntentLevel } from "./types"

const CONTEXT: AssembledContext = {
  business: { orgId: "org1", orgName: "Acme", country: "IN" },
  user: { userId: "u1", displayName: "Alex", roles: [] },
  sessionMessages: [],
  pruneStats: { messagesBefore: 5, messagesAfter: 3, tokensBefore: 100, tokensAfter: 60, reductionPct: 40 },
  hydratedTemplate: null,
}

const COMPILED: CompiledPrompt = {
  cleanedText: "fix login bug",
  machinePrompt: "CODE:FIX:fix_login",
  contentHash: "a".repeat(64),
  fingerprint: "b".repeat(64),
  noiseReductionPct: 10,
  tokenReduction: { estimatedOriginalTokens: 20, estimatedMachineTokens: 5, reductionPct: 75 },
  matchedTemplate: null,
}

const CODE_CLASSIFICATION: Classification = { category: "CODE", confidence: 0.8, scores: {}, keywordsFound: [], patternsMatched: [] }
const QUERY_CLASSIFICATION: Classification = { category: "QUERY", confidence: 0.6, scores: {}, keywordsFound: [], patternsMatched: [] }
const FIX_INTENT: IntentLevel = { primary: "FIX", secondary: null, implicit: null }
const DELETE_INTENT: IntentLevel = { primary: "DELETE", secondary: null, implicit: null }

describe("selectModelTier", () => {
  test("a permission-gated intent (DELETE) is judgment tier", () => {
    expect(selectModelTier(CODE_CLASSIFICATION, DELETE_INTENT).complexityTier).toBe("judgment")
  })

  test("CODE/OPS categories are integrative tier", () => {
    expect(selectModelTier(CODE_CLASSIFICATION, FIX_INTENT).complexityTier).toBe("integrative")
  })

  test("other categories default to mechanical tier", () => {
    expect(selectModelTier(QUERY_CLASSIFICATION, { primary: "QUERY", secondary: null, implicit: null }).complexityTier).toBe("mechanical")
  })
})

describe("verify (Layer 5 orchestrator)", () => {
  test("all checks pass for a well-formed, non-sensitive compiled prompt with no unresolved variables", () => {
    const result = verify({
      analysis: { variables: [] },
      classification: CODE_CLASSIFICATION,
      intent: FIX_INTENT,
      context: CONTEXT,
      compiled: { ...COMPILED, matchedTemplate: "some-template" },
      cacheMatchScore: 0.6,
      modelReady: true,
      userRoles: [],
    })
    expect(result.allPassed).toBe(true)
    expect(result.checks.every((c) => c.passed)).toBe(true)
  })

  test("permission check fails for a DELETE intent without the required role", () => {
    const result = verify({
      analysis: { variables: [] },
      classification: CODE_CLASSIFICATION,
      intent: DELETE_INTENT,
      context: CONTEXT,
      compiled: COMPILED,
      cacheMatchScore: 0,
      modelReady: true,
      userRoles: [],
    })
    const permCheck = result.checks.find((c) => c.name === "permission.role_check")
    expect(permCheck?.passed).toBe(false)
    expect(result.allPassed).toBe(false)
  })

  test("permission check passes for a DELETE intent when the caller holds veridian_admin", () => {
    const result = verify({
      analysis: { variables: [] },
      classification: CODE_CLASSIFICATION,
      intent: DELETE_INTENT,
      context: CONTEXT,
      compiled: COMPILED,
      cacheMatchScore: 0,
      modelReady: true,
      userRoles: ["veridian_admin"],
    })
    const permCheck = result.checks.find((c) => c.name === "permission.role_check")
    expect(permCheck?.passed).toBe(true)
  })

  test("business-rule check fails when a variable is unresolved and not intentionally bound", () => {
    const result = verify({
      analysis: { variables: [{ defaultValue: null, boundElsewhere: false }] },
      classification: CODE_CLASSIFICATION,
      intent: FIX_INTENT,
      context: CONTEXT,
      compiled: COMPILED,
      cacheMatchScore: 0,
      modelReady: true,
      userRoles: [],
    })
    const bizCheck = result.checks.find((c) => c.name === "business_rule.variables_resolved")
    expect(bizCheck?.passed).toBe(false)
  })

  test("returns a real cost estimate for the default platform floor-tier model", () => {
    const result = verify({
      analysis: { variables: [] },
      classification: CODE_CLASSIFICATION,
      intent: FIX_INTENT,
      context: CONTEXT,
      compiled: COMPILED,
      cacheMatchScore: 0,
      modelReady: true,
      userRoles: [],
    })
    expect(result.estimatedCostUsd).not.toBeNull()
    expect(result.estimatedCostUsd as number).toBeGreaterThan(0)
  })
})
