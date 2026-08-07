/// <reference types="bun-types" />
// Gap closure, 2026-08-07 (VERIDIAN Review Framework, Cache & Synchronization
// / "Cache Integrity & Security"): this module had zero test coverage
// before. Covers the two behaviors this wave changed: (1) content is
// encrypted at rest via ai-config-crypto's pgcrypto helpers -- what
// db.insert/db.update actually receive is ciphertext, never the plaintext
// LLM answer, and a decrypted hit returns the original plaintext to the
// caller; (2) an undecryptable row (legacy plaintext, rotated key, or
// corrupt ciphertext) is treated as a cache miss, not a thrown error, and
// gets overwritten with a freshly encrypted value; (3) `ttlMs` is honored
// per-call instead of the module's fixed 24h constant.
// Mocks @/lib/db and @/lib/ai-config-crypto, matching
// org-branding-service.test.ts's established pattern for this class of
// dependency (never touching a live DB or pgcrypto from a .test.ts file).
// @/lib/llm-client is deliberately NEVER passed to mock.module() here --
// llm-client.test.ts tests that module's REAL implementation directly via
// a static top-level `import { callLLM } from "./llm-client"`, and a
// mock.restore()-in-afterEach "capture real module, restore it" pattern
// (tenant-isolation.test.ts's own established convention, PR #434) was
// tried here first and did NOT hold on CI's real file-discovery order --
// llm-client.test.ts's own static import still resolved to this file's
// stale mocked callLLM 4 times in a row, breaking its real Anthropic
// prompt-caching assertions (confirmed live in CI, unreproducible locally
// where file order differs; mock.module() replaces bun's process-wide
// module registry entry, and restoring it later doesn't reliably un-leak
// an already-bound static import elsewhere). Fixed instead by mocking
// globalThis.fetch directly (llm-client.test.ts's own established pattern
// for exercising callLLM's REAL code against a fake HTTP response) --
// callLLM runs for real, unmocked, so there is no module-registry mutation
// at all for this dependency, eliminating the leak vector rather than
// chasing it.
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"

const realFetch = globalThis.fetch

/** Fakes the OpenAI-compatible-provider HTTP response callLLM's groq branch expects (callOpenAICompatible's `data.choices[0].message.content` / `data.usage.{prompt,completion}_tokens` shape). */
function mockLlmFetch(content: string, usage: { promptTokens: number; completionTokens: number } = { promptTokens: 10, completionTokens: 5 }) {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens },
    }),
  })) as typeof fetch
}

function mockDbUpdateChain(spy: (values: unknown) => void) {
  const chain = {
    set: mock((values: unknown) => {
      spy(values)
      return chain
    }),
    where: mock(() => Promise.resolve(undefined)),
  }
  return mock(() => chain)
}

function mockDbInsertChain(spy: (values: unknown) => void, shouldThrow = false) {
  const chain = {
    values: mock((values: unknown) => {
      spy(values)
      if (shouldThrow) return Promise.reject(new Error("insert failed"))
      return Promise.resolve(undefined)
    }),
  }
  return mock(() => chain)
}

function setupMocks(opts: {
  hit?: { content: string; promptTokens: number; completionTokens: number; expiresAt: Date } | null
  decrypt?: (ciphertext: string) => Promise<string>
  encrypt?: (plaintext: string) => Promise<string>
  onUpdate?: (values: unknown) => void
  onInsert?: (values: unknown) => void
  insertThrows?: boolean
}) {
  mock.module("@/lib/db", () => ({
    db: {
      query: { llmResponseCache: { findFirst: mock(async () => opts.hit ?? null) } },
      update: mockDbUpdateChain(opts.onUpdate ?? (() => {})),
      insert: mockDbInsertChain(opts.onInsert ?? (() => {}), opts.insertThrows),
    },
    llmResponseCache: {},
  }))
  mock.module("@/lib/ai-config-crypto", () => ({
    encryptApiKey: mock(opts.encrypt ?? (async (plaintext: string) => `enc:${plaintext}`)),
    decryptApiKey: mock(opts.decrypt ?? (async (ciphertext: string) => ciphertext.replace(/^enc:/, ""))),
  }))
  mockLlmFetch("fresh answer")
}

beforeEach(() => {
  mock.restore()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("callLLMCached -- encryption at rest", () => {
  test("a cache miss writes ENCRYPTED content to the DB, not the plaintext LLM answer", async () => {
    let inserted: any = null
    setupMocks({ hit: null, onInsert: (v) => (inserted = v) })
    const { callLLMCached } = await import("./llm-response-cache")

    const result = await callLLMCached({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user")

    expect(result.cached).toBe(false)
    expect(result.content).toBe("fresh answer")
    expect(inserted).not.toBeNull()
    expect(inserted.content).toBe("enc:fresh answer")
    expect(inserted.content).not.toBe("fresh answer")
  })

  test("a live, decryptable hit is decrypted back to plaintext for the caller", async () => {
    setupMocks({
      hit: { content: "enc:cached answer", promptTokens: 3, completionTokens: 2, expiresAt: new Date(Date.now() + 60_000) },
    })
    const { callLLMCached } = await import("./llm-response-cache")

    const result = await callLLMCached({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user")

    expect(result.cached).toBe(true)
    expect(result.content).toBe("cached answer")
  })

  test("an undecryptable row (legacy plaintext / rotated key) is treated as a MISS, not a thrown error, and gets overwritten", async () => {
    let updated: any = null
    setupMocks({
      hit: { content: "plaintext-from-before-this-wave", promptTokens: 1, completionTokens: 1, expiresAt: new Date(Date.now() + 60_000) },
      decrypt: async () => {
        throw new Error("not valid pgp data")
      },
      onUpdate: (v) => (updated = v),
    })
    const { callLLMCached } = await import("./llm-response-cache")

    const result = await callLLMCached({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user")

    expect(result.cached).toBe(false)
    expect(result.content).toBe("fresh answer")
    expect(updated).not.toBeNull()
    expect(updated.content).toBe("enc:fresh answer")
  })

  test("an expired row is a miss even though it would otherwise decrypt fine", async () => {
    setupMocks({
      hit: { content: "enc:stale answer", promptTokens: 1, completionTokens: 1, expiresAt: new Date(Date.now() - 60_000) },
    })
    const { callLLMCached } = await import("./llm-response-cache")

    const result = await callLLMCached({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user")

    expect(result.cached).toBe(false)
    expect(result.content).toBe("fresh answer")
  })

  test("an encryption failure on write never throws -- the real LLM response still reaches the caller", async () => {
    setupMocks({
      hit: null,
      encrypt: async () => {
        throw new Error("AI_CONFIG_ENCRYPTION_KEY is not set")
      },
    })
    const { callLLMCached } = await import("./llm-response-cache")

    const result = await callLLMCached({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user")

    expect(result.cached).toBe(false)
    expect(result.content).toBe("fresh answer")
  })
})

describe("callLLMCached -- selective TTL tuning (CACHE_TTL)", () => {
  test("ttlMs defaults to CACHE_TTL.STANDARD (24h) when the caller doesn't specify one", async () => {
    let inserted: any = null
    setupMocks({ hit: null, onInsert: (v) => (inserted = v) })
    const { callLLMCached, CACHE_TTL } = await import("./llm-response-cache")

    const before = Date.now()
    await callLLMCached({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user")
    const expiresAt = new Date(inserted.expiresAt).getTime()

    expect(expiresAt).toBeGreaterThanOrEqual(before + CACHE_TTL.STANDARD)
    expect(expiresAt).toBeLessThan(before + CACHE_TTL.STANDARD + 5_000)
  })

  test("a caller-supplied ttlMs (e.g. CACHE_TTL.HIGH_VOLATILITY) overrides the default", async () => {
    let inserted: any = null
    setupMocks({ hit: null, onInsert: (v) => (inserted = v) })
    const { callLLMCached, CACHE_TTL } = await import("./llm-response-cache")

    const before = Date.now()
    await callLLMCached({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user", { ttlMs: CACHE_TTL.HIGH_VOLATILITY })
    const expiresAt = new Date(inserted.expiresAt).getTime()

    expect(expiresAt).toBeGreaterThanOrEqual(before + CACHE_TTL.HIGH_VOLATILITY)
    expect(expiresAt).toBeLessThan(before + CACHE_TTL.HIGH_VOLATILITY + 5_000)
    expect(expiresAt).toBeLessThan(before + CACHE_TTL.STANDARD)
  })
})

describe("callLLMJsonCached -- encryption + TTL parity with callLLMCached", () => {
  test("a JSON cache miss also writes encrypted content and parses the fresh JSON response", async () => {
    let inserted: any = null
    setupMocks({
      hit: null,
      onInsert: (v) => (inserted = v),
    })
    mockLlmFetch('{"answer":"ok"}', { promptTokens: 4, completionTokens: 2 })
    const { callLLMJsonCached } = await import("./llm-response-cache")

    const result = await callLLMJsonCached<{ answer: string }>({ orgId: "org-1" }, "groq", "llama-3", "key", "sys", "user")

    expect(result.cached).toBe(false)
    expect(result.data.answer).toBe("ok")
    expect(inserted.content).toBe('enc:{"answer":"ok"}')
  })
})
