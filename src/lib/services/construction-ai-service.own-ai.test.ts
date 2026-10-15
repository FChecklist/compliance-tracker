/// <reference types="bun-types" />
// Discuss with "Connect your AI": a person's own AI, one a teammate shared, or the organisation's answers the chat even while PROJEXA's own AI is
// OFF; the call uses THAT key, never the owner-laptop test bridge, and the model is told what PROJEXA is. With nothing connected and our AI off the
// answer is the plain "use your own AI" sentence and no model is called. Faked: the lookup, the model call and the policy/prompt/log helpers.
// Run: bun test --isolate src/lib/services/construction-ai-service.own-ai.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

let own: { source: string; provider: string; model: string; apiKey: string } | null = null
const llmCalls: Array<{ provider: string; model: string; key: string; system: string; options: Record<string, unknown> }> = []
mock.module("@/lib/ai/org-own-ai", () => ({ resolveAiFor: async () => own }))
const realLlm = await import("@/lib/llm-client")
mock.module("@/lib/llm-client", () => ({
  ...realLlm,
  callLLM: async (provider: string, model: string, key: string, system: string, _msg: string, options: Record<string, unknown>) => {
    llmCalls.push({ provider, model, key, system, options })
    return { content: "Answer from the customer's AI", usage: { promptTokens: 1, completionTokens: 1 } }
  },
}))
mock.module("@/lib/prompt-os-resolver", () => ({ resolvePromptTemplate: async () => "BASE DISCUSS PROMPT." }))
mock.module("@/lib/orchestra-execution-logger", () => ({ recordOrchestraExecution: () => {} }))
mock.module("@/lib/policy-enforcement-engine", () => ({ enforcePolicy: () => ({ allowed: true }), refusalMessageFor: () => "refused" }))
mock.module("@/lib/orchestra-model-resolver", () => ({ resolveModelConfig: async () => { throw new Error("must not be asked when the person has their own AI") } }))
const { discussConstruction } = await import("./construction-ai-service")
const { USE_YOUR_OWN_AI } = await import("@/lib/projexa-internal-ai")

const saved = process.env.PROJEXA_INTERNAL_AI_ENABLED
afterAll(() => { if (saved === undefined) delete process.env.PROJEXA_INTERNAL_AI_ENABLED; else process.env.PROJEXA_INTERNAL_AI_ENABLED = saved })
beforeEach(() => { own = null; llmCalls.length = 0; delete process.env.PROJEXA_INTERNAL_AI_ENABLED })

describe("Discuss with a connected AI", () => {
  test("own AI connected, PROJEXA's own AI off: the person's key is used, the bridge is bypassed, the model is briefed", async () => {
    own = { source: "shared", provider: "anthropic", model: "claude-haiku-5-5", apiKey: "fake-shared-key-1111" }
    const out = await discussConstruction({ orgId: "org-1", userId: "bala" }, "hello")
    expect(out.reply).toBe("Answer from the customer's AI")
    expect(llmCalls).toHaveLength(1)
    expect(llmCalls[0]).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", key: "fake-shared-key-1111" })
    expect(llmCalls[0]!.options.bypassBridge).toBe(true)
    expect(llmCalls[0]!.system).toContain("construction project-management software")
    expect(llmCalls[0]!.system).toContain("not accounting or financial software")
    expect(llmCalls[0]!.system).toContain("BASE DISCUSS PROMPT.")
  })
  test("nothing connected and PROJEXA's own AI off: the plain sentence, no model call", async () => {
    expect(await discussConstruction({ orgId: "org-1", userId: "bala" }, "hello")).toEqual({ reply: USE_YOUR_OWN_AI })
    expect(llmCalls).toHaveLength(0)
  })
})
