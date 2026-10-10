/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05e, register row AW-305: coverage wave 5 -- the minutes-of-meeting, drawing, note, material-receipt and timesheet
// decision functions an AI can call through a project link, by the role of the person and the project of the link.
//
// THE TEN FUNCTIONS
//   new executors   update_mom_minutes  add_meeting_action_item  add_meeting_outcome  publish_mom          (executors/meetings.ts)
//   reviewed for links, executor already there
//                   create_mom  create_drawing  capture_artifact  record_material_receipt  approve_timesheet  reject_timesheet
//
// PROVEN HERE, for EVERY function unless it says otherwise
//   the link, through the REAL Edge handler (coverage-link-checks-w56.ts): level, rank, money flag, free-text and id parameters as written
//     below; a link below the rank never lists the function; a valid check; each required parameter named when missing (422 on /actions for a
//     level-1 function); a level-2 function refused on /actions and a valid check and proposal instead (a draft the person confirms); a params
//     projectId of another project 403; an undeclared name and text over 2,000 characters are problems;
//   the executor, over the store double and recording fakes of the services each function wraps
//     - valid parameters succeed, the service is called once with the task's org, the acting person and the project's own record;
//     - each required parameter left out is refused with the registry's code and the parameter's D-03 key, and no service is reached;
//     - a caller that names no person is refused, and a role below the function's rank is refused (an absent or unknown role is rank 0);
//     - a params.projectId naming another project is PROJECT_NOT_REACHABLE;
//     - an id of a record of ANOTHER project (a meeting, a project meeting, a time entry) reads as absent: RECORD_NOT_FOUND, the service is not
//       reached and the store is unchanged;
//   and, where it applies
//     - free text is cleaned (control characters out) and refused above 2,000 characters, for strings and for the items of a list;
//     - a MoM action item may only be given to a person the project names (the lead, the team, the people on its tasks);
//     - the link never runs a model: publish_mom locks the minutes WITHOUT the intelligence pass, and add_meeting_action_item records the item
//       WITHOUT handing its title to the task execution engine (each is an option the service takes, on by default for every other caller);
//     - a published meeting cannot be amended: the service's 409 comes back as a refusal;
//     - a drawing link is kept only when it is https (it is stored as written and opened by people, never fetched);
//     - the material receipt's unit cost is null below the manager rank; the timesheet decisions are a manager's, judged from the person's own row.
//
// WHAT IS REAL: executor.ts, executors/meetings.ts, executors/scope.ts, function-registry.ts, run-submission's registry, the generated policy,
// the Edge handler. WHAT IS FAKED: @/lib/db/tenant-scoped (boq-store-double.ts: the executors' own lookups run their real where clauses against
// fixture rows), the services each function wraps, and the link's database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave5.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fakeWithTenantContext, makeBoqStore, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { describeLinkContract, registryRow, type LinkExpectation } from "./__test-helpers__/coverage-link-checks-w56";

const ORG = "org_1";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const MANAGER = "person_manager";
const MEMBER = "person_member";
const VIEWER = "person_viewer";
/** A person of the organisation that project A does not name. */
const OUTSIDER = "person_outsider";
const API_KEY = "apikey_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Zoomies Dubai", status: "active", leadUserId: MANAGER },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood", status: "active" },
  ]);
  seedRows(s, "users", [
    { id: MANAGER, orgId: ORG, isActive: true, role: "manager", name: "Asha Manager", email: "asha@example.com" },
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Ravi Member", email: "ravi@example.com" },
    { id: VIEWER, orgId: ORG, isActive: true, role: "viewer", name: "Meera Viewer", email: "meera@example.com" },
    { id: OUTSIDER, orgId: ORG, isActive: true, role: "member", name: "Omar Outsider", email: "omar@example.com" },
  ]);
  seedRows(s, "project_team_members", [{ id: "team_1", orgId: ORG, projectId: PROJECT_A, userId: MEMBER, role: "member" }]);
  seedRows(s, "veri_meetings", [
    { id: "mtg_a", orgId: ORG, title: "Site meeting", scheduledAt: new Date("2026-09-24T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_A, status: "draft" },
    { id: "mtg_pub", orgId: ORG, title: "Kick-off", scheduledAt: new Date("2026-09-01T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_A, status: "published" },
    { id: "mtg_b", orgId: ORG, title: "Other site", scheduledAt: new Date("2026-09-24T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_B, status: "draft" },
    { id: "mtg_deleted", orgId: ORG, title: "Removed", scheduledAt: new Date("2026-09-24T10:00:00Z"), contextEntityType: "project", contextEntityId: PROJECT_A, status: "deleted" },
    { id: "mtg_org", orgId: ORG, title: "All hands", scheduledAt: new Date("2026-09-24T10:00:00Z"), contextEntityType: null, contextEntityId: null, status: "draft" },
  ]);
  seedRows(s, "pms_meetings", [
    { id: "pms_a", orgId: ORG, projectId: PROJECT_A, title: "Coordination", scheduledAt: new Date("2026-09-24T10:00:00Z") },
    { id: "pms_b", orgId: ORG, projectId: PROJECT_B, title: "Other coordination", scheduledAt: new Date("2026-09-24T10:00:00Z") },
  ]);
  seedRows(s, "construction_materials", [
    { id: "mat_a", orgId: ORG, projectId: PROJECT_A, name: "Cement OPC 53", unit: "bag" },
    { id: "mat_b", orgId: ORG, projectId: PROJECT_B, name: "Steel TMT", unit: "kg" },
  ]);
  return s;
}

// ── the services each function wraps, as recording fakes ─────────────────────
type Args = unknown[];
const fn = {
  createVeriMeeting: mock(async (_c: unknown, input: Row) => ({ id: "mtg_new", ...input })),
  updateMeetingMinutes: mock(async (_c: unknown, id: string, minutes: string) => {
    if (id === "mtg_pub") throw new ServiceErrorRef.cls("This meeting is published and locked -- its details cannot be edited", 409);
    return { id, minutes };
  }),
  addMeetingActionItem: mock(async (_c: unknown, meetingId: string, input: Row, _opts?: Row) => ({ id: "action_1", meetingId, task: { id: "task_1", title: input.title, userId: input.assigneeUserId ?? MEMBER } })),
  publishVeriMeeting: mock(async (_c: unknown, id: string, _opts?: Row) => ({ id, status: "published" })),
  addMeetingOutcome: mock(async (_c: unknown, meetingId: string, notes: string) => ({ id: "outcome_1", meetingId, notes })),
  createDrawingRecord: mock(async (_c: unknown, input: Row) => ({ id: "drawing_new", ...input })),
  createMaterial: mock(async (_c: unknown, input: Row) => ({ id: "mat_new", ...input, unitCost: String(input.unitCost ?? 0) })),
  createMaterialReceipt: mock(async (_c: unknown, input: Row) => ({ id: "receipt_1", ...input, unitCost: String(input.unitCost ?? 0) })),
  getTimeEntry: mock(async (_c: unknown, id: string) => ({ id, projectId: id === "te_b" ? PROJECT_B : PROJECT_A, hours: "6.00" })),
  approveTimeEntry: mock(async (_c: unknown, id: string) => ({ id, userId: MEMBER, hours: "6.00", approvalStatus: "approved" })),
  rejectTimeEntry: mock(async (_c: unknown, id: string, reason?: string) => ({ id, userId: MEMBER, hours: "6.00", approvalStatus: "rejected", rejectionReason: reason })),
  recordTimesheetDecisionTasks: mock(async (..._a: Args) => ({ reviewTaskClosed: 1, returnedTaskCreated: false })),
  createSourceObject: mock(async (..._a: Args) => "source_1"),
};
// the service's own error class, loaded after the services (see the load order note)
const ServiceErrorRef: { cls: new (message: string, status: number) => Error } = { cls: Error as never };
const allMocks = (): Array<ReturnType<typeof mock>> => Object.values(fn);
const totalCalls = () => allMocks().reduce((sum, m) => sum + m.mock.calls.length, 0);

const restores: Array<[string, unknown]> = [];
function stub(path: string, real: object, overrides: object) {
  mock.module(path, () => ({ ...real, ...overrides }));
  restores.push([path, real]);
}

// LOAD ORDER. The service modules import each other in cycles, and a cycle only resolves for one entry order: the one executor.ts itself uses,
// which starts at construction-progress-service. So the real modules below are loaded in executor.ts's own order, each mocked right after it is
// loaded (the same preamble as executor-registry-u38.test.ts).
const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));
restores.push(["@/lib/db/tenant-scoped", realTenantScoped]);

await import("@/lib/services/construction-progress-service");
stub("@/lib/services/pms-time-service", await import("@/lib/services/pms-time-service"), { getTimeEntry: fn.getTimeEntry, approveTimeEntry: fn.approveTimeEntry, rejectTimeEntry: fn.rejectTimeEntry });
await import("@/lib/services/construction-dashboard-service");
await import("@/lib/services/construction-labour-service");
await import("@/lib/services/construction-boq-service");
await import("@/lib/services/cost-visibility-service");
stub("@/lib/services/pms-meeting-service", await import("@/lib/services/pms-meeting-service"), { addMeetingOutcome: fn.addMeetingOutcome });
stub("@/lib/services/document-service", await import("@/lib/services/document-service"), { createDrawingRecord: fn.createDrawingRecord });
await import("@/lib/services/construction-change-order-service");
await import("@/lib/services/construction-site-instruction-service");
await import("@/lib/services/construction-reports-service");
await import("@/lib/services/erp-accounting-service");
await import("@/lib/services/boq-analysis-service");
await import("@/lib/services/pms-issue-service");
await import("@/lib/services/schedule-service");
await import("@/lib/services/pms-taxonomy-service");
await import("@/lib/services/construction-billing-workflow-service");
const realVeri = await import("@/lib/services/veri-meeting-service");
ServiceErrorRef.cls = realVeri.ServiceError as never;
stub("@/lib/services/veri-meeting-service", realVeri, {
  createVeriMeeting: fn.createVeriMeeting, updateMeetingMinutes: fn.updateMeetingMinutes, addMeetingActionItem: fn.addMeetingActionItem, publishVeriMeeting: fn.publishVeriMeeting,
});
stub("@/lib/services/construction-materials-service", await import("@/lib/services/construction-materials-service"), { createMaterial: fn.createMaterial, createMaterialReceipt: fn.createMaterialReceipt });
stub("@/lib/services/timesheet-review-task-service", await import("@/lib/services/timesheet-review-task-service"), { recordTimesheetDecisionTasks: fn.recordTimesheetDecisionTasks });
stub("@/lib/crr/capture", await import("@/lib/crr/capture"), { createSourceObject: fn.createSourceObject });

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
let functionSpec: typeof import("./function-registry").functionSpec;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
  ({ functionSpec } = await import("./function-registry"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  for (const m of allMocks()) m.mockClear();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  for (const [path, real] of restores) await mock.module(path, () => real as object);
});

type Task = import("./executor").ExecutableTask;
const task = (functionId: string, params: Row, overrides: Partial<Task> = {}): Task => ({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, role: "manager", actorUserId: MANAGER, ...overrides });
const run = (functionId: string, params: Row, overrides?: Partial<Task>) => executeTask(task(functionId, params, overrides));
async function result(functionId: string, params: Row, overrides?: Partial<Task>): Promise<Row> {
  const outcome = await run(functionId, params, overrides);
  if (!outcome.success) throw new Error(`expected ${functionId} to succeed, got ${JSON.stringify(outcome.failure)}`);
  return outcome.result as Row;
}
async function failure(functionId: string, params: Row, overrides?: Partial<Task>) {
  const outcome = await run(functionId, params, overrides);
  if (outcome.success) throw new Error(`expected ${functionId} to be refused`);
  return outcome.failure;
}
const snapshot = () => JSON.stringify(store.tables);
const callOf = (m: { mock: { calls: unknown[][] } }, n = 0) => m.mock.calls[n];

// ── the ten functions: the parameters that are valid, what is required, the service each reaches, the id of another project ────────────────
type Case = {
  id: string;
  /** The lowest rank of the person (viewer 1, member 2, manager 3), and the role name one rank below it. */
  rank: 2 | 3;
  valid: Row;
  /** Each required parameter other than the project: [name, registry code, the key `missing` names: the registry field (a D-03 key) or the parameter's own name]. */
  required: Array<[string, string, string]>;
  /** The service the function reaches. */
  service: ReturnType<typeof mock>;
  /** An id parameter naming a record of another project, when the function has one. */
  foreign?: [string, string];
};
const CASES: Case[] = [
  { id: "create_mom", rank: 2, valid: { title: "Site meeting", scheduledAt: "2026-09-24T10:00:00.000Z" }, required: [["title", "TITLE_REQUIRED", "title"], ["scheduledAt", "DATE_REQUIRED", "scheduledAt"]], service: fn.createVeriMeeting },
  { id: "update_mom_minutes", rank: 2, valid: { meetingId: "mtg_a", minutes: "Slab pour agreed for Monday." }, required: [["meetingId", "VALUE_REQUIRED", "value"], ["minutes", "VALUE_REQUIRED", "value"]], service: fn.updateMeetingMinutes, foreign: ["meetingId", "mtg_b"] },
  { id: "add_meeting_action_item", rank: 2, valid: { meetingId: "mtg_a", title: "Order the rubber tiles" }, required: [["meetingId", "VALUE_REQUIRED", "value"], ["title", "TITLE_REQUIRED", "title"]], service: fn.addMeetingActionItem, foreign: ["meetingId", "mtg_b"] },
  { id: "add_meeting_outcome", rank: 2, valid: { meetingId: "pms_a", notes: "Client accepted the mock-up." }, required: [["meetingId", "VALUE_REQUIRED", "value"], ["notes", "VALUE_REQUIRED", "value"]], service: fn.addMeetingOutcome, foreign: ["meetingId", "pms_b"] },
  { id: "publish_mom", rank: 3, valid: { meetingId: "mtg_a" }, required: [["meetingId", "VALUE_REQUIRED", "value"]], service: fn.publishVeriMeeting, foreign: ["meetingId", "mtg_b"] },
  { id: "create_drawing", rank: 2, valid: { name: "AR-101 Ground floor plan", externalUrl: "https://example.com/AR-101-A" }, required: [["name", "TITLE_REQUIRED", "name"], ["externalUrl", "LINK_REQUIRED", "externalUrl"]], service: fn.createDrawingRecord },
  { id: "capture_artifact", rank: 2, valid: { title: "Precedent", text: "Slab shuttering was left for 7 days." }, required: [["title", "TITLE_REQUIRED", "title"], ["text", "VALUE_REQUIRED", "text"]], service: fn.createSourceObject },
  { id: "record_material_receipt", rank: 2, valid: { materialId: "mat_a", quantity: 20 }, required: [["materialId", "MATERIAL_REQUIRED", "material"], ["quantity", "QUANTITY_REQUIRED", "value"]], service: fn.createMaterialReceipt, foreign: ["materialId", "mat_b"] },
  { id: "approve_timesheet", rank: 3, valid: { timeEntryId: "te_a" }, required: [["timeEntryId", "VALUE_REQUIRED", "value"]], service: fn.approveTimeEntry, foreign: ["timeEntryId", "te_b"] },
  { id: "reject_timesheet", rank: 3, valid: { timeEntryId: "te_a", rejectionReason: "Hours do not match the task" }, required: [["timeEntryId", "VALUE_REQUIRED", "value"], ["rejectionReason", "VALUE_REQUIRED", "value"]], service: fn.rejectTimeEntry, foreign: ["timeEntryId", "te_b"] },
];
/** The role one rank below the function's, and one at it. */
const BELOW = (rank: number) => (rank === 3 ? "member" : "viewer");

// ═══ THE LINK: the policy written out again, and the checks that hold for every function ═════════════════════════════════════════════════
// [id, kind, level, rank, money, free text, id parameters, valid call, required]
const EXPECT: LinkExpectation[] = [
  { id: "create_mom", kind: "write", level: 1, rank: 2, money: false, text: ["title", "minutes", "meetingType", "attendees", "agenda"], ids: [], valid: { title: "Site meeting", scheduledAt: "2026-09-24T10:00:00Z", attendees: ["Asha"], actionItems: [{ title: "Order tiles" }] }, required: ["title", "scheduledAt"] },
  { id: "update_mom_minutes", kind: "write", level: 1, rank: 2, money: false, text: ["minutes"], ids: ["meetingId"], valid: { meetingId: "mtg_a", minutes: "Slab pour agreed." }, required: ["meetingId", "minutes"] },
  { id: "add_meeting_action_item", kind: "write", level: 1, rank: 2, money: false, text: ["title"], ids: ["assigneeUserId", "meetingId"], valid: { meetingId: "mtg_a", title: "Order tiles", dueDate: "2026-10-01" }, required: ["meetingId", "title"] },
  { id: "add_meeting_outcome", kind: "write", level: 1, rank: 2, money: false, text: ["notes"], ids: ["meetingId"], valid: { meetingId: "pms_a", notes: "Client accepted the mock-up." }, required: ["meetingId", "notes"] },
  { id: "publish_mom", kind: "write", level: 2, rank: 3, money: false, text: [], ids: ["meetingId"], valid: { meetingId: "mtg_a" }, required: ["meetingId"] },
  { id: "create_drawing", kind: "write", level: 2, rank: 2, money: false, text: ["name", "externalUrl", "drawingNo", "rev", "discipline", "kind"], ids: [], valid: { name: "AR-101 plan", externalUrl: "https://example.com/a", drawingNo: "AR-101", rev: "B", status: "current" }, required: ["name", "externalUrl"] },
  { id: "capture_artifact", kind: "write", level: 1, rank: 2, money: false, text: ["title", "text"], ids: [], valid: { title: "Precedent", text: "Slab shuttering was left for 7 days." }, required: ["title", "text"] },
  { id: "record_material_receipt", kind: "write", level: 2, rank: 2, money: true, text: ["materialName", "reference", "notes", "spec", "unit"], ids: ["materialId"], valid: { materialId: "mat_a", quantity: 20, unitCost: 410 }, required: ["materialId", "quantity"] },
  { id: "approve_timesheet", kind: "write", level: 2, rank: 3, money: false, text: [], ids: ["timeEntryId"], valid: { timeEntryId: "te_a" }, required: ["timeEntryId"] },
  { id: "reject_timesheet", kind: "write", level: 2, rank: 3, money: false, text: ["rejectionReason"], ids: ["timeEntryId"], valid: { timeEntryId: "te_a", rejectionReason: "Hours do not match the task" }, required: ["timeEntryId", "rejectionReason"] },
];
for (const e of EXPECT) describeLinkContract(e);

describe("AW-305: the ten functions are in the generated registry and have an executor", () => {
  test("each is a write with an executor, and the four new ones are new (their executors are in executors/meetings.ts)", () => {
    expect(CASES).toHaveLength(10);
    expect(EXPECT).toHaveLength(10);
    for (const c of CASES) {
      expect({ id: c.id, executor: hasExecutor(c.id), writes: functionWrites(c.id), row: !!registryRow(c.id) }).toEqual({ id: c.id, executor: true, writes: true, row: true });
    }
  });

  test("create_mom, create_drawing and record_material_receipt declare the parameters their executors read that are not card fields", () => {
    expect(registryRow("create_mom")!.declared_params).toEqual(expect.arrayContaining(["meetingType", "attendees", "agenda", "actionItems", "minutes"]));
    expect(registryRow("create_drawing")!.declared_params).toEqual(expect.arrayContaining(["kind", "drawingNo", "rev", "discipline", "status"]));
    expect(registryRow("record_material_receipt")!.declared_params).toEqual(expect.arrayContaining(["unit", "spec", "notes", "materialName", "unitCost", "receivedDate", "reference"]));
  });

  test("an organisation supplier is not a link parameter: vendorId is not declared for a material receipt (the internal pipeline still takes it)", () => {
    expect(registryRow("record_material_receipt")!.declared_params).not.toContain("vendorId");
  });
});

// ═══ THE EXECUTOR: what holds for every function ══════════════════════════════════════════════════════════════════════════════════════════
describe("AW-305: valid parameters succeed and reach the service once, as the acting person", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    const outcome = await run(c.id, c.valid);
    expect({ id: c.id, ok: outcome.success }).toEqual({ id: c.id, ok: true });
    expect(c.service).toHaveBeenCalledTimes(1);
  });

  test("the service gets the task's org and the acting person, never the API key's id, and the project's own meeting", async () => {
    await result("update_mom_minutes", { meetingId: "mtg_a", minutes: "Slab pour agreed." }, { actorUserId: MEMBER, role: "member" });
    const [ctx, id, minutes] = callOf(fn.updateMeetingMinutes) as [{ orgId: string; userId: string; dbUser: Row }, string, string];
    expect([ctx.orgId, ctx.userId, ctx.dbUser.id, id, minutes]).toEqual([ORG, MEMBER, MEMBER, "mtg_a", "Slab pour agreed."]);
    await result("add_meeting_outcome", { meetingId: "pms_a", notes: "Accepted." });
    expect(callOf(fn.addMeetingOutcome)).toEqual([{ orgId: ORG }, "pms_a", "Accepted."]);
  });
});

describe("AW-305: each required parameter left out is refused with the registry's code and the key it names, and no service is reached", () => {
  for (const c of CASES) {
    for (const [name, code, key] of c.required) {
      test(`${c.id} without ${name} -> ${code} [${key}]`, async () => {
        const params = { ...c.valid };
        delete params[name];
        const before = snapshot();
        const refused = await failure(c.id, params);
        expect({ code: refused.code, missing: refused.missing }).toEqual({ code, missing: [key] });
        expect(totalCalls()).toBe(0);
        expect(snapshot()).toBe(before);
      });
    }
  }
});

describe("AW-305: the person and the rank", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s: a caller that names no person is refused, and a role below the rank is refused; nothing is reached", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    const before = snapshot();
    const noPerson = await run(c.id, c.valid, { actorUserId: null });
    expect(noPerson).toMatchObject({ success: false, failure: { code: "NOT_PERMITTED" } });
    for (const role of [BELOW(c.rank), undefined, null, "no_such_role"]) {
      const refused = await run(c.id, c.valid, { role });
      expect({ id: c.id, role, ok: refused.success }).toEqual({ id: c.id, role, ok: false });
      expect(refused).toMatchObject({ failure: { code: "NOT_PERMITTED" } });
    }
    expect(totalCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    // and the rank itself is enough
    expect((await run(c.id, c.valid, { role: c.rank === 3 ? "manager" : "member", actorUserId: c.rank === 3 ? MANAGER : MEMBER })).success).toBe(true);
  });

  test("a rank above the floor is enough too (an admin)", async () => {
    expect((await run("add_meeting_action_item", { meetingId: "mtg_a", title: "Order tiles" }, { role: "admin" })).success).toBe(true);
  });
});

describe("AW-305: the project", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s: a params.projectId naming another project is PROJECT_NOT_REACHABLE, and no project at all is PROJECT_REQUIRED", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    expect(await failure(c.id, { ...c.valid, projectId: PROJECT_B })).toEqual({ code: "PROJECT_NOT_REACHABLE", missing: ["projectId"], picker: "project" });
    // a function the registry says needs no project (a note, a timesheet decision) may run with none; the others need one
    if (functionSpec(c.id)!.requiresProject) expect(await failure(c.id, c.valid, { projectId: null })).toMatchObject({ code: "PROJECT_REQUIRED" });
    expect(totalCalls()).toBe(0);
  });
});

describe("AW-305: an id of a record of ANOTHER project reads as absent: RECORD_NOT_FOUND, the service is not reached and nothing is written", () => {
  for (const c of CASES.filter((x) => x.foreign)) {
    test(`${c.id} with ${c.foreign![0]} = ${c.foreign![1]}`, async () => {
      const before = snapshot();
      const refused = await failure(c.id, { ...c.valid, [c.foreign![0]]: c.foreign![1] });
      expect(refused.code).toBe("RECORD_NOT_FOUND");
      // the timesheet decisions read the entry first (getTimeEntry, a read whose answer is dropped); no service that writes is reached
      expect(totalCalls() - fn.getTimeEntry.mock.calls.length).toBe(0);
      expect(c.service).toHaveBeenCalledTimes(0);
      expect(snapshot()).toBe(before);
    });
  }

  test("a meeting that does not exist, one that is not the project's (no context), and a deleted one read the same way as another project's", async () => {
    for (const meetingId of ["mtg_missing", "mtg_org", "mtg_deleted"]) {
      for (const id of ["update_mom_minutes", "add_meeting_action_item", "publish_mom"]) {
        const params = id === "update_mom_minutes" ? { meetingId, minutes: "x" } : id === "add_meeting_action_item" ? { meetingId, title: "x" } : { meetingId };
        expect({ id, meetingId, code: (await failure(id, params)).code }).toEqual({ id, meetingId, code: "RECORD_NOT_FOUND" });
      }
    }
    // a project meeting of the other kind: a MoM id is not a pms meeting and the reverse
    expect((await failure("add_meeting_outcome", { meetingId: "mtg_a", notes: "x" })).code).toBe("RECORD_NOT_FOUND");
    expect((await failure("update_mom_minutes", { meetingId: "pms_a", minutes: "x" })).code).toBe("RECORD_NOT_FOUND");
    expect(totalCalls()).toBe(0);
  });

  test("a record of another organisation is absent as well", async () => {
    seedRows(store, "veri_meetings", [{ id: "mtg_x", orgId: "org_2", title: "Elsewhere", scheduledAt: new Date(), contextEntityType: "project", contextEntityId: PROJECT_A, status: "draft" }]);
    expect((await failure("update_mom_minutes", { meetingId: "mtg_x", minutes: "x" })).code).toBe("RECORD_NOT_FOUND");
    expect(totalCalls()).toBe(0);
  });
});

describe("AW-305: free text is cleaned and capped, for strings and for the items of a list", () => {
  const CTRL = String.fromCharCode(0x202e, 0x200b, 0x7);

  test("minutes, an action item title and an outcome are cleaned (control, zero-width and bidi characters out) and reach the service clean", async () => {
    await result("update_mom_minutes", { meetingId: "mtg_a", minutes: `Slab${CTRL} pour` });
    expect(callOf(fn.updateMeetingMinutes)[2]).toBe("Slab pour");
    await result("add_meeting_action_item", { meetingId: "mtg_a", title: `Order${CTRL} tiles` });
    expect((callOf(fn.addMeetingActionItem)[2] as Row).title).toBe("Order tiles");
    await result("add_meeting_outcome", { meetingId: "pms_a", notes: `Accepted${CTRL}` });
    expect(callOf(fn.addMeetingOutcome)[2]).toBe("Accepted");
  });

  test("text over 2,000 characters is refused with nothing written, exactly 2,000 is kept", async () => {
    for (const [id, params, key] of [
      ["update_mom_minutes", { meetingId: "mtg_a" }, "minutes"],
      ["add_meeting_action_item", { meetingId: "mtg_a" }, "title"],
      ["add_meeting_outcome", { meetingId: "pms_a" }, "notes"],
    ] as Array<[string, Row, string]>) {
      const refused = await failure(id, { ...params, [key]: "x".repeat(2001) });
      expect({ id, code: refused.code }).toEqual({ id, code: "REQUEST_REJECTED" });
      expect((await run(id, { ...params, [key]: "x".repeat(2000) })).success).toBe(true);
    }
  });

  test("a value that is only control characters is empty: it is the missing-value refusal, not a blank record", async () => {
    expect((await failure("update_mom_minutes", { meetingId: "mtg_a", minutes: CTRL })).code).toBe("VALUE_REQUIRED");
    expect((await failure("add_meeting_action_item", { meetingId: "mtg_a", title: CTRL })).code).toBe("TITLE_REQUIRED");
  });

  test("create_mom: the attendees and the agenda are lists, so the link's cap does not see them: each item is cleaned, and 2,001 characters or 51 items are refused", async () => {
    await result("create_mom", { ...CASES[0].valid, attendees: [`Asha${CTRL}`, "Ravi", "  "], agenda: "Slab pour", minutes: `Agreed${CTRL}` });
    expect(callOf(fn.createVeriMeeting)[1]).toMatchObject({ attendees: ["Asha", "Ravi"], agenda: ["Slab pour"], minutes: "Agreed" });
    fn.createVeriMeeting.mockClear();
    for (const bad of [{ attendees: ["x".repeat(2001)] }, { agenda: ["ok", "x".repeat(2001)] }, { attendees: Array.from({ length: 51 }, (_, i) => `P${i}`) }, { attendees: [5] }, { agenda: { a: 1 } }, { minutes: "x".repeat(2001) }, { title: "x".repeat(2001) }]) {
      expect({ bad: Object.keys(bad)[0], code: (await failure("create_mom", { ...CASES[0].valid, ...bad })).code }).toEqual({ bad: Object.keys(bad)[0], code: "REQUEST_REJECTED" });
    }
    expect(fn.createVeriMeeting).toHaveBeenCalledTimes(0);
    expect((await run("create_mom", { ...CASES[0].valid, attendees: Array.from({ length: 50 }, (_, i) => `P${i}`) })).success).toBe(true);
  });
});

describe("AW-305: an action item may only be given to a person the project names", () => {
  test("add_meeting_action_item: the lead, a team member and a person on one of the project's tasks are allowed; an organisation member the project does not name is not", async () => {
    seedRows(store, "pms_issues", [{ id: "issue_1", orgId: ORG, projectId: PROJECT_A, number: 1, title: "Joinery", assigneeId: VIEWER, createdById: MANAGER }]);
    for (const assigneeUserId of [MANAGER, MEMBER, VIEWER]) {
      fn.addMeetingActionItem.mockClear();
      expect({ assigneeUserId, ok: (await run("add_meeting_action_item", { meetingId: "mtg_a", title: "Order tiles", assigneeUserId })).success }).toEqual({ assigneeUserId, ok: true });
      expect((callOf(fn.addMeetingActionItem)[2] as Row).assigneeUserId).toBe(assigneeUserId);
    }
    fn.addMeetingActionItem.mockClear();
    const refused = await failure("add_meeting_action_item", { meetingId: "mtg_a", title: "Order tiles", assigneeUserId: OUTSIDER });
    expect(refused).toMatchObject({ code: "RECORD_NOT_FOUND", missing: ["worker"] });
    expect(fn.addMeetingActionItem).toHaveBeenCalledTimes(0);
  });

  test("the acting person may always give an action item to themselves, even where the project names them nowhere", async () => {
    expect((await run("add_meeting_action_item", { meetingId: "mtg_a", title: "Order tiles", assigneeUserId: OUTSIDER }, { actorUserId: OUTSIDER, role: "member" })).success).toBe(true);
    expect((await run("create_mom", { ...CASES[0].valid, actionItems: [{ title: "Order tiles", assigneeUserId: OUTSIDER }] }, { actorUserId: OUTSIDER, role: "member" })).success).toBe(true);
  });

  test("a person of another project's team is not the project's: the same refusal", async () => {
    seedRows(store, "project_team_members", [{ id: "team_b", orgId: ORG, projectId: PROJECT_B, userId: OUTSIDER, role: "member" }]);
    expect((await failure("add_meeting_action_item", { meetingId: "mtg_a", title: "Order tiles", assigneeUserId: OUTSIDER })).code).toBe("RECORD_NOT_FOUND");
  });

  test("create_mom: every action item's assignee must be a person of the project; one outsider refuses the whole MoM, nothing is created", async () => {
    const ok = await run("create_mom", { ...CASES[0].valid, actionItems: [{ title: "Order tiles", assigneeUserId: MEMBER }, { title: "Book crane" }] });
    expect(ok.success).toBe(true);
    expect((callOf(fn.createVeriMeeting)[1] as Row).actionItems).toEqual([
      { title: "Order tiles", assigneeUserId: MEMBER, dueDate: undefined },
      { title: "Book crane", assigneeUserId: undefined, dueDate: undefined },
    ]);
    fn.createVeriMeeting.mockClear();
    const refused = await failure("create_mom", { ...CASES[0].valid, actionItems: [{ title: "Order tiles", assigneeUserId: MEMBER }, { title: "Book crane", assigneeUserId: OUTSIDER }] });
    expect(refused).toMatchObject({ code: "RECORD_NOT_FOUND", missing: ["worker"] });
    expect(fn.createVeriMeeting).toHaveBeenCalledTimes(0);
  });

  test("create_mom: action items that are not a list of objects, more than 25 of them, or with a title over 2,000 characters are refused", async () => {
    for (const actionItems of ["Order tiles", [5], [["x"]], Array.from({ length: 26 }, (_, i) => ({ title: `A${i}` })), [{ title: "x".repeat(2001) }]]) {
      expect((await failure("create_mom", { ...CASES[0].valid, actionItems })).code).toBe("REQUEST_REJECTED");
    }
    expect(fn.createVeriMeeting).toHaveBeenCalledTimes(0);
  });
});

describe("AW-305: the link never runs a model", () => {
  test("publish_mom locks the minutes WITHOUT the intelligence pass (generateIntelligence: false)", async () => {
    await result("publish_mom", { meetingId: "mtg_a" });
    expect(fn.publishVeriMeeting).toHaveBeenCalledTimes(1);
    expect(callOf(fn.publishVeriMeeting)[2]).toEqual({ generateIntelligence: false });
  });

  test("add_meeting_action_item records the item WITHOUT handing its title to the task execution engine (autoExecute: false)", async () => {
    await result("add_meeting_action_item", { meetingId: "mtg_a", title: "Order tiles" });
    expect(callOf(fn.addMeetingActionItem)[3]).toEqual({ autoExecute: false });
  });

  test("the two off switches are options of the services and default on: an existing caller passes nothing and still gets the model pass", async () => {
    const src = await Bun.file(new URL("../services/veri-meeting-service.ts", import.meta.url)).text();
    expect(src).toContain("opts: { generateIntelligence?: boolean } = {}");
    expect(src).toContain("opts.generateIntelligence !== false");
    expect(src).toContain("opts: { autoExecute?: boolean } = {}");
    expect(src).toContain("opts.autoExecute === false");
  });
});

describe("AW-305: publish_mom is a manager's, and a published meeting cannot be amended", () => {
  test("the person's own row must be a manager's as well as the task's role: a member row with a manager role on the task is refused", async () => {
    const refused = await failure("publish_mom", { meetingId: "mtg_a" }, { actorUserId: MEMBER, role: "manager" });
    expect(refused).toMatchObject({ code: "NOT_PERMITTED", context: { reason: "manager_rank_required" } });
    expect(fn.publishVeriMeeting).toHaveBeenCalledTimes(0);
  });

  test("an unknown or inactive acting person is refused before the service", async () => {
    expect((await failure("publish_mom", { meetingId: "mtg_a" }, { actorUserId: "person_nobody" })).code).toBe("NOT_PERMITTED");
    expect((await failure("update_mom_minutes", { meetingId: "mtg_a", minutes: "x" }, { actorUserId: "person_nobody" })).code).toBe("NOT_PERMITTED");
    expect(totalCalls()).toBe(0);
  });

  test("update_mom_minutes on a published meeting: the service's 409 is ALREADY_RECORDED and nothing changes", async () => {
    const refused = await failure("update_mom_minutes", { meetingId: "mtg_pub", minutes: "Late edit" });
    expect(refused.code).toBe("ALREADY_RECORDED");
    expect(fn.updateMeetingMinutes).toHaveBeenCalledTimes(1);
  });

  test("the answers carry the id and the screen route of the record", async () => {
    expect(await result("publish_mom", { meetingId: "mtg_a" })).toMatchObject({ id: "mtg_a", route: "/moms/mtg_a" });
    expect(await result("add_meeting_outcome", { meetingId: "pms_a", notes: "Accepted." })).toMatchObject({ id: "outcome_1", route: "/meetings/pms_a" });
  });
});

describe("AW-305: a drawing link is kept only when it is https", () => {
  test("http, javascript:, data:, a relative path, an empty host and a link over 2,000 characters are refused; https is kept as written", async () => {
    for (const externalUrl of ["http://example.com/a.pdf", "javascript:alert(1)", "data:text/html;base64,AAAA", "/files/a.pdf", "https://", "ftp://example.com/a", `https://example.com/${"a".repeat(2000)}`]) {
      expect({ externalUrl: externalUrl.slice(0, 30), code: (await failure("create_drawing", { ...CASES[5].valid, externalUrl })).code }).toEqual({ externalUrl: externalUrl.slice(0, 30), code: "REQUEST_REJECTED" });
    }
    expect(fn.createDrawingRecord).toHaveBeenCalledTimes(0);
    await result("create_drawing", { ...CASES[5].valid, externalUrl: "https://example.com/AR-101-A?rev=B#top" });
    expect((callOf(fn.createDrawingRecord)[1] as Row).externalUrl).toBe("https://example.com/AR-101-A?rev=B#top");
  });

  test("a current drawing goes to the service as a draft's confirmed record: the status and the drawing number are passed as given", async () => {
    await result("create_drawing", { ...CASES[5].valid, drawingNo: "AR-101", rev: "B", status: "current", discipline: "Architectural", kind: "3d_walkthrough" });
    expect(callOf(fn.createDrawingRecord)).toEqual([
      { orgId: ORG, userId: MANAGER },
      { name: "AR-101 Ground floor plan", category: "drawing_3d", projectId: PROJECT_A, discipline: "Architectural", drawingNo: "AR-101", rev: "B", status: "current", externalUrl: "https://example.com/AR-101-A" },
    ]);
    expect((await failure("create_drawing", { ...CASES[5].valid, status: "final" })).code).toBe("REQUEST_REJECTED");
  });
});

describe("AW-305: money and decisions", () => {
  test("record_material_receipt: the unit cost is the figure for a manager and null below the manager rank, whatever the service returned", async () => {
    const manager = await result("record_material_receipt", { materialId: "mat_a", quantity: 5, unitCost: 410 });
    expect(JSON.stringify(manager)).toContain("410");
    const member = await result("record_material_receipt", { materialId: "mat_a", quantity: 5, unitCost: 410 }, { role: "member", actorUserId: MEMBER });
    expect(JSON.stringify(member)).not.toContain("410");
    expect((member.record as Row).receipt).toMatchObject({ unitCost: null });
    expect((member.record as Row).financialsRedacted).toBe(true);
  });

  test("record_material_receipt: another project's material is refused before a receipt is written, and a name the project does not have is not created without a unit", async () => {
    expect((await failure("record_material_receipt", { materialId: "mat_b", quantity: 1 })).code).toBe("RECORD_NOT_FOUND");
    expect((await failure("record_material_receipt", { materialName: "Sand", quantity: 4 })).code).toBe("VALUE_REQUIRED");
    expect(fn.createMaterialReceipt).toHaveBeenCalledTimes(0);
    expect(fn.createMaterial).toHaveBeenCalledTimes(0);
  });

  test("approve_timesheet and reject_timesheet are a manager's decision judged from the person's own row: a member row is refused whatever role the task claims", async () => {
    for (const id of ["approve_timesheet", "reject_timesheet"]) {
      const params = id === "approve_timesheet" ? { timeEntryId: "te_a" } : { timeEntryId: "te_a", rejectionReason: "Hours do not match the task" };
      const refused = await failure(id, params, { actorUserId: MEMBER, role: "admin" });
      expect({ id, code: refused.code, reason: refused.context?.reason }).toEqual({ id, code: "NOT_PERMITTED", reason: "manager_rank_required" });
    }
    expect(fn.approveTimeEntry).toHaveBeenCalledTimes(0);
    expect(fn.rejectTimeEntry).toHaveBeenCalledTimes(0);
  });

  test("reject_timesheet needs a reason of the service's minimum length", async () => {
    expect((await failure("reject_timesheet", { timeEntryId: "te_a", rejectionReason: "no" })).code).toBe("VALUE_REQUIRED");
    expect(fn.rejectTimeEntry).toHaveBeenCalledTimes(0);
  });

  test("capture_artifact files the note on the project, under the person; a text over the executor's 50,000 cap is refused (the link's cap is 2,000)", async () => {
    await result("capture_artifact", { title: "Precedent", text: "Slab shuttering was left for 7 days." });
    expect(callOf(fn.createSourceObject)[0]).toMatchObject({ orgId: ORG, linkedEntityType: "project", linkedEntityId: PROJECT_A, createdById: MANAGER, title: "Precedent" });
    fn.createSourceObject.mockClear();
    expect((await failure("capture_artifact", { title: "Big", text: "x".repeat(50_001) })).code).toBe("REQUEST_REJECTED");
    expect(fn.createSourceObject).toHaveBeenCalledTimes(0);
  });
});
