/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-portability pure unit tests.
import { describe, expect, test } from "bun:test"
import { adaptPromptForAllProviders, adaptPromptForProvider } from "./prompt-portability"

describe("adaptPromptForProvider", () => {
  test("OpenAI-compatible providers get a messages array with a system role", () => {
    const req = adaptPromptForProvider("openai", "You are helpful.", "Hello")
    expect(req.provider).toBe("openai")
    if (req.provider === "openai" || req.provider === "groq" || req.provider === "openrouter" || req.provider === "cerebras") {
      expect(req.messages).toEqual([{ role: "system", content: "You are helpful." }, { role: "user", content: "Hello" }])
    }
  })

  test("Anthropic splits system out of the messages array", () => {
    const req = adaptPromptForProvider("anthropic", "You are helpful.", "Hello")
    expect(req.provider).toBe("anthropic")
    if (req.provider === "anthropic") {
      expect(req.system).toBe("You are helpful.")
      expect(req.messages).toEqual([{ role: "user", content: "Hello" }])
    }
  })

  test("Google uses systemInstruction + contents/parts", () => {
    const req = adaptPromptForProvider("google", "You are helpful.", "Hello")
    expect(req.provider).toBe("google")
    if (req.provider === "google") {
      expect(req.systemInstruction).toBe("You are helpful.")
      expect(req.contents).toEqual([{ role: "user", parts: [{ text: "Hello" }] }])
    }
  })

  test("an empty system prompt is omitted, not sent as an empty string", () => {
    const req = adaptPromptForProvider("openai", "", "Hello")
    if (req.provider === "openai" || req.provider === "groq" || req.provider === "openrouter" || req.provider === "cerebras") {
      expect(req.messages).toEqual([{ role: "user", content: "Hello" }])
    }
  })
})

describe("adaptPromptForAllProviders", () => {
  test("returns one adapted request per requested provider", () => {
    const all = adaptPromptForAllProviders(["openai", "anthropic", "google"], "sys", "hi")
    expect(Object.keys(all).sort()).toEqual(["anthropic", "google", "openai"])
  })
})
