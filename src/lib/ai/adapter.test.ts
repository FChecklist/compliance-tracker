/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { assertAiProviderAllowed, assertAiProviderAllowedForSystemBatch, getAiProvider, AiProviderRefusalError } from "./adapter";

const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;
const ORIGINAL_RAJAT_USER_ID = process.env.RAJAT_USER_ID;

afterEach(() => {
  if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
  if (ORIGINAL_RAJAT_USER_ID === undefined) delete process.env.RAJAT_USER_ID;
  else process.env.RAJAT_USER_ID = ORIGINAL_RAJAT_USER_ID;
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
});
