/// <reference types="bun-types" />
// Priority 5: unit tests for capability-learning-service.ts's pure
// functions (deriveCapabilityKey, tokenizePrompt, wordOverlapScore,
// computeCoverageStats). The DB-touching functions are not tested here,
// matching this codebase's established convention (see task-service.test.ts/
// approval-workflow-service.test.ts's own stated precedent).
import { describe, test, expect } from "bun:test"
import { deriveCapabilityKey, tokenizePrompt, wordOverlapScore, computeCoverageStats, ServiceError } from "./capability-learning-service"

describe("deriveCapabilityKey", () => {
  test("produces a stable dotted slug from modePill + pathKeys", () => {
    expect(deriveCapabilityKey("Accounts", ["Tax Filing", "GST", "Prepare"])).toBe("accounts.tax_filing.gst.prepare")
  })

  test("is stable across repeated calls with the same input (no randomness)", () => {
    const a = deriveCapabilityKey("Accounts", ["GST", "Prepare"])
    const b = deriveCapabilityKey("Accounts", ["GST", "Prepare"])
    expect(a).toBe(b)
  })

  test("strips non-alphanumeric characters and collapses whitespace", () => {
    expect(deriveCapabilityKey("Accounts!", ["Q3 2024-25"])).toBe("accounts.q3_2024_25")
  })

  test("throws when modePill and pathKeys together produce nothing usable", () => {
    expect(() => deriveCapabilityKey("", [])).toThrow(ServiceError)
    expect(() => deriveCapabilityKey("   ", ["   "])).toThrow(ServiceError)
  })
})

describe("tokenizePrompt", () => {
  test("lowercases, strips punctuation, dedupes", () => {
    const tokens = tokenizePrompt("Did we file? DID we FILE the GST return?")
    expect(tokens).toContain("file")
    expect(tokens).toContain("gst")
    expect(tokens).toContain("return")
    expect(tokens.filter((t) => t === "file").length).toBe(1) // deduped
  })

  test("drops stopwords", () => {
    const tokens = tokenizePrompt("Did we file the GST return")
    expect(tokens).not.toContain("did")
    expect(tokens).not.toContain("we")
    expect(tokens).not.toContain("the")
  })

  test("matches the exact 'Did/We/File' example from the Owner's spec", () => {
    const tokens = tokenizePrompt("Did we file?")
    expect(tokens.sort()).toEqual(["file"]) // "did"/"we" are stopwords, only "file" survives
  })

  test("empty/whitespace-only input returns an empty array", () => {
    expect(tokenizePrompt("")).toEqual([])
    expect(tokenizePrompt("   ")).toEqual([])
  })
})

describe("wordOverlapScore", () => {
  test("identical word sets score 1.0", () => {
    expect(wordOverlapScore(["gst", "filed"], ["gst", "filed"])).toBe(1)
  })

  test("disjoint word sets score 0", () => {
    expect(wordOverlapScore(["gst", "filed"], ["invoice", "paid"])).toBe(0)
  })

  test("partial overlap scores between 0 and 1 (Jaccard)", () => {
    // "have we filed gst" vs "gst filing done" -- shared: gst. union: filed/have/gst/filing/done (5), intersection 1
    const a = tokenizePrompt("have we filed gst")
    const b = tokenizePrompt("gst filing done")
    const score = wordOverlapScore(a, b)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  test("an empty set on either side scores 0, not NaN", () => {
    expect(wordOverlapScore([], ["gst"])).toBe(0)
    expect(wordOverlapScore(["gst"], [])).toBe(0)
    expect(wordOverlapScore([], [])).toBe(0)
  })
})

describe("computeCoverageStats", () => {
  test("computes rounded percentages from real rolling counts", () => {
    const stats = computeCoverageStats(83, 12, 5)
    expect(stats.total).toBe(100)
    expect(stats.fullSoftwarePercent).toBe(83)
    expect(stats.packageAvailablePercent).toBe(12)
    expect(stats.novelPercent).toBe(5)
  })

  test("zero total returns zero percentages, not NaN/Infinity", () => {
    const stats = computeCoverageStats(0, 0, 0)
    expect(stats).toEqual({ total: 0, fullSoftwarePercent: 0, packageAvailablePercent: 0, novelPercent: 0 })
  })

  test("rounds to nearest integer percent", () => {
    const stats = computeCoverageStats(1, 1, 1) // 33.33/33.33/33.33
    expect(stats.total).toBe(3)
    expect(stats.fullSoftwarePercent + stats.packageAvailablePercent + stats.novelPercent).toBeGreaterThanOrEqual(99)
  })
})
