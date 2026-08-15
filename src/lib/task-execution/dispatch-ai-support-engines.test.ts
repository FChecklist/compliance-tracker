/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchAiSupportEngines } from "./dispatch-ai-support-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchAiSupportEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchAiSupportEngines("materiality_calculator", {})).toBe(NOT_HANDLED)
  })

  test("tool_selector_engine rejects a non-array availableTools", async () => {
    expect(dispatchAiSupportEngines("tool_selector_engine", { requestedCapability: "x", availableTools: "nope" }))
      .rejects.toThrow("availableTools must be an array")
  })

  test("context_deduplicator_engine rejects a non-array lines", async () => {
    expect(dispatchAiSupportEngines("context_deduplicator_engine", { lines: "nope" })).rejects.toThrow("lines must be an array of strings")
  })

  test("context_deduplicator_engine dedupes a real array of lines", async () => {
    const result = await dispatchAiSupportEngines("context_deduplicator_engine", { lines: ["a", "a", "b"] }) as { deduplicatedLines: string[] }
    expect(result.deduplicatedLines).toEqual(["a", "b"])
  })
})
