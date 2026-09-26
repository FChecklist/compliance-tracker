/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05f, register row AW-306: coverage wave 6 -- the exception, BOQ comparison, budget variance and schedule functions an AI
// can call through a project link, by the role of the person and the project of the link.
//
// THE SEVEN FUNCTIONS (executors/analysis.ts and executors/schedule.ts)
//   reads    get_project_exceptions  compare_boq_revisions  get_project_budget_variance   (they state amounts: the manager rank)
//            get_gantt_schedule  compare_schedule_baseline                                 (project data: the member rank)
//   writes   capture_schedule_baseline (a draft, the manager rank)   update_task (direct, the member rank)
// list_delayed_activities_project, the eighth row of the wave in GAP_A, is NOT built: the dashboard's delayedTaskCount and get_project_schedule
// already give an AI the delayed tasks of one project, and a second definition of "delayed" would disagree with the dashboard's. The reason is
// recorded in the coverage fragment (ai-os/projexa-build-002/coverage-fragments) and in the report.
//
// PROVEN HERE, for EVERY function unless it says otherwise
//   the link, through the REAL Edge handler (coverage-link-checks-w56.ts): level, rank, money flag, free-text and id parameters as written below;
//     a link below the rank never lists the function; a valid check; each required parameter named when missing (422 on /actions for the level-1
//     write); a level-2 function refused on /actions and a valid check and proposal instead; a params projectId of another project 403; an
//     undeclared name and text over 2,000 characters are problems;
//   the executor, over the store double and recording fakes of the services each function wraps
//     - valid parameters succeed and reach the service once with the task's org and the project's own record;
//     - each required parameter left out is refused with the registry's code and the key it names, and no service is reached;
//     - a role below the rank is refused (an absent or unknown role is rank 0), and for the money reads BEFORE anything else is read or named;
//       a write also refuses a caller that names no person;
//     - a params.projectId naming another project is PROJECT_NOT_REACHABLE;
//     - an id of a record of ANOTHER project (a BOQ, the BOQ to compare against, a budget, a baseline, a task, a milestone) reads as absent, the
//       service is not reached and the store is unchanged; an organisation-wide budget (no cost centre) is no project's;
//   and, where it applies
//     - compare_boq_revisions passes its answer through the cost-visibility rule of the compare route (project-side cost fields removed unless the
//       organisation granted the role);
//     - update_task takes only the keys it lists, checks each (priority, dates, completion, assignees, milestone), refuses a typed completion on a
//       task linked to a BOQ line, never takes position, archive or labels, and gives an assignee only from the project's own people;
//     - free text is cleaned and refused above 2,000 characters.
//
// WHAT IS REAL: executor.ts, executors/analysis.ts, executors/schedule.ts, executors/scope.ts, applyCostVisibility, function-registry.ts, the
// generated policy, the Edge handler. WHAT IS FAKED: @/lib/db/tenant-scoped (boq-store-double.ts), the services each function wraps, and the link's
// database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave6.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fakeWithTenantContext, makeBoqStore, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { describeLinkContract, registryRow, type LinkExpectation } from "./__test-helpers__/coverage-link-checks-w56";

const ORG = "org_1";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const MANAGER = "person_manager";
const MEMBER = "person_member";
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
    { id: OUTSIDER, orgId: ORG, isActive: true, role: "member", name: "Omar Outsider", email: "omar@example.com" },
  ]);
  seedRows(s, "project_team_members", [{ id: "team_1", orgId: ORG, projectId: PROJECT_A, userId: MEMBER, role: "member" }]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a1", orgId: ORG, projectId: PROJECT_A, version: 1, status: "approved" },
    { id: "boq_a2", orgId: ORG, projectId: PROJECT_A, version: 2, status: "draft", parentBoqId: "boq_a1" },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, status: "approved" },
  ]);
  seedRows(s, "erp_cost_centers", [
    { id: "cc_a", orgId: ORG, name: "Zoomies", projectId: PROJECT_A },
    { id: "cc_b", orgId: ORG, name: "Oakwood", projectId: PROJECT_B },
    { id: "cc_none", orgId: ORG, name: "Head office", projectId: null },
  ]);
  seedRows(s, "erp_budgets", [
    { id: "bud_a", orgId: ORG, fiscalYearId: "fy_1", costCenterId: "cc_a", name: "Zoomies FY", status: "submitted" },
    { id: "bud_b", orgId: ORG, fiscalYearId: "fy_1", costCenterId: "cc_b", name: "Oakwood FY", status: "submitted" },
    { id: "bud_org", orgId: ORG, fiscalYearId: "fy_1", costCenterId: null, name: "Company FY", status: "submitted" },
    { id: "bud_hq", orgId: ORG, fiscalYearId: "fy_1", costCenterId: "cc_none", name: "Head office FY", status: "submitted" },
  ]);
  seedRows(s, "pms_schedule_baselines", [
    { id: "base_a", orgId: ORG, projectId: PROJECT_A, name: "Baseline 1" },
    { id: "base_b", orgId: ORG, projectId: PROJECT_B, name: "Other baseline" },
  ]);
  seedRows(s, "pms_issues", [
    { id: "issue_a", orgId: ORG, projectId: PROJECT_A, number: 1, title: "Joinery shop drawings", assigneeId: MEMBER, createdById: MANAGER },
    { id: "issue_linked", orgId: ORG, projectId: PROJECT_A, number: 2, title: "Pour slab", createdById: MANAGER },
    { id: "issue_b", orgId: ORG, projectId: PROJECT_B, number: 1, title: "Facade cladding" },
  ]);
  seedRows(s, "pms_issue_boq_links", [{ id: "link_1", orgId: ORG, issueId: "issue_linked", boqLineItemId: "line_a" }]);
  seedRows(s, "pms_milestones", [
    { id: "ms_a", orgId: ORG, projectId: PROJECT_A, name: "Structure complete" },
    { id: "ms_b", orgId: ORG, projectId: PROJECT_B, name: "Other structure" },
  ]);
  return s;
}

// ── the services each function wraps, as recording fakes ─────────────────────
type Args = unknown[];
const COMPARISON = {
  added: [{ id: "l_new", itemCode: "3.01", quantity: "1", rate: "100", amount: "100", rateProject: "80", qtyProject: "1", projectValue: 80 }],
  removed: [],
  changed: [{ key: "1.01", previous: { rate: "450", rateProject: "380" }, current: { rate: "500", rateProject: "400" }, quantityChange: 0, rateChange: 50, netVariation: 6000, variance: 20 }],
  warnings: [],
  totalVariation: 6100,
};
const fn = {
  getProjectExceptions: mock(async (_c: unknown, projectId: string) => {
    if (projectId !== PROJECT_A && projectId !== PROJECT_B) throw new ServiceErrorRef.cls("Project not found", 404);
    return [{ item: 10, title: "Work disputed with vendor", formula: "open dispute", records: [{ id: "d1", detail: "Open vendor dispute: tiles (5000 disputed)", recordType: "vendor_dispute" }], count: 1, flagged: true }];
  }),
  compareBoq: mock(async (..._a: Args) => structuredClone(COMPARISON)),
  getBudgetVariance: mock(async (_c: unknown, id: string, asOf?: string) => ({ budget: { id }, asOfDate: asOf ?? "2027-03-31", lines: [], totalBudget: 900000, totalActual: 400000 })),
  getGanttData: mock(async (..._a: Args) => ({ tasks: [{ id: "issue_a", title: "Joinery shop drawings", isCritical: true }], dependencies: [], milestones: [] })),
  compareBaseline: mock(async (_c: unknown, id: string) => ({ baseline: { id }, variances: [{ issueId: "issue_a", dueVarianceDays: 3 }] })),
  captureBaseline: mock(async (_c: unknown, projectId: string, name: string) => {
    if (name === "No tasks") throw new ServiceErrorRef.cls("No issues to baseline for this project", 400);
    return { id: "base_new", projectId, name };
  }),
  updateIssue: mock(async (_c: unknown, id: string, patch: Row) => {
    if (patch.statusId === "status_blocked") throw new ServiceErrorRef.cls("Cannot mark complete: predecessor is not yet complete.", 409);
    return { id, ...patch };
  }),
};
const ServiceErrorRef: { cls: new (message: string, status: number) => Error } = { cls: Error as never };
const allMocks = (): Array<ReturnType<typeof mock>> => Object.values(fn);
const totalCalls = () => allMocks().reduce((sum, m) => sum + m.mock.calls.length, 0);

const restores: Array<[string, unknown]> = [];
function stub(path: string, real: object, overrides: object) {
  mock.module(path, () => ({ ...real, ...overrides }));
  restores.push([path, real]);
}

// LOAD ORDER: see coverage-wave5.test.ts and executor-registry-u38.test.ts. The real modules are loaded in executor.ts's own order, each mocked
// right after it is loaded.
const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));
restores.push(["@/lib/db/tenant-scoped", realTenantScoped]);

await import("@/lib/services/construction-progress-service");
await import("@/lib/services/pms-time-service");
await import("@/lib/services/construction-dashboard-service");
await import("@/lib/services/construction-labour-service");
stub("@/lib/services/construction-boq-service", await import("@/lib/services/construction-boq-service"), { compareBoq: fn.compareBoq });
await import("@/lib/services/cost-visibility-service");
await import("@/lib/services/pms-meeting-service");
await import("@/lib/services/document-service");
await import("@/lib/services/construction-change-order-service");
await import("@/lib/services/construction-site-instruction-service");
await import("@/lib/services/construction-reports-service");
await import("@/lib/services/erp-accounting-service");
await import("@/lib/services/boq-analysis-service");
stub("@/lib/services/pms-issue-service", await import("@/lib/services/pms-issue-service"), { updateIssue: fn.updateIssue });
stub("@/lib/services/schedule-service", await import("@/lib/services/schedule-service"), { getGanttData: fn.getGanttData, compareBaseline: fn.compareBaseline, captureBaseline: fn.captureBaseline });
await import("@/lib/services/pms-taxonomy-service");
await import("@/lib/services/construction-billing-workflow-service");
const realVeri = await import("@/lib/services/veri-meeting-service");
ServiceErrorRef.cls = realVeri.ServiceError as never;
await import("@/lib/services/construction-materials-service");
await import("@/lib/services/timesheet-review-task-service");
await import("@/lib/crr/capture");
stub("@/lib/services/construction-exceptions-service", await import("@/lib/services/construction-exceptions-service"), { getProjectExceptions: fn.getProjectExceptions });
stub("@/lib/services/erp-budget-service", await import("@/lib/services/erp-budget-service"), { getBudgetVariance: fn.getBudgetVariance });

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
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

type Case = {
  id: string;
  write: boolean;
  rank: 2 | 3;
  valid: Row;
  required: Array<[string, string, string]>;
  service: ReturnType<typeof mock>;
  foreign?: [string, string];
};
const CASES: Case[] = [
  { id: "get_project_exceptions", write: false, rank: 3, valid: {}, required: [], service: fn.getProjectExceptions },
  { id: "compare_boq_revisions", write: false, rank: 3, valid: { boqId: "boq_a2", againstBoqId: "boq_a1" }, required: [["boqId", "BOQ_VERSION_REQUIRED", "boqVersion"]], service: fn.compareBoq, foreign: ["boqId", "boq_b"] },
  { id: "get_project_budget_variance", write: false, rank: 3, valid: { budgetId: "bud_a" }, required: [["budgetId", "VALUE_REQUIRED", "value"]], service: fn.getBudgetVariance, foreign: ["budgetId", "bud_b"] },
  { id: "get_gantt_schedule", write: false, rank: 2, valid: {}, required: [], service: fn.getGanttData },
  { id: "compare_schedule_baseline", write: false, rank: 2, valid: { baselineId: "base_a" }, required: [["baselineId", "VALUE_REQUIRED", "value"]], service: fn.compareBaseline, foreign: ["baselineId", "base_b"] },
  { id: "capture_schedule_baseline", write: true, rank: 3, valid: { name: "Baseline 2" }, required: [["name", "TITLE_REQUIRED", "name"]], service: fn.captureBaseline },
  { id: "update_task", write: true, rank: 2, valid: { issueId: "issue_a", title: "Joinery drawings v2" }, required: [["issueId", "TASK_REQUIRED", "task"]], service: fn.updateIssue, foreign: ["issueId", "issue_b"] },
];
const BELOW = (rank: number) => (rank === 3 ? "member" : "viewer");

// ═══ THE LINK ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const EXPECT: LinkExpectation[] = [
  { id: "get_project_exceptions", kind: "read", level: 0, rank: 3, money: true, text: [], ids: [], valid: {}, required: [] },
  { id: "compare_boq_revisions", kind: "read", level: 0, rank: 3, money: true, text: [], ids: ["againstBoqId", "boqId"], valid: { boqId: "boq_a2", againstBoqId: "boq_a1" }, required: ["boqId"] },
  { id: "get_project_budget_variance", kind: "read", level: 0, rank: 3, money: true, text: [], ids: ["budgetId"], valid: { budgetId: "bud_a", asOfDate: "2027-03-31" }, required: ["budgetId"] },
  { id: "get_gantt_schedule", kind: "read", level: 0, rank: 2, money: false, text: [], ids: [], valid: {}, required: [] },
  { id: "compare_schedule_baseline", kind: "read", level: 0, rank: 2, money: false, text: [], ids: ["baselineId"], valid: { baselineId: "base_a" }, required: ["baselineId"] },
  { id: "capture_schedule_baseline", kind: "write", level: 2, rank: 3, money: false, text: ["name"], ids: [], valid: { name: "Baseline 2" }, required: ["name"] },
  {
    id: "update_task", kind: "write", level: 1, rank: 2, money: false, text: ["title", "description"], ids: ["assigneeIds", "issueId", "milestoneId", "statusId"],
    valid: { issueId: "issue_a", title: "Joinery drawings v2", statusId: "status_1", priority: "high", startDate: "2026-10-01", dueDate: "2026-10-10", completionPercentage: 40, milestoneId: "ms_a", assigneeIds: [MEMBER] },
    required: ["issueId"],
  },
];
for (const e of EXPECT) describeLinkContract(e);

describe("AW-306: the seven functions are in the generated registry and have an executor", () => {
  test("each has an executor and a row; the reads are reads and the two others write", () => {
    expect(CASES).toHaveLength(7);
    expect(EXPECT).toHaveLength(7);
    for (const c of CASES) {
      expect({ id: c.id, executor: hasExecutor(c.id), writes: functionWrites(c.id), row: !!registryRow(c.id) }).toEqual({ id: c.id, executor: true, writes: c.write, row: true });
    }
  });

  test("update_task declares the people list; compare_boq_revisions and get_project_budget_variance declare their optional parameters", () => {
    expect(registryRow("update_task")!.declared_params).toEqual(expect.arrayContaining(["assigneeIds", "completionPercentage", "milestoneId", "statusId", "priority", "startDate", "dueDate"]));
    expect(registryRow("compare_boq_revisions")!.declared_params).toContain("againstBoqId");
    expect(registryRow("get_project_budget_variance")!.declared_params).toContain("asOfDate");
  });

  test("position, archive, assignedById and labels are not declared: the link cannot name them", () => {
    for (const bad of ["position", "isArchived", "assignedById", "labelIds", "estimatePointId"]) expect(registryRow("update_task")!.declared_params).not.toContain(bad);
  });
});

// ═══ THE EXECUTOR ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("AW-306: valid parameters succeed and reach the service once", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    const outcome = await run(c.id, c.valid);
    expect({ id: c.id, ok: outcome.success }).toEqual({ id: c.id, ok: true });
    expect(c.service).toHaveBeenCalledTimes(1);
  });

  test("the service gets the task's org, the project's own record and (for a write) the acting person, never the API key's id", async () => {
    await result("get_project_exceptions", {});
    expect(callOf(fn.getProjectExceptions)).toEqual([{ orgId: ORG }, PROJECT_A]);
    await result("get_gantt_schedule", {});
    expect(callOf(fn.getGanttData)).toEqual([{ orgId: ORG }, PROJECT_A]);
    await result("compare_schedule_baseline", { baselineId: "base_a" });
    expect(callOf(fn.compareBaseline)).toEqual([{ orgId: ORG }, "base_a"]);
    await result("capture_schedule_baseline", { name: "Baseline 2" }, { role: "admin", actorUserId: MEMBER });
    expect(callOf(fn.captureBaseline)).toEqual([{ orgId: ORG, userId: MEMBER }, PROJECT_A, "Baseline 2"]);
    await result("update_task", { issueId: "issue_a", title: "New" }, { actorUserId: MEMBER, role: "member" });
    expect(callOf(fn.updateIssue)).toEqual([{ orgId: ORG, userId: MEMBER, dbUser: null }, "issue_a", { title: "New" }]);
    await result("get_project_budget_variance", { budgetId: "bud_a", asOfDate: "2027-01-31" });
    expect(callOf(fn.getBudgetVariance)).toEqual([{ orgId: ORG }, "bud_a", "2027-01-31"]);
  });
});

describe("AW-306: each required parameter left out is refused with the registry's code and the key it names, and no service is reached", () => {
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

describe("AW-306: the rank of the person, and the person for a write", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s: a role below the rank (and an absent or unknown role) is refused and nothing is reached; the rank itself is enough", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    const before = snapshot();
    for (const role of [BELOW(c.rank), undefined, null, "no_such_role"]) {
      const refused = await run(c.id, c.valid, { role });
      expect({ id: c.id, role, ok: refused.success }).toEqual({ id: c.id, role, ok: false });
      expect(refused).toMatchObject({ failure: { code: "NOT_PERMITTED" } });
    }
    expect(totalCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    expect((await run(c.id, c.valid, { role: c.rank === 3 ? "manager" : "member", actorUserId: c.rank === 3 ? MANAGER : MEMBER })).success).toBe(true);
  });

  test.each(CASES.filter((c) => c.write).map((c) => [c.id] as const))("%s: a caller that names no person is refused before any service", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    expect(await run(c.id, c.valid, { actorUserId: null })).toMatchObject({ success: false, failure: { code: "NOT_PERMITTED", context: { reason: "unidentified_actor" } } });
    expect(totalCalls()).toBe(0);
  });

  test("a read names no person and still runs: a read has no confirming person", async () => {
    for (const c of CASES.filter((x) => !x.write)) expect((await run(c.id, c.valid, { actorUserId: null })).success).toBe(true);
  });

  test("the three money reads judge the rank BEFORE anything else: a member with a missing or foreign parameter is told only that the rank is not enough", async () => {
    for (const [id, params] of [["compare_boq_revisions", {}], ["compare_boq_revisions", { boqId: "boq_b" }], ["get_project_budget_variance", {}], ["get_project_budget_variance", { budgetId: "bud_b" }], ["get_project_exceptions", { projectId: PROJECT_B }]] as Array<[string, Row]>) {
      const refused = await failure(id, params, { role: "member" });
      expect({ id, code: refused.code, missing: refused.missing, reason: refused.context?.reason }).toEqual({ id, code: "NOT_PERMITTED", missing: [], reason: "manager_rank_required" });
    }
    expect(totalCalls()).toBe(0);
  });
});

describe("AW-306: the project", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s: a params.projectId naming another project is PROJECT_NOT_REACHABLE, and no project at all is PROJECT_REQUIRED", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    expect(await failure(c.id, { ...c.valid, projectId: PROJECT_B })).toEqual({ code: "PROJECT_NOT_REACHABLE", missing: ["projectId"], picker: "project" });
    expect(await failure(c.id, c.valid, { projectId: null })).toMatchObject({ code: "PROJECT_REQUIRED" });
    expect(totalCalls()).toBe(0);
  });

  test("a project of another organisation reads as absent for the reads and the baseline (get_gantt_schedule, capture_schedule_baseline, get_project_exceptions)", async () => {
    seedRows(store, "projects", [{ id: "project_x", orgId: "org_2", name: "Elsewhere", status: "active" }]);
    for (const [id, params] of [["get_gantt_schedule", {}], ["capture_schedule_baseline", { name: "B" }], ["get_project_exceptions", {}]] as Array<[string, Row]>) {
      const refused = await failure(id, params, { projectId: "project_x" });
      expect({ id, code: refused.code }).toEqual({ id, code: "RECORD_NOT_FOUND" });
    }
    expect(fn.getGanttData).toHaveBeenCalledTimes(0);
    expect(fn.captureBaseline).toHaveBeenCalledTimes(0);
  });
});

describe("AW-306: an id of a record of ANOTHER project reads as absent: RECORD_NOT_FOUND, the service is not reached and nothing is written", () => {
  for (const c of CASES.filter((x) => x.foreign)) {
    test(`${c.id} with ${c.foreign![0]} = ${c.foreign![1]}`, async () => {
      const before = snapshot();
      const refused = await failure(c.id, { ...c.valid, [c.foreign![0]]: c.foreign![1] });
      expect(refused.code).toBe("RECORD_NOT_FOUND");
      expect(totalCalls()).toBe(0);
      expect(snapshot()).toBe(before);
    });
  }

  test("compare_boq_revisions: the BOQ to compare against must be the project's too (againstBoqId, and `against`, the route's name for it)", async () => {
    for (const key of ["againstBoqId", "against"]) {
      const refused = await failure("compare_boq_revisions", { boqId: "boq_a2", [key]: "boq_b" });
      expect({ key, code: refused.code, missing: refused.missing }).toEqual({ key, code: "RECORD_NOT_FOUND", missing: ["boqVersion"] });
    }
    expect(fn.compareBoq).toHaveBeenCalledTimes(0);
    // `against` is accepted by the internal pipeline when it is the project's own
    await result("compare_boq_revisions", { boqId: "boq_a2", against: "boq_a1" });
    expect(callOf(fn.compareBoq)).toEqual([{ orgId: ORG }, "boq_a2", { against: "boq_a1" }]);
    fn.compareBoq.mockClear();
    // without one, the service compares with the parent
    await result("compare_boq_revisions", { boqId: "boq_a2" });
    expect(callOf(fn.compareBoq)).toEqual([{ orgId: ORG }, "boq_a2", { against: undefined }]);
    expect((await failure("compare_boq_revisions", { boqId: "boq_a2", againstBoqId: 5 })).code).toBe("REQUEST_REJECTED");
  });

  test("get_project_budget_variance: a budget belongs to a project through its cost centre; one with none, one on a cost centre of no project, and a missing one are absent", async () => {
    for (const budgetId of ["bud_org", "bud_hq", "bud_missing"]) {
      expect({ budgetId, code: (await failure("get_project_budget_variance", { budgetId })).code }).toEqual({ budgetId, code: "RECORD_NOT_FOUND" });
    }
    expect(fn.getBudgetVariance).toHaveBeenCalledTimes(0);
  });

  test("get_project_budget_variance: an as-of date must be a real day (a YYYY-MM-DD); nothing is read for a bad one", async () => {
    for (const asOfDate of ["2027-02-30", "31/03/2027", "2027-3-1", 20270331, ""]) {
      const refused = await run("get_project_budget_variance", { budgetId: "bud_a", asOfDate });
      expect({ asOfDate, ok: refused.success, code: refused.success ? null : refused.failure.code }).toEqual({ asOfDate, ok: asOfDate === "", code: asOfDate === "" ? null : "DATE_REQUIRED" });
    }
  });

  test("update_task: a milestone of another project, a milestone that does not exist and an assignee the project does not name are refused before the service", async () => {
    const before = snapshot();
    expect((await failure("update_task", { issueId: "issue_a", milestoneId: "ms_b" })).code).toBe("RECORD_NOT_FOUND");
    expect((await failure("update_task", { issueId: "issue_a", milestoneId: "ms_missing" })).code).toBe("RECORD_NOT_FOUND");
    expect(await failure("update_task", { issueId: "issue_a", assigneeIds: [MEMBER, OUTSIDER] })).toMatchObject({ code: "RECORD_NOT_FOUND", missing: ["worker"] });
    expect(totalCalls()).toBe(0);
    expect(snapshot()).toBe(before);
    // the acting person may always assign themselves
    expect((await run("update_task", { issueId: "issue_a", assigneeIds: [OUTSIDER] }, { actorUserId: OUTSIDER, role: "member" })).success).toBe(true);
    fn.updateIssue.mockClear();
    // the project's own milestone and people are fine, and null clears the milestone
    await result("update_task", { issueId: "issue_a", milestoneId: "ms_a", assigneeIds: [MEMBER, MANAGER, MEMBER] });
    expect(callOf(fn.updateIssue)[2]).toEqual({ milestoneId: "ms_a", assigneeIds: [MEMBER, MANAGER] });
    fn.updateIssue.mockClear();
    await result("update_task", { issueId: "issue_a", milestoneId: null });
    expect(callOf(fn.updateIssue)[2]).toEqual({ milestoneId: null });
  });
});

describe("AW-306: compare_boq_revisions passes through the cost-visibility rule of the compare route", () => {
  const projectSide = (v: unknown) => JSON.stringify(v).includes("rateProject") || JSON.stringify(v).includes("qtyProject") || JSON.stringify(v).includes("projectValue") || JSON.stringify(v).includes('"variance"');

  test("an organisation that has not granted the manager role the cost: every project-side cost field is removed at any depth; the contract side stays", async () => {
    const out = (await result("compare_boq_revisions", { boqId: "boq_a2", againstBoqId: "boq_a1" })) as Row;
    expect(projectSide(out)).toBe(false);
    expect(out.totalVariation).toBe(6100);
    expect((out.added as Row[])[0]).toMatchObject({ itemCode: "3.01", rate: "100", amount: "100" });
  });

  test("granted (canSeeCost true for manager): the whole answer, project side included", async () => {
    seedRows(store, "cost_visibility_config", [{ id: "cfg_1", orgId: ORG, role: "manager", canSeeCost: true, changedById: MANAGER }]);
    const out = (await result("compare_boq_revisions", { boqId: "boq_a2", againstBoqId: "boq_a1" })) as Row;
    expect(projectSide(out)).toBe(true);
    expect(out).toEqual(COMPARISON);
  });

  test("an admin is judged by the admin's own grant, not the manager's; no grant is no cost", async () => {
    seedRows(store, "cost_visibility_config", [{ id: "cfg_1", orgId: ORG, role: "manager", canSeeCost: true, changedById: MANAGER }]);
    expect(projectSide(await result("compare_boq_revisions", { boqId: "boq_a2" }, { role: "admin" }))).toBe(false);
  });
});

describe("AW-306: the answers", () => {
  test("get_project_exceptions answers the checks; the service's own 404 for a project is RECORD_NOT_FOUND", async () => {
    const out = (await result("get_project_exceptions", {})) as { checks: Array<{ item: number; flagged: boolean }> };
    expect(out.checks[0]).toMatchObject({ item: 10, flagged: true });
    seedRows(store, "projects", [{ id: "project_gone", orgId: ORG, name: "Gone", status: "active" }]);
    expect((await failure("get_project_exceptions", {}, { projectId: "project_gone" })).code).toBe("RECORD_NOT_FOUND");
  });

  test("capture_schedule_baseline: the name is cleaned and capped; a project with no tasks is the service's 400 as a refusal; the answer carries the id", async () => {
    const CTRL = String.fromCharCode(0x202e, 0x200b, 0x7);
    const out = await result("capture_schedule_baseline", { name: `Baseline${CTRL} 3` });
    expect(callOf(fn.captureBaseline)[2]).toBe("Baseline 3");
    expect(out).toMatchObject({ id: "base_new", route: "/schedule/baselines" });
    fn.captureBaseline.mockClear();
    expect((await failure("capture_schedule_baseline", { name: "x".repeat(2001) })).code).toBe("REQUEST_REJECTED");
    expect((await failure("capture_schedule_baseline", { name: CTRL })).code).toBe("TITLE_REQUIRED");
    expect(fn.captureBaseline).toHaveBeenCalledTimes(0);
    expect((await failure("capture_schedule_baseline", { name: "No tasks" })).code).toBe("REQUEST_REJECTED");
  });
});

describe("AW-306: update_task takes only the keys it lists, and checks each", () => {
  test("keys the function does not list are dropped, never forwarded: position, isArchived, assignedById, labelIds, estimatePointId, projectId of another kind", async () => {
    await result("update_task", { issueId: "issue_a", title: "New", position: "a0", isArchived: true, assignedById: OUTSIDER, labelIds: ["l1"], estimatePointId: "e1", parentIssueId: "x" });
    expect(callOf(fn.updateIssue)[2]).toEqual({ title: "New" });
  });

  test("every listed key reaches the service, typed", async () => {
    await result("update_task", { issueId: "issue_a", title: " T ", description: "D", statusId: "status_1", priority: "high", startDate: "2026-10-01", dueDate: "2026-10-10", completionPercentage: "40", milestoneId: "ms_a", assigneeIds: [MEMBER] });
    expect(callOf(fn.updateIssue)[2]).toEqual({
      title: "T", description: "D", statusId: "status_1", priority: "high", startDate: "2026-10-01", dueDate: "2026-10-10", completionPercentage: 40, milestoneId: "ms_a", assigneeIds: [MEMBER],
    });
  });

  test("a date can be cleared with null, and a description with an empty text", async () => {
    await result("update_task", { issueId: "issue_a", dueDate: null, startDate: null, description: "  " });
    expect(callOf(fn.updateIssue)[2]).toEqual({ dueDate: null, startDate: null, description: null });
  });

  test("an empty patch, a bad priority, bad dates, a start after the due date, a completion outside 0 to 100, bad people and bad ids are refused; nothing is reached", async () => {
    const refusals: Array<[Row, string]> = [
      [{}, "VALUE_REQUIRED"],
      [{ priority: "critical" }, "REQUEST_REJECTED"],
      [{ priority: "" }, "REQUEST_REJECTED"],
      [{ dueDate: "2026-02-30" }, "DATE_REQUIRED"],
      [{ startDate: "10/10/2026" }, "DATE_REQUIRED"],
      [{ startDate: 5 }, "DATE_REQUIRED"],
      [{ startDate: "2026-10-10", dueDate: "2026-10-01" }, "VALUE_OUT_OF_RANGE"],
      [{ completionPercentage: 101 }, "VALUE_OUT_OF_RANGE"],
      [{ completionPercentage: -1 }, "VALUE_OUT_OF_RANGE"],
      [{ completionPercentage: "half" }, "VALUE_OUT_OF_RANGE"],
      [{ assigneeIds: MEMBER }, "REQUEST_REJECTED"],
      [{ assigneeIds: [5] }, "REQUEST_REJECTED"],
      [{ assigneeIds: [" "] }, "REQUEST_REJECTED"],
      [{ assigneeIds: Array.from({ length: 26 }, (_, i) => `p${i}`) }, "REQUEST_REJECTED"],
      [{ statusId: "" }, "REQUEST_REJECTED"],
      [{ milestoneId: "" }, "REQUEST_REJECTED"],
      [{ title: "x".repeat(2001) }, "REQUEST_REJECTED"],
      [{ description: "x".repeat(2001) }, "REQUEST_REJECTED"],
      [{ title: String.fromCharCode(0x200b) }, "TITLE_REQUIRED"],
    ];
    for (const [patch, code] of refusals) expect({ patch: JSON.stringify(patch).slice(0, 60), code: (await failure("update_task", { issueId: "issue_a", ...patch })).code }).toEqual({ patch: JSON.stringify(patch).slice(0, 60), code });
    expect(totalCalls()).toBe(0);
  });

  test("a typed completion on a task linked to a BOQ line is refused (its progress comes from the site's entries); other keys on it are allowed", async () => {
    const refused = await failure("update_task", { issueId: "issue_linked", completionPercentage: 50 });
    expect(refused).toMatchObject({ code: "REQUEST_REJECTED", context: { reason: "progress_is_derived" } });
    expect(fn.updateIssue).toHaveBeenCalledTimes(0);
    expect((await run("update_task", { issueId: "issue_linked", dueDate: "2026-11-01" })).success).toBe(true);
    expect((await run("update_task", { issueId: "issue_a", completionPercentage: 50 })).success).toBe(true);
  });

  test("the service's own refusals come back as refusals: a completed status behind an unfinished predecessor is 409 ALREADY_RECORDED", async () => {
    expect((await failure("update_task", { issueId: "issue_a", statusId: "status_blocked" })).code).toBe("ALREADY_RECORDED");
  });
});
