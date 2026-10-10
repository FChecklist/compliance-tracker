/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-28, register row BR-406: the function id `create_boq`
// is registered in EXECUTORS and WRITE_FUNCTION_IDS and wraps createBoq()
// (construction-boq-service.ts). A task carrying nested lineItems writes ONE
// BOQ, and the line items re-read from the store equal the input in number.
//
// Also proven here, because they are what makes the entry safe to register:
//   - the BOQ is recorded under the person who confirmed (task.actorUserId),
//     never under task.userId (the org API key's id on the PROJEXA proxy), and
//     a task naming no person is refused before anything is written;
//   - the tenant is the task's org and the project is the task's project: a
//     project of another org, or a params.projectId naming another project, is
//     refused with 0 BOQ rows written;
//   - a block that fails the registry (no title, no project) or that the
//     service cannot accept (lineItems not a list, a line with no description,
//     "line_items" in place of lineItems) is refused with the pipeline's
//     failure shape and writes nothing;
//   - the result carries no project-side cost field;
//   - the executor never holds two transactions open at once (D-06);
//   - through the pipeline, create_boq is a PROPOSAL until a person confirms:
//     proposeSubmission() writes no BOQ, confirmSubmission() does.
//
// WHAT IS REAL: executor.ts, function-registry.ts, validate(), run-submission.ts,
// createBoq() and every helper it calls. WHAT IS FAKED: only
// @/lib/db/tenant-scoped, by __test-helpers__/boq-store-double.ts, which
// evaluates the real compiled where clauses against fixture rows and commits a
// transaction's writes only when it resolves.
//
// Run: bun test --isolate src/lib/pipeline/executor.create-boq.test.ts
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
import { normaliseForMatch } from "./classify";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const PROJECT_OTHER_ORG = "project_x";
const PERSON = "person_1";
/** What task.userId holds for PROJEXA's proxy: the org API key's id, not a person. */
const API_KEY = "apikey_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere" },
  ]);
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }]);
  return s;
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
let EXECUTABLE_FUNCTION_IDS: typeof import("./executor").EXECUTABLE_FUNCTION_IDS;
let functionSpec: typeof import("./function-registry").functionSpec;
let WRITE_FUNCTION_IDS: typeof import("./function-registry").WRITE_FUNCTION_IDS;
let proposeSubmission: typeof import("./run-submission").proposeSubmission;
let confirmSubmission: typeof import("./run-submission").confirmSubmission;
let runDirectTask: typeof import("./run-submission").runDirectTask;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor, EXECUTABLE_FUNCTION_IDS } = await import("./executor"));
  ({ functionSpec, WRITE_FUNCTION_IDS } = await import("./function-registry"));
  ({ proposeSubmission, confirmSubmission, runDirectTask } = await import("./run-submission"));
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

/** Three lines, one of them a sub-task of another: the nested block a document extraction produces. */
function lineItems(): Row[] {
  return [
    { itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450, qtyProject: 110, rateProject: 380 },
    { itemCode: "1.02", description: "PCC 1:4:8 below footings", unit: "cum", quantity: 30, rate: 5200 },
    { itemCode: "1.02.1", parentItemCode: "1.02", breakdownPercentage: 40, description: "PCC labour", unit: "", quantity: 0, rate: 0 },
  ];
}

function task(params: Row, overrides: Partial<import("./executor").ExecutableTask> = {}): import("./executor").ExecutableTask {
  return { orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId: "create_boq", params, actorUserId: PERSON, ...overrides };
}

const boqs = () => rowsOf(store, "construction_boqs");
const linesOf = (boqId: unknown) => rowsOf(store, "construction_boq_line_items").filter((l) => l.boqId === boqId);
const nothingWritten = (before: string) => expect(JSON.stringify(store.tables)).toBe(before);

describe("BR-406: create_boq is a registered write that goes through the pipeline's write path", () => {
  test("it has an executor, is in WRITE_FUNCTION_IDS and the candidate set, so classify-only reports writes:true, executable:true", () => {
    expect(hasExecutor("create_boq")).toBe(true);
    expect(functionWrites("create_boq")).toBe(true);
    expect(WRITE_FUNCTION_IDS.has("create_boq")).toBe(true);
    expect(EXECUTABLE_FUNCTION_IDS).toContain("create_boq");
  });

  test("its registry spec: a project-scoped write that needs a project and a title, with a confirm card", () => {
    const spec = functionSpec("create_boq")!;
    expect(spec.kind).toBe("write");
    expect(spec.requiresProject).toBe(true);
    expect(spec.requiredParams.map((p) => [p.name, p.code])).toEqual([
      ["projectId", "PROJECT_REQUIRED"],
      ["title", "TITLE_REQUIRED"],
    ]);
    expect(spec.card?.primaryLabel).toBe("Save BOQ");
  });
});

describe("BR-406: a task with nested lineItems writes 1 BOQ, and the re-read line-item count equals the input count", () => {
  test("*** THE ROW: 1 BOQ on the task's project, and its re-read line items number exactly the input's ***", async () => {
    const input = lineItems();

    const outcome = await executeTask(task({ title: "Villa 21 - Tender BOQ", lineItems: input }));

    expect(outcome.success).toBe(true);
    // Re-read from the store, not from the result.
    expect(boqs()).toHaveLength(1);
    const [boq] = boqs();
    expect([boq.orgId, boq.projectId, boq.title, boq.version, boq.status]).toEqual([ORG, PROJECT_A, "Villa 21 - Tender BOQ", 1, "draft"]);
    const stored = linesOf(boq.id);
    expect(stored).toHaveLength(input.length);
    expect(stored.map((l) => l.itemCode).sort()).toEqual(["1.01", "1.02", "1.02.1"]);
    // Nested for real: the sub-task hangs off its parent's stored id.
    const parent = stored.find((l) => l.itemCode === "1.02")!;
    const child = stored.find((l) => l.itemCode === "1.02.1")!;
    expect(child.parentLineItemId).toBe(parent.id);
    expect(child.orgId).toBe(ORG);
    // The receipt names the row that was written.
    if (!outcome.success) return;
    const result = outcome.result as { id: string; route: string };
    expect(result.id).toBe(boq.id as string);
    expect(result.route).toBe(`/scope/${boq.id}`);
  });

  test("a BOQ with no lines (R-03) is still one BOQ with 0 re-read lines", async () => {
    const outcome = await executeTask(task({ title: "Empty scope" }));

    expect(outcome.success).toBe(true);
    expect(boqs()).toHaveLength(1);
    expect(linesOf(boqs()[0].id)).toHaveLength(0);
  });

  test("the executor never holds two transactions open at once (D-06), and every where clause was evaluated", async () => {
    await executeTask(task({ title: "Villa 21 - Tender BOQ", lineItems: lineItems() }));

    expect(store.maxOpen).toBe(1);
    expect(store.unparsed).toEqual([]);
  });

  test("a write task never returns a project-side cost field, even though one was written", async () => {
    const outcome = await executeTask(task({ title: "Villa 21 - Tender BOQ", lineItems: lineItems() }));

    expect(outcome.success).toBe(true);
    const shipped = keysDeep(outcome.success ? outcome.result : null);
    for (const field of PROJECT_SIDE_COST_FIELDS) expect(shipped.has(field)).toBe(false);
    // Stored as given -- the redaction is on what the task returns.
    const line = rowsOf(store, "construction_boq_line_items").find((l) => l.itemCode === "1.01")!;
    expect(line.rateProject).toBe("380");
    // The contract side stays visible (cost-visibility-service's rule).
    expect(shipped.has("lineItems")).toBe(true);
    expect(shipped.has("rate")).toBe(true);
  });
});

describe("BR-406: the audit actor is the person, never the API key", () => {
  test("createdById is task.actorUserId, not task.userId", async () => {
    await executeTask(task({ title: "Villa 21 - Tender BOQ", lineItems: lineItems() }));

    expect(boqs()[0].createdById).toBe(PERSON);
    expect(boqs()[0].createdById).not.toBe(API_KEY);
  });

  test("a task naming no person -> NOT_PERMITTED (unidentified_actor), 0 rows written", async () => {
    const before = JSON.stringify(store.tables);

    const outcome = await executeTask(task({ title: "Villa 21 - Tender BOQ", lineItems: lineItems() }, { actorUserId: null }));

    expect(outcome).toEqual({ success: false, failure: { code: "NOT_PERMITTED", missing: [], context: { reason: "unidentified_actor" }, picker: "none" } });
    nothingWritten(before);
  });
});

describe("BR-406: the tenant is the task's org and the project is the task's project", () => {
  test("params.projectId naming another project of the same org -> PROJECT_NOT_REACHABLE, 0 rows written", async () => {
    const before = JSON.stringify(store.tables);

    const outcome = await executeTask(task({ projectId: PROJECT_B, title: "Villa 21 - Tender BOQ", lineItems: lineItems() }));

    expect(outcome).toEqual({ success: false, failure: { code: "PROJECT_NOT_REACHABLE", missing: ["projectId"], picker: "project" } });
    nothingWritten(before);
  });

  test("a project of another org -> RECORD_NOT_FOUND (the service's own 404), 0 rows written", async () => {
    const before = JSON.stringify(store.tables);

    const outcome = await executeTask(task({ title: "Villa 21 - Tender BOQ", lineItems: lineItems() }, { projectId: PROJECT_OTHER_ORG }));

    expect(outcome.success).toBe(false);
    expect(outcome.success === false && outcome.failure.code).toBe("RECORD_NOT_FOUND");
    nothingWritten(before);
  });

  test("the BOQ and every line carry the task's org", async () => {
    await executeTask(task({ title: "Villa 21 - Tender BOQ", lineItems: lineItems() }));

    expect(boqs().map((b) => b.orgId)).toEqual([ORG]);
    expect(new Set(rowsOf(store, "construction_boq_line_items").map((l) => l.orgId))).toEqual(new Set([ORG]));
  });

  test("a project-A scoped pill naming project B -> PROJECT_NOT_REACHABLE, no task minted, no BOQ", async () => {
    const result = await runDirectTask({
      orgId: ORG, userId: API_KEY, mode: "Projects", functionId: "create_boq",
      params: { projectId: PROJECT_B, title: "Villa 21 - Tender BOQ", lineItems: lineItems() },
      actorUserId: PERSON,
      projectScope: PROJECT_A,
    });

    expect(result.failures.map((f) => f.code)).toEqual(["PROJECT_NOT_REACHABLE"]);
    expect(rowsOf(store, "pipeline_tasks")).toEqual([]);
    expect(boqs()).toEqual([]);
  });
});

describe("BR-406: a block that fails the registry or the service is refused with the pipeline's failure shape", () => {
  const refused = async (params: Row) => {
    const before = JSON.stringify(store.tables);
    const outcome = await executeTask(task(params));
    nothingWritten(before);
    if (outcome.success) throw new Error("expected a refusal");
    return outcome.failure;
  };

  test("no title -> TITLE_REQUIRED, asking for the title", async () => {
    expect(await refused({ lineItems: lineItems() })).toEqual({ code: "TITLE_REQUIRED", missing: ["title"], picker: "value" });
  });

  test("no project anywhere -> PROJECT_REQUIRED", async () => {
    const before = JSON.stringify(store.tables);
    const outcome = await executeTask(task({ title: "Villa 21 - Tender BOQ" }, { projectId: null }));
    expect(outcome).toEqual({ success: false, failure: { code: "PROJECT_REQUIRED", missing: ["projectId"], picker: "project" } });
    nothingWritten(before);
  });

  test("lineItems that is not a list -> REQUEST_REJECTED (the service's 400 shape), not INTERNAL_ERROR", async () => {
    const expected = { code: "REQUEST_REJECTED" as const, missing: [], context: { status: 400, functionId: "create_boq" }, picker: "none" as const };
    expect(await refused({ title: "T", lineItems: "1.01 Excavation 120 cum" })).toEqual(expected);
    expect(await refused({ title: "T", lineItems: { description: "Excavation" } })).toEqual(expected);
    expect(await refused({ title: "T", lineItems: [null] })).toEqual(expected);
  });

  test("a line the service will not accept (no description) -> REQUEST_REJECTED, and no half-written BOQ", async () => {
    const bad = [...lineItems(), { itemCode: "1.03", unit: "cum", quantity: 1, rate: 1 }];
    expect(await refused({ title: "T", lineItems: bad })).toEqual({
      code: "REQUEST_REJECTED",
      missing: [],
      context: { status: 400, functionId: "create_boq" },
      picker: "none",
    });
  });

  test('"line_items" in place of lineItems -> REQUEST_REJECTED, never a header-only BOQ reported as a success', async () => {
    const failure = await refused({ title: "T", line_items: lineItems() });
    expect(failure.code).toBe("REQUEST_REJECTED");
  });
});

describe("BR-406 through the pipeline: a proposal until a person confirms (PMD-05)", () => {
  const PHRASE = "new boq";

  beforeEach(() => {
    seedRows(store, "phrase_map", [{ orgId: ORG, normalisedPhrase: normaliseForMatch(PHRASE), functionId: "create_boq", fixedParams: null, promotedAt: new Date() }]);
    seedRows(store, "submissions", [{ id: "sub_1", orgId: ORG, projectId: PROJECT_A, mode: "Projects", rawInput: PHRASE, userId: API_KEY }]);
  });

  test("proposeSubmission resolves create_boq, asks for the title, and writes no BOQ", async () => {
    const proposal = await proposeSubmission({ orgId: ORG, userId: API_KEY, mode: "Projects", projectId: PROJECT_A, rawInput: PHRASE });

    const first = proposal.proposals[0];
    expect(first.functionId).toBe("create_boq");
    expect(first.status).toBe("needs_input");
    expect(first.missing.map((m) => m.code)).toEqual(["TITLE_REQUIRED"]);
    expect(boqs()).toEqual([]);
    expect(rowsOf(store, "pipeline_tasks")).toEqual([]);
  });

  test("confirmSubmission writes it: 1 BOQ under the confirming person, re-read line count = input count", async () => {
    const input = lineItems();

    const outcome = await confirmSubmission({
      orgId: ORG,
      userId: API_KEY,
      submissionId: "sub_1",
      functionId: "create_boq",
      params: { title: "Villa 21 - Tender BOQ", lineItems: input },
      role: "manager",
      actorUserId: PERSON,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("done");
    expect(boqs()).toHaveLength(1);
    expect(boqs()[0].createdById).toBe(PERSON);
    expect(linesOf(boqs()[0].id)).toHaveLength(input.length);
    // The persisted task result is the redacted one.
    const [persisted] = rowsOf(store, "pipeline_tasks");
    expect(persisted.status).toBe("done");
    for (const field of PROJECT_SIDE_COST_FIELDS) expect(keysDeep(persisted.result).has(field)).toBe(false);
  });

  test("a confirm with no person behind it is refused by the executor and writes no BOQ", async () => {
    const outcome = await confirmSubmission({
      orgId: ORG,
      userId: API_KEY,
      submissionId: "sub_1",
      functionId: "create_boq",
      params: { title: "Villa 21 - Tender BOQ", lineItems: lineItems() },
      actorUserId: null,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.failures.map((f) => f.code)).toEqual(["NOT_PERMITTED"]);
    expect(boqs()).toEqual([]);
  });
});
