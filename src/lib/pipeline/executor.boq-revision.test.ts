/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-28, register row BR-408: executeCreateBoqRevision
// forwarded only boqId and title to createBoqRevision(), so every revision the
// pipeline made copied the parent's lines unchanged, could never pass the
// scope-reduction override, and never recorded the change order it came from.
// It now forwards lineItems, allowScopeReductionOverride and
// sourceChangeOrderId, and each is proven here by what it DOES, re-read from
// the store rather than read off a spy:
//   - lineItems: the revision's re-read lines differ from the parent's and
//     equal the input; without lineItems they equal the parent's (the copy
//     default), so the difference is the forwarded list;
//   - allowScopeReductionOverride: reducing a line with recorded progress is
//     refused (409, nothing written) without it and written with it;
//   - sourceChangeOrderId: the approved change order's boq_revision_id is the
//     new revision's id afterwards; a draft change order is refused by the
//     service (so the id reached it), and a change order of another project is
//     refused by the executor before anything is written.
// Also: the revision is recorded under the confirming person, a BOQ of another
// project is still refused (U-18), the result carries no project-side cost
// field, and no two transactions are ever open at once.
//
// WHAT IS REAL: executor.ts, createBoqRevision() with its scope-reduction guard
// and change-order link, run-submission.ts for the pill case. WHAT IS FAKED:
// only @/lib/db/tenant-scoped (__test-helpers__/boq-store-double.ts).
//
// Run: bun test --isolate src/lib/pipeline/executor.boq-revision.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  fakeWithTenantContext,
  keysDeep,
  makeBoqStore,
  rowsOf,
  seedRows,
  type BoqStore,
  type Row,
} from "./__test-helpers__/boq-store-double";
import { PROJECT_SIDE_COST_FIELDS } from "@/lib/services/cost-visibility-service";

const ORG = "org_1";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const PERSON = "person_1";
const API_KEY = "apikey_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood" },
  ]);
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, title: "Original Scope", status: "approved", createdById: "someone_else" },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, title: "Oakwood Scope", status: "approved", createdById: "someone_else" },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "li_a1", orgId: ORG, boqId: "boq_a", itemCode: "A1", description: "Blockwork - Ground Floor", unit: "sqm", quantity: "100", rate: "50", amount: "5000", qtyProject: "95", rateProject: "41" },
    { id: "li_a2", orgId: ORG, boqId: "boq_a", itemCode: "A2", description: "Internal plaster", unit: "sqm", quantity: "200", rate: "20", amount: "4000" },
    { id: "li_b1", orgId: ORG, boqId: "boq_b", itemCode: "B1", description: "Facade cladding", unit: "sqm", quantity: "10", rate: "900", amount: "9000" },
  ]);
  // Work already done on A1 -- what the scope-reduction guard protects.
  seedRows(s, "construction_work_progress_entries", [
    { orgId: ORG, projectId: PROJECT_A, activityId: "act_a", boqLineItemId: "li_a1", entryDate: "2026-09-20", quantityDone: "40", percentComplete: "40" },
  ]);
  seedRows(s, "construction_change_orders", [
    { id: "co_ok", orgId: ORG, projectId: PROJECT_A, number: 7, title: "Extra waterproofing", status: "approved", requestedById: PERSON },
    { id: "co_draft", orgId: ORG, projectId: PROJECT_A, number: 8, title: "Pending change", status: "draft", requestedById: PERSON },
    { id: "co_b", orgId: ORG, projectId: PROJECT_B, number: 3, title: "Oakwood change", status: "approved", requestedById: PERSON },
  ]);
  return s;
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let runDirectTask: typeof import("./run-submission").runDirectTask;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ runDirectTask } = await import("./run-submission"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
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

/** A revision that ADDS scope: A1 up from 100 to 120, A2 unchanged, A3 new. Nothing already done is reduced. */
const GROWN: Row[] = [
  { itemCode: "A1", description: "Blockwork - Ground Floor", unit: "sqm", quantity: 120, rate: 50 },
  { itemCode: "A2", description: "Internal plaster", unit: "sqm", quantity: 200, rate: 20 },
  { itemCode: "A3", description: "Waterproofing", unit: "sqm", quantity: 80, rate: 35 },
];

/** A revision that REDUCES A1 (40% done on site) from 100 to 60. */
const REDUCED: Row[] = [
  { itemCode: "A1", description: "Blockwork - Ground Floor", unit: "sqm", quantity: 60, rate: 50 },
  { itemCode: "A2", description: "Internal plaster", unit: "sqm", quantity: 200, rate: 20 },
];

function task(params: Row, overrides: Partial<import("./executor").ExecutableTask> = {}): import("./executor").ExecutableTask {
  return {
    orgId: ORG,
    userId: API_KEY,
    projectId: PROJECT_A,
    functionId: "create_boq_revision",
    params: { boqId: "boq_a", title: "Rev 1", ...params },
    actorUserId: PERSON,
    ...overrides,
  };
}

const boq = (id: string) => rowsOf(store, "construction_boqs").find((b) => b.id === id)!;
const revisionsOf = (parentId: string) => rowsOf(store, "construction_boqs").filter((b) => b.parentBoqId === parentId);
const linesOf = (boqId: unknown) => rowsOf(store, "construction_boq_line_items").filter((l) => l.boqId === boqId);
const changeOrder = (id: string) => rowsOf(store, "construction_change_orders").find((c) => c.id === id)!;
/** What a line IS, independent of its row id: code, quantity, rate. */
const signature = (lines: Row[]) => lines.map((l) => `${l.itemCode}|${Number(l.quantity)}|${Number(l.rate)}`).sort();
const PARENT_SIGNATURE = ["A1|100|50", "A2|200|20"];

async function refusedWithNothingWritten(params: Row, overrides: Partial<import("./executor").ExecutableTask> = {}) {
  const before = JSON.stringify(store.tables);
  const outcome = await executeTask(task(params, overrides));
  expect(JSON.stringify(store.tables)).toBe(before);
  if (outcome.success) throw new Error("expected a refusal");
  return outcome.failure;
}

describe("BR-408: lineItems reaches createBoqRevision", () => {
  test("*** THE ROW: the re-read revision's line items differ from the parent's, and are the ones sent ***", async () => {
    const outcome = await executeTask(task({ lineItems: GROWN }));

    expect(outcome.success).toBe(true);
    const [revision] = revisionsOf("boq_a");
    expect([revision.version, revision.projectId, revision.orgId]).toEqual([2, PROJECT_A, ORG]);
    const revisionLines = linesOf(revision.id);
    const parentLines = linesOf("boq_a");
    expect(signature(revisionLines)).not.toEqual(signature(parentLines));
    expect(signature(revisionLines)).toEqual(["A1|120|50", "A2|200|20", "A3|80|35"]);
    // The parent keeps its own lines and is superseded by the revision.
    expect(signature(parentLines)).toEqual(PARENT_SIGNATURE);
    expect(boq("boq_a").status).toBe("superseded");
  });

  test("contrast: with no lineItems the revision copies the parent's lines -- so the difference above is the forwarded list", async () => {
    const outcome = await executeTask(task({}));

    expect(outcome.success).toBe(true);
    const [revision] = revisionsOf("boq_a");
    expect(signature(linesOf(revision.id))).toEqual(PARENT_SIGNATURE);
  });
});

describe("BR-408: allowScopeReductionOverride reaches createBoqRevision (the scope-reduction guard)", () => {
  test("without it, reducing A1 (40% done) is refused with the 409, and nothing is written", async () => {
    const failure = await refusedWithNothingWritten({ lineItems: REDUCED });

    expect(failure).toEqual({ code: "ALREADY_RECORDED", missing: [], context: { status: 409, functionId: "create_boq_revision" }, picker: "none" });
    expect(revisionsOf("boq_a")).toEqual([]);
    expect(boq("boq_a").status).toBe("approved");
  });

  test("with allowScopeReductionOverride: true the same reduction is written, A1 at 60", async () => {
    const outcome = await executeTask(task({ lineItems: REDUCED, allowScopeReductionOverride: true }));

    expect(outcome.success).toBe(true);
    const [revision] = revisionsOf("boq_a");
    expect(signature(linesOf(revision.id))).toEqual(["A1|60|50", "A2|200|20"]);
    expect(boq("boq_a").status).toBe("superseded");
  });

  test('only a real boolean overrides: the string "true" is refused like no override at all', async () => {
    const failure = await refusedWithNothingWritten({ lineItems: REDUCED, allowScopeReductionOverride: "true" });

    expect(failure.code).toBe("ALREADY_RECORDED");
  });
});

describe("BR-408: sourceChangeOrderId reaches createBoqRevision (the R-98 change-order link)", () => {
  test("an approved change order of this project is linked: its re-read boq_revision_id is the new revision", async () => {
    const outcome = await executeTask(task({ lineItems: GROWN, sourceChangeOrderId: "co_ok" }));

    expect(outcome.success).toBe(true);
    const [revision] = revisionsOf("boq_a");
    expect(changeOrder("co_ok").boqRevisionId).toBe(revision.id);
  });

  test("a draft change order is refused by the service (the id reached it): REQUEST_REJECTED, nothing written", async () => {
    const failure = await refusedWithNothingWritten({ lineItems: GROWN, sourceChangeOrderId: "co_draft" });

    expect(failure).toEqual({ code: "REQUEST_REJECTED", missing: [], context: { status: 400, functionId: "create_boq_revision" }, picker: "none" });
    expect(changeOrder("co_draft").boqRevisionId).toBeNull();
  });

  test("a change order of ANOTHER project is refused before anything is written, and stays unlinked", async () => {
    const failure = await refusedWithNothingWritten({ lineItems: GROWN, sourceChangeOrderId: "co_b" });

    expect(failure).toEqual({ code: "RECORD_NOT_FOUND", missing: [], context: { status: 404, functionId: "create_boq_revision" }, picker: "none" });
    expect(changeOrder("co_b").boqRevisionId).toBeNull();
    expect(revisionsOf("boq_a")).toEqual([]);
  });

  test("all three together: the reduced lines, the override and the change-order link land in one revision", async () => {
    const outcome = await executeTask(task({ lineItems: REDUCED, allowScopeReductionOverride: true, sourceChangeOrderId: "co_ok" }));

    expect(outcome.success).toBe(true);
    const [revision] = revisionsOf("boq_a");
    expect(signature(linesOf(revision.id))).toEqual(["A1|60|50", "A2|200|20"]);
    expect(changeOrder("co_ok").boqRevisionId).toBe(revision.id);
    expect(store.maxOpen).toBe(1);
    expect(store.unparsed).toEqual([]);
  });
});

describe("BR-408: actor, project and cost fields", () => {
  test("the revision is recorded under the person who confirmed, never the API key", async () => {
    await executeTask(task({ lineItems: GROWN }));

    const [revision] = revisionsOf("boq_a");
    expect(revision.createdById).toBe(PERSON);
  });

  test("a revision naming no person -> NOT_PERMITTED (unidentified_actor), nothing written", async () => {
    const failure = await refusedWithNothingWritten({ lineItems: GROWN }, { actorUserId: null });

    expect(failure).toEqual({ code: "NOT_PERMITTED", missing: [], context: { reason: "unidentified_actor" }, picker: "none" });
  });

  test("a BOQ of another project is still refused (U-18) with every forwarded field present, nothing written", async () => {
    const failure = await refusedWithNothingWritten({ boqId: "boq_b", lineItems: GROWN, allowScopeReductionOverride: true, sourceChangeOrderId: "co_ok" });

    expect(failure).toEqual({ code: "RECORD_NOT_FOUND", missing: ["boqVersion"], picker: "none" });
  });

  test("lineItems that is not a list -> REQUEST_REJECTED, nothing written (not a copy-forward reported as success)", async () => {
    const failure = await refusedWithNothingWritten({ lineItems: "A1 120 sqm" });

    expect(failure.code).toBe("REQUEST_REJECTED");
  });

  test("the result carries no project-side cost field, though the parent's lines carry them", async () => {
    const outcome = await executeTask(task({}));

    expect(outcome.success).toBe(true);
    const shipped = keysDeep(outcome.success ? outcome.result : null);
    for (const field of PROJECT_SIDE_COST_FIELDS) expect(shipped.has(field)).toBe(false);
    // Copied forward in storage, not in the result.
    const [revision] = revisionsOf("boq_a");
    expect(linesOf(revision.id).find((l) => l.itemCode === "A1")!.rateProject).toBe("41");
  });
});

describe("BR-408 through the pill path: validate() lets the three parameters through to the executor", () => {
  test("runDirectTask with all three -> done, the revision's lines are the ones sent, the change order is linked", async () => {
    const result = await runDirectTask({
      orgId: ORG,
      userId: API_KEY,
      mode: "Projects",
      projectId: PROJECT_A,
      functionId: "create_boq_revision",
      params: { boqId: "boq_a", lineItems: REDUCED, allowScopeReductionOverride: true, sourceChangeOrderId: "co_ok" },
      actorUserId: PERSON,
    });

    expect(result.status).toBe("done");
    const [revision] = revisionsOf("boq_a");
    expect(signature(linesOf(revision.id))).toEqual(["A1|60|50", "A2|200|20"]);
    expect(changeOrder("co_ok").boqRevisionId).toBe(revision.id);
    expect(revision.createdById).toBe(PERSON);
  });
});
