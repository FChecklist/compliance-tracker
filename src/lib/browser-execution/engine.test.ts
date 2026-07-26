import { beforeEach, describe, expect, test } from "bun:test";
import { runBrowserExecutionTiers } from "./engine";
import { resetInMemoryCacheForTests } from "./storage-cache";
import type { BrowserCapabilityReport } from "./types";

beforeEach(() => resetInMemoryCacheForTests());

const BASE_INPUT = {
  business: { orgId: null, orgName: null, country: null },
  user: { userId: "u1", displayName: null, roles: [] },
  sessionMessages: [],
};

const ALL_AVAILABLE: BrowserCapabilityReport = {
  npu: { tier: "npu", available: true, reason: "x" },
  builtinAi: { tier: "builtin-ai", available: true, reason: "x" },
  webgpu: { tier: "lite-llm", available: true, reason: "x" },
  liteLlm: { tier: "lite-llm", available: true, reason: "x" },
  transformers: { tier: "transformers", available: true, reason: "x" },
  server: { tier: "server", available: true, reason: "x" },
  detectedAt: 0,
};

describe("runBrowserExecutionTiers", () => {
  test("a clear, high-confidence request never attempts any AI tier -- deterministic compiler alone", async () => {
    // Real sample verified via a scratch run of runPipeline() directly:
    // allPassed=true, confidence.composite=0.4608 (>= MIN_CONFIDENT_COMPOSITE).
    const outcome = await runBrowserExecutionTiers({ ...BASE_INPUT, rawText: "review the compliance report" });
    expect(outcome.tierUsed).toBe("deterministic");
    expect(outcome.attempts).toEqual([]);
    expect(outcome.machinePrompt.length).toBeGreaterThan(0);
    expect(outcome.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a low-confidence request tries local AI tiers in planned order, using the first that succeeds", async () => {
    // Real sample: allPassed=false, complexityTier=mechanical -- needsRefinement
    // is true regardless of the confidence threshold's exact value.
    const outcome = await runBrowserExecutionTiers(
      { ...BASE_INPUT, rawText: "What is the deployment status?" },
      {
        capabilities: ALL_AVAILABLE,
        tierRunners: {
          npu: async () => { throw new Error("npu declined") },
          "builtin-ai": async (_input, base) => ({ ...base, category: "QUERY", confidence: 0.9 }),
          "lite-llm": async () => { throw new Error("should not be reached -- builtin-ai already succeeded") },
        },
      },
    );
    expect(outcome.tierUsed).toBe("builtin-ai");
    expect(outcome.attempts.map((a) => a.tier)).toEqual(["npu", "builtin-ai"]);
    expect(outcome.attempts[0].succeeded).toBe(false);
    expect(outcome.attempts[1].succeeded).toBe(true);
  });

  test("falls all the way through to server when every local tier declines", async () => {
    const outcome = await runBrowserExecutionTiers(
      { ...BASE_INPUT, rawText: "What is the deployment status?" },
      {
        capabilities: ALL_AVAILABLE,
        tierRunners: {
          npu: async () => { throw new Error("npu declined") },
          "builtin-ai": async () => { throw new Error("builtin-ai declined") },
          "lite-llm": async () => { throw new Error("lite-llm declined") },
          transformers: async () => { throw new Error("transformers declined") },
        },
      },
    );
    expect(outcome.tierUsed).toBe("server");
    expect(outcome.attempts.map((a) => a.tier)).toEqual(["npu", "builtin-ai", "lite-llm", "transformers", "server"]);
    expect(outcome.attempts.every((a, i) => i === outcome.attempts.length - 1 ? a.succeeded : !a.succeeded)).toBe(true);
  });

  test("a permission-gated (judgment-tier) request skips every local tier and goes straight to server", async () => {
    const outcome = await runBrowserExecutionTiers(
      { ...BASE_INPUT, rawText: "Delete the staging environment" },
      { capabilities: ALL_AVAILABLE },
    );
    expect(outcome.complexityTier).toBe("judgment");
    expect(outcome.tierUsed).toBe("server");
    expect(outcome.attempts).toEqual([
      { tier: "server", attempted: true, succeeded: true, ms: 0, detail: "handed off to existing server dispatch path (unchanged) for deterministic SOFTWARE execution" },
    ]);
  });

  test("repeating the exact same request is served from cache the second time", async () => {
    const first = await runBrowserExecutionTiers({ ...BASE_INPUT, rawText: "review the compliance report" });
    expect(first.cacheHit).toBe(false);
    const second = await runBrowserExecutionTiers({ ...BASE_INPUT, rawText: "review the compliance report" });
    expect(second.cacheHit).toBe(true);
    expect(second.machinePrompt).toBe(first.machinePrompt);
  });
});
