import { describe, expect, test } from "bun:test"
import {
  computeClaimConfidenceScore,
  extractVerifiableClaims,
  verifyFileClaim,
  verifyFunctionClaim,
  LOW_CONFIDENCE_SCORE_THRESHOLD,
} from "./claim-verification"

describe("extractVerifiableClaims -- GP-08/GP-09 Tier-1 fact-check extraction", () => {
  test("extracts a backtick-quoted file path", () => {
    const claims = extractVerifiableClaims("I edited `src/lib/claim-verification.ts` to add this.")
    expect(claims).toContainEqual({ type: "file_path", value: "src/lib/claim-verification.ts" })
  })

  test("extracts a backtick-quoted function reference", () => {
    const claims = extractVerifiableClaims("This calls `computeDispatchConfidencePercentage()` internally.")
    expect(claims).toContainEqual({ type: "function_reference", value: "computeDispatchConfidencePercentage" })
  })

  test("plain prose with no backtick-quoted claims extracts nothing", () => {
    expect(extractVerifiableClaims("This change looks correct and should work fine.")).toEqual([])
  })

  test("dedupes repeated claims and caps at 10 total", () => {
    const many = Array.from({ length: 15 }, (_, i) => `\`fn${i}()\``).join(" ")
    const claims = extractVerifiableClaims(many + " `fn0()`")
    expect(claims.length).toBe(10)
  })
})

describe("verifyFileClaim -- real repo filesystem checks", () => {
  test("a file that genuinely exists in this repo verifies true", () => {
    expect(verifyFileClaim("src/lib/claim-verification.ts")).toBe(true)
  })

  test("a file that does not exist verifies false", () => {
    expect(verifyFileClaim("src/lib/this-file-does-not-exist-xyz123.ts")).toBe(false)
  })

  test("path traversal outside the repo root is rejected, never checked", () => {
    expect(verifyFileClaim("../../../etc/passwd")).toBe(false)
  })
})

describe("verifyFunctionClaim -- real repo source-scan checks", () => {
  test("a function that genuinely exists in this repo verifies true", async () => {
    expect(await verifyFunctionClaim("computeDispatchConfidencePercentage")).toBe(true)
  })

  test("a function that does not exist anywhere in this repo verifies false", async () => {
    expect(await verifyFunctionClaim("totallyMadeUpFunctionNameXyz123")).toBe(false)
  })
})

describe("computeClaimConfidenceScore -- end-to-end scoring", () => {
  test("a claim citing a function/file that genuinely exists scores high confidence, not flagged", async () => {
    const result = await computeClaimConfidenceScore(
      "Verified by reading `src/lib/claim-verification.ts` and calling `computeDispatchConfidencePercentage()`."
    )
    expect(result.confidenceScore).toBe(1)
    expect(result.lowConfidenceFlagged).toBe(false)
    expect(result.claims.every((c) => c.verified)).toBe(true)
  })

  test("a claim citing a function/file that does not exist scores low confidence, correctly flagged", async () => {
    const result = await computeClaimConfidenceScore(
      "Verified by reading `src/lib/nonexistent-imaginary-file.ts` and calling `totallyMadeUpFunctionNameXyz123()`."
    )
    expect(result.confidenceScore).toBe(0)
    expect(result.confidenceScore).toBeLessThan(LOW_CONFIDENCE_SCORE_THRESHOLD)
    expect(result.lowConfidenceFlagged).toBe(true)
    expect(result.claims.every((c) => !c.verified)).toBe(true)
  })

  test("a mix of real and fabricated claims lands strictly between 0 and 1 and reflects the true/false split", async () => {
    const result = await computeClaimConfidenceScore(
      "See `src/lib/claim-verification.ts` (real) and `totallyMadeUpFunctionNameXyz123()` and `anotherFakeFunctionAbc456()` (both fabricated)."
    )
    expect(result.confidenceScore).toBeCloseTo(1 / 3, 5)
    expect(result.lowConfidenceFlagged).toBe(true)
  })

  test("no extractable claims -> confidenceScore 1, never flagged", async () => {
    const result = await computeClaimConfidenceScore("This all looks good, no issues found.")
    expect(result.confidenceScore).toBe(1)
    expect(result.lowConfidenceFlagged).toBe(false)
    expect(result.claims).toEqual([])
  })
})
