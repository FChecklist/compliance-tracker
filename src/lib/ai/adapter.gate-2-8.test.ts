/// <reference types="bun-types" />
// PROJEXA-BUILD-001 Phase 1, item T-3: the RAJAT_USER_ID provider gate, as it
// behaves today, written down as a table.
//
// WHAT THE GATE IS. assertAiProviderAllowed() is a licence gate, not a
// per-tenant permission. When Level 1 resolves to claude-cli or
// claude-cli-remote (one individual's subscription) it refuses every identity
// except RAJAT_USER_ID, and it refuses everyone when RAJAT_USER_ID is unset.
// When Level 1 resolves to openrouter it refuses nobody. adapter.test.ts
// already pins the individual refusal cases (its "THE REQUIRED PROOF" tests).
//
// WHAT THIS FILE ADDS: the full grid in one place -- 4 provider states x
// RAJAT_USER_ID set/unset x 3 identity shapes -- driven by the per-level
// variable AI_PROVIDER_PIPELINE_L1 (the variable the deployment actually sets
// for Level 1), the exact refusal text a user is shown, and a few identity
// comparison edge cases. The three identities model the three callers that
// reach the gate: the owner, a signed-in person who is not the owner, and a
// PROJEXA org API key (whose id is what the gate sees on the proxy path).
//
// WHAT THIS FILE MUST NOT ASSERT: that a non-owner passes under claude-cli or
// claude-cli-remote. That contradicts adapter.test.ts and the licence reasoning
// in adapter.ts. A non-owner passes only when Level 1 resolves to openrouter,
// and openrouter is metered spend, which is an owner decision.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { assertAiProviderAllowed, AiProviderRefusalError } from "./adapter";
import { resolveProviderForLevel } from "./provider-config";
import { NO_COMMENTARY_SENTENCE } from "./refusal";

const ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_PROVIDER_PIPELINE_L2", "AI_ALLOWED_PROVIDERS", "RAJAT_USER_ID"] as const;
const SAVED: Record<(typeof ENV_KEYS)[number], string | undefined> = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

const OWNER = "owner_user_id_1";
const NONOWNER = "user_2";
const APIKEY = "apikey_3";

type Identity = "OWNER" | "NONOWNER" | "APIKEY";
const IDENTITY_VALUE: Record<Identity, string> = { OWNER, NONOWNER, APIKEY };
const IDENTITIES: Identity[] = ["OWNER", "NONOWNER", "APIKEY"];

type ProviderState = { label: string; applyEnv: () => void; verdicts: Record<"rajatSet" | "rajatUnset", Record<Identity, boolean>> };

// Expected outcome per identity, written out rather than computed, so the table
// cannot agree with the implementation by sharing its logic. true = allowed
// (no throw), false = refused (AiProviderRefusalError).
const SUBSCRIPTION_VERDICTS: ProviderState["verdicts"] = {
  rajatSet: { OWNER: true, NONOWNER: false, APIKEY: false },
  rajatUnset: { OWNER: false, NONOWNER: false, APIKEY: false },
};
const METERED_VERDICTS: ProviderState["verdicts"] = {
  rajatSet: { OWNER: true, NONOWNER: true, APIKEY: true },
  rajatUnset: { OWNER: true, NONOWNER: true, APIKEY: true },
};

const PROVIDER_STATES: ProviderState[] = [
  {
    label: "L1 provider unset (defaults to claude-cli)",
    applyEnv: () => {
      delete process.env.AI_PROVIDER;
      delete process.env.AI_PROVIDER_PIPELINE_L1;
    },
    verdicts: SUBSCRIPTION_VERDICTS,
  },
  {
    label: "L1 provider claude-cli",
    applyEnv: () => {
      delete process.env.AI_PROVIDER;
      process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
    },
    verdicts: SUBSCRIPTION_VERDICTS,
  },
  {
    label: "L1 provider claude-cli-remote",
    applyEnv: () => {
      delete process.env.AI_PROVIDER;
      process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli-remote";
    },
    verdicts: SUBSCRIPTION_VERDICTS,
  },
  {
    label: "L1 provider openrouter",
    applyEnv: () => {
      delete process.env.AI_PROVIDER;
      process.env.AI_PROVIDER_PIPELINE_L1 = "openrouter";
    },
    verdicts: METERED_VERDICTS,
  },
];

let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  // Save is done once at module load (SAVED); every test starts from a blank
  // slate for the five variables so no earlier test's value can leak in.
  for (const k of ENV_KEYS) delete process.env[k];
  // The gate logs every refusal with console.error. The grid below refuses
  // dozens of times, so the log is captured here instead of printed.
  silenced = [spyOn(console, "error").mockImplementation(() => {})];
});

afterEach(() => {
  for (const s of silenced) s.mockRestore();
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

function catchGateError(userId: string): unknown {
  try {
    assertAiProviderAllowed(userId, "pipeline_l1");
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("RAJAT_USER_ID gate grid -- 4 provider states x RAJAT_USER_ID set/unset x 3 identities (24 cases)", () => {
  for (const state of PROVIDER_STATES) {
    for (const rajat of ["rajatSet", "rajatUnset"] as const) {
      for (const identity of IDENTITIES) {
        const allowed = state.verdicts[rajat][identity];
        const rajatLabel = rajat === "rajatSet" ? "RAJAT_USER_ID=owner" : "RAJAT_USER_ID unset";
        const name = `${state.label}, ${rajatLabel}, identity ${identity} -> ${allowed ? "allowed" : "refused with the no-commentary sentence"}`;

        test(name, () => {
          state.applyEnv();
          if (rajat === "rajatSet") process.env.RAJAT_USER_ID = OWNER;
          else delete process.env.RAJAT_USER_ID;

          const caught = catchGateError(IDENTITY_VALUE[identity]);

          if (allowed) {
            expect(caught).toBeUndefined();
            return;
          }
          expect(caught).toBeInstanceOf(AiProviderRefusalError);
          expect((caught as Error).message).toBe(NO_COMMENTARY_SENTENCE);
        });
      }
    }
  }
});

describe("refusal text and Level 1 resolution", () => {
  test("the sentence a refused user is shown says commentary is off and points at the records", () => {
    expect(NO_COMMENTARY_SENTENCE).toBe("VERI can't add commentary right now - here is what the records say");
  });

  test("resolveProviderForLevel('pipeline_l1') with AI_PROVIDER and AI_PROVIDER_PIPELINE_L1 both unset is exactly claude-cli", () => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_PROVIDER_PIPELINE_L1;
    expect(resolveProviderForLevel("pipeline_l1")).toBe("claude-cli");
  });
});

describe("which variable decides Level 1", () => {
  test("a global subscription provider with an openrouter Level 1 override lets every identity through", () => {
    process.env.AI_PROVIDER = "claude-cli-remote";
    process.env.AI_PROVIDER_PIPELINE_L1 = "openrouter";
    delete process.env.RAJAT_USER_ID;
    for (const identity of IDENTITIES) {
      expect(catchGateError(IDENTITY_VALUE[identity])).toBeUndefined();
    }
  });

  test("a Level 2 override does not lift the Level 1 gate", () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
    process.env.AI_PROVIDER_PIPELINE_L2 = "openrouter";
    process.env.RAJAT_USER_ID = OWNER;
    expect(catchGateError(NONOWNER)).toBeInstanceOf(AiProviderRefusalError);
    expect(catchGateError(OWNER)).toBeUndefined();
  });
});

describe("how the gate compares identities", () => {
  test("the comparison is exact: a different letter case or a trailing space is a different identity", () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
    process.env.RAJAT_USER_ID = OWNER;
    expect(catchGateError(OWNER)).toBeUndefined();
    expect(catchGateError(OWNER.toUpperCase())).toBeInstanceOf(AiProviderRefusalError);
    expect(catchGateError(`${OWNER} `)).toBeInstanceOf(AiProviderRefusalError);
  });

  test("RAJAT_USER_ID set to an empty string counts as unset: nobody passes, not even the empty identity", () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
    process.env.RAJAT_USER_ID = "";
    expect(catchGateError("")).toBeInstanceOf(AiProviderRefusalError);
    expect(catchGateError(OWNER)).toBeInstanceOf(AiProviderRefusalError);
  });
});
