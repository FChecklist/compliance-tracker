/// <reference types="bun-types" />
// D26.B5.S1 (per-source-type model routing, ai-os/STATUS-REPORT.md item 9).
// Tests applySourceTypeOverride() directly -- the pure function
// resolveModelConfig()/resolvePlatformModelConfig() both delegate to -- plus
// one integration-level suite for resolveModelConfig() itself with `@/lib/db`
// and its crypto/cost-guard dependencies mock.module()'d out, matching
// asset-registry-cache.test.ts's established pattern for this file's kind of
// dependency (never touching a live DB from a .test.ts file).
import { describe, test, expect, mock } from "bun:test"
import type { ResolvedModelConfig } from "./orchestra-model-resolver"

function config(overrides: Partial<ResolvedModelConfig> = {}): ResolvedModelConfig {
  return { provider: "groq", model: "openai/gpt-oss-120b", apiKey: "key-1", isCustomerConfigured: false, ...overrides }
}

describe("applySourceTypeOverride", () => {
  test("undefined sourceType is a no-op passthrough (every pre-existing call site)", async () => {
    const { applySourceTypeOverride } = await import("./orchestra-model-resolver")
    const original = config()
    expect(applySourceTypeOverride(original, undefined)).toEqual(original)
  })

  test("an unregistered sourceType passes the original config through unchanged, not an error", async () => {
    const { applySourceTypeOverride } = await import("./orchestra-model-resolver")
    const original = config()
    expect(applySourceTypeOverride(original, "some_unregistered_source_type")).toEqual(original)
  })

  test("vision_document_extraction swaps the model when the primary provider has a registered override", async () => {
    const { applySourceTypeOverride } = await import("./orchestra-model-resolver")
    const result = applySourceTypeOverride(config({ provider: "openai", model: "gpt-4o-mini" }), "vision_document_extraction")
    expect(result?.provider).toBe("openai")
    expect(result?.model).toBe("gpt-4o")
  })

  test("falls back to the fallback provider's override when the primary provider has none registered", async () => {
    const { applySourceTypeOverride } = await import("./orchestra-model-resolver")
    const original = config({
      provider: "groq", model: "openai/gpt-oss-120b",
      fallback: { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", apiKey: "fallback-key" },
    })
    const result = applySourceTypeOverride(original, "vision_document_extraction")
    expect(result?.provider).toBe("openrouter")
    expect(result?.model).toBe("openai/gpt-4o-mini")
    expect(result?.apiKey).toBe("fallback-key")
  })

  test("returns null when a registered sourceType has no override for the primary OR fallback provider", async () => {
    const { applySourceTypeOverride } = await import("./orchestra-model-resolver")
    // groq has no vision override, and there's no fallback at all here.
    const result = applySourceTypeOverride(config({ provider: "groq", fallback: undefined }), "vision_document_extraction")
    expect(result).toBeNull()
  })

  test("returns null when neither primary nor fallback provider has a registered override", async () => {
    const { applySourceTypeOverride } = await import("./orchestra-model-resolver")
    const result = applySourceTypeOverride(
      config({ provider: "groq", fallback: { provider: "cerebras", model: "gpt-oss-120b", apiKey: "k" } }),
      "vision_document_extraction"
    )
    expect(result).toBeNull()
  })

  test("preserves isCustomerConfigured/fallback fields when only the model/provider swap", async () => {
    const { applySourceTypeOverride } = await import("./orchestra-model-resolver")
    const original = config({ provider: "anthropic", model: "claude-haiku", isCustomerConfigured: true })
    const result = applySourceTypeOverride(original, "vision_document_extraction")
    expect(result?.isCustomerConfigured).toBe(true)
    expect(result?.model).toBe("claude-sonnet-5") // the registered override, not the original model
  })
})

// ─── resolveModelConfig: sourceType wiring end-to-end, @/lib/db mocked ────

describe("resolveModelConfig with sourceType (integration, DB mocked)", () => {
  test("applies the vision override on top of the platform-default resolution", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "openai", model: "gpt-4o-mini-text" } })) },
          customerModelConfig: { findFirst: mock(async () => undefined) },
        },
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async (c: string) => c) }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const originalOpenAiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "openai-test-key"
    try {
      const { resolveModelConfig } = await import("./orchestra-model-resolver")
      const result = await resolveModelConfig("org-1", "customer_account_oa", "vision_document_extraction")
      expect(result?.provider).toBe("openai")
      expect(result?.model).toBe("gpt-4o") // swapped from the platform default's "gpt-4o-mini-text"
    } finally {
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalOpenAiKey
    }
  })

  test("without sourceType, the platform-default text model is returned unmodified (backward compatible)", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "openai", model: "gpt-4o-mini-text" } })) },
          customerModelConfig: { findFirst: mock(async () => undefined) },
        },
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async (c: string) => c) }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const originalOpenAiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "openai-test-key"
    try {
      const { resolveModelConfig } = await import("./orchestra-model-resolver")
      const result = await resolveModelConfig("org-1", "customer_account_oa")
      expect(result?.model).toBe("gpt-4o-mini-text") // untouched -- no sourceType passed
    } finally {
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalOpenAiKey
    }
  })
})
