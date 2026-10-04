/// <reference types="bun-types" />
// Audit 37 point 12 (proof test #2, ai-os/audit37/C_internal_ai.md): the internal AI cannot
// "code". Level 1's only output is a function id from a CLOSED candidate list; runLevel1
// re-validates every model answer in code. A function id outside the candidate set (a made-up
// "write_code", a code snippet, a prose sentence in the id slot), a below-floor confidence, or an
// item code that is not in the project's BOQ all come back as a null resolution with an honest
// reason -- never as something the executor could run.
//
// WHAT IS REAL: runLevel1 and its validation, the provider gate. WHAT IS FAKED: the claude-cli
// provider (returns whatever the test says -- the hostile model).
//
// Falsifiability (R74-RULING-03 (c)): delete the `candidateFunctionIds.includes(...)` check in
// level1.ts and the "outside the candidate set" cases below fail (the id is resolved).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
// Audit 37 point 11: the per-organisation allow flag (internal-ai-org-allowance.ts) is default closed; this file tests behaviour for an ALLOWED org.
mock.module("@/lib/ai/internal-ai-org-allowance", () => ({ INTERNAL_AI_BRANCH_KEY: "internal_ai", isInternalAiAllowedForOrg: async () => true, isInternalAiAllowedForOrgWithDb: async () => true }))
;
import { aiEnvSnapshot } from "@/lib/pipeline/__test-helpers__/pipeline-store-double";

const savedFlag = process.env.PROJEXA_INTERNAL_AI_ENABLED;
beforeAll(() => { process.env.PROJEXA_INTERNAL_AI_ENABLED = "1" });
afterAll(() => { if (savedFlag === undefined) delete process.env.PROJEXA_INTERNAL_AI_ENABLED; else process.env.PROJEXA_INTERNAL_AI_ENABLED = savedFlag });

const OWNER_ID = "user_owner";
const CANDIDATES = ["get_construction_project_dashboard", "list_delayed_activities"] as const;

type Raw = { functionId: string | null; params?: Record<string, unknown>; missingParams?: string[]; confidence: number; unmappedIntent?: string }[];
let nextAnswer: Raw = [];
let providerCalls = 0;

const realClaudeCli = await import("@/lib/ai/providers/claude-cli");
mock.module("@/lib/ai/providers/claude-cli", () => ({
  ...realClaudeCli,
  claudeCliProvider: {
    classify: async () => { providerCalls++; return nextAnswer },
    analyse: async () => [],
  },
}));

const env = aiEnvSnapshot();
beforeEach(() => {
  env.clear();
  process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
  process.env.RAJAT_USER_ID = OWNER_ID;
  providerCalls = 0;
});
afterEach(() => env.restore());
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/ai/providers/claude-cli", () => realClaudeCli);
});

const { runLevel1 } = await import("./level1");

async function run(answer: Raw) {
  nextAnswer = answer;
  return runLevel1(["write me a python script"], { orgId: "org_a", userId: "key_1", personId: OWNER_ID, projectId: null, candidateFunctionIds: CANDIDATES });
}

describe("Audit 37 #12 -- Level 1 cannot produce anything but a candidate function id", () => {
  test("control: a valid candidate at full confidence resolves (so the nulls below are the validation, not a broken stub)", async () => {
    const out = await run([{ functionId: "get_construction_project_dashboard", params: {}, confidence: 0.95 }]);
    expect(providerCalls).toBe(1);
    expect(out.resolutions[0]).toMatchObject({ functionId: "get_construction_project_dashboard", source: "level1" });
  });

  test.each([
    ["an invented function id", "write_code"],
    ["a code snippet in the id slot", "import os; os.system('rm -rf /')"],
    ["a prose sentence in the id slot", "Sure! Here is the script you asked for: print('hi')"],
    ["a real function that is not in this module's candidate set", "delete_project"],
  ])("%s -> null resolution, not in candidate set, nothing runnable", async (_label, functionId) => {
    const out = await run([{ functionId, params: { code: "print('hi')" }, confidence: 0.99 }]);
    expect(providerCalls).toBe(1);
    expect(out.resolutions).toEqual([null]);
    expect(out.reasons[0]).toContain("not in this module's candidate set");
  });

  test("a prose-only answer (no function id) is a null resolution with the unmapped intent as the reason", async () => {
    const out = await run([{ functionId: null, confidence: 0, unmappedIntent: "user wants code written" }]);
    expect(out.resolutions).toEqual([null]);
    expect(out.reasons[0]).toContain("could not map");
  });

  test("a candidate id below the 0.8 confidence floor is a null resolution", async () => {
    const out = await run([{ functionId: "get_construction_project_dashboard", params: {}, confidence: 0.5 }]);
    expect(out.resolutions).toEqual([null]);
    expect(out.reasons[0]).toContain("below");
  });

  test("an empty / missing provider answer is a null resolution, never a guess", async () => {
    const out = await run([]);
    expect(out.resolutions).toEqual([null]);
  });
});
