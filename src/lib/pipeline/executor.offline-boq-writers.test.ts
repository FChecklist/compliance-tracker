/// <reference types="bun-types" />
// OFFLINE WRITERS 2 (PROJEXA offline BOQ create and BOQ revision): what the laptop sends when a person saves a BOQ or a revision with no network is
// create_boq / create_boq_revision on the AI work link. The laptop checks the same rules before it keeps the write; THIS file proves the server end of
// each rule, through the real executor, and re-reads the stored rows (never a spy), so a rule the laptop's copy got wrong is still caught on arrival.
//
// Sumeet's rules, each with an accepting and a refusing case:
//   - line amount = QTY x RATE; a sub-task's amount = ROOT qty x ROOT rate x breakdown %, and its own qty / rate are ignored;
//   - weights are NOT forced to add up to 100;
//   - a child with a parent but no percentage is refused; a parent code that matches nothing is refused; a circular reference is refused;
//   - a missing title is refused naming the field (the title);
//   - a revision can add a line and change a quantity or rate, and its variation vs the prior revision is the sum of the changes (BOQ total excludes
//     sub-tasks); removing a line that has progress is refused with SCOPE_REDUCTION_BLOCKED, and so is reducing one; nothing is written on a refusal.
//
// WHAT IS REAL: executor.ts, function-registry.ts, createBoq() / createBoqRevision() and the scope-reduction guard. WHAT IS FAKED: only
// @/lib/db/tenant-scoped (__test-helpers__/boq-store-double.ts).
//
// Run: bun test --isolate src/lib/pipeline/executor.offline-boq-writers.test.ts
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
    { id: "li_a3", orgId: ORG, boqId: "boq_a", itemCode: "A3", description: "Paint", unit: "sqm", quantity: "300", rate: "10", amount: "3000" },
  ]);
  // work already recorded on A1 (40% done) and nothing on A2 / A3
  seedRows(s, "construction_work_progress_entries", [
    { orgId: ORG, projectId: PROJECT_A, activityId: "act_a", boqLineItemId: "li_a1", entryDate: "2026-09-20", quantityDone: "40", percentComplete: "40" },
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

const task = (functionId: string, params: Row): import("./executor").ExecutableTask => ({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, actorUserId: PERSON });
const createBoq = (params: Row) => executeTask(task("create_boq", { title: "New scope", ...params }));
const revise = (params: Row) => executeTask(task("create_boq_revision", { boqId: "boq_a", title: "Rev 1", ...params }));

const boqs = () => rowsOf(store, "construction_boqs");
const linesOf = (boqId: unknown) => rowsOf(store, "construction_boq_line_items").filter((l) => l.boqId === boqId);
const line = (boqId: unknown, code: string) => linesOf(boqId).find((l) => l.itemCode === code)!;

async function refused(run: () => Promise<import("./executor").ExecutionOutcome>) {
  const before = JSON.stringify(store.tables);
  const outcome = await run();
  expect(JSON.stringify(store.tables)).toBe(before); // nothing stored on a refusal
  if (outcome.success) throw new Error("expected a refusal");
  return outcome.failure;
}

const ROOT = { itemCode: "R1", description: "Slab", unit: "cum", quantity: 100, rate: 50 };

describe("create_boq: amounts and sub-tasks, re-read from the store", () => {
  test("a root line's amount is QTY x RATE", async () => {
    const outcome = await createBoq({ lineItems: [ROOT] });
    expect(outcome.success).toBe(true);
    const [created] = boqs().filter((b) => b.id !== "boq_a");
    expect(Number(line(created.id, "R1").amount)).toBe(5000);
  });

  test("a sub-task's amount is ROOT qty x ROOT rate x breakdown %, and its own qty and rate are ignored", async () => {
    const outcome = await createBoq({ lineItems: [ROOT, { itemCode: "R1.1", parentItemCode: "R1", breakdownPercentage: 40, description: "Shuttering", unit: "", quantity: 7, rate: 9 }] });
    expect(outcome.success).toBe(true);
    const [created] = boqs().filter((b) => b.id !== "boq_a");
    const child = line(created.id, "R1.1");
    expect([Number(child.quantity), Number(child.rate), Number(child.amount)]).toEqual([100, 20, 2000]);
  });

  test("a grandchild prices off the ROOT, not its immediate parent", async () => {
    const outcome = await createBoq({
      lineItems: [ROOT, { itemCode: "R1.1", parentItemCode: "R1", breakdownPercentage: 50, description: "Part", unit: "", quantity: 0, rate: 0 }, { itemCode: "R1.1.1", parentItemCode: "R1.1", breakdownPercentage: 10, description: "Sub-part", unit: "", quantity: 0, rate: 0 }],
    });
    expect(outcome.success).toBe(true);
    const [created] = boqs().filter((b) => b.id !== "boq_a");
    expect(Number(line(created.id, "R1.1.1").amount)).toBe(500); // 100 x (50 x 10%)
  });

  test("weights are NOT forced to add up to 100: children of 30% and 30% are accepted", async () => {
    const outcome = await createBoq({
      lineItems: [ROOT, { itemCode: "R1.1", parentItemCode: "R1", breakdownPercentage: 30, description: "A", unit: "", quantity: 0, rate: 0 }, { itemCode: "R1.2", parentItemCode: "R1", breakdownPercentage: 30, description: "B", unit: "", quantity: 0, rate: 0 }],
    });
    expect(outcome.success).toBe(true);
    const [created] = boqs().filter((b) => b.id !== "boq_a");
    expect(linesOf(created.id)).toHaveLength(3);
  });

  test("a title-only BOQ (no lines) is one BOQ with no lines", async () => {
    const outcome = await createBoq({});
    expect(outcome.success).toBe(true);
    const [created] = boqs().filter((b) => b.id !== "boq_a");
    expect([created.title, linesOf(created.id)]).toEqual(["New scope", []]);
  });
});

describe("create_boq: what is refused, with nothing stored", () => {
  test("a child with a parent but no percentage", async () => {
    const failure = await refused(() => createBoq({ lineItems: [ROOT, { itemCode: "R1.1", parentItemCode: "R1", description: "Shuttering", unit: "", quantity: 0, rate: 0 }] }));
    expect(failure.code).toBe("REQUEST_REJECTED");
  });

  test("a parent code that matches nothing", async () => {
    const failure = await refused(() => createBoq({ lineItems: [ROOT, { itemCode: "R1.1", parentItemCode: "NOPE", breakdownPercentage: 40, description: "Shuttering", unit: "", quantity: 0, rate: 0 }] }));
    expect(failure.code).toBe("REQUEST_REJECTED");
  });

  test("a circular reference", async () => {
    const failure = await refused(() =>
      createBoq({
        lineItems: [ROOT, { itemCode: "C1", parentItemCode: "C2", breakdownPercentage: 10, description: "One", unit: "", quantity: 0, rate: 0 }, { itemCode: "C2", parentItemCode: "C1", breakdownPercentage: 10, description: "Two", unit: "", quantity: 0, rate: 0 }],
      })
    );
    expect(failure.code).toBe("REQUEST_REJECTED");
  });

  test("a missing title is refused, and the failure names the title", async () => {
    const failure = await refused(() => executeTask(task("create_boq", { lineItems: [ROOT] })));
    expect([failure.code, failure.missing]).toEqual(["TITLE_REQUIRED", ["title"]]);
  });

  test("a line with no description is refused", async () => {
    const failure = await refused(() => createBoq({ lineItems: [{ ...ROOT, description: "" }] }));
    expect(failure.code).toBe("REQUEST_REJECTED");
  });
});

describe("create_boq_revision: an accepted revision, re-read from the store", () => {
  // The parent's lines as the laptop sends them: a revision lists EVERY line it wants (a line left out is removed).
  const PARENT = [
    { itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: 100, rate: 50 },
    { itemCode: "A2", description: "Plaster", unit: "sqm", quantity: 200, rate: 20 },
    { itemCode: "A3", description: "Paint", unit: "sqm", quantity: 300, rate: 10 },
  ];

  test("adding a line and raising a quantity is written; the variation is the sum of the changes (+1,000 raised, +1,750 added)", async () => {
    const outcome = await revise({
      lineItems: [{ ...PARENT[0], quantity: 120 }, PARENT[1], PARENT[2], { itemCode: "A4", description: "Waterproofing", unit: "sqm", quantity: 50, rate: 35 }],
    });
    expect(outcome.success).toBe(true);
    const [revision] = boqs().filter((b) => b.parentBoqId === "boq_a");
    expect(revision.version).toBe(2);
    expect(boqs().find((b) => b.id === "boq_a")!.status).toBe("superseded");
    const total = (id: unknown) => linesOf(id).reduce((sum, l) => sum + Number(l.amount), 0);
    // the figure the laptop shows beforehand is exactly this difference
    expect(total(revision.id) - total("boq_a")).toBe(1000 + 1750);
    expect(Number(line(revision.id, "A4").amount)).toBe(1750);
  });

  test("changing a rate on a line with NO progress, and lowering it, is allowed", async () => {
    const outcome = await revise({ lineItems: [PARENT[0], { ...PARENT[1], rate: 15 }, PARENT[2]] });
    expect(outcome.success).toBe(true);
    const [revision] = boqs().filter((b) => b.parentBoqId === "boq_a");
    expect(Number(line(revision.id, "A2").amount)).toBe(3000);
  });

  test("RAISING a line that has progress is allowed (only reducing or removing is blocked)", async () => {
    const outcome = await revise({ lineItems: [{ ...PARENT[0], quantity: 150 }, PARENT[1], PARENT[2]] });
    expect(outcome.success).toBe(true);
  });
});

describe("create_boq_revision: a line with progress cannot be removed or reduced (SCOPE_REDUCTION_BLOCKED), nothing stored", () => {
  const PARENT_NO_A1 = [
    { itemCode: "A2", description: "Plaster", unit: "sqm", quantity: 200, rate: 20 },
    { itemCode: "A3", description: "Paint", unit: "sqm", quantity: 300, rate: 10 },
  ];

  test("removing A1 (40% done)", async () => {
    const failure = await refused(() => revise({ lineItems: PARENT_NO_A1 }));
    expect(failure).toEqual({ code: "SCOPE_REDUCTION_BLOCKED", missing: [], context: { status: 409, functionId: "create_boq_revision" }, picker: "none" });
  });

  test("reducing A1's quantity", async () => {
    const failure = await refused(() => revise({ lineItems: [{ itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: 60, rate: 50 }, ...PARENT_NO_A1] }));
    expect(failure.code).toBe("SCOPE_REDUCTION_BLOCKED");
  });

  test("reducing A1's rate", async () => {
    const failure = await refused(() => revise({ lineItems: [{ itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: 100, rate: 40 }, ...PARENT_NO_A1] }));
    expect(failure.code).toBe("SCOPE_REDUCTION_BLOCKED");
  });

  test("removing a line with NO progress (A3) is allowed", async () => {
    const outcome = await revise({
      lineItems: [{ itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: 100, rate: 50 }, PARENT_NO_A1[0]],
    });
    expect(outcome.success).toBe(true);
  });
});
