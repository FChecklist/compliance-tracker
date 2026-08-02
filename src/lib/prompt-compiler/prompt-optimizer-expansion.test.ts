/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-optimizer +
// engine-prompt-expansion pure unit tests.
import { describe, expect, test } from "bun:test"
import { expandMachinePrompt, isSafeToOptimize, optimizeMachinePrompt } from "./prompt-optimizer-expansion"
import type { CompiledPrompt } from "./types"

const COMPILED: CompiledPrompt = {
  cleanedText: "fix the login bug",
  machinePrompt: "CODE:FIX:fix_the_login_bug",
  contentHash: "a".repeat(64),
  fingerprint: "b".repeat(64),
  noiseReductionPct: 10,
  tokenReduction: { estimatedOriginalTokens: 10, estimatedMachineTokens: 5, reductionPct: 50 },
  matchedTemplate: null,
}

describe("isSafeToOptimize", () => {
  test("false with no quality signal at all (do not optimize blind)", () => {
    expect(isSafeToOptimize(null)).toBe(false)
  })

  test("false when sample size is too small", () => {
    expect(isSafeToOptimize({ passRate: 1, sampleSize: 1 })).toBe(false)
  })

  test("false when pass rate is below the safety floor", () => {
    expect(isSafeToOptimize({ passRate: 0.5, sampleSize: 10 })).toBe(false)
  })

  test("true with a strong pass rate and enough samples", () => {
    expect(isSafeToOptimize({ passRate: 0.9, sampleSize: 10 })).toBe(true)
  })
})

describe("optimizeMachinePrompt", () => {
  test("does not modify the prompt when optimization is unsafe", () => {
    const result = optimizeMachinePrompt(COMPILED, null)
    expect(result.wasOptimized).toBe(false)
    expect(result.machinePrompt).toBe(COMPILED.machinePrompt)
  })

  test("drops generic filler terms when the quality signal supports it", () => {
    const withFiller: CompiledPrompt = { ...COMPILED, machinePrompt: "CODE:FIX:fix_the_login_bug" }
    const result = optimizeMachinePrompt(withFiller, { passRate: 0.9, sampleSize: 10 })
    expect(result.machinePrompt).not.toContain("_the_")
    expect(result.wasOptimized).toBe(true)
    expect(result.termsDropped).toBeGreaterThan(0)
  })

  test("never touches the category/intent prefix", () => {
    const result = optimizeMachinePrompt(COMPILED, { passRate: 0.9, sampleSize: 10 })
    expect(result.machinePrompt.startsWith("CODE:FIX:")).toBe(true)
  })
})

describe("expandMachinePrompt", () => {
  test("expands a template-matched CODE_FIX shape into a readable instruction", () => {
    const expanded = expandMachinePrompt("CODE_FIX:issue=login error:target=auth module")
    expect(expanded.toLowerCase()).toContain("fix")
  })

  test("expands a compressed CATEGORY:INTENT:terms fallback shape", () => {
    const expanded = expandMachinePrompt("CODE:FIX:fix_login")
    expect(expanded.toLowerCase()).toContain("fix")
  })

  test("substitutes a known variable default into the expansion", () => {
    const expanded = expandMachinePrompt("TASK:review pr_number", [{ name: "pr_number", inferredType: "string", defaultValue: "PR-42", boundElsewhere: false }])
    expect(expanded).toContain("PR-42")
  })
})
