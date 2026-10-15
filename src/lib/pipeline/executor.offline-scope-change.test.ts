/// <reference types="bun-types" />
// OFFLINE WRITERS 3 (PROJEXA: add a scope item, and a change of scope, with no network; Sumeet R-96, R-97, R-98). What the laptop sends for both is
// create_boq_revision: a scope item is a revision that keeps every line and adds the new ones; a change of scope is the same revision with
// sourceChangeOrderId. The laptop checks the server's rules from its own copy first; THIS file proves the server end of the ones executor.boq-revision.test.ts
// does not, through the real executor, re-reading the stored rows:
//   - adding a scope item to a BOQ whose line has recorded progress is allowed (nothing is reduced), keeps every existing line, supersedes the parent;
//   - a change order already carried out by one revision cannot be linked to a second (409), and nothing is written;
//   - a revision for a change order that removes or reduces work with recorded progress is SCOPE_REDUCTION_BLOCKED, and the change order stays UNLINKED
//     (the link is made in the same transaction as the revision, so a refusal rolls it back);
//   - a BOQ can be revised once: a second revision of the same parent (two offline scope items made one after the other) is refused with nothing written.
//
// WHAT IS REAL: executor.ts, createBoqRevision() with the scope-reduction guard and the change-order link. WHAT IS FAKED: only @/lib/db/tenant-scoped.
//
// Run: bun test --isolate src/lib/pipeline/executor.offline-scope-change.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";

const ORG = "org_1";
const PROJECT_A = "project_a";
const PERSON = "person_1";
const API_KEY = "apikey_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [{ id: PROJECT_A, orgId: ORG, name: "Cedar Heights" }]);
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }]);
  seedRows(s, "construction_boqs", [{ id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, title: "Original Scope", status: "approved", createdById: "someone_else" }]);
  seedRows(s, "construction_boq_line_items", [
    { id: "li_a1", orgId: ORG, boqId: "boq_a", itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: "100", rate: "50", amount: "5000" },
    { id: "li_a2", orgId: ORG, boqId: "boq_a", itemCode: "A2", description: "Plaster", unit: "sqm", quantity: "200", rate: "20", amount: "4000" },
  ]);
  seedRows(s, "construction_work_progress_entries", [
    { orgId: ORG, projectId: PROJECT_A, activityId: "act_a", boqLineItemId: "li_a1", entryDate: "2026-09-20", quantityDone: "40", percentComplete: "40" },
  ]);
  seedRows(s, "construction_change_orders", [
    { id: "co_ok", orgId: ORG, projectId: PROJECT_A, number: 7, title: "Extra waterproofing", status: "approved", requestedById: PERSON },
    { id: "co_taken", orgId: ORG, projectId: PROJECT_A, number: 5, title: "Carried out already", status: "approved", requestedById: PERSON, boqRevisionId: "boq_earlier" },
  ]);
  return s;
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const revise = (params: Row) =>
  executeTask({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId: "create_boq_revision", params: { boqId: "boq_a", title: "Rev 1", ...params }, actorUserId: PERSON });

const boq = (id: string) => rowsOf(store, "construction_boqs").find((b) => b.id === id)!;
const revisionsOf = (parentId: string) => rowsOf(store, "construction_boqs").filter((b) => b.parentBoqId === parentId);
const linesOf = (boqId: unknown) => rowsOf(store, "construction_boq_line_items").filter((l) => l.boqId === boqId);
const changeOrder = (id: string) => rowsOf(store, "construction_change_orders").find((c) => c.id === id)!;
const signature = (lines: Row[]) => lines.map((l) => `${l.itemCode}|${Number(l.quantity)}|${Number(l.rate)}`).sort();

const KEPT: Row[] = [
  { itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: 100, rate: 50 },
  { itemCode: "A2", description: "Plaster", unit: "sqm", quantity: 200, rate: 20 },
];
const NEW_ITEM: Row = { itemCode: "A3", description: "Waterproofing", unit: "sqm", quantity: 80, rate: 35 };

async function refusedWithNothingWritten(params: Row) {
  const before = JSON.stringify(store.tables);
  const outcome = await revise(params);
  expect(JSON.stringify(store.tables)).toBe(before);
  if (outcome.success) throw new Error("expected a refusal");
  return outcome.failure;
}

describe("add a scope item: every line kept, the new one added", () => {
  test("A1 has 40% recorded on site; adding A3 is allowed, the parent is superseded and keeps its own lines", async () => {
    expect((await revise({ lineItems: [...KEPT, NEW_ITEM] })).success).toBe(true);
    const [revision] = revisionsOf("boq_a");
    expect(revision!.version).toBe(2);
    expect(signature(linesOf(revision!.id))).toEqual(["A1|100|50", "A2|200|20", "A3|80|35"]);
    expect(signature(linesOf("boq_a"))).toEqual(["A1|100|50", "A2|200|20"]);
    expect(boq("boq_a").status).toBe("superseded");
  });

  test("a BOQ can be revised once: a second revision of the same parent (a second offline scope item) is refused and nothing is written", async () => {
    expect((await revise({ lineItems: [...KEPT, NEW_ITEM] })).success).toBe(true);
    const failure = await refusedWithNothingWritten({ lineItems: [...KEPT, { ...NEW_ITEM, itemCode: "A4", description: "Second item" }] });
    expect(failure.code).toBe("ALREADY_RECORDED");
    expect(revisionsOf("boq_a")).toHaveLength(1);
  });
});

describe("change of scope: a revision carried out for an approved change order", () => {
  test("the change order is linked to the revision that carried it out", async () => {
    expect((await revise({ lineItems: [...KEPT, NEW_ITEM], sourceChangeOrderId: "co_ok" })).success).toBe(true);
    expect(changeOrder("co_ok").boqRevisionId).toBe(revisionsOf("boq_a")[0]!.id);
  });

  test("a change order already carried out by an earlier revision cannot be used again: refused, nothing written, the first link kept", async () => {
    const failure = await refusedWithNothingWritten({ lineItems: [...KEPT, NEW_ITEM], sourceChangeOrderId: "co_taken" });
    expect(failure.code).toBe("ALREADY_RECORDED");
    expect(changeOrder("co_taken").boqRevisionId).toBe("boq_earlier");
    expect(revisionsOf("boq_a")).toEqual([]);
  });

  test("a change of scope that REDUCES work with recorded progress is blocked, and the change order stays UNLINKED (the link rolls back with the revision)", async () => {
    const reduced = KEPT.map((l) => (l.itemCode === "A1" ? { ...l, quantity: 60 } : l));
    const failure = await refusedWithNothingWritten({ lineItems: reduced, sourceChangeOrderId: "co_ok" });
    expect(failure.code).toBe("SCOPE_REDUCTION_BLOCKED");
    expect(changeOrder("co_ok").boqRevisionId ?? null).toBeNull();
    expect(boq("boq_a").status).toBe("approved");
  });

  test("a change of scope that REMOVES a line with recorded progress is blocked the same way; removing a line with none (A2) is allowed", async () => {
    const failure = await refusedWithNothingWritten({ lineItems: KEPT.filter((l) => l.itemCode !== "A1"), sourceChangeOrderId: "co_ok" });
    expect(failure.code).toBe("SCOPE_REDUCTION_BLOCKED");
    expect((await revise({ lineItems: KEPT.filter((l) => l.itemCode !== "A2"), sourceChangeOrderId: "co_ok" })).success).toBe(true);
    expect(signature(linesOf(revisionsOf("boq_a")[0]!.id))).toEqual(["A1|100|50"]);
  });
});
