/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09a (register row AW-502; spec 9.7 C-1 and 9.6 step 5; write-path gap report G1 and G8): a write that came through an AI work
// link is RECORDED as one. runDirectTask writes `via 'ai_link'` and the link's id on the submission, mints the task with the resolution source
// `external_ai` (so pipeline_tasks.executor reads "ai": a model chose the write, even though this pipeline ran none), and persists
// model_calls 0 and level1_outcome 'not_needed' (before this it only RETURNED them, so a query for model_calls = 0 read NULL and proved nothing).
// The same call without a link is untouched: executor "software", no provenance columns, no telemetry columns.
//
// WHAT IS REAL: run-submission.ts (runDirectTask, executorFor), validate(), the executors, classify.ts. WHAT IS FAKED: the database layer
// (fake-tenant-db.ts, which compiles the real drizzle where clauses), the memory write (a spy, as in run-submission-ai-link.test.ts) and Level 1 (a
// spy that must never run).
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. remove the `external_ai` mint branch in runDirectTask    -> "the task is minted for the caller's AI ..." fails (executor is software)
//   2. make executorFor ignore "external_ai"                    -> "executorFor: external_ai is ai" and the executor assertions fail
//   3. drop linkProvenanceColumns from the submissions insert   -> "the submission carries via ai_link ..." fails
//   4. drop linkTelemetryColumns from the final update          -> "model_calls 0 and level1_outcome not_needed are persisted ..." fails
//
// Run: bun test --isolate src/lib/pipeline/run-direct-task.link.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createFakeStore, fakeFixtures, makeFakeWithTenantContext, FAKE_ORG, FAKE_PROJECT_A, FAKE_USER, type FakeStore } from "./fake-tenant-db";

let store: FakeStore = createFakeStore(fakeFixtures());

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(makeFakeWithTenantContext(() => store)),
}));

const realLevel1 = await import("@/lib/pipeline/level1");
const runLevel1Spy = mock(async (texts: string[]) => ({ resolutions: texts.map(() => null), reasons: texts.map(() => "spy"), modelCalls: 1 }));
mock.module("@/lib/pipeline/level1", () => ({ ...realLevel1, runLevel1: runLevel1Spy }));

const realMemoryService = await import("@/lib/services/memory-service");
const createMemoryRecordSpy = mock(async (..._args: unknown[]) => ({ id: "memory_1" }));
mock.module("@/lib/services/memory-service", () => ({ ...realMemoryService, createMemoryRecord: createMemoryRecordSpy }));

let runDirectTask: typeof import("./run-submission").runDirectTask;
let executorFor: typeof import("./run-submission").executorFor;
beforeAll(async () => {
  ({ runDirectTask, executorFor } = await import("./run-submission"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = createFakeStore(fakeFixtures());
  runLevel1Spy.mockClear();
  createMemoryRecordSpy.mockClear();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})];
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

const LINK_ID = "link_1";
const run = (over: Record<string, unknown> = {}) =>
  runDirectTask({
    orgId: FAKE_ORG,
    userId: FAKE_USER,
    mode: "Projects",
    projectId: FAKE_PROJECT_A,
    functionId: "record_attendance",
    params: { rosterId: "roster_a", date: "2026-09-26" },
    role: "manager",
    actorUserId: FAKE_USER,
    ...over,
  });

const submissionRow = () => store.tables.submissions[0] as Record<string, unknown>;
const taskRow = () => store.tables.pipeline_tasks[0] as Record<string, unknown>;

describe("executorFor: the resolution source of a link write", () => {
  test("executorFor: external_ai is ai, and the sources that existed before are unchanged", () => {
    expect(executorFor("external_ai")).toBe("ai");
    expect(executorFor("level1")).toBe("ai");
    for (const s of ["phrase_map", "structural", "last_action", "reuse_cache", "phrase_fuzzy", "none"] as const) expect(`${s}=${executorFor(s)}`).toBe(`${s}=software`);
  });
});

describe("runDirectTask through a link is recorded as a link write", () => {
  test("the submission carries via ai_link and the link's id and the link's person", async () => {
    const result = await run({ aiLinkId: LINK_ID, via: "ai_link", note: `[ai-link ${LINK_ID}] Record attendance` });

    expect(result.status).toBe("done");
    expect(store.tables.submissions).toHaveLength(1);
    expect(submissionRow()).toMatchObject({ via: "ai_link", aiLinkId: LINK_ID, userId: FAKE_USER, orgId: FAKE_ORG, projectId: FAKE_PROJECT_A });
    // the write itself landed
    expect(store.tables.construction_attendance.map((r) => r.rosterId)).toEqual(["roster_a"]);
  });

  test("the task is minted for the caller's AI: pipeline_tasks.executor is ai, though no model ran here", async () => {
    await run({ aiLinkId: LINK_ID, via: "ai_link" });

    expect(store.tables.pipeline_tasks).toHaveLength(1);
    expect(taskRow()).toMatchObject({ executor: "ai", functionId: "record_attendance", status: "done" });
    expect(runLevel1Spy).not.toHaveBeenCalled();
  });

  test("model_calls 0 and level1_outcome not_needed are persisted on the submission, not only returned", async () => {
    const result = await run({ aiLinkId: LINK_ID, via: "ai_link" });

    expect(result.modelCalls).toBe(0);
    expect(result.level1Outcome).toBe("not_needed");
    expect(submissionRow()).toMatchObject({ modelCalls: 0, cacheHits: 0, level1Outcome: "not_needed", level: 0, source: "not_needed", l0HitRate: "1.0000", level1RefusalCode: null, status: "done" });
    expect(runLevel1Spy).not.toHaveBeenCalled();
  });

  test("a link id alone is a link (via is written as ai_link, the only value the table admits); via alone has no link id", async () => {
    await run({ aiLinkId: LINK_ID });
    expect(submissionRow()).toMatchObject({ via: "ai_link", aiLinkId: LINK_ID });
    expect(taskRow().executor).toBe("ai");

    store = createFakeStore(fakeFixtures());
    await run({ via: "ai_link" });
    expect(submissionRow().via).toBe("ai_link");
    expect("aiLinkId" in submissionRow()).toBe(false);
    expect(taskRow().executor).toBe("ai");
  });

  test("a link write that fails validation still records its provenance and its zero model calls (a failed submission is a measurement too)", async () => {
    const result = await run({ aiLinkId: LINK_ID, via: "ai_link", params: {} });

    expect(result.status).toBe("failed");
    expect(submissionRow()).toMatchObject({ via: "ai_link", aiLinkId: LINK_ID, status: "failed", modelCalls: 0, level1Outcome: "not_needed" });
    expect(store.tables.pipeline_tasks ?? []).toEqual([]);
  });
});

describe("the same call without a link is exactly what it was", () => {
  test("REGRESSION: executor software, no provenance columns, no telemetry columns written", async () => {
    const result = await run();

    expect(result.status).toBe("done");
    expect(taskRow().executor).toBe("software");
    const row = submissionRow();
    for (const key of ["via", "aiLinkId", "modelCalls", "cacheHits", "level1Outcome", "level", "source", "l0HitRate", "level1RefusalCode"]) {
      expect(`${key} ${key in row}`).toBe(`${key} false`);
    }
    expect(row.status).toBe("done");
  });
});
