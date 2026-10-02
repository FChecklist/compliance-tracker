/// <reference types="bun-types" />
// lf-b3-ai-off (owner directive 2026-10-02, "the user's own AI, never ours"): with PROJEXA_INTERNAL_AI_ENABLED unset, the pipeline
// never asks Level 1 (the internal model) -- for ANY caller, not only the AI work link -- and a Level-0 miss is still the ordinary gap
// verdict, but worded USE_YOUR_OWN_AI instead of "not enabled for this workspace yet". With the switch at "1" every path is as before.
//
// WHAT IS REAL: run-submission.ts (runSubmission, submitForVerdict and the dry run behind it, confirmSubmission, effectiveLevel1),
// classify-only.ts, level0, the reuse cache, the registry, validate(). WHAT IS FAKED: the database (fake-tenant-db.ts) and the model
// lane itself: `runLevel1` is a spy -- the provider gate and every provider sit behind it, so "the spy was never called" is "no model,
// and no provider consulted". Same harness as run-submission-ai-link.test.ts.
//
// Run: bun test --isolate src/lib/pipeline/projexa-internal-ai-off.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createFakeStore, fakeFixtures, makeFakeWithTenantContext, FAKE_ORG, FAKE_PROJECT_A, FAKE_USER, type FakeStore } from "./fake-tenant-db";
import { USE_YOUR_OWN_AI } from "@/lib/projexa-internal-ai";

let store: FakeStore = createFakeStore(fakeFixtures());

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(makeFakeWithTenantContext(() => store)),
}));

const realLevel1 = await import("@/lib/pipeline/level1");
const runLevel1Spy = mock(async (texts: string[]) => ({
  resolutions: texts.map(() => null),
  reasons: texts.map(() => "spy: no function"),
  modelCalls: 1,
}));
mock.module("@/lib/pipeline/level1", () => ({ ...realLevel1, runLevel1: runLevel1Spy }));

const realMemoryService = await import("@/lib/services/memory-service");
mock.module("@/lib/services/memory-service", () => ({ ...realMemoryService, createMemoryRecord: mock(async () => ({ id: "memory_1" })) }));

let rs: typeof import("./run-submission");
let classifyOnly: typeof import("./classify-only").classifyOnly;
let gapAnswer: typeof import("./dry-run").gapAnswer;
beforeAll(async () => {
  rs = await import("./run-submission");
  ({ classifyOnly } = await import("./classify-only"));
  ({ gapAnswer } = await import("./dry-run"));
});

const FLAG = "PROJEXA_INTERNAL_AI_ENABLED";
const savedFlag = process.env[FLAG];
let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  delete process.env[FLAG];
  store = createFakeStore(fakeFixtures());
  runLevel1Spy.mockClear();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/pipeline/level1", () => realLevel1);
  await mock.module("@/lib/services/memory-service", () => realMemoryService);
});

const MISS_TEXT = "xyzzy unmatched phrase";
const base = { orgId: FAKE_ORG, userId: FAKE_USER, mode: "Projects", projectId: FAKE_PROJECT_A, rawInput: MISS_TEXT, role: "manager" };
const OLD_GAP_WORDS = "not enabled for this workspace";

describe("effectiveLevel1: the switch is read inside the one function every entry point consults", () => {
  test("switch unset: every caller is off, whatever it asked for", () => {
    expect(rs.effectiveLevel1({})).toBe("off");
    expect(rs.effectiveLevel1({ level1: "internal" })).toBe("off");
    expect(rs.effectiveLevel1({ aiLinkId: "link_1" })).toBe("off");
  });

  test("any value but exactly '1' is still off", () => {
    for (const v of ["", "0", "true", "yes", " 1", "1 "]) {
      process.env[FLAG] = v;
      expect(rs.effectiveLevel1({ level1: "internal" })).toBe("off");
    }
  });

  test("switch '1': the rule as before (a link is off, every other caller keeps what it asked for, default internal)", () => {
    process.env[FLAG] = "1";
    expect(rs.effectiveLevel1({})).toBe("internal");
    expect(rs.effectiveLevel1({ level1: "off" })).toBe("off");
    expect(rs.effectiveLevel1({ aiLinkId: "link_1", level1: "internal" })).toBe("off");
  });

  test("gapSaysUseYourOwnAi: only for an app caller while the switch is off -- a link's own AI is already the one working", () => {
    expect(rs.gapSaysUseYourOwnAi({})).toBe(true);
    expect(rs.gapSaysUseYourOwnAi({ aiLinkId: "link_1" })).toBe(false);
    expect(rs.gapSaysUseYourOwnAi({ via: "ai_link" })).toBe(false);
    process.env[FLAG] = "1";
    expect(rs.gapSaysUseYourOwnAi({})).toBe(false);
  });
});

describe("gapAnswer: the gap keeps its route, only the words change", () => {
  test("with useYourOwnAi the message is USE_YOUR_OWN_AI and still names the screen", () => {
    expect(gapAnswer("create a vendor", { useYourOwnAi: true })).toEqual({ message: `${USE_YOUR_OWN_AI} - Open Vendors`, route: "/vendors" });
    expect(gapAnswer(MISS_TEXT, { useYourOwnAi: true })).toEqual({ message: `${USE_YOUR_OWN_AI} - Open Home`, route: "/dashboard" });
  });

  test("without it the old sentence is unchanged", () => {
    expect(gapAnswer(MISS_TEXT).message).toContain(OLD_GAP_WORDS);
    expect(gapAnswer(MISS_TEXT, { useYourOwnAi: false }).message).toContain(OLD_GAP_WORDS);
  });
});

describe("runSubmission", () => {
  test("switch unset: Level 1 is never called, the miss is a gap, and the person is told once to use their own AI", async () => {
    const result = await rs.runSubmission(base);
    expect(runLevel1Spy).not.toHaveBeenCalled();
    expect(result.modelCalls).toBe(0);
    expect(result.gaps.map((g) => g.text)).toEqual([MISS_TEXT]);
    expect(result.chatMessages.filter((m) => m === USE_YOUR_OWN_AI)).toHaveLength(1);
  });

  test("switch unset, AI work link: no model either, and no 'paste your link' to a caller that already did", async () => {
    const result = await rs.runSubmission({ ...base, aiLinkId: "link_1" });
    expect(runLevel1Spy).not.toHaveBeenCalled();
    expect(result.chatMessages).not.toContain(USE_YOUR_OWN_AI);
  });

  test("switch '1': Level 1 is called once for the miss, as before, and the sentence is not added", async () => {
    process.env[FLAG] = "1";
    const result = await rs.runSubmission(base);
    expect(runLevel1Spy).toHaveBeenCalledTimes(1);
    expect(result.modelCalls).toBe(1);
    expect(result.chatMessages).not.toContain(USE_YOUR_OWN_AI);
  });
});

describe("submitForVerdict (the typed composer's verdict)", () => {
  test("switch unset: no Level 1, and the gap verdict's message is USE_YOUR_OWN_AI, not 'not enabled for this workspace'", async () => {
    const verdict = await rs.submitForVerdict(base);
    expect(runLevel1Spy).not.toHaveBeenCalled();
    expect(verdict.status).toBe("gap");
    expect(verdict.message).toContain(USE_YOUR_OWN_AI);
    expect(JSON.stringify(verdict)).not.toContain(OLD_GAP_WORDS);
  });

  test("switch '1': Level 1 is called and the old gap wording comes back", async () => {
    process.env[FLAG] = "1";
    const verdict = await rs.submitForVerdict(base);
    expect(runLevel1Spy).toHaveBeenCalledTimes(1);
    expect(verdict.status).toBe("gap");
    expect(verdict.message).toContain(OLD_GAP_WORDS);
    expect(JSON.stringify(verdict)).not.toContain(USE_YOUR_OWN_AI);
  });
});

describe("confirmSubmission (its input has no level1 field, which is why the switch lives in effectiveLevel1)", () => {
  const stored = () => {
    store.tables.submissions = [{ id: "sub_1", orgId: FAKE_ORG, projectId: FAKE_PROJECT_A, mode: "Projects", rawInput: MISS_TEXT, userId: FAKE_USER }];
  };

  test("switch unset: a confirm whose words miss Level 0 never reaches Level 1", async () => {
    stored();
    await rs.confirmSubmission({ orgId: FAKE_ORG, userId: FAKE_USER, submissionId: "sub_1", role: "manager" });
    expect(runLevel1Spy).not.toHaveBeenCalled();
  });

  test("switch '1': the same confirm asks Level 1, as before", async () => {
    process.env[FLAG] = "1";
    stored();
    await rs.confirmSubmission({ orgId: FAKE_ORG, userId: FAKE_USER, submissionId: "sub_1", role: "manager" });
    expect(runLevel1Spy).toHaveBeenCalledTimes(1);
  });
});

describe("classifyOnly (calls Level 1 directly, not through effectiveLevel1)", () => {
  const input = { orgId: FAKE_ORG, userId: FAKE_USER, mode: "Projects", projectId: FAKE_PROJECT_A, rawInput: MISS_TEXT };

  test("switch unset: no Level 1, zero model calls, the gap comes back with USE_YOUR_OWN_AI", async () => {
    const result = await classifyOnly(input);
    expect(runLevel1Spy).not.toHaveBeenCalled();
    expect(result.modelCalls).toBe(0);
    expect(result.segments.map((s) => s.verdict)).toEqual(["gap"]);
    expect(result.message).toBe(USE_YOUR_OWN_AI);
  });

  test("switch '1': Level 1 is asked and no such sentence is added", async () => {
    process.env[FLAG] = "1";
    const result = await classifyOnly(input);
    expect(runLevel1Spy).toHaveBeenCalledTimes(1);
    expect(result.message).toBeNull();
  });
});
