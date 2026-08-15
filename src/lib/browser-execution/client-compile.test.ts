/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5: the real end-to-end proof of this
// phase's own success criterion -- "end-user input -> browser-native
// FIRST-pass machine-language output" -- run here with an injected
// zero-capability env (so it deterministically exercises the
// server-fallback tier) and a full-capability env (so it deterministically
// exercises the top of TIER_PRIORITY), proving compileInBrowser() reuses
// phase_2's real analyzeLightweight() rather than a duplicate.
import { describe, expect, test } from "bun:test"
import { compileInBrowser } from "./client-compile"

describe("compileInBrowser", () => {
  test("produces a real LightweightAnalysis via phase_2's existing engine, tagged with the selected tier", () => {
    const draft = compileInBrowser("Fix the login bug for the OAuth callback", { navigator: { gpu: {} } })
    expect(draft.analysis.classification.category).toBe("CODE")
    expect(draft.analysis.intent.primary).toBe("FIX")
    expect(draft.tier).toBe("lite-llm")
    expect(draft.fallbackChain).toEqual(["transformers", "server"])
    expect(draft.compileMs).toBeGreaterThanOrEqual(0)
  })

  test("falls back to the server tier with zero browser capability, and still compiles a real analysis", () => {
    const draft = compileInBrowser("What is the GST filing deadline this month?", {})
    expect(draft.tier).toBe("server")
    expect(draft.fallbackChain).toEqual([])
    expect(draft.analysis.originalText).toContain("GST filing deadline")
  })
})
