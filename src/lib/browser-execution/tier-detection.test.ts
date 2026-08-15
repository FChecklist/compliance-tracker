/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5: real unit tests for each browser
// compute tier's feature detection, using injected fake navigator/window
// objects (this module's own `env` param) rather than a real browser --
// see tier-detection.ts's own header comment for why that's the right
// tradeoff for this file.
import { describe, expect, test } from "bun:test"
import { detectAllTiers, detectBuiltinAiTier, detectLiteLlmTier, detectNpuTier, detectServerTier, detectTransformersTier } from "./tier-detection"

describe("detectNpuTier", () => {
  test("unavailable with no navigator at all", () => {
    expect(detectNpuTier({}).available).toBe(false)
  })
  test("unavailable when navigator exists but has no ml", () => {
    expect(detectNpuTier({ navigator: {} }).available).toBe(false)
  })
  test("available when navigator.ml is present", () => {
    expect(detectNpuTier({ navigator: { ml: {} } }).available).toBe(true)
  })
})

describe("detectBuiltinAiTier", () => {
  test("unavailable with no window", () => {
    expect(detectBuiltinAiTier({}).available).toBe(false)
  })
  test("available when window.ai is present", () => {
    expect(detectBuiltinAiTier({ window: { ai: {} } }).available).toBe(true)
  })
  test("available when window.LanguageModel is present", () => {
    expect(detectBuiltinAiTier({ window: { LanguageModel: {} } }).available).toBe(true)
  })
})

describe("detectLiteLlmTier", () => {
  test("unavailable server-side (no navigator)", () => {
    const result = detectLiteLlmTier({})
    expect(result.available).toBe(false)
    expect(result.gpuAccelerated).toBe(false)
  })
  test("available but not GPU-accelerated when navigator exists without gpu (litert-spike's real WASM-fallback case)", () => {
    const result = detectLiteLlmTier({ navigator: {} })
    expect(result.available).toBe(true)
    expect(result.gpuAccelerated).toBe(false)
    expect(result.reason).toContain("WASM fallback")
  })
  test("GPU-accelerated when navigator.gpu is present", () => {
    const result = detectLiteLlmTier({ navigator: { gpu: {} } })
    expect(result.available).toBe(true)
    expect(result.gpuAccelerated).toBe(true)
  })
})

describe("detectTransformersTier", () => {
  test("unavailable server-side", () => {
    expect(detectTransformersTier({}).available).toBe(false)
  })
  test("available in any browser-like environment", () => {
    expect(detectTransformersTier({ navigator: {} }).available).toBe(true)
  })
})

describe("detectServerTier", () => {
  test("always available", () => {
    expect(detectServerTier().available).toBe(true)
  })
})

describe("detectAllTiers", () => {
  test("returns all 5 tiers in a stable order with a fully-capable env", () => {
    const tiers = detectAllTiers({ navigator: { ml: {}, gpu: {} }, window: { ai: {} } })
    expect(tiers.map((t) => t.tier)).toEqual(["npu", "builtin-ai", "lite-llm", "transformers", "server"])
    expect(tiers.every((t) => t.available)).toBe(true)
  })
  test("with zero browser capability, only server is available", () => {
    const tiers = detectAllTiers({})
    const byTier = Object.fromEntries(tiers.map((t) => [t.tier, t.available]))
    expect(byTier).toEqual({ npu: false, "builtin-ai": false, "lite-llm": false, transformers: false, server: true })
  })
})
