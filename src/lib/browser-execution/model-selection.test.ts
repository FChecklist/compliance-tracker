import { describe, expect, test } from "bun:test";
import { needsRefinement, planTierOrder } from "./model-selection";
import type { BrowserCapabilityReport } from "./types";

const ALL_AVAILABLE: BrowserCapabilityReport = {
  npu: { tier: "npu", available: true, reason: "x" },
  builtinAi: { tier: "builtin-ai", available: true, reason: "x" },
  webgpu: { tier: "lite-llm", available: true, reason: "x" },
  liteLlm: { tier: "lite-llm", available: true, reason: "x" },
  transformers: { tier: "transformers", available: true, reason: "x" },
  server: { tier: "server", available: true, reason: "x" },
  detectedAt: 0,
};

const NONE_AVAILABLE: BrowserCapabilityReport = {
  npu: { tier: "npu", available: false, reason: "x" },
  builtinAi: { tier: "builtin-ai", available: false, reason: "x" },
  webgpu: { tier: "lite-llm", available: false, reason: "x" },
  liteLlm: { tier: "lite-llm", available: false, reason: "x" },
  transformers: { tier: "transformers", available: true, reason: "x" }, // always available (WASM)
  server: { tier: "server", available: true, reason: "x" },
  detectedAt: 0,
};

describe("needsRefinement", () => {
  test("false when verification passed with high confidence", () => {
    expect(needsRefinement({ allPassed: true, confidence: { composite: 0.9 } })).toBe(false);
  });
  test("true when verification failed even at high confidence", () => {
    expect(needsRefinement({ allPassed: false, confidence: { composite: 0.9 } })).toBe(true);
  });
  test("true when confidence is below the threshold even if allPassed", () => {
    expect(needsRefinement({ allPassed: true, confidence: { composite: 0.3 } })).toBe(true);
  });
});

describe("planTierOrder", () => {
  test("judgment tier always goes straight to server, regardless of capabilities", () => {
    expect(planTierOrder({ complexityTier: "judgment", reason: "x" }, ALL_AVAILABLE)).toEqual(["server"]);
  });

  test("mechanical tier with everything available tries every local tier before server", () => {
    expect(planTierOrder({ complexityTier: "mechanical", reason: "x" }, ALL_AVAILABLE)).toEqual([
      "npu", "builtin-ai", "lite-llm", "transformers", "server",
    ]);
  });

  test("integrative tier skips the transformers classification-only pass", () => {
    expect(planTierOrder({ complexityTier: "integrative", reason: "x" }, ALL_AVAILABLE)).toEqual([
      "npu", "builtin-ai", "lite-llm", "server",
    ]);
  });

  test("mechanical tier with nothing available falls straight to server (still always terminates)", () => {
    expect(planTierOrder({ complexityTier: "mechanical", reason: "x" }, NONE_AVAILABLE)).toEqual([
      "transformers", "server",
    ]);
  });
});
