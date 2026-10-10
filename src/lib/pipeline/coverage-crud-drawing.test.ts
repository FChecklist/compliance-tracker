/// <reference types="bun-types" />
// P5 (AI function coverage, 2026-10-08, ai-os/audit37/AI_FUNCTION_COVERAGE_2026-10-08.md) -- update_drawing (level 1, member rank 2, not money):
// the drawing edit PATCH /api/v1/projexa/drawings/{id} already offers, run through the same service. Same harness and same checks as
// update_permit in coverage-crud-b2.test.ts (coverage-suite.ts: link policy, link check, level, roles, foreign ids, free text), plus:
//   - a valid call as the right role runs the REAL service (document-service.ts updateDocumentMetadata) and the change reads back from the store;
//   - only name, discipline and a DRAWING category are taken; isExternalLink and the other metadata keys stay; a category that is not a drawing
//     category is refused; a document of this project that is not a drawing (a permit) reads as absent;
//   - a task of another organisation, a viewer and a task with no role write nothing.
//
// WHAT IS REAL: executor.ts, function-registry.ts, executors/crud-drawings.ts, document-service.ts, the generated link policy and the Edge handler.
// WHAT IS FAKED: only @/lib/db/tenant-scoped (coverage-fixtures.ts) and the link's own database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-crud-drawing.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { changedTables, makeStore, ORG, OTHER_ORG, PROJECT_A, PROJECT_B, PROJECT_X, snapshot, tableJson } from "./__test-helpers__/coverage-fixtures";
import { seedWave89Records, w79WithTenantContext } from "./__test-helpers__/coverage-w79";
import { defineCoverageSuite, failureOf, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: w79WithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

function seedDrawings(s: BoqStore): void {
  seedWave89Records(s);
  seedRows(s, "documents", [
    {
      id: "dwg_a", orgId: ORG, name: "GF plan rev B", fileUrl: "https://example.com/gf.pdf", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_A,
      metadata: { isExternalLink: true, drawingNo: "A-101", rev: "B", discipline: "structural" },
    },
    { id: "dwg_b", orgId: ORG, name: "Other plan", fileUrl: "https://example.com/b.pdf", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_B, metadata: {} },
    { id: "dwg_x", orgId: OTHER_ORG, name: "Elsewhere plan", fileUrl: "https://example.com/x.pdf", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_X, metadata: {} },
  ]);
}

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedDrawings(store);
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const run = (fn: string, params: Row, over: Partial<import("./executor").ExecutableTask> = {}) => executeTask(task(fn, params, over));
const row = (id: string): Row | undefined => rowsOf(store, "documents").find((r) => r.id === id);

export const CASES: Case[] = [
  {
    fn: "update_drawing", level: 1, minRank: 2, money: false, valid: { drawingId: "dwg_a", name: "GF plan rev C", discipline: "architectural", category: "drawing_3d" },
    required: [["drawingId", "value"]], text: ["name", "discipline"], foreign: [["drawingId", "dwg_b", "dwg_x"]],
  },
];

describe("update_drawing is registered, executable and a write", () => {
  test("it has an executor and writes", () => {
    expect({ executor: hasExecutor("update_drawing"), write: functionWrites("update_drawing") }).toEqual({ executor: true, write: true });
  });
});

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

describe("update_drawing: the real service's write, re-read from the store", () => {
  test("as a manager, writes only documents; name, category and discipline change; the other metadata keys stay", async () => {
    const before = tableJson(store);
    resultOf(await run("update_drawing", CASES[0].valid));
    expect(store.unparsed).toEqual([]);
    const written = changedTables(before, store).filter((t) => !(before[t] === undefined && JSON.stringify(store.tables[t]) === "[]"));
    expect(written).toEqual(["documents"]);
    const d = row("dwg_a")!;
    expect(d.name).toBe("GF plan rev C");
    expect(d.category).toBe("drawing_3d");
    expect(d.metadata).toEqual({ isExternalLink: true, drawingNo: "A-101", rev: "B", discipline: "architectural" });
    expect(row("dwg_b")!.name).toBe("Other plan");
  });

  test("as a member (the route's own rank), the write is made", async () => {
    resultOf(await run("update_drawing", { drawingId: "dwg_a", name: "Member rename" }, { role: "member" }));
    expect(row("dwg_a")!.name).toBe("Member rename");
  });

  test("a viewer, and a task with no role, are refused and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_drawing", { drawingId: "dwg_a", name: "Viewer rename" }, { role: "viewer" })).code).toBe("NOT_PERMITTED");
    expect(failureOf(await run("update_drawing", { drawingId: "dwg_a", name: "No role" }, { role: undefined })).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
    expect(row("dwg_a")!.name).toBe("GF plan rev B");
  });

  test("a category that is not a drawing category is refused (a drawing cannot be moved out of the register), and nothing is written", async () => {
    const before = snapshot(store);
    for (const category of ["permit", "other", "contract"]) {
      expect(failureOf(await run("update_drawing", { drawingId: "dwg_a", category })).code).toBe("REQUEST_REJECTED");
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a document of this project that is not a drawing (a permit) reads as absent, and stays", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_drawing", { drawingId: "doc_a", name: "Hijacked" }))).toMatchObject({ code: "RECORD_NOT_FOUND", context: { param: "drawingId" } });
    expect(snapshot(store)).toBe(before);
  });

  test("an empty patch is refused and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_drawing", { drawingId: "dwg_a" })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });

  test("a task of another organisation with this project's ids is refused, and nothing is written", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_drawing", CASES[0].valid, { orgId: OTHER_ORG })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot(store)).toBe(before);
  });
});
