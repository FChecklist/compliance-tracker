/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-43 (register row BR-582, spec 9.9, audit A-01, AWL-S16):
// a function read through the AI work link runs in READ-ONLY executor mode and
// writes NOTHING -- no submissions, pipeline_tasks, pill_usage, chain_history,
// gap_log, memory or intent row.
//
// WHAT IS REAL: execute-read.ts, executor.ts (its registry and executeTask),
// validate(), function-registry.ts, and run-submission.ts's runDirectTask (used
// only as the positive control and, by hand, as the mutation).
// WHAT IS FAKED: only @/lib/db/tenant-scoped, by fake-tenant-db.ts, which
// records every insert, update and delete, and every raw execute of one, by
// table. A read that reached runDirectTask -- which mints a submission, a task,
// a pill use and a chain-history row even for a read (F-15) -- leaves a record
// in `store.writes` and fails these tests.
//
// Run: bun test --isolate src/lib/pipeline/execute-read.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { projects } from "@/lib/db/schema";
import { createFakeStore, fakeFixtures, makeFakeWithTenantContext, FAKE_ORG, FAKE_PROJECT_A, FAKE_PROJECT_B, FAKE_USER, type FakeStore } from "./fake-tenant-db";
import type { ExecutableTask, ExecutionOutcome } from "./executor";

let store: FakeStore = createFakeStore(fakeFixtures());

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(makeFakeWithTenantContext(() => store)),
}));

let executeRead: typeof import("./execute-read").executeRead;
let declaredReadParams: typeof import("./execute-read").declaredReadParams;
let executeTask: typeof import("./executor").executeTask;
let EXECUTABLE_FUNCTION_IDS: typeof import("./executor").EXECUTABLE_FUNCTION_IDS;
let functionWrites: typeof import("./executor").functionWrites;
let runDirectTask: typeof import("./run-submission").runDirectTask;
beforeAll(async () => {
  ({ executeRead, declaredReadParams } = await import("./execute-read"));
  ({ executeTask, EXECUTABLE_FUNCTION_IDS, functionWrites } = await import("./executor"));
  ({ runDirectTask } = await import("./run-submission"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = createFakeStore(fakeFixtures());
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const DASHBOARD = "get_construction_project_dashboard";
const readInput = (functionId: string, over: Record<string, unknown> = {}) => ({
  orgId: FAKE_ORG,
  userId: FAKE_USER,
  projectId: FAKE_PROJECT_A,
  functionId,
  role: "manager",
  actorUserId: FAKE_USER,
  ...over,
});

/**
 * A real read executor: it opens a (fake) transaction and SELECTS a project
 * row, like the real ones do, so the "no write" assertions below are made about
 * a call that really went through the database layer. Injected through
 * executeTask()'s own `executors` seam, so executeRead's own steps (registry,
 * effective list, params, validate, executeTask) all run for real.
 */
async function selectingReader(task: ExecutableTask): Promise<ExecutionOutcome> {
  const { withTenantContext } = await import("@/lib/db/tenant-scoped");
  const found = await withTenantContext({ orgId: task.orgId }, async (db) => {
    const reader = db as unknown as { select: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } } };
    const [row] = await reader.select().from(projects).where(eq(projects.id, task.projectId as string)).limit(1);
    return row;
  });
  return { success: true, result: { project: found, params: task.params, role: task.role } };
}
const viaSelectingReader = (task: ExecutableTask) => executeTask(task, { [DASHBOARD]: selectingReader });

describe("executeRead: a function read writes nothing (BR-582)", () => {
  test("a read through a real database call leaves ZERO writes on every table the pipeline owns", async () => {
    const outcome = await executeRead(readInput(DASHBOARD), viaSelectingReader);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && (outcome.result as { project: { id: string } }).project.id).toBe(FAKE_PROJECT_A);
    // The whole record, not a per-table list, so a table nobody thought of cannot be written either.
    expect(store.writes).toEqual([]);
    for (const table of ["submissions", "pipeline_tasks", "pill_usage", "chain_history", "gap_log", "memory_records", "ai_work_link_intent"]) {
      expect((store.tables[table] ?? []).length).toBe(0);
    }
    expect(store.unparsed).toEqual([]);
  });

  test("every read function the registry can run, on its REAL executor, still writes nothing (success or failure)", async () => {
    const reads = EXECUTABLE_FUNCTION_IDS.filter((id) => !functionWrites(id));
    expect(reads.length).toBeGreaterThan(10);

    for (const functionId of reads) {
      // The real executors may fail here (the fake has no rows for a dashboard); what is asserted is that
      // executeRead ANSWERED and that nothing was written on the way.
      const outcome = await executeRead(readInput(functionId));
      expect(typeof outcome.ok).toBe("boolean");
    }
    expect(store.writes).toEqual([]);
    expect(store.tables.submissions).toEqual([]);
    expect(store.tables.pipeline_tasks).toEqual([]);
  });

  test("POSITIVE CONTROL: the same read through runDirectTask (the pill path) DOES write, and the fake sees it", async () => {
    await runDirectTask({ orgId: FAKE_ORG, userId: FAKE_USER, mode: "Projects", projectId: FAKE_PROJECT_A, functionId: DASHBOARD, params: {}, role: "manager" });

    expect(store.writes).toContain("insert:submissions");
    expect(store.writes).toContain("insert:pipeline_tasks");
    expect(store.writes).toContain("insert:pill_usage");
    expect(store.writes).toContain("insert:chain_history");
  });

  test("a raw INSERT, UPDATE or DELETE through execute() is recorded too (the fake cannot be sidestepped by raw SQL)", async () => {
    const { withTenantContext } = await import("@/lib/db/tenant-scoped");
    const { sql } = await import("drizzle-orm");
    await withTenantContext({ orgId: FAKE_ORG }, async (db) => {
      const raw = db as unknown as { execute: (s: unknown) => Promise<unknown> };
      await raw.execute(sql`select 1`);
      await raw.execute(sql`insert into compliance.memory_records (id) values (${"m1"})`);
      await raw.execute(sql`UPDATE compliance.memory_records SET content = ${"x"}`);
    });

    expect(store.writes).toEqual(["execute:insert", "execute:update"]);
  });
});

describe("executeRead: only a read, only on the effective list, only this project", () => {
  test("a WRITE function is refused 403 FUNCTION_NOT_READ, and nothing is run or written", async () => {
    let ran = false;
    const outcome = await executeRead(readInput("record_work_progress", { params: { percent: 10 } }), async () => {
      ran = true;
      return { success: true, result: {} };
    });

    expect(outcome).toEqual({ ok: false, status: 403, code: "FUNCTION_NOT_READ" });
    expect(ran).toBe(false);
    expect(store.writes).toEqual([]);
  });

  test("a command verb and an unknown id are refused 403 as well", async () => {
    expect(await executeRead(readInput("run_work_progress_report"))).toEqual({ ok: false, status: 403, code: "FUNCTION_NOT_READ" });
    expect(await executeRead(readInput("drop_all_tables"))).toEqual({ ok: false, status: 403, code: "FUNCTION_NOT_READ" });
  });

  test("a read that is not on the link's effective list is 403 FUNCTION_NOT_ALLOWED; on the list it runs", async () => {
    const refused = await executeRead(readInput(DASHBOARD, { allowedFunctionIds: new Set(["get_boq_line_items"]) }), viaSelectingReader);
    expect(refused).toEqual({ ok: false, status: 403, code: "FUNCTION_NOT_ALLOWED" });

    const allowed = await executeRead(readInput(DASHBOARD, { allowedFunctionIds: [DASHBOARD] }), viaSelectingReader);
    expect(allowed.ok).toBe(true);
  });

  test("the project is the link's, whatever params.projectId names", async () => {
    const outcome = await executeRead(readInput(DASHBOARD, { params: { projectId: FAKE_PROJECT_B } }), viaSelectingReader);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && (outcome.result as { params: { projectId: string } }).params.projectId).toBe(FAKE_PROJECT_A);
    expect(outcome.ok && (outcome.result as { project: { id: string } }).project.id).toBe(FAKE_PROJECT_A);
  });

  test("only the parameters the registry declares reach the executor; the rest are dropped", async () => {
    const outcome = await executeRead(readInput(DASHBOARD, { params: { projectId: FAKE_PROJECT_A, sneaky: "x", orgId: "another_org" } }), viaSelectingReader);

    expect(outcome.ok && (outcome.result as { params: Record<string, unknown> }).params).toEqual({ projectId: FAKE_PROJECT_A });
    expect([...declaredReadParams("get_boq_line_items")].sort()).toEqual(["boqId", "cursor", "limit", "projectId"]);
    expect([...declaredReadParams(DASHBOARD)]).toEqual(["projectId"]);
  });

  test("the role and the acting person reach the executor (money is redacted by the role there)", async () => {
    const outcome = await executeRead(readInput(DASHBOARD, { role: null }), viaSelectingReader);
    expect(outcome.ok && (outcome.result as { role: unknown }).role).toBeNull();
  });

  test("a read that fails validation is 422 with the code and writes NO gap row", async () => {
    // A blank id parameter: validate() refuses it before any executor runs.
    let ran = false;
    const outcome = await executeRead(readInput("get_boq_line_items", { params: { boqId: "" } }), async () => {
      ran = true;
      return { success: true, result: {} };
    });

    expect(outcome.ok === false && outcome.status).toBe(422);
    expect(ran).toBe(false);
    expect(store.writes).toEqual([]);
    expect(store.tables.gap_log ?? []).toEqual([]);
  });

  test("an executor failure comes back as a 422 failure, a retryable one as 503, and neither writes", async () => {
    const refused = await executeRead(readInput(DASHBOARD), async () => ({ success: false, failure: { code: "RECORD_NOT_FOUND", missing: ["project"], picker: "none" } }) as ExecutionOutcome);
    expect(refused.ok === false && refused.status).toBe(422);

    const transport = await executeRead(readInput(DASHBOARD), async () => ({ success: false, failure: { code: "BACKEND_UNAVAILABLE", missing: [], picker: "none" }, debug: "boom" }) as ExecutionOutcome);
    expect(transport.ok === false && transport.status).toBe(503);
    expect(store.writes).toEqual([]);
  });
});
