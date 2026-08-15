/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-compiler (deepen) +
// pipeline-prompt-construction pure unit tests.
import { describe, expect, test } from "bun:test"
import { analyzeLightweight, buildCompiledPrompt, compressToMachinePrompt, computeFingerprint, estimateTokenReduction, hashContent } from "./prompt-construction"
import { classify, extractIntent } from "./intent-classifier"

describe("analyzeLightweight (Layer 2)", () => {
  test("strips conversational filler via the existing normalizeForLlm and classifies the result", () => {
    const analysis = analyzeLightweight("Hi, could you please basically fix the login bug for me?")
    expect(analysis.classification.category).toBe("CODE")
    expect(analysis.originalText).toContain("Hi")
    expect(analysis.wordCount).toBeGreaterThan(0)
  })
})

describe("compressToMachinePrompt (port of prompt_engine.py's _compress_to_prompt)", () => {
  test("keeps an action verb and its immediate object", () => {
    const text = "Fix login"
    const classification = classify(text)
    const intent = extractIntent(text)
    const prompt = compressToMachinePrompt(text, classification, intent)
    expect(prompt).toContain("Fix")
    expect(prompt).toContain("login")
    expect(prompt.startsWith(`${classification.category}:${intent.primary}:`)).toBe(true)
  })

  test("falls back to first/last word when no action verb is present", () => {
    const text = "quarterly compliance summary report document"
    const classification = classify(text)
    const intent = extractIntent(text)
    const prompt = compressToMachinePrompt(text, classification, intent)
    expect(prompt).toContain("quarterly")
    expect(prompt).toContain("document")
  })
})

describe("estimateTokenReduction (port of prompt_engine.py's estimate_token_reduction)", () => {
  test("reports a positive reduction when the machine prompt is much shorter", () => {
    const result = estimateTokenReduction("this is a much longer original sentence with many words in it", "CODE:FIX:login")
    expect(result.reductionPct).toBeGreaterThan(0)
    expect(result.estimatedMachineTokens).toBeLessThan(result.estimatedOriginalTokens)
  })
})

describe("hashContent / computeFingerprint", () => {
  test("hashContent is deterministic for identical text", () => {
    expect(hashContent("same text")).toBe(hashContent("same text"))
  })

  test("hashContent differs for different text", () => {
    expect(hashContent("text a")).not.toBe(hashContent("text b"))
  })

  test("computeFingerprint is identical for two differently-worded prompts with the same compiled shape", () => {
    const a = analyzeLightweight("Fix the login bug")
    const b = analyzeLightweight("Fix the payment bug")
    const fpA = computeFingerprint(a.classification, a.intent, a.entities, a.variables)
    const fpB = computeFingerprint(b.classification, b.intent, b.entities, b.variables)
    expect(fpA).toBe(fpB)
  })
})

describe("buildCompiledPrompt (Layer 4 orchestrator)", () => {
  test("produces a machine prompt, a content hash, and a fingerprint", () => {
    const analysis = analyzeLightweight("Fix the authentication bug in the login module")
    const compiled = buildCompiledPrompt(analysis)
    expect(compiled.machinePrompt.length).toBeGreaterThan(0)
    expect(compiled.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(compiled.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  test("matches a known template for a code-fix request", () => {
    const analysis = analyzeLightweight("fix login error in the auth module")
    const compiled = buildCompiledPrompt(analysis)
    expect(compiled.machinePrompt.startsWith("CODE_FIX:")).toBe(true)
    expect(compiled.matchedTemplate).not.toBeNull()
  })
})
