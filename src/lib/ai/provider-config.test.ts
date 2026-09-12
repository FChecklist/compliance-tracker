/// <reference types="bun-types" />
import { describe, expect, test, afterEach } from "bun:test";
import { resolveAllowedProviders, resolveProviderForLevel, UnknownAiProviderError } from "./provider-config";

const ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_PROVIDER_PIPELINE_L2", "AI_ALLOWED_PROVIDERS"] as const;
const ORIGINAL = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

function clearAll() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("resolveProviderForLevel -- dev/prod default and per-level override (P1.1)", () => {
  test("dev default: no config at all resolves to claude-cli for every level", () => {
    clearAll();
    expect(resolveProviderForLevel("pipeline_l1")).toBe("claude-cli");
    expect(resolveProviderForLevel("pipeline_l2")).toBe("claude-cli");
  });

  test("prod default: AI_PROVIDER=openrouter applies to every level with no override", () => {
    clearAll();
    process.env.AI_PROVIDER = "openrouter";
    expect(resolveProviderForLevel("pipeline_l1")).toBe("openrouter");
    expect(resolveProviderForLevel("pipeline_l2")).toBe("openrouter");
  });

  test("per-level override: AI_PROVIDER_PIPELINE_L1 wins over the global default for L1 only", () => {
    clearAll();
    process.env.AI_PROVIDER = "openrouter"; // global/prod default
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli"; // e.g. dev testing L1 only
    expect(resolveProviderForLevel("pipeline_l1")).toBe("claude-cli");
    expect(resolveProviderForLevel("pipeline_l2")).toBe("openrouter"); // untouched by L1's override
  });

  test("per-level override: AI_PROVIDER_PIPELINE_L2 wins over the global default for L2 only", () => {
    clearAll();
    process.env.AI_PROVIDER = "claude-cli";
    process.env.AI_PROVIDER_PIPELINE_L2 = "openrouter"; // L2 can never actually run under claude-cli anyway (see adapter.test.ts), but resolution itself must still honor the override
    expect(resolveProviderForLevel("pipeline_l1")).toBe("claude-cli");
    expect(resolveProviderForLevel("pipeline_l2")).toBe("openrouter");
  });

  test("a disallowed provider is refused even if it is a syntactically known provider name", () => {
    clearAll();
    process.env.AI_ALLOWED_PROVIDERS = "openrouter"; // claude-cli deliberately excluded
    process.env.AI_PROVIDER = "claude-cli";
    expect(() => resolveProviderForLevel("pipeline_l1")).toThrow(UnknownAiProviderError);
  });

  test("a disallowed per-level override is refused the same way as a disallowed global default", () => {
    clearAll();
    process.env.AI_ALLOWED_PROVIDERS = "claude-cli";
    process.env.AI_PROVIDER = "claude-cli";
    process.env.AI_PROVIDER_PIPELINE_L2 = "openrouter"; // not on the allowlist
    expect(() => resolveProviderForLevel("pipeline_l2")).toThrow(UnknownAiProviderError);
  });

  test("*** no path returns an unlisted/arbitrary provider silently *** -- an unknown value throws rather than passing through", () => {
    clearAll();
    process.env.AI_PROVIDER = "some-unlisted-provider";
    expect(() => resolveProviderForLevel("pipeline_l1")).toThrow(UnknownAiProviderError);
  });

  test("an unknown per-level override value throws rather than silently falling back to the global default", () => {
    clearAll();
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_PROVIDER_PIPELINE_L1 = "totally-not-a-provider";
    expect(() => resolveProviderForLevel("pipeline_l1")).toThrow(UnknownAiProviderError);
  });
});

describe("resolveAllowedProviders -- the config-driven provider allowlist (P1.1)", () => {
  test("defaults to both known providers when unset", () => {
    clearAll();
    expect(resolveAllowedProviders().sort()).toEqual(["claude-cli", "openrouter"]);
  });

  test("a configured allowlist narrows the set", () => {
    clearAll();
    process.env.AI_ALLOWED_PROVIDERS = "openrouter";
    expect(resolveAllowedProviders()).toEqual(["openrouter"]);
  });

  test("an allowlist naming an unknown provider throws rather than silently ignoring the bad entry", () => {
    clearAll();
    process.env.AI_ALLOWED_PROVIDERS = "openrouter, some-typo";
    expect(() => resolveAllowedProviders()).toThrow(UnknownAiProviderError);
  });

  test("an empty AI_ALLOWED_PROVIDERS string throws rather than silently allowing everything", () => {
    clearAll();
    process.env.AI_ALLOWED_PROVIDERS = "   ";
    expect(() => resolveAllowedProviders()).toThrow(UnknownAiProviderError);
  });
});
