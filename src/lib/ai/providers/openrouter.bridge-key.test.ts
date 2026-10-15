// Audit 100 A4/A14/A34: with the test-mode AI bridge on (AI_BRIDGE=queue), Level 1 through the openrouter provider must not need a paid
// OpenRouter key -- the bridge answers before any key is read. Without the bridge the key is still required, exactly as before.
// Run: bun test --isolate src/lib/ai/providers/openrouter.bridge-key.test.ts
import { describe, test, expect, afterEach, mock } from "bun:test"

const calls: { apiKey: string }[] = []
mock.module("@/lib/llm-client", () => ({
  callLLMJson: async (_p: string, _m: string, apiKey: string) => {
    calls.push({ apiKey })
    return { data: { results: [{ functionId: "list_projects", params: {}, missingParams: [], confidence: 0.9, unmappedIntent: null }] } }
  },
}))
mock.module("@/lib/ai/level-model-registry", () => ({ resolvePipelineModel: async (_l: string, fallback: string) => fallback }))

const { openrouterProvider, requireApiKey, BRIDGE_NO_KEY } = await import("./openrouter")

const saved = { bridge: process.env.AI_BRIDGE, key: process.env.OPENROUTER_API_KEY }
afterEach(() => {
  calls.length = 0
  if (saved.bridge === undefined) delete process.env.AI_BRIDGE
  else process.env.AI_BRIDGE = saved.bridge
  if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = saved.key
})

describe("openrouter provider key under the AI bridge", () => {
  test("bridge on, no paid key: Level 1 still classifies, and the placeholder (never a real key) is what reaches the caller", async () => {
    process.env.AI_BRIDGE = "queue"
    delete process.env.OPENROUTER_API_KEY
    const out = await openrouterProvider.classify(["list my projects"], ["list_projects"], { orgId: "o" })
    expect(out[0].functionId).toBe("list_projects")
    expect(calls).toEqual([{ apiKey: BRIDGE_NO_KEY }])
  })

  test("bridge on with a paid key present: the paid key is still not handed out", () => {
    process.env.AI_BRIDGE = "queue"
    process.env.OPENROUTER_API_KEY = "sk-or-real-looking"
    expect(requireApiKey()).toBe(BRIDGE_NO_KEY)
  })

  test("bridge off: the key is required, as before", () => {
    delete process.env.AI_BRIDGE
    delete process.env.OPENROUTER_API_KEY
    expect(() => requireApiKey()).toThrow("OPENROUTER_API_KEY is not set")
    process.env.OPENROUTER_API_KEY = "sk-or-x"
    expect(requireApiKey()).toBe("sk-or-x")
  })

  test("only the exact value 'queue' turns the bridge on", () => {
    process.env.AI_BRIDGE = "QUEUE"
    delete process.env.OPENROUTER_API_KEY
    expect(() => requireApiKey()).toThrow("OPENROUTER_API_KEY is not set")
  })
})
