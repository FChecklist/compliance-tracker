/// <reference types="bun-types" />
// Sibling unit tests for src/lib/services/memory-write-attribution.ts.
//
// Pure-function scope by design: the two axes that make a write
// "AI-originated", the exact refusal, and the shape that gets persisted.
// r68-phase6-write-path.test.ts covers the same rule from the other end --
// through the real write functions, proving nothing reaches the database
// when attribution is missing.
import { describe, expect, test } from "bun:test"
import {
  assertAttributionComplete,
  buildAttributionEntry,
  isAiOriginatedWrite,
  MemoryAttributionError,
} from "./memory-write-attribution"

describe("isAiOriginatedWrite -- two independent axes", () => {
  test("changedBy.type 'AI' is sufficient on its own", () => {
    expect(isAiOriginatedWrite({ originatorType: "AI", provenanceType: "USER_CONFIRMED" })).toBe(true)
  })

  test("provenanceType 'AI_INFERRED' is sufficient on its own", () => {
    // A human saving a model's inference: the person acted, the model
    // authored. It still has to say which model.
    expect(isAiOriginatedWrite({ originatorType: "USER", provenanceType: "AI_INFERRED" })).toBe(true)
  })

  test("USER and SYSTEM writes of non-inferred content are not AI-originated", () => {
    expect(isAiOriginatedWrite({ originatorType: "USER", provenanceType: "USER_CONFIRMED" })).toBe(false)
    expect(isAiOriginatedWrite({ originatorType: "SYSTEM", provenanceType: "DATABASE_CONFIRMED" })).toBe(false)
    expect(isAiOriginatedWrite({})).toBe(false)
  })
})

describe("assertAttributionComplete", () => {
  test("returns null for a legitimately non-AI write and demands nothing", () => {
    expect(assertAttributionComplete("t", { originatorType: "USER", provenanceType: "USER_CONFIRMED" })).toBeNull()
  })

  test("returns the completed pair for a properly attributed AI write", () => {
    const result = assertAttributionComplete("t", {
      originatorType: "AI",
      modelId: "anthropic/claude-sonnet-5",
      promptHash: "sha256:abc",
    })
    expect(result).toEqual({ modelId: "anthropic/claude-sonnet-5", promptHash: "sha256:abc" })
  })

  test("trims, so a padded value is stored clean rather than stored padded", () => {
    const result = assertAttributionComplete("t", {
      originatorType: "AI",
      modelId: "  anthropic/claude-sonnet-5  ",
      promptHash: " sha256:abc ",
    })
    expect(result?.modelId).toBe("anthropic/claude-sonnet-5")
  })

  test("throws MemoryAttributionError naming BOTH missing fields", () => {
    expect(() => assertAttributionComplete("createMemoryRecord", { originatorType: "AI" })).toThrow(
      MemoryAttributionError
    )
    expect(() => assertAttributionComplete("createMemoryRecord", { originatorType: "AI" })).toThrow(
      /missing modelId and promptHash/
    )
  })

  test("half-attribution is refused in both directions", () => {
    expect(() => assertAttributionComplete("t", { originatorType: "AI", modelId: "m" })).toThrow(
      /missing promptHash/
    )
    expect(() => assertAttributionComplete("t", { originatorType: "AI", promptHash: "h" })).toThrow(
      /missing modelId/
    )
  })

  test("whitespace-only values do not count as attribution", () => {
    expect(() =>
      assertAttributionComplete("t", { originatorType: "AI", modelId: "  ", promptHash: "\t\n" })
    ).toThrow(/missing modelId and promptHash/)
  })

  test("null values do not count as attribution", () => {
    expect(() =>
      assertAttributionComplete("t", { originatorType: "AI", modelId: null, promptHash: null })
    ).toThrow(/missing modelId and promptHash/)
  })

  test("the message says WHICH axis made this an AI write, so the fix is obvious", () => {
    expect(() => assertAttributionComplete("t", { originatorType: "AI" })).toThrow(/changedBy.type is 'AI'/)
    expect(() => assertAttributionComplete("t", { provenanceType: "AI_INFERRED" })).toThrow(
      /provenanceType is 'AI_INFERRED'/
    )
  })

  test("the message names the calling function, so a stack-less log still locates it", () => {
    expect(() => assertAttributionComplete("supersedeMemoryRecord", { originatorType: "AI" })).toThrow(
      /^supersedeMemoryRecord:/
    )
  })

  test("the message cites the binding ruling rather than asserting the rule on its own authority", () => {
    expect(() => assertAttributionComplete("t", { originatorType: "AI" })).toThrow(/R-IMG-07, binding/)
  })
})

describe("buildAttributionEntry -- the persisted shape", () => {
  test("carries all four facts R-IMG-07 names: model, prompt hash, caller, chain", () => {
    const entry = buildAttributionEntry({
      originatorType: "AI",
      originatorId: "assistant-run-77",
      attribution: { modelId: "anthropic/claude-sonnet-5", promptHash: "sha256:abc" },
      chainId: "chain-1",
      at: new Date("2026-09-04T12:00:00.000Z"),
    })
    expect(entry).toEqual({
      originatorType: "AI",
      originatorId: "assistant-run-77",
      modelId: "anthropic/claude-sonnet-5",
      promptHash: "sha256:abc",
      chainId: "chain-1",
      at: "2026-09-04T12:00:00.000Z",
    })
  })

  test("a non-AI write records explicit nulls, not absent keys -- a queryable 'no model', not a hole", () => {
    const entry = buildAttributionEntry({ originatorType: "SYSTEM", attribution: null })
    expect(entry.modelId).toBeNull()
    expect(entry.promptHash).toBeNull()
    expect(entry.chainId).toBeNull()
    expect(entry.originatorId).toBeNull()
    expect(Object.keys(entry).sort()).toEqual(
      ["at", "chainId", "modelId", "originatorId", "originatorType", "promptHash"]
    )
  })

  test("timestamps in ISO 8601, matching metadata.lifecycleHistory's existing convention", () => {
    const entry = buildAttributionEntry({ originatorType: "USER", attribution: null })
    expect(typeof entry.at).toBe("string")
    expect(new Date(entry.at as string).toISOString()).toBe(entry.at)
  })
})
