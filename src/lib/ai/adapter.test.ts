/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { assertAiProviderAllowed, assertAiProviderAllowedForSystemBatch, getAiProvider, AiProviderRefusalError } from "./adapter";
import { UnknownAiProviderError } from "./provider-config";

const ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_PROVIDER_PIPELINE_L2", "AI_ALLOWED_PROVIDERS", "RAJAT_USER_ID"] as const;
const ORIGINAL = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
const ORIGINAL_AI_PROVIDER = ORIGINAL.AI_PROVIDER;
const ORIGINAL_RAJAT_USER_ID = ORIGINAL.RAJAT_USER_ID;

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe("assertAiProviderAllowed -- the M27 startup/per-request assertion", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "claude-cli";
    process.env.RAJAT_USER_ID = "rajat_user_id_123";
  });

  test("Rajat's own user id is allowed through, no throw", () => {
    expect(() => assertAiProviderAllowed("rajat_user_id_123")).not.toThrow();
  });

  test("*** THE REQUIRED PROOF: authenticating as a second user is refused ***", () => {
    expect(() => assertAiProviderAllowed("some_other_real_user_id")).toThrow(AiProviderRefusalError);
  });

  test("a second user's refusal carries a message, not a silent pass-through", () => {
    try {
      assertAiProviderAllowed("some_other_real_user_id");
      throw new Error("expected assertAiProviderAllowed to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AiProviderRefusalError);
      expect((e as Error).message.length).toBeGreaterThan(0);
    }
  });

  test("fails SAFE (refuses) when RAJAT_USER_ID is not configured at all, even for a plausible-looking id", () => {
    delete process.env.RAJAT_USER_ID;
    expect(() => assertAiProviderAllowed("anyone")).toThrow(AiProviderRefusalError);
  });

  test("empty-string userId is refused like any other non-matching id", () => {
    expect(() => assertAiProviderAllowed("")).toThrow(AiProviderRefusalError);
  });
});

describe("assertAiProviderAllowed -- openrouter has no per-user restriction", () => {
  test("any user id passes when AI_PROVIDER=openrouter, RAJAT_USER_ID irrelevant", () => {
    process.env.AI_PROVIDER = "openrouter";
    delete process.env.RAJAT_USER_ID;
    expect(() => assertAiProviderAllowed("literally_anyone")).not.toThrow();
  });
});

describe("assertAiProviderAllowedForSystemBatch -- G-01b, the L2 batch has no user to check", () => {
  test("*** THE REQUIRED PROOF: claude-cli refuses a system batch even with RAJAT_USER_ID set ***", () => {
    // This is the case the removed comment got wrong. RAJAT_USER_ID being set
    // is exactly the environment-1 configuration, where the `claude` binary
    // exists -- so "it would fail anyway for want of a binary" is false, and
    // without this gate the batch fanned every org out through a personal
    // subscription.
    process.env.AI_PROVIDER = "claude-cli";
    process.env.RAJAT_USER_ID = "rajat_user_id_123";
    expect(() => assertAiProviderAllowedForSystemBatch("l2-nightly-analyse")).toThrow(AiProviderRefusalError);
  });

  test("there is no permitted-account escape hatch: it refuses with RAJAT_USER_ID unset too", () => {
    process.env.AI_PROVIDER = "claude-cli";
    delete process.env.RAJAT_USER_ID;
    expect(() => assertAiProviderAllowedForSystemBatch("l2-nightly-analyse")).toThrow(AiProviderRefusalError);
  });

  test("openrouter runs the batch -- the refusal is about the licence, not about batches", () => {
    process.env.AI_PROVIDER = "openrouter";
    delete process.env.RAJAT_USER_ID;
    expect(() => assertAiProviderAllowedForSystemBatch("l2-nightly-analyse")).not.toThrow();
  });

  test("the refusal carries a message rather than passing silently", () => {
    process.env.AI_PROVIDER = "claude-cli";
    try {
      assertAiProviderAllowedForSystemBatch("l2-nightly-analyse");
      throw new Error("expected assertAiProviderAllowedForSystemBatch to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AiProviderRefusalError);
      expect((e as Error).message.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveProviderName (via assertAiProviderAllowed's own validation)", () => {
  test("an unknown AI_PROVIDER value throws rather than silently defaulting", () => {
    process.env.AI_PROVIDER = "some-typo-value";
    expect(() => assertAiProviderAllowed("anyone")).toThrow();
  });

  test("AI_PROVIDER unset defaults to claude-cli (today's dev-phase default, M27)", () => {
    delete process.env.AI_PROVIDER;
    process.env.RAJAT_USER_ID = "rajat_user_id_123";
    expect(() => assertAiProviderAllowed("rajat_user_id_123")).not.toThrow();
    expect(() => assertAiProviderAllowed("someone_else")).toThrow(AiProviderRefusalError);
  });
});

describe("getAiProvider -- resolves and caches per AI_PROVIDER value", () => {
  test("returns an object exposing classify() and analyse() for openrouter", () => {
    process.env.AI_PROVIDER = "openrouter";
    const provider = getAiProvider();
    expect(typeof provider.classify).toBe("function");
    expect(typeof provider.analyse).toBe("function");
  });

  test("returns an object exposing classify() and analyse() for claude-cli", () => {
    process.env.AI_PROVIDER = "claude-cli";
    const provider = getAiProvider();
    expect(typeof provider.classify).toBe("function");
    expect(typeof provider.analyse).toBe("function");
  });

  test("switching AI_PROVIDER returns a different provider object, not a stale cache", () => {
    process.env.AI_PROVIDER = "openrouter";
    const openrouter = getAiProvider();
    process.env.AI_PROVIDER = "claude-cli";
    const claudeCli = getAiProvider();
    expect(openrouter).not.toBe(claudeCli);
  });

  test("caches per (level, provider) pair -- L1 and L2 resolving to different providers don't collide", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
    const l1 = getAiProvider("pipeline_l1");
    const l2 = getAiProvider("pipeline_l2");
    expect(l1).not.toBe(l2);
  });
});

describe("P1.1 -- per-level provider override, dev/prod default (see provider-config.test.ts for the resolver's own unit tests)", () => {
  afterEach(() => {
    delete process.env.AI_PROVIDER_PIPELINE_L1;
    delete process.env.AI_PROVIDER_PIPELINE_L2;
    delete process.env.AI_ALLOWED_PROVIDERS;
  });

  test("dev default: unset AI_PROVIDER gates pipeline_l1 exactly as before (no config regression)", () => {
    delete process.env.AI_PROVIDER;
    process.env.RAJAT_USER_ID = "rajat_user_id_123";
    expect(() => assertAiProviderAllowed("rajat_user_id_123", "pipeline_l1")).not.toThrow();
    expect(() => assertAiProviderAllowed("someone_else", "pipeline_l1")).toThrow(AiProviderRefusalError);
  });

  test("prod default: AI_PROVIDER=openrouter lifts the per-user restriction for every level with no override", () => {
    process.env.AI_PROVIDER = "openrouter";
    delete process.env.RAJAT_USER_ID;
    expect(() => assertAiProviderAllowed("literally_anyone", "pipeline_l1")).not.toThrow();
    expect(() => assertAiProviderAllowedForSystemBatch("l2-nightly-analyse", "pipeline_l2")).not.toThrow();
  });

  test("per-level override: L1 can run claude-cli (gated) while L2 is forced to openrouter by its own override", () => {
    process.env.AI_PROVIDER = "claude-cli"; // global default
    process.env.AI_PROVIDER_PIPELINE_L2 = "openrouter"; // L2-only override
    process.env.RAJAT_USER_ID = "rajat_user_id_123";
    // L1 still uses the global default (claude-cli) and is still gated:
    expect(() => assertAiProviderAllowed("rajat_user_id_123", "pipeline_l1")).not.toThrow();
    expect(() => assertAiProviderAllowed("someone_else", "pipeline_l1")).toThrow(AiProviderRefusalError);
    // L2 uses its own override (openrouter) and is NOT claude-cli-gated:
    expect(() => assertAiProviderAllowedForSystemBatch("l2-nightly-analyse", "pipeline_l2")).not.toThrow();
  });

  test("a disallowed provider is refused through the public gate too, not just the resolver", () => {
    process.env.AI_ALLOWED_PROVIDERS = "openrouter";
    process.env.AI_PROVIDER = "claude-cli";
    expect(() => assertAiProviderAllowed("anyone", "pipeline_l1")).toThrow(UnknownAiProviderError);
  });

  test("*** THE DELIBERATE NON-CHANGE: no per-level override or allowlist config removes the claude-cli identity gate *** -- this is the P1.1 boundary: config controls WHICH provider a level uses, never WHETHER claude-cli still checks identity once selected", () => {
    process.env.AI_PROVIDER = "openrouter"; // prod-like global default
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli"; // but this level is overridden back to claude-cli
    process.env.RAJAT_USER_ID = "rajat_user_id_123";
    // The override reaching claude-cli still means the identity gate applies --
    // config generality never bypasses the compliance check documented in
    // assertAiProviderAllowed's own header (Anthropic OAuth/subscription
    // auth is for ordinary individual use only).
    expect(() => assertAiProviderAllowed("some_other_real_user_id", "pipeline_l1")).toThrow(AiProviderRefusalError);
  });

  test("*** C-05, reviewer-required: BOTH refusal paths in ONE test *** -- a second identity on claude-cli is refused, AND an unlisted provider string is refused, so neither guard can silently regress without the other's test also failing", () => {
    // Path 1: claude-cli (the command-line/CLI-OAuth provider) refuses a
    // second identity -- the compliance gate itself.
    process.env.AI_PROVIDER = "claude-cli";
    process.env.RAJAT_USER_ID = "rajat_user_id_123";
    delete process.env.AI_ALLOWED_PROVIDERS;
    expect(() => assertAiProviderAllowed("a_genuinely_different_user", "pipeline_l1")).toThrow(AiProviderRefusalError);

    // Path 2: an unlisted/unknown provider string is refused -- the
    // default-deny allowlist, a structurally different failure mode (an
    // UnknownAiProviderError, not a per-user AiProviderRefusalError) that a
    // fix for path 1 could not accidentally satisfy.
    process.env.AI_PROVIDER = "some-provider-nobody-configured";
    expect(() => assertAiProviderAllowed("rajat_user_id_123", "pipeline_l1")).toThrow(UnknownAiProviderError);
  });
});
