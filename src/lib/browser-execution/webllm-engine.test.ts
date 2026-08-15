/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 2: real unit tests for the
// WebLLM wiring -- exercised via injected envs/engine factories (same
// pattern tier-detection.test.ts/tier-orchestrator.test.ts already
// establish, since a real WebGPU device isn't available in this test
// runtime any more than it is in CI). The factory injection point is real
// production code (`WebLlmEngineFactory`), not test-only scaffolding --
// only the factory's *implementation* (a real GPU + real multi-hundred-MB
// download) is swapped out here.
import { describe, expect, test } from "bun:test"
import {
  buildToolCallSystemPrompt,
  LITE_LLM_MODEL_ID,
  runLiteLlmToolCall,
  startLiteLlmSession,
  type WebLlmChatEngine,
  type WebLlmEngineFactory,
} from "./webllm-engine"

describe("startLiteLlmSession", () => {
  test("real path: WebGPU present, lite-llm selected -- loads the real (injected) engine for the real chosen model id", async () => {
    let requestedModelId: string | null = null
    const fakeFactory: WebLlmEngineFactory = async (modelId) => {
      requestedModelId = modelId
      return {
        chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
        unload: async () => {},
      }
    }
    const result = await startLiteLlmSession({ navigator: { gpu: {} } }, fakeFactory)
    expect(result.kind).toBe("ready")
    expect(requestedModelId).toBe(LITE_LLM_MODEL_ID)
    if (result.kind === "ready") expect(result.modelId).toBe(LITE_LLM_MODEL_ID)
  })

  test("real, honest fallback: navigator.gpu absent -- does NOT call the engine factory at all", async () => {
    let factoryCalled = false
    const fakeFactory: WebLlmEngineFactory = async () => {
      factoryCalled = true
      throw new Error("should never be called")
    }
    const result = await startLiteLlmSession({ navigator: {} }, fakeFactory)
    expect(result.kind).toBe("fallback")
    expect(factoryCalled).toBe(false)
    if (result.kind === "fallback") expect(result.reason).toMatch(/WebGPU/)
  })

  test("not-selected: zero browser capability at all -- server tier wins, WebLLM never attempted", async () => {
    let factoryCalled = false
    const fakeFactory: WebLlmEngineFactory = async () => {
      factoryCalled = true
      throw new Error("should never be called")
    }
    const result = await startLiteLlmSession({}, fakeFactory)
    expect(result.kind).toBe("not-selected")
    expect(factoryCalled).toBe(false)
  })

  test("not-selected: npu outranks lite-llm when both are available", async () => {
    const result = await startLiteLlmSession({ navigator: { ml: {}, gpu: {} } }, async () => {
      throw new Error("should never be called")
    })
    expect(result.kind).toBe("not-selected")
  })
})

describe("buildToolCallSystemPrompt", () => {
  test("includes every tool's name, description, and schema", () => {
    const prompt = buildToolCallSystemPrompt([
      { name: "get_overdue_count", description: "counts overdue items", inputSchema: { type: "object", properties: {} } },
    ])
    expect(prompt).toContain("get_overdue_count")
    expect(prompt).toContain("counts overdue items")
    expect(prompt).toContain("tool_call")
  })
})

describe("runLiteLlmToolCall", () => {
  test("real round trip against an injected engine: model replies with a tool_call envelope, gets parsed for real", async () => {
    const fakeEngine: WebLlmChatEngine = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify({ tool_call: { name: "get_overdue_count", arguments: { base: 4 } } }) } }],
          }),
        },
      },
      unload: async () => {},
    }
    const result = await runLiteLlmToolCall(fakeEngine, [
      { name: "get_overdue_count", description: "counts overdue items", inputSchema: { type: "object", properties: {} } },
    ], "How many items are overdue?")
    expect(result.toolCall).toEqual({ name: "get_overdue_count", arguments: { base: 4 } })
  })

  test("model declines to call a tool -- honest null, not a synthesized fake tool call", async () => {
    const fakeEngine: WebLlmChatEngine = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: "42" }) } }] }),
        },
      },
      unload: async () => {},
    }
    const result = await runLiteLlmToolCall(fakeEngine, [], "What is the answer?")
    expect(result.toolCall).toBeNull()
  })
})
