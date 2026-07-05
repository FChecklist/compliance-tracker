// Wave 79: regression test for Wave 23's token-cost estimation -- pure
// math, no network/DB, cheap to get exactly right and easy to silently
// break (e.g. a units mix-up between per-1k and per-token pricing).
import { describe, expect, test } from "bun:test"
import { estimateCostUsd } from "./llm-client"

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
