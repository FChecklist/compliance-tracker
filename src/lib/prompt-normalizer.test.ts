// Regression coverage added alongside the ReDoS fix (CodeQL: polynomial
// regex on src/lib/prompt-normalizer.ts:118-120, ai-team-workforce PR #78
// CI run) -- the regex-based whitespace/punctuation collapse was replaced
// with a single-pass manual scan (collapseWhitespaceAndPunctuation). These
// tests pin the observable behavior of normalizeForLlm() so that rewrite,
// and any future change to it, can be verified rather than just reviewed.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { normalizeForLlm } from "./prompt-normalizer"

describe("normalizeForLlm -- whitespace/punctuation cleanup", () => {
  test("collapses runs of internal whitespace to a single space", () => {
    expect(normalizeForLlm("What    is   my   GST    status")).toBe("What is my GST status")
  })

  test("removes a space immediately before punctuation", () => {
    expect(normalizeForLlm("What is my status , exactly ?")).toBe("What is my status, exactly?")
  })

  test("strips leading whitespace and punctuation", () => {
    expect(normalizeForLlm("  ,, . What is my status")).toBe("What is my status")
  })

  test("does not hang or blow up on a long run of repeated spaces (ReDoS regression check)", () => {
    const input = "check status" + " ".repeat(50000) + "please"
    const start = Date.now()
    const result = normalizeForLlm(input)
    expect(Date.now() - start).toBeLessThan(200)
    expect(result).toBe("check status")
  })

  test("tabs and newlines count as whitespace too", () => {
    expect(normalizeForLlm("What\tis\nmy   status")).toBe("What is my status")
  })
})

describe("normalizeForLlm -- filler stripping (existing behavior, unaffected by the rewrite)", () => {
  test("strips a greeting and politeness filler", () => {
    expect(normalizeForLlm("Hi, could you check my GST status please")).toBe("check my GST status")
  })

  test("never strips a denylisted word even inside a matched filler phrase", () => {
    const result = normalizeForLlm("may you check this")
    expect(result.toLowerCase()).toContain("may you")
  })

  test("returns the original text if stripping would leave nothing", () => {
    expect(normalizeForLlm("hi thanks")).toBe("hi thanks")
  })
})
