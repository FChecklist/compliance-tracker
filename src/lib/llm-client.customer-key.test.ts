/// <reference types="bun-types" />
// A customer's OWN AI key (org-own-ai.ts) must reach their vendor even while PROJEXA's own AI is switched OFF and the owner-laptop test bridge is ON.
// The earlier unit tests mocked callLLM, so this is the one that proves the real transport: the switch (assertProjexaInternalAi) stops OUR spend, not
// theirs, and the bridge never answers for a key that is not ours. Falsifiability: drop the `!options?.bypassBridge` guard on the assertion, or the
// bridge condition, and the first two cases fail.
// Run: bun test --isolate src/lib/llm-client.customer-key.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { callLLM, CUSTOMER_VENDOR_ENDPOINTS } from "./llm-client"

const saved = { master: process.env.PROJEXA_INTERNAL_AI_ENABLED, bridge: process.env.AI_BRIDGE, fetch: globalThis.fetch }
const seen: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = []

beforeEach(() => {
  delete process.env.PROJEXA_INTERNAL_AI_ENABLED
  process.env.AI_BRIDGE = "queue"
  seen.length = 0
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) })
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello from the vendor" } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 })
  }) as unknown as typeof fetch
})
afterEach(() => { globalThis.fetch = saved.fetch })
afterAll(() => {
  for (const [k, v] of [["PROJEXA_INTERNAL_AI_ENABLED", saved.master], ["AI_BRIDGE", saved.bridge]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

describe("callLLM with a customer's own key", () => {
  test("PROJEXA's own AI off + test bridge on: the customer's key still reaches THEIR vendor, at the address given", async () => {
    const out = await callLLM("openai", "deepseek-flash", "customer-key", "sys", "hi", { bypassBridge: true, baseUrl: CUSTOMER_VENDOR_ENDPOINTS.deepseek })
    expect(out.content).toBe("hello from the vendor")
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe("https://api.deepseek.com/chat/completions")
    expect(seen[0]!.auth).toBe("Bearer customer-key")
    expect(seen[0]!.body.model).toBe("deepseek-flash")
  })

  test("each vendor goes to its own address", async () => {
    await callLLM("openai", "glm-5", "k", "s", "u", { bypassBridge: true, baseUrl: CUSTOMER_VENDOR_ENDPOINTS.zai })
    await callLLM("openai", "grok-4.20-0309-non-reasoning", "k", "s", "u", { bypassBridge: true, baseUrl: CUSTOMER_VENDOR_ENDPOINTS.xai })
    expect(seen.map((s) => s.url)).toEqual(["https://api.z.ai/api/paas/v4/chat/completions", "https://api.x.ai/v1/chat/completions"])
  })

  test("without the customer flag nothing changes: PROJEXA's own AI off still refuses, and no request is made", async () => {
    await expect(callLLM("openai", "m", "k", "s", "u", {})).rejects.toThrow()
    expect(seen).toHaveLength(0)
  })
})
