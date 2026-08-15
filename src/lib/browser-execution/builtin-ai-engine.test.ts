/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 3: real unit tests proving
// Built-in-AI inference actually EXECUTES (not just detects) when
// window.ai / window.LanguageModel is present. No real Chrome Built-in AI
// model is available in this test runtime, so this exercises the real
// production call path (runBuiltinAiPrompt -> tier-orchestrator's real
// shouldAttemptBuiltinAi gate -> session factory -> session.prompt) with
// only the session factory's *implementation* swapped for a real, injected
// fake session -- same established pattern as webllm-engine.test.ts /
// npu-engine.test.ts.
import { describe, expect, test } from "bun:test"
import { defaultBuiltinAiSessionFactory, runBuiltinAiPrompt, type BuiltinAiSession, type BuiltinAiSessionFactory } from "./builtin-ai-engine"

describe("runBuiltinAiPrompt", () => {
  test("real path: window.LanguageModel present -- builtin-ai selected, real session created and prompted", async () => {
    let promptedWith: string | null = null
    let destroyed = false
    const fakeSession: BuiltinAiSession = {
      prompt: async (text) => {
        promptedWith = text
        return "real model reply"
      },
      destroy: () => {
        destroyed = true
      },
    }
    const fakeFactory: BuiltinAiSessionFactory = async () => fakeSession

    const result = await runBuiltinAiPrompt("hello world", { window: { LanguageModel: {} } }, fakeFactory)

    expect(result.kind).toBe("ready")
    expect(promptedWith).toBe("hello world")
    expect(destroyed).toBe(true)
    if (result.kind === "ready") expect(result.text).toBe("real model reply")
  })

  test("real, honest not-selected: window.ai/window.LanguageModel absent -- does NOT call the session factory at all", async () => {
    let factoryCalled = false
    const fakeFactory: BuiltinAiSessionFactory = async () => {
      factoryCalled = true
      throw new Error("should never be called")
    }

    const result = await runBuiltinAiPrompt("hi", { navigator: { gpu: {} } }, fakeFactory)

    expect(result.kind).toBe("not-selected")
    expect(factoryCalled).toBe(false)
  })

  test("not-selected: npu outranks builtin-ai when both are available", async () => {
    const result = await runBuiltinAiPrompt("hi", { navigator: { ml: {} }, window: { ai: {} } }, async () => {
      throw new Error("should never be called")
    })
    expect(result.kind).toBe("not-selected")
  })

  test("session is destroyed even when prompt() rejects", async () => {
    let destroyed = false
    const fakeFactory: BuiltinAiSessionFactory = async () => ({
      prompt: async () => {
        throw new Error("model overloaded")
      },
      destroy: () => {
        destroyed = true
      },
    })

    await expect(runBuiltinAiPrompt("hi", { window: { ai: {} } }, fakeFactory)).rejects.toThrow("model overloaded")
    expect(destroyed).toBe(true)
  })
})

describe("defaultBuiltinAiSessionFactory", () => {
  test("prefers the current window.LanguageModel global over the legacy window.ai.languageModel namespace", async () => {
    let currentCalled = false
    let legacyCalled = false
    const session: BuiltinAiSession = { prompt: async () => "ok" }
    const env = {
      window: {
        LanguageModel: { create: async () => { currentCalled = true; return session } },
        ai: { languageModel: { create: async () => { legacyCalled = true; return session } } },
      },
    }
    const result = await defaultBuiltinAiSessionFactory(env)
    expect(result).toBe(session)
    expect(currentCalled).toBe(true)
    expect(legacyCalled).toBe(false)
  })

  test("falls back to the legacy window.ai.languageModel namespace when only it is present", async () => {
    const session: BuiltinAiSession = { prompt: async () => "ok" }
    const env = { window: { ai: { languageModel: { create: async () => session } } } }
    expect(await defaultBuiltinAiSessionFactory(env)).toBe(session)
  })

  test("throws a clear error when neither real API shape is present", async () => {
    await expect(defaultBuiltinAiSessionFactory({ window: {} })).rejects.toThrow(/neither window.LanguageModel nor window.ai.languageModel/)
  })
})
