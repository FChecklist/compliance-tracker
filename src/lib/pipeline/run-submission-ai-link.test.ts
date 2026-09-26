/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-43 (register row BR-287, spec 9.7 C-1 and C-2): a
// submission made through an AI work link carries its link (`aiLinkId`, or
// `via: "ai_link"`), and NEVER runs the internal AI. The session/app path keeps
// calling Level 1 exactly as before.
//
// WHAT IS REAL: run-submission.ts (runSubmission, submitForVerdict, the dry run
// behind it, confirmSubmission, runDirectTask), level0, the reuse cache, the
// registry, validate(). WHAT IS FAKED: the database layer (fake-tenant-db.ts),
// and the model call itself: `runLevel1` is a spy, which is what
// assertAiProviderAllowed and the provider sit behind, so "the spy was never
// called" is "no model, and no provider consulted".
//
// Run: bun test --isolate src/lib/pipeline/run-submission-ai-link.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createFakeStore, fakeFixtures, makeFakeWithTenantContext, FAKE_ORG, FAKE_PROJECT_A, FAKE_USER, type FakeStore } from "./fake-tenant-db";
import { ServiceError } from "@/lib/services/compliance-service";

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
const createMemoryRecordSpy = mock(async (..._args: unknown[]) => ({ id: "memory_1" }));
mock.module("@/lib/services/memory-service", () => ({ ...realMemoryService, createMemoryRecord: createMemoryRecordSpy }));

let runSubmission: typeof import("./run-submission").runSubmission;
let submitForVerdict: typeof import("./run-submission").submitForVerdict;
let runDirectTask: typeof import("./run-submission").runDirectTask;
let confirmSubmission: typeof import("./run-submission").confirmSubmission;
let effectiveLevel1: typeof import("./run-submission").effectiveLevel1;
let isFromAiLink: typeof import("./run-submission").isFromAiLink;
beforeAll(async () => {
  ({ runSubmission, submitForVerdict, runDirectTask, confirmSubmission, effectiveLevel1, isFromAiLink } = await import("./run-submission"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
let infoSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  store = createFakeStore(fakeFixtures());
  runLevel1Spy.mockClear();
  createMemoryRecordSpy.mockClear();
  infoSpy = spyOn(console, "info").mockImplementation(() => {});
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), infoSpy];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/pipeline/level1", () => realLevel1);
  await mock.module("@/lib/services/memory-service", () => realMemoryService);
});

const MISS_TEXT = "xyzzy unmatched phrase";
const LINK_ID = "link_1";
const base = { orgId: FAKE_ORG, userId: FAKE_USER, mode: "Projects", projectId: FAKE_PROJECT_A, rawInput: MISS_TEXT, role: "manager" };

describe("effectiveLevel1 and isFromAiLink: the one rule", () => {
  test("a link is always off; every other caller keeps what it asked for, default internal", () => {
    expect(effectiveLevel1({ aiLinkId: LINK_ID })).toBe("off");
    expect(effectiveLevel1({ aiLinkId: LINK_ID, level1: "internal" })).toBe("off");
    expect(effectiveLevel1({ via: "ai_link", level1: "internal" })).toBe("off");
    expect(effectiveLevel1({})).toBe("internal");
    expect(effectiveLevel1({ level1: "internal" })).toBe("internal");
    expect(effectiveLevel1({ level1: "off" })).toBe("off");
    expect(effectiveLevel1({ aiLinkId: null, via: null })).toBe("internal");
  });

  test("a link is recognised by its id or by via, and only by those", () => {
    expect(isFromAiLink({ aiLinkId: LINK_ID })).toBe(true);
    expect(isFromAiLink({ via: "ai_link" })).toBe(true);
    expect(isFromAiLink({ aiLinkId: "", via: null })).toBe(false);
    expect(isFromAiLink({})).toBe(false);
  });
});

describe("runSubmission: a link submission never runs the internal AI (BR-287)", () => {
  test("aiLinkId with level1 left at internal: Level 1 is not called, no model call, the miss is a gap", async () => {
    const result = await runSubmission({ ...base, aiLinkId: LINK_ID, level1: "internal" });

    expect(runLevel1Spy).not.toHaveBeenCalled();
    expect(result.modelCalls).toBe(0);
    expect(result.gaps.map((g) => g.text)).toEqual([MISS_TEXT]);
    expect(result.tasks).toEqual([]);
    expect(result.level1Outcome).toBe("resolved");
  });

  test("aiLinkId alone (no level1 at all) behaves the same", async () => {
    await runSubmission({ ...base, aiLinkId: LINK_ID });
    expect(runLevel1Spy).not.toHaveBeenCalled();
  });

  test("via 'ai_link' without an id is a link too", async () => {
    await runSubmission({ ...base, via: "ai_link" });
    expect(runLevel1Spy).not.toHaveBeenCalled();
  });

  test("REGRESSION: the session/app path (no link, level1 omitted) still calls Level 1 exactly once for the miss", async () => {
    const result = await runSubmission(base);

    expect(runLevel1Spy).toHaveBeenCalledTimes(1);
    expect(runLevel1Spy.mock.calls[0][0]).toEqual([MISS_TEXT]);
    expect(result.modelCalls).toBe(1);
  });

  test("REGRESSION: level1 'internal' with no link calls Level 1; level1 'off' with no link does not (the U-43 switch as before)", async () => {
    await runSubmission({ ...base, level1: "internal" });
    expect(runLevel1Spy).toHaveBeenCalledTimes(1);

    runLevel1Spy.mockClear();
    await runSubmission({ ...base, level1: "off" });
    expect(runLevel1Spy).not.toHaveBeenCalled();
  });

  test("a link submission's log line names the link; another caller's does not", async () => {
    await runSubmission({ ...base, aiLinkId: LINK_ID });
    await runSubmission(base);

    const lines = infoSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[pipeline] submission="));
    expect(lines[0]).toContain(`via=ai_link ai_link_id=${LINK_ID}`);
    expect(lines[1]).not.toContain("ai_link");
  });
});

describe("the proposal, verdict and confirm behind a link never run the internal AI either", () => {
  test("submitForVerdict with aiLinkId: Level 1 is not called; without it, it is", async () => {
    const linked = await submitForVerdict({ ...base, aiLinkId: LINK_ID });
    expect(runLevel1Spy).not.toHaveBeenCalled();
    expect(linked.submissionId).toBeTruthy();

    await submitForVerdict(base);
    expect(runLevel1Spy).toHaveBeenCalledTimes(1);
  });
});

describe("confirmSubmission: the confirm step of a link is a link write", () => {
  const TODAY = "2026-09-25";
  const stored = () => {
    store.tables.submissions = [{ id: "sub_1", orgId: FAKE_ORG, projectId: FAKE_PROJECT_A, mode: "Projects", rawInput: "mark asha present", userId: FAKE_USER }];
    store.phraseMapRow = { functionId: "record_attendance", fixedParams: { rosterId: "roster_a", date: TODAY }, promotedAt: new Date() };
  };

  test("with aiLinkId: the proposal makes no model call and the write's memory is marked ai_link with the link id", async () => {
    stored();

    const outcome = await confirmSubmission({ orgId: FAKE_ORG, userId: FAKE_USER, submissionId: "sub_1", role: "manager", actorUserId: FAKE_USER, aiLinkId: LINK_ID });

    expect(outcome.ok).toBe(true);
    expect(runLevel1Spy).not.toHaveBeenCalled();
    expect(store.tables.construction_attendance.map((r) => r.rosterId)).toEqual(["roster_a"]);
    expect(createMemoryRecordSpy.mock.calls[0][2]).toMatchObject({ sourceType: "ai_link", sourceId: LINK_ID });
  });

  test("a confirm whose words no longer resolve is refused not_proposed, and a link never asks the model to try again", async () => {
    stored();
    store.phraseMapRow = null;

    const linked = await confirmSubmission({ orgId: FAKE_ORG, userId: FAKE_USER, submissionId: "sub_1", role: "manager", aiLinkId: LINK_ID });
    expect(linked.ok === false && linked.reason).toBe("not_proposed");
    expect(runLevel1Spy).not.toHaveBeenCalled();

    // REGRESSION: the session path does ask (and, with the spy answering nothing, is refused the same way).
    const session = await confirmSubmission({ orgId: FAKE_ORG, userId: FAKE_USER, submissionId: "sub_1", role: "manager" });
    expect(session.ok === false && session.reason).toBe("not_proposed");
    expect(runLevel1Spy).toHaveBeenCalledTimes(1);
    expect(store.tables.construction_attendance ?? []).toEqual([]);
  });

  test("REGRESSION: without a link the same confirm writes the same row and its memory is source_type 'task'", async () => {
    stored();

    const outcome = await confirmSubmission({ orgId: FAKE_ORG, userId: FAKE_USER, submissionId: "sub_1", role: "manager", actorUserId: FAKE_USER });

    expect(outcome.ok).toBe(true);
    expect(store.tables.construction_attendance.map((r) => r.rosterId)).toEqual(["roster_a"]);
    expect(createMemoryRecordSpy.mock.calls[0][2]).toMatchObject({ sourceType: "task" });
  });
});

describe("runDirectTask: the link is carried to the write's memory", () => {
  const run = (over: Record<string, unknown> = {}) =>
    runDirectTask({
      orgId: FAKE_ORG,
      userId: FAKE_USER,
      mode: "Projects",
      projectId: FAKE_PROJECT_A,
      functionId: "record_attendance",
      params: { rosterId: "roster_a", date: "2026-09-25" },
      role: "manager",
      actorUserId: FAKE_USER,
      ...over,
    });

  test("never calls Level 1, link or not (the pill path has no model)", async () => {
    await run({ aiLinkId: LINK_ID });
    await run();
    expect(runLevel1Spy).not.toHaveBeenCalled();
  });

  test("a write through a link leaves a memory marked ai_link, carrying the link id", async () => {
    const result = await run({ aiLinkId: LINK_ID, note: "[ai-link link_1] Record attendance" });

    expect(result.status).toBe("done");
    expect(createMemoryRecordSpy).toHaveBeenCalledTimes(1);
    const input = createMemoryRecordSpy.mock.calls[0][2] as { sourceType: string; sourceId: string | null; metadata: Record<string, unknown> };
    expect(input.sourceType).toBe("ai_link");
    expect(input.sourceId).toBe(LINK_ID);
    expect(input.metadata).toEqual({ via: "ai_link", aiLinkId: LINK_ID });
  });

  test("REGRESSION: the same write without a link leaves the memory as it always was (source_type 'task', no link metadata)", async () => {
    await run();

    const input = createMemoryRecordSpy.mock.calls[0][2] as { sourceType: string; sourceId?: string | null; metadata?: unknown };
    expect(input.sourceType).toBe("task");
    expect(input.sourceId).toBeUndefined();
    expect(input.metadata).toBeUndefined();
  });

  test("a refused text (over 2,000 characters) is a ServiceError 422 and nothing is written", async () => {
    const error = await run({ aiLinkId: LINK_ID, params: { rosterId: "roster_a", date: "2026-09-25", remarks: "x".repeat(2001) } }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(422);
    expect((error as ServiceError).code).toBe("TEXT_TOO_LONG");
    expect(store.writes).toEqual([]);
    expect(createMemoryRecordSpy).not.toHaveBeenCalled();
  });
});
