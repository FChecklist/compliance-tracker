/// <reference types="bun-types" />
// Wave 79: regression test for Wave 23's token-cost estimation -- pure
// math, no network/DB, cheap to get exactly right and easy to silently
// break (e.g. a units mix-up between per-1k and per-token pricing).
import { describe, expect, test, afterEach } from "bun:test"
import { estimateCostUsd, callLLM } from "./llm-client"

describe("estimateCostUsd", () => {
  test("computes prompt+completion cost for a known model", () => {
    // gpt-4o-mini: promptPer1k 0.00015, completionPer1k 0.0006
    const cost = estimateCostUsd("gpt-4o-mini", { promptTokens: 1000, completionTokens: 1000 })
    expect(cost).not.toBeNull()
    expect(cost!).toBeCloseTo(0.00015 + 0.0006, 10)
  })

  test("scales linearly with token count", () => {
    const half = estimateCostUsd("gpt-4o-mini", { promptTokens: 500, completionTokens: 0 })!
    const full = estimateCostUsd("gpt-4o-mini", { promptTokens: 1000, completionTokens: 0 })!
    expect(full).toBeCloseTo(half * 2, 10)
  })

  test("returns 0 for the free OpenRouter model variant", () => {
    expect(estimateCostUsd("meta-llama/llama-3.3-70b-instruct:free", { promptTokens: 100000, completionTokens: 100000 })).toBe(0)
  })

  test("returns null for an unrecognized model rather than guessing", () => {
    expect(estimateCostUsd("some-model-nobody-registered", { promptTokens: 100, completionTokens: 100 })).toBeNull()
  })

  test("returns 0 (not null) for zero-token usage on a known model", () => {
    expect(estimateCostUsd("gpt-4o-mini", { promptTokens: 0, completionTokens: 0 })).toBe(0)
  })
})

// Prompt & Cache Management Framework, Phase 1 (2026-07-14): regression
// tests for callAnthropic's new cache_control branch. Mocks globalThis.fetch
// directly, same pattern as composio-connectors.test.ts, and restores it
// after every test so no other test file's fetch usage is affected.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function mockAnthropicFetch(usageExtra: Record<string, number> = {}) {
  let capturedBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string)
    return {
      ok: true,
      json: async () => ({
        content: [{ text: "ok" }],
        usage: { input_tokens: 5000, output_tokens: 20, ...usageExtra },
      }),
    } as Response
  }) as typeof fetch
  return () => capturedBody
}

const LONG_SYSTEM_PROMPT = "You are VERI. ".repeat(400) // well over the 3500-char floor
const SHORT_SYSTEM_PROMPT = "You are VERI."

describe("callLLM (anthropic) prompt caching", () => {
  test("sends a plain system string when enablePromptCache is not passed (pre-existing behavior, byte-identical)", async () => {
    const getBody = mockAnthropicFetch()
    await callLLM("anthropic", "claude-sonnet-5", "test-key", LONG_SYSTEM_PROMPT, "hello")
    expect(typeof getBody()!.system).toBe("string")
  })

  test("sends a cache_control content-block array when enablePromptCache is true and the prompt is above the minimum size", async () => {
    const getBody = mockAnthropicFetch({ cache_read_input_tokens: 4800, cache_creation_input_tokens: 0 })
    const result = await callLLM("anthropic", "claude-sonnet-5", "test-key", LONG_SYSTEM_PROMPT, "hello", { enablePromptCache: true })
    const system = getBody()!.system as Array<{ type: string; text: string; cache_control: { type: string } }>
    expect(Array.isArray(system)).toBe(true)
    expect(system[0].cache_control).toEqual({ type: "ephemeral" })
    expect(result.usage.cacheReadTokens).toBe(4800)
    expect(result.usage.cacheCreationTokens).toBe(0)
  })

  test("does NOT send cache_control when the prompt is below the minimum cacheable size, even if enablePromptCache is true", async () => {
    const getBody = mockAnthropicFetch()
    const result = await callLLM("anthropic", "claude-sonnet-5", "test-key", SHORT_SYSTEM_PROMPT, "hello", { enablePromptCache: true })
    expect(typeof getBody()!.system).toBe("string")
    expect(result.usage.cacheReadTokens).toBeUndefined()
    expect(result.usage.cacheCreationTokens).toBeUndefined()
  })

  test("uses double the size floor for a Haiku model", async () => {
    const getBody = mockAnthropicFetch()
    // Long enough for Sonnet's floor, not for Haiku's (2x)
    const mid = "You are VERI. ".repeat(300)
    await callLLM("anthropic", "claude-haiku-4-5-20251001", "test-key", mid, "hello", { enablePromptCache: true })
    expect(typeof getBody()!.system).toBe("string") // stayed a plain string -- floor not met for Haiku
  })
})
