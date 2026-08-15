/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: Layer 2-5 pipeline orchestrator
// integration test -- still DB-free (cacheMatchScore/modelReady/userRoles
// are passed in directly rather than resolved from a live DB), matching
// this repo's established .test.ts convention.
import { describe, expect, test } from "bun:test"
import { runPipeline } from "./pipeline"

describe("runPipeline", () => {
  test("runs all four stages end to end for one real sample prompt", () => {
    const result = runPipeline({
      rawText: "Hi, could you please fix the login bug in the auth module for me? Thanks!",
      business: { orgId: "org1", orgName: "Acme Corp", country: "IN" },
      user: { userId: "u1", displayName: "Alex", roles: [] },
      sessionMessages: [],
    })

    expect(result.analysis.classification.category).toBe("CODE")
    expect(result.compiled.machinePrompt.length).toBeGreaterThan(0)
    expect(result.compiled.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.verification.confidence.composite).toBeGreaterThanOrEqual(0)
    expect(result.timings.length).toBe(4)
    expect(result.timings.map((t) => t.stage)).toEqual([
      "lightweight_analysis",
      "context_assembly",
      "prompt_construction",
      "verification",
    ])
  })

  test("every stage timing carries its own document-specified budget", () => {
    const result = runPipeline({
      rawText: "What is the deployment status?",
      business: { orgId: null, orgName: null, country: null },
      user: { userId: "u1", displayName: null, roles: [] },
      sessionMessages: [],
    })
    const budgets = Object.fromEntries(result.timings.map((t) => [t.stage, t.budgetMs]))
    expect(budgets).toEqual({
      lightweight_analysis: 15,
      context_assembly: 25,
      prompt_construction: 30,
      verification: 30,
    })
  })

  test("a permission-gated intent without the required role fails verification", () => {
    const result = runPipeline({
      rawText: "Delete the staging environment",
      business: { orgId: "org1", orgName: "Acme", country: "IN" },
      user: { userId: "u1", displayName: "Alex", roles: [] },
      sessionMessages: [],
    })
    expect(result.verification.allPassed).toBe(false)
  })
})
