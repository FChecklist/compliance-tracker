/// <reference types="bun-types" />
// D26.B5.S1 (per-source-type model routing, ai-os/STATUS-REPORT.md item 9).
// Tests applySourceTypeOverride() directly -- the pure function
// resolveModelConfig()/resolvePlatformModelConfig() both delegate to -- plus
// one integration-level suite for resolveModelConfig() itself with `@/lib/db`
// and its crypto/cost-guard dependencies mock.module()'d out, matching
// asset-registry-cache.test.ts's established pattern for this file's kind of
// dependency (never touching a live DB from a .test.ts file).
//
// Review Framework remediation, Wave B (BYO-AI-model): extended with the
// resolver's BYO-enabled-vs-disabled branching (a real active
// customer_model_config row winning over the platform default, and an
// org/layer with none falling through), testProviderConnection()'s pass/
// fail paths, and -- the coverage this wave was explicitly asked to add --
// an end-to-end proof that when an org's configured BYO provider actually
// FAILS at call time, the platform-default fallback populated by
// platformFallbackFor() is what callLLM() really falls back to, not just a
// value sitting unused in the returned config object.
import { describe, test, expect, mock, afterEach } from "bun:test"
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

// ─── resolveModelConfig: BYO enabled vs disabled branching ───────────────
// Review Framework remediation, Wave B. Builds a minimal chainable mock for
// db.update(...).set(...).where(...).then(...) -- resolveModelConfig's
// fire-and-forget lastUsedAt touch on a real BYO hit -- since bun:mock's
// default object mock has no chain methods otherwise.
function mockDbUpdateChain() {
  const chain = {
    set: mock(() => chain),
    where: mock(() => chain),
    then: (resolve: (v: unknown) => void) => resolve(undefined),
  }
  return mock(() => chain)
}

describe("resolveModelConfig BYO branching (integration, DB mocked)", () => {
  test("an active customer_model_config row with a key and model WINS over the platform default", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "groq", model: "openai/gpt-oss-120b" } })) },
          customerModelConfig: {
            findFirst: mock(async () => ({
              id: "cfg-1", orgId: "org-1", orchestraLayerId: "layer-1",
              provider: "anthropic", modelName: "claude-sonnet-5",
              encryptedApiKey: "encrypted-blob", isActive: true,
            })),
          },
        },
        update: mockDbUpdateChain(),
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async (c: string) => `decrypted:${c}`) }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const { resolveModelConfig } = await import("./orchestra-model-resolver")
    const result = await resolveModelConfig("org-1", "customer_account_oa")
    expect(result?.provider).toBe("anthropic")
    expect(result?.model).toBe("claude-sonnet-5")
    expect(result?.apiKey).toBe("decrypted:encrypted-blob") // decrypted, never the raw ciphertext
    expect(result?.isCustomerConfigured).toBe(true)
  })

  test("no active BYO config for this org/layer falls through to the platform default (isCustomerConfigured: false)", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "groq", model: "openai/gpt-oss-120b" } })) },
          // The route-level query already filters on isActive = true, so a
          // disabled row (or none at all) both surface here as undefined --
          // this is the exact branch a "Reset to platform default"/disabled
          // config takes.
          customerModelConfig: { findFirst: mock(async () => undefined) },
        },
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async (c: string) => c) }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const originalGroqKey = process.env.GROQ_API_KEY
    process.env.GROQ_API_KEY = "groq-test-key"
    try {
      const { resolveModelConfig } = await import("./orchestra-model-resolver")
      const result = await resolveModelConfig("org-1", "customer_account_oa")
      expect(result?.provider).toBe("groq")
      expect(result?.model).toBe("openai/gpt-oss-120b")
      expect(result?.isCustomerConfigured).toBe(false)
    } finally {
      if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY
      else process.env.GROQ_API_KEY = originalGroqKey
    }
  })

  test("a BYO row missing a key or model is treated as inert, not a partial override", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "groq", model: "openai/gpt-oss-120b" } })) },
          // isActive: true, but no encryptedApiKey yet (an admin who filled
          // in provider/model and hasn't added a key -- the route's own
          // "allowed to save, but inert" state).
          customerModelConfig: { findFirst: mock(async () => ({ id: "cfg-2", orgId: "org-1", orchestraLayerId: "layer-1", provider: "openai", modelName: "gpt-4o", encryptedApiKey: null, isActive: true })) },
        },
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async (c: string) => c) }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const originalGroqKey = process.env.GROQ_API_KEY
    process.env.GROQ_API_KEY = "groq-test-key"
    try {
      const { resolveModelConfig } = await import("./orchestra-model-resolver")
      const result = await resolveModelConfig("org-1", "customer_account_oa")
      expect(result?.isCustomerConfigured).toBe(false)
      expect(result?.provider).toBe("groq") // platform default, not the keyless openai row
    } finally {
      if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY
      else process.env.GROQ_API_KEY = originalGroqKey
    }
  })

  test("resolveModelConfig returns null (blocks the call) when the cost guard denies it, even with an active BYO config", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "groq", model: "openai/gpt-oss-120b" } })) },
          customerModelConfig: { findFirst: mock(async () => ({ id: "cfg-1", orgId: "org-1", orchestraLayerId: "layer-1", provider: "anthropic", modelName: "claude-sonnet-5", encryptedApiKey: "enc", isActive: true })) },
        },
        update: mockDbUpdateChain(),
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async (c: string) => c) }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: false, reason: "org spend cap reached" })) }))

    const { resolveModelConfig } = await import("./orchestra-model-resolver")
    const result = await resolveModelConfig("org-1", "customer_account_oa")
    expect(result).toBeNull()
  })

  test("a customer-configured (BYO) resolution carries a platform-default fallback target, when OpenRouter is configured", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "groq", model: "openai/gpt-oss-120b" } })) },
          customerModelConfig: { findFirst: mock(async () => ({ id: "cfg-1", orgId: "org-1", orchestraLayerId: "layer-1", provider: "anthropic", modelName: "claude-sonnet-5", encryptedApiKey: "enc", isActive: true })) },
        },
        update: mockDbUpdateChain(),
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async (c: string) => c) }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = "openrouter-test-key"
    try {
      const { resolveModelConfig } = await import("./orchestra-model-resolver")
      const result = await resolveModelConfig("org-1", "customer_account_oa")
      expect(result?.provider).toBe("anthropic") // the org's own BYO choice, unchanged
      expect(result?.fallback).toBeDefined()
      expect(result?.fallback?.provider).toBe("openrouter") // never substitutes another org's key -- always the platform's own
    } finally {
      if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    }
  })
})

// ─── testProviderConnection: real connectivity check before saving ──────
// Review Framework remediation, Wave B: previously POST /api/settings/
// model-config only validated shape (provider in the enum, modelName
// non-empty) -- these tests cover the new function that actually calls the
// provider before a config is persisted, mocking globalThis.fetch the same
// way llm-client.test.ts's Anthropic cache tests already do.
describe("testProviderConnection", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test("returns ok: true when the provider accepts the test call", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 10, completion_tokens: 1 } }),
    })) as typeof fetch

    const { testProviderConnection } = await import("./orchestra-model-resolver")
    const result = await testProviderConnection("openai", "gpt-4o-mini", "sk-real-looking-key")
    expect(result.ok).toBe(true)
  })

  test("returns ok: false with the provider's error surfaced when the key is rejected (401, not retried)", async () => {
    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      return { ok: false, status: 401, text: async () => "invalid_api_key" } as Response
    }) as typeof fetch

    const { testProviderConnection } = await import("./orchestra-model-resolver")
    const result = await testProviderConnection("openai", "gpt-4o-mini", "sk-bad-key")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("401")
    expect(callCount).toBe(1) // 401 is a permanent failure -- callLLM's own retry logic must not burn retries on it
  })

  test("returns ok: false when the model name doesn't exist for that provider (404)", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => "model_not_found" })) as unknown as typeof fetch

    const { testProviderConnection } = await import("./orchestra-model-resolver")
    const result = await testProviderConnection("openai", "not-a-real-model", "sk-real-looking-key")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("404")
  })

  test("returns ok: false (not a thrown exception) on a network-level failure", async () => {
    globalThis.fetch = (async () => { throw new TypeError("fetch failed") }) as unknown as typeof fetch

    const { testProviderConnection } = await import("./orchestra-model-resolver")
    const result = await testProviderConnection("groq", "openai/gpt-oss-120b", "gsk-key")
    expect(result.ok).toBe(false)
  })

  test("never echoes the API key back in the error message", async () => {
    const secretKey = "sk-super-secret-do-not-leak-123456"
    globalThis.fetch = (async () => ({ ok: false, status: 401, text: async () => "invalid_api_key" })) as unknown as typeof fetch

    const { testProviderConnection } = await import("./orchestra-model-resolver")
    const result = await testProviderConnection("openai", "gpt-4o-mini", secretKey)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain(secretKey)
  })
})

// ─── End-to-end: a BYO org's provider failing at CALL time actually
// degrades to the platform default, not just a config field sitting unused
// ─────────────────────────────────────────────────────────────────────────
// This is the test the dispatch brief explicitly asked for: proof that
// resolveModelConfig()'s `fallback` field (populated by platformFallbackFor
// for every customer-configured resolution) is really honored by callLLM()
// when the org's own configured provider fails, not just a value that looks
// right in isolation. Mocks fetch by URL so the "primary" (Anthropic) call
// fails and the "fallback" (OpenRouter) call succeeds, then drives the
// exact two functions in sequence a real Orchestra Layer call site does:
// resolveModelConfig() to get the config, then callLLM() with its
// `.fallback` passed through.
describe("BYO failure -> platform-default fallback (end-to-end, resolver + llm-client)", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test("when the org's own BYO provider fails, the call transparently succeeds via the platform-default fallback instead of throwing", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "groq", model: "openai/gpt-oss-120b" } })) },
          customerModelConfig: { findFirst: mock(async () => ({
            id: "cfg-1", orgId: "org-1", orchestraLayerId: "layer-1",
            provider: "anthropic", modelName: "claude-sonnet-5",
            encryptedApiKey: "enc-bad-key", isActive: true,
          })) },
        },
        update: mockDbUpdateChain(),
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async () => "expired-anthropic-key") }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = "openrouter-live-key"
    try {
      const { resolveModelConfig } = await import("./orchestra-model-resolver")
      const { callLLM } = await import("./llm-client")

      const resolved = await resolveModelConfig("org-1", "customer_account_oa")
      expect(resolved).not.toBeNull()
      expect(resolved!.provider).toBe("anthropic")
      expect(resolved!.fallback).toBeDefined()

      // The org's own Anthropic key is expired (401, permanent -- no
      // retries burned); the platform's OpenRouter fallback succeeds.
      globalThis.fetch = (async (url: string) => {
        if (url.includes("anthropic.com")) {
          return { ok: false, status: 401, text: async () => "expired API key" } as Response
        }
        if (url.includes("openrouter.ai")) {
          return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: "fallback response" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
          } as Response
        }
        throw new Error(`unexpected fetch to ${url}`)
      }) as typeof fetch

      const result = await callLLM(resolved!.provider, resolved!.model, resolved!.apiKey, "system prompt", "user message", undefined, resolved!.fallback)
      expect(result.content).toBe("fallback response") // came from the fallback, the primary never succeeded
    } finally {
      if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    }
  })

  test("without a fallback (e.g. no OPENROUTER_API_KEY configured), the same primary failure throws instead of silently degrading", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          orchestraLayers: { findFirst: mock(async () => ({ id: "layer-1", layerKey: "customer_account_oa", defaultModelConfig: { provider: "groq", model: "openai/gpt-oss-120b" } })) },
          customerModelConfig: { findFirst: mock(async () => ({
            id: "cfg-1", orgId: "org-1", orchestraLayerId: "layer-1",
            provider: "anthropic", modelName: "claude-sonnet-5",
            encryptedApiKey: "enc-bad-key", isActive: true,
          })) },
        },
        update: mockDbUpdateChain(),
      },
      orchestraLayers: {}, customerModelConfig: {}, clientModelConfig: {}, sharedPoolAllocations: {},
    }))
    mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(async () => "expired-anthropic-key") }))
    mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))

    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    try {
      const { resolveModelConfig } = await import("./orchestra-model-resolver")
      const { callLLM } = await import("./llm-client")

      const resolved = await resolveModelConfig("org-1", "customer_account_oa")
      expect(resolved!.fallback).toBeUndefined() // nothing sensible to fall back to -- honestly absent, not fabricated

      globalThis.fetch = (async () => ({ ok: false, status: 401, text: async () => "expired API key" })) as unknown as typeof fetch

      await expect(
        callLLM(resolved!.provider, resolved!.model, resolved!.apiKey, "system prompt", "user message", undefined, resolved!.fallback)
      ).rejects.toThrow()
    } finally {
      if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    }
  })
})
