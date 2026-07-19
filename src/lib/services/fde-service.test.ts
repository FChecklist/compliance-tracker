/// <reference types="bun-types" />
// UMR-03 gap closure. Tests the pure parts of fde-service.ts added to wire
// in the instruction-execution-cache -- labelFromContent(),
// buildResolvedCapabilityResponseText(), and cacheableResolutionFromEvaluation()
// -- rather than submitFdeRequest() itself, which touches a live database
// (policy engine, embeddings, LLM calls) and is deliberately left untested
// here, matching this repo's established pattern (see capability-registry-
// service.test.ts's own note on this).
import { describe, expect, test } from "bun:test"
import { labelFromContent, buildResolvedCapabilityResponseText, cacheableResolutionFromEvaluation } from "./fde-service"

describe("labelFromContent", () => {
  test("recovers the name segment (first pipe-delimited part)", () => {
    expect(labelFromContent("GST Filing | compliance_item > gst_filing | Files monthly GST returns")).toBe("GST Filing")
  })

  test("falls back to a truncated slice when there's no pipe delimiter", () => {
    expect(labelFromContent("a plain label with no pipes")).toBe("a plain label with no pipes")
  })
})

describe("buildResolvedCapabilityResponseText", () => {
  test("a cache hit (fromCache=true) is worded as a learned reuse, not a fresh match", () => {
    const text = buildResolvedCapabilityResponseText("GST Filing Agent", 0.97, true)
    expect(text).toContain("already learned how to handle")
    expect(text).toContain("GST Filing Agent")
    expect(text).toContain("97%")
  })

  test("a fresh embedding match (fromCache=false) keeps the original 'already covered' wording", () => {
    const text = buildResolvedCapabilityResponseText("GST Filing Agent", 0.96, false)
    expect(text).toContain("already covered by")
    expect(text).toContain("96%")
    expect(text).not.toContain("already learned how to handle")
  })
})

describe("cacheableResolutionFromEvaluation -- UMR-03", () => {
  test("caches an existing_agent match with a real matchedId", () => {
    const result = cacheableResolutionFromEvaluation({ matchType: "existing_agent", matchedId: "agent-123", matchedLabel: "GST Filing Agent" })
    expect(result).toEqual({ capabilityType: "worker_agent", capabilityId: "agent-123", label: "GST Filing Agent" })
  })

  test("does not cache an existing_agent match missing a matchedId", () => {
    expect(cacheableResolutionFromEvaluation({ matchType: "existing_agent", matchedId: null, matchedLabel: "GST Filing Agent" })).toBeNull()
  })

  test("does not cache existing_module/existing_rule matches -- no resolvable ID in this schema", () => {
    expect(cacheableResolutionFromEvaluation({ matchType: "existing_module", matchedId: null, matchedLabel: "GST module" })).toBeNull()
    expect(cacheableResolutionFromEvaluation({ matchType: "existing_rule", matchedId: null, matchedLabel: "GST rule" })).toBeNull()
  })

  test("does not cache a no_match evaluation", () => {
    expect(cacheableResolutionFromEvaluation({ matchType: "no_match", matchedId: null, matchedLabel: null })).toBeNull()
  })
})
