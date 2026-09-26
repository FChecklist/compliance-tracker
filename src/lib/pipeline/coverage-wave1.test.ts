/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05a wave 1, register row AW-301: the ten schedule, milestone and report functions are on an AI work link, and each
// one validates its parameters, refuses another project's ids, respects the person's role, withholds money below manager, and caps and
// cleans free text.
//
// THE TEN (all had an executor since U-38 and were on no link until this wave)
//   reads   get_boq_line_items (rank 3)  run_named_report (2)  get_project_schedule (2)  list_milestones (2)
//           get_manpower_cost_report (2)  get_designer_timesheet_report (2)  get_project_analysis (3)
//   writes  create_milestone, update_milestone, create_schedule_task (level 1, a direct action for a member link)
//
// TWO LAYERS, both proven for every function
//   1. THE LINK (coverage-link-matrix.ts, the REAL Edge handler over the link-database fake): the generated policy (level, minimum rank, money
//      flag, text and id parameters, required names), the rank ladder (viewer, member, manager), missing and unknown and optional parameters,
//      the 2,000-character text rule, the 8 KB body limit and the level rule of /actions, /propose and /drafts.
//   2. THE EXECUTOR (the REAL executor.ts and execute-read.ts, function-registry.ts, validate()): a read through executeRead() (the link's
//      read mode: the link's project is forced, only declared parameters pass, the link's effective list gates it) and a write through
//      executeTask(). What each function does with an id of another project, with a member's role and with free text.
//
// WHAT IS REAL: executor.ts, execute-read.ts, function-registry.ts, validate(), applyLinkTextRules(), the generated link registry, the Edge
// handler and the executors' own lookups (their where clauses evaluated against fixture rows by boq-store-double.ts).
// WHAT IS FAKED: @/lib/db/tenant-scoped (the store double) and the service functions each executor wraps whose queries the double cannot run
// (joins, aggregates): recording fakes, so the call and its arguments are what is asserted. getProjectBoqLinePage() is REAL, so a BOQ of
// another project is refused by the service itself; the page read (a raw keyset query) is the one thing that needs PGlite and is proven by
// executor.get-boq-line-items.test.ts (BR-407).
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave1.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fakeWithTenantContext, makeBoqStore, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { effectiveList, registerLinkMatrix, type PolicyRow } from "./__test-helpers__/coverage-link-matrix";
import { AI_LINK_TEXT_MAX, applyLinkTextRules, isFreeTextParam } from "./ai-link-text";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const PERSON = "person_manager";
const MEMBER = "person_member";
const USER_B = "person_of_b";
const OUTSIDER = "person_other_org";
/** What task.userId holds for PROJEXA's proxy: the org API key's id, not a person. */
const API_KEY = "apikey_1";

let store: BoqStore;
function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood" },
  ]);
  seedRows(s, "users", [
    { id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" },
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Babu K", email: "babu@example.com" },
    { id: USER_B, orgId: ORG, isActive: true, role: "member", name: "Chitra P", email: "chitra@example.com" },
    { id: OUTSIDER, orgId: OTHER_ORG, isActive: true, role: "member", name: "Dev R", email: "dev@example.org" },
  ]);
  seedRows(s, "project_team_members", [
    { orgId: ORG, projectId: PROJECT_A, userId: PERSON, role: "lead" },
    { orgId: ORG, projectId: PROJECT_A, userId: MEMBER, role: "member" },
    { orgId: ORG, projectId: PROJECT_B, userId: USER_B, role: "lead" },
  ]);
  seedRows(s, "pms_issue_types", [
    { id: "type_ok", orgId: ORG, name: "Activity" },
    { id: "type_other_org", orgId: OTHER_ORG, name: "Activity" },
  ]);
  seedRows(s, "pms_issues", [
    { id: "issue_a", orgId: ORG, projectId: PROJECT_A, title: "Shop drawings" },
    { id: "issue_b", orgId: ORG, projectId: PROJECT_B, title: "Other project's activity" },
  ]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, status: "approved" },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, status: "approved" },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "line_a", orgId: ORG, boqId: "boq_a", itemCode: "EX-01", quantity: "10", rate: "450", amount: "4500", rateProject: "380", qtyProject: "11" },
    { id: "line_b", orgId: ORG, boqId: "boq_b", itemCode: "EX-01", quantity: "10", rate: "450", amount: "4500" },
  ]);
  return s;
}

// ── the service functions each executor wraps, as recording fakes ───────────────
type Args = unknown[];
const fn = {
  getProjectBoqLinePage: mock(async (..._a: Args): Promise<unknown> => null),
  manpowerCostReport: mock(async (..._a: Args) => ({ byTrade: [{ trade: "Mason", totalCost: 48000, workerDays: 12 }], date: null })),
  designerTimesheetReport: mock(async (..._a: Args) => ({
    period: { from: "2026-10-01", to: "2026-10-31" },
    projectScoped: {
      byUser: [{ userId: PERSON, userName: "Asha M", totalHours: 32 }],
      byCategory: [{ category: "drafting", hours: 32, actual: 25600, budget: null }],
      byDesignerStatus: [{ status: "active", budget: 40000, actual: 25600, variance: 14400 }],
      overallBudget: 40000, overallActual: 25600, overallVariance: 14400,
    },
    orgWide: {
      byDesigner: [{ userId: PERSON, userName: "Asha M", hours: 90, budget: 90000, actual: 72000, variance: 18000 }],
      byProject: [{ projectId: PROJECT_B, projectName: "Oakwood", budget: 500000, actual: 320000, variance: 180000 }],
    },
  })),
  budgetSummary: mock(async (..._a: Args) => ({ payload: "budget-summary" })),
  budgetVariance: mock(async (..._a: Args) => ({ payload: "budget-variance" })),
  weeklyProject: mock(async (..._a: Args) => ({ payload: "weekly-project" })),
  workProgress: mock(async (..._a: Args) => ({ payload: "work-progress" })),
  manpowerCostSlug: mock(async (..._a: Args) => ({ payload: "manpower-cost" })),
  categoryBoqAmounts: mock(async (..._a: Args): Promise<unknown> => null),
  getBaseCurrency: mock(async (..._a: Args) => ({ baseCurrency: { code: "INR" } })),
  getProjectAnalysis: mock(async (_c: unknown, projectId: string) => ({ projectId, projectName: "Cedar Heights", contractValueNow: 5000000 })),
  listOrgAnalysis: mock(async (..._a: Args) => [{ projectId: PROJECT_A }, { projectId: PROJECT_B }]),
  listIssues: mock(async (_c: unknown, projectId: string, _f: unknown) => [{ id: projectId === PROJECT_A ? "issue_a" : "issue_b", projectId, number: 12, title: "Joinery shop drawings" }]),
  resolveDefaultIssueTypeId: mock(async (..._a: Args): Promise<string | null> => "type_ok"),
  createScheduleActivity: mock(async (_c: unknown, input: Row) => ({ id: "task_new", number: 13, ...input })),
  // the project's own list, as the service answers it: another project's milestone is not on it
  listMilestones: mock(async (_c: unknown, projectId: string) => [projectId === PROJECT_A ? { id: "ms_a", name: "Structure complete", completionPercentage: 40 } : { id: "ms_b", name: "Other", completionPercentage: 0 }]),
  createMilestone: mock(async (_c: unknown, _p: string, input: Row) => ({ id: "ms_new", ...input, completionPercentage: 0 })),
  updateMilestone: mock(async (_c: unknown, id: string, patch: Row) => ({ id, ...patch, completionPercentage: 40 })),
};
const allMocks = (): Array<ReturnType<typeof mock>> => Object.values(fn);
const totalCalls = () => allMocks().reduce((sum, m) => sum + m.mock.calls.length, 0);

const restores: Array<[string, unknown]> = [];
function stub(path: string, real: object, overrides: object) {
  mock.module(path, () => ({ ...real, ...overrides }));
  restores.push([path, real]);
}

// LOAD ORDER: the service modules import each other in cycles, and a cycle resolves for one entry order only, the one executor.ts itself uses
// (see executor-registry-u38.test.ts). Each real module is loaded in that order and mocked right after it is loaded.
const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));
restores.push(["@/lib/db/tenant-scoped", realTenantScoped]);

await import("@/lib/services/construction-progress-service");
await import("@/lib/services/pms-time-service");
await import("@/lib/services/construction-dashboard-service");
await import("@/lib/services/construction-labour-service");
await import("@/lib/services/construction-boq-service");
await import("@/lib/services/cost-visibility-service");
await import("@/lib/services/pms-meeting-service");
await import("@/lib/services/document-service");
await import("@/lib/services/construction-change-order-service");
await import("@/lib/services/construction-site-instruction-service");
const realReports = await import("@/lib/services/construction-reports-service");
// Bun's mock.module also replaces the exports of the namespace object already imported, so the real function is taken BEFORE the stub is
// installed: reading it from `realReports` inside the stub would call the stub itself.
const realBuildReportTable = realReports.buildReportTable;
const realReportRegistry = { ...realReports.REPORT_REGISTRY };
stub("@/lib/services/construction-reports-service", { ...realReports }, {
  manpowerCostReport: fn.manpowerCostReport,
  designerTimesheetReport: fn.designerTimesheetReport,
  // the real table builder for the one report whose note carries an amount; a fixed table for the others
  buildReportTable: (slug: string, payload: unknown, currency: string | null) =>
    slug === "category-boq-amounts" ? realBuildReportTable("category-boq-amounts", payload as never, currency) : { ...REPORT_TABLE, currency },
  REPORT_REGISTRY: {
    ...realReportRegistry,
    "budget-summary": fn.budgetSummary, "budget-variance": fn.budgetVariance, "weekly-project": fn.weeklyProject, "work-progress": fn.workProgress,
    "manpower-cost": fn.manpowerCostSlug, "category-boq-amounts": fn.categoryBoqAmounts,
  },
});
stub("@/lib/services/erp-accounting-service", await import("@/lib/services/erp-accounting-service"), { getBaseCurrency: fn.getBaseCurrency });
stub("@/lib/services/boq-analysis-service", await import("@/lib/services/boq-analysis-service"), { getProjectAnalysis: fn.getProjectAnalysis, listOrgAnalysis: fn.listOrgAnalysis });
stub("@/lib/services/pms-issue-service", await import("@/lib/services/pms-issue-service"), { listIssues: fn.listIssues });
stub("@/lib/services/schedule-service", await import("@/lib/services/schedule-service"), { createScheduleActivity: fn.createScheduleActivity });
stub("@/lib/services/pms-taxonomy-service", await import("@/lib/services/pms-taxonomy-service"), {
  listMilestones: fn.listMilestones, createMilestone: fn.createMilestone, updateMilestone: fn.updateMilestone, resolveDefaultIssueTypeId: fn.resolveDefaultIssueTypeId,
});
await import("@/lib/services/construction-billing-workflow-service");
await import("@/lib/services/veri-meeting-service");
await import("@/lib/services/construction-materials-service");
await import("@/lib/services/timesheet-review-task-service");
await import("@/lib/services/memory-recall-service");
await import("@/lib/crr/capture");
await import("@/lib/services/report-share-service");
await import("@/lib/services/construction-boq-import-service");

const REPORT_TABLE = {
  columns: [
    { key: "head", label: "Head", unit: "text", align: "left" },
    { key: "budget", label: "Budget", unit: "currency", align: "right" },
    { key: "done", label: "Done", unit: "percent", align: "right" },
  ],
  rows: [{ head: "Civil", budget: 900000, done: 40 }],
  totals: { budget: 900000, done: 40 },
};

let executeTask: typeof import("./executor").executeTask;
let executeRead: typeof import("./execute-read").executeRead;
let functionSpec: typeof import("./function-registry").functionSpec;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ executeRead } = await import("./execute-read"));
  ({ functionSpec } = await import("./function-registry"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  for (const m of allMocks()) m.mockClear();
  fn.categoryBoqAmounts.mockImplementation(async () => ({ categories: [{ categoryId: "c1", name: "Civil", totalAmount: 900000 }], uncategorizedAmount: 45000, totalAmount: 945000 }));
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  for (const [path, real] of restores) await mock.module(path, () => real as object);
});

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
type ReadOutcome = Awaited<ReturnType<typeof executeRead>>;
/** A read as the link runs it: the link's project is forced, the function must be on the link's effective list. */
const read = (functionId: string, params: Row = {}, role: string | null = "manager", extra: { projectId?: string; allowed?: string[] } = {}): Promise<ReadOutcome> =>
  executeRead({ orgId: ORG, userId: PERSON, projectId: extra.projectId ?? PROJECT_A, functionId, params, role, actorUserId: PERSON, allowedFunctionIds: extra.allowed ?? [functionId] });
async function readOk(functionId: string, params: Row = {}, role: string | null = "manager"): Promise<Row> {
  const out = await read(functionId, params, role);
  if (!out.ok) throw new Error(`expected ${functionId} to succeed, got ${JSON.stringify(out)}`);
  return out.result as Row;
}
type Overrides = Partial<import("./executor").ExecutableTask>;
const task = (functionId: string, params: Row, overrides: Overrides = {}): import("./executor").ExecutableTask =>
  ({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, role: "member", actorUserId: MEMBER, ...overrides });
const write = (functionId: string, params: Row, overrides: Overrides = {}) => executeTask(task(functionId, params, overrides));
async function writeOk(functionId: string, params: Row, overrides: Overrides = {}): Promise<Row> {
  const out = await write(functionId, params, overrides);
  if (!out.success) throw new Error(`expected ${functionId} to succeed, got ${JSON.stringify(out.failure)}`);
  return out.result as Row;
}
async function refused(functionId: string, params: Row, overrides: Overrides = {}) {
  const out = await write(functionId, params, overrides);
  if (out.success) throw new Error(`expected ${functionId} to be refused`);
  return out.failure;
}
const callOf = (m: { mock: { calls: unknown[][] } }, n = 0) => m.mock.calls[n];
const snapshot = () => JSON.stringify(store.tables);
const keysDeep = (value: unknown, acc: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, acc));
  else if (typeof value === "object" && value !== null && !(value instanceof Date)) for (const [k, v] of Object.entries(value)) { acc.add(k); keysDeep(v, acc); }
  return acc;
};

// ═══ 1. THE LINK ══════════════════════════════════════════════════════════════════════════════

// An independent copy of the policy of scripts/gen-ai-link-registry.data.ts, written out again on purpose.
const ROWS: PolicyRow[] = [
  { id: "get_boq_line_items", kind: "read", level: 0, rank: 3, money: true, valid: {}, required: [], optional: { boqId: "boq_1", cursor: "abc", limit: 10 }, ids: ["boqId"] },
  { id: "run_named_report", kind: "read", level: 0, rank: 2, money: true, valid: { reportSlug: "budget-summary" }, required: ["reportSlug"],
    optional: { weekStart: "2026-09-21", date: "2026-09-22", trade: "Mason", category: "Civil", groupBy: "category", vendorId: "sup_1", boqId: "boq_1" }, ids: ["boqId", "vendorId"] },
  { id: "get_project_schedule", kind: "read", level: 0, rank: 2, money: false, valid: {}, required: [], optional: { statusId: "st_1", assigneeId: "u_1" }, ids: ["assigneeId", "statusId"] },
  { id: "list_milestones", kind: "read", level: 0, rank: 2, money: false, valid: {}, required: [] },
  { id: "create_milestone", kind: "write", level: 1, rank: 2, money: false, valid: { title: "Structure complete" }, required: ["title"],
    optional: { targetDate: "2026-11-30", description: "Frame and slabs" }, text: ["title", "description"] },
  { id: "update_milestone", kind: "write", level: 1, rank: 2, money: false, valid: { milestoneId: "ms_a" }, required: ["milestoneId"],
    optional: { title: "Structure done", description: "Frame", targetDate: "2026-11-30", status: "completed" }, text: ["title", "description"], ids: ["milestoneId"] },
  { id: "create_schedule_task", kind: "write", level: 1, rank: 2, money: false, valid: { title: "Pour slab", startDate: "2026-10-05" }, required: ["title", "startDate"],
    optional: { dueDate: "2026-10-08", durationDays: 3, description: "Level 1 slab", priority: "high", predecessorId: "issue_a", boqLineItemId: "line_a", assigneeIds: [MEMBER], typeId: "type_ok" },
    text: ["title", "description"], ids: ["assigneeIds", "boqLineItemId", "predecessorId", "typeId"] },
  { id: "get_manpower_cost_report", kind: "read", level: 0, rank: 2, money: true, valid: {}, required: [], optional: { date: "2026-10-01", trade: "Mason", dateFrom: "2026-10-01", dateTo: "2026-10-31" } },
  { id: "get_designer_timesheet_report", kind: "read", level: 0, rank: 2, money: true, valid: {}, required: [], optional: { from: "2026-10-01", to: "2026-10-31" } },
  { id: "get_project_analysis", kind: "read", level: 0, rank: 3, money: true, valid: {}, required: [] },
];

registerLinkMatrix("AW-301 wave 1", ROWS);

// ═══ 2. THE EXECUTOR ══════════════════════════════════════════════════════════════════════════

const READ_IDS = ROWS.filter((r) => r.kind === "read").map((r) => r.id);
const WRITE_IDS = ROWS.filter((r) => r.kind === "write").map((r) => r.id);

describe("AW-301: the registry has an executor for each, and a read is a read on the read path, a write a write", () => {
  test("each function is in the registry with the kind the policy says; a write is refused by the read mode, a read has no card to confirm", async () => {
    for (const row of ROWS) {
      const spec = functionSpec(row.id)!;
      expect({ id: row.id, kind: spec.kind }).toEqual({ id: row.id, kind: row.kind === "read" ? "ask" : "write" });
      expect({ id: row.id, hasCard: spec.card !== undefined }).toEqual({ id: row.id, hasCard: row.kind === "write" });
    }
    for (const id of WRITE_IDS) {
      const out = await read(id, {}, "manager", { allowed: [id] });
      expect({ id, out }).toEqual({ id, out: { ok: false, status: 403, code: "FUNCTION_NOT_READ" } });
    }
    expect(totalCalls()).toBe(0);
  });

  test("a read that is not on the link's effective list is refused before anything runs", async () => {
    for (const id of READ_IDS) {
      const out = await read(id, {}, "manager", { allowed: ["get_construction_project_dashboard"] });
      expect({ id, out }).toEqual({ id, out: { ok: false, status: 403, code: "FUNCTION_NOT_ALLOWED" } });
    }
    expect(totalCalls()).toBe(0);
  });
});

describe("AW-301: rank end to end: the effective list of a link of each rank gates the executor's read mode", () => {
  test("a link below a read's minimum rank has no such function on its list, and executeRead() answers 403 FUNCTION_NOT_ALLOWED with nothing run; from the rank up it runs", async () => {
    for (const rank of [1, 2, 3] as const) {
      const list = await effectiveList(rank);
      for (const row of ROWS.filter((r) => r.kind === "read")) {
        const calls = totalCalls();
        const out = await read(row.id, row.valid, rank >= 3 ? "manager" : rank === 2 ? "member" : "viewer", { allowed: list });
        if (rank < row.rank) {
          expect({ id: row.id, rank, out }).toEqual({ id: row.id, rank, out: { ok: false, status: 403, code: "FUNCTION_NOT_ALLOWED" } });
          // refused before anything ran: no service was called
          expect({ id: row.id, rank, ran: totalCalls() - calls }).toEqual({ id: row.id, rank, ran: 0 });
        } else {
          expect({ id: row.id, rank, refused: !out.ok && out.status === 403 }).toEqual({ id: row.id, rank, refused: false });
        }
      }
    }
  });
});

describe("AW-301: what the read mode hands to the executor", () => {
  test("only the parameters the registry declares, plus the link's project: an undeclared name is dropped and a projectId naming another project is overwritten", async () => {
    for (const row of ROWS.filter((r) => r.kind === "read")) {
      const seen: Array<Record<string, unknown>> = [];
      const spy = async (t: import("./executor").ExecutableTask) => {
        seen.push(t.params);
        return { success: true as const, result: {} };
      };
      const params = { ...row.valid, ...(row.optional ?? {}), not_declared: "x", evil: 1, projectId: PROJECT_B };
      const out = await executeRead({ orgId: ORG, userId: PERSON, projectId: PROJECT_A, functionId: row.id, params, role: "manager", actorUserId: PERSON, allowedFunctionIds: [row.id] }, spy);
      expect({ id: row.id, ok: out.ok }).toEqual({ id: row.id, ok: true });
      expect({ id: row.id, keys: Object.keys(seen[0]).sort() }).toEqual({ id: row.id, keys: [...Object.keys(row.valid), ...Object.keys(row.optional ?? {}), "projectId"].sort() });
      expect({ id: row.id, projectId: seen[0].projectId }).toEqual({ id: row.id, projectId: PROJECT_A });
    }
  });
});

describe("AW-301: every read, in the link's read mode", () => {
  const OK_PARAMS: Row = {
    get_boq_line_items: {}, run_named_report: { reportSlug: "budget-summary" }, get_project_schedule: {}, list_milestones: {},
    get_manpower_cost_report: {}, get_designer_timesheet_report: {}, get_project_analysis: {},
  };

  test("a complete parameter set succeeds, and the link's project is the one every service is asked about", async () => {
    for (const id of READ_IDS) {
      const out = await read(id, OK_PARAMS[id] as Row);
      expect({ id, ok: out.ok }).toEqual({ id, ok: true });
    }
    expect(fn.manpowerCostReport.mock.calls[0][1]).toBe(PROJECT_A);
    expect(fn.designerTimesheetReport.mock.calls[0][1]).toBe(PROJECT_A);
    expect(fn.getProjectAnalysis.mock.calls[0][1]).toBe(PROJECT_A);
    expect(fn.listIssues.mock.calls[0][1]).toBe(PROJECT_A);
    expect(fn.listMilestones.mock.calls[0][1]).toBe(PROJECT_A);
    expect(fn.budgetSummary.mock.calls[0][1]).toBe(PROJECT_A);
  });

  test("the project is the link's whatever the caller names: projectId in params is overwritten, never obeyed (0 calls on project B)", async () => {
    for (const id of READ_IDS) {
      const out = await read(id, { ...(OK_PARAMS[id] as Row), projectId: PROJECT_B });
      expect({ id, ok: out.ok }).toEqual({ id, ok: true });
    }
    for (const m of [fn.manpowerCostReport, fn.designerTimesheetReport, fn.getProjectAnalysis, fn.listIssues, fn.listMilestones, fn.budgetSummary]) {
      expect(m.mock.calls.map((c) => c[1])).toEqual([PROJECT_A]);
    }
    // and an org-wide answer is never asked for: no read reaches listOrgAnalysis, and the analysis is the one project's row
    expect(fn.listOrgAnalysis).toHaveBeenCalledTimes(0);
  });

  test("the optional parameters reach the service, and a name the registry does not declare does not", async () => {
    await readOk("get_manpower_cost_report", { date: "2026-10-01", trade: "Mason", dateFrom: "2026-10-01", dateTo: "2026-10-31", evil: "x" });
    expect(callOf(fn.manpowerCostReport)).toEqual([{ orgId: ORG }, PROJECT_A, "2026-10-01", "Mason", "2026-10-01", "2026-10-31"]);
    await readOk("get_designer_timesheet_report", { from: "2026-10-01", to: "2026-10-31", evil: "x" });
    expect(callOf(fn.designerTimesheetReport)).toEqual([{ orgId: ORG }, PROJECT_A, { from: "2026-10-01", to: "2026-10-31" }]);
    await readOk("get_project_schedule", { statusId: "st_1", assigneeId: MEMBER, evil: "x" });
    expect(callOf(fn.listIssues)).toEqual([{ orgId: ORG }, PROJECT_A, { statusId: "st_1", assigneeId: MEMBER }]);
    await readOk("run_named_report", { reportSlug: "weekly-project", weekStart: "2026-09-21", evil: "x" });
    expect(callOf(fn.weeklyProject)).toEqual([{ orgId: ORG }, PROJECT_A, "2026-09-21"]);
    await readOk("run_named_report", { reportSlug: "work-progress", category: ["Civil", "Paint"] });
    expect(callOf(fn.workProgress)).toEqual([{ orgId: ORG }, PROJECT_A, { categoryFilter: ["Civil", "Paint"] }]);
    await readOk("run_named_report", { reportSlug: "manpower-cost", date: "2026-10-01", trade: "Mason" });
    expect(callOf(fn.manpowerCostSlug)).toEqual([{ orgId: ORG }, PROJECT_A, "2026-10-01", "Mason"]);
    await readOk("run_named_report", { reportSlug: "budget-variance", category: "Civil", vendorId: "sup_1", groupBy: "category" });
    expect(callOf(fn.budgetVariance)).toEqual([{ orgId: ORG }, PROJECT_A, { categories: ["Civil"], vendorId: "sup_1", groupBy: "category" }]);
  });

  test("a report that needs a week says so (DATE_REQUIRED); a report the registry does not know is REQUEST_REJECTED; nothing is read either way", async () => {
    expect(await read("run_named_report", { reportSlug: "weekly-project" })).toMatchObject({ ok: false, status: 422, failure: { code: "DATE_REQUIRED", missing: ["date"] } });
    expect(await read("run_named_report", { reportSlug: "no-such-report" })).toMatchObject({ ok: false, status: 422, failure: { code: "REQUEST_REJECTED" } });
    // designer-timesheet has its own function (the org-wide block is not returned), so the named-report function refuses it
    expect(await read("run_named_report", { reportSlug: "designer-timesheet" })).toMatchObject({ ok: false, status: 422, failure: { code: "REQUEST_REJECTED" } });
    expect(totalCalls()).toBe(0);
  });

  test("missing: run_named_report without its report is a 422 that names what is missing (the vocabulary key, not the parameter name)", async () => {
    const out = await read("run_named_report", {});
    expect(out).toMatchObject({ ok: false, status: 422, failure: { code: "VALUE_REQUIRED", missing: ["value"] } });
    expect(await read("run_named_report", { reportSlug: "   " })).toMatchObject({ ok: false, status: 422, failure: { code: "VALUE_REQUIRED", missing: ["value"] } });
    expect(totalCalls()).toBe(0);
  });

  test("another project's id: a BOQ of project B named on a report is refused as absent and the report is not run; the schedule filters cannot widen the project", async () => {
    const before = snapshot();
    const out = await read("run_named_report", { reportSlug: "category-boq-amounts", boqId: "boq_b" });
    expect(out).toMatchObject({ ok: false, status: 422, failure: { code: "RECORD_NOT_FOUND" } });
    expect(fn.categoryBoqAmounts).toHaveBeenCalledTimes(0);
    expect(snapshot()).toBe(before);
    // the link's own BOQ is fine
    expect((await read("run_named_report", { reportSlug: "category-boq-amounts", boqId: "boq_a" })).ok).toBe(true);
    expect(callOf(fn.categoryBoqAmounts)).toEqual([{ orgId: ORG }, PROJECT_A, { boqId: "boq_a" }]);
    // a status or an assignee of project B is only a filter on project A's own tasks: the service is asked about A, so B's tasks cannot come back
    const tasks = (await readOk("get_project_schedule", { statusId: "st_of_b", assigneeId: USER_B })).tasks as Row[];
    expect(callOf(fn.listIssues)[1]).toBe(PROJECT_A);
    expect(tasks.every((t) => t.projectId === PROJECT_A)).toBe(true);
  });

  test("get_boq_line_items: a BOQ of another project is refused by the REAL service (0 lines read); the link's own BOQ and the current BOQ are read", async () => {
    // getProjectBoqLinePage() is real: it looks the named BOQ up on this org and project and answers null for any other, which is RECORD_NOT_FOUND
    const before = snapshot();
    for (const boqId of ["boq_b", "no-such-boq"]) {
      expect(await read("get_boq_line_items", { boqId })).toMatchObject({ ok: false, status: 422, failure: { code: "RECORD_NOT_FOUND" } });
    }
    expect(snapshot()).toBe(before);
    expect(store.unparsed).toEqual([]);
    const own = await read("get_boq_line_items", { boqId: "boq_a", limit: 5 });
    expect(own.ok).toBe(true);
    expect((own as { result: { boqId: string } }).result.boqId).toBe("boq_a");
    // a limit that is not a whole number from 1 up is a bad request, before any transaction
    expect(await read("get_boq_line_items", { limit: 0 })).toMatchObject({ ok: false, status: 422, failure: { code: "REQUEST_REJECTED" } });
  });

  test("get_boq_line_items: no project-side cost field leaves the executor for any role; the contract rate is why the link's rank is 3 (the record kind hides it below 3)", async () => {
    for (const role of ["member", "manager", null]) {
      const out = await readOk("get_boq_line_items", { boqId: "boq_a" }, role);
      const shipped = keysDeep(out);
      for (const field of ["rateProject", "qtyProject", "projectValue"]) expect({ role, field, shipped: shipped.has(field) }).toEqual({ role, field, shipped: false });
    }
    // the boq_lines record kind hides rate and amount below rank 3, and the function is not offered below rank 3: a member link reads lines
    // through the kind with the money hidden, never through this function
    const kinds = JSON.parse(readFileSync(new URL("../../../supabase/functions/ai-work-link/record-kinds.generated.json", import.meta.url), "utf8")) as Array<{ kind: string; money_columns: string[] }>;
    const lines = kinds.find((k) => k.kind === "boq_lines")!;
    expect(lines.money_columns).toEqual(expect.arrayContaining(["rate", "amount"]));
    expect(ROWS.find((r) => r.id === "get_boq_line_items")!.rank).toBe(3);
  });

  test("get_project_analysis: refused below manager whatever the link says (the route is refused, not a column hidden); a manager gets the one project's row", async () => {
    for (const role of ["member", "viewer", null]) {
      const out = await read("get_project_analysis", {}, role);
      expect({ role, out }).toMatchObject({ role, out: { ok: false, status: 422, failure: { code: "NOT_PERMITTED" } } });
    }
    expect(fn.getProjectAnalysis).toHaveBeenCalledTimes(0);
    const ok = await readOk("get_project_analysis", {}, "manager");
    expect(ok).toEqual({ row: { projectId: PROJECT_A, projectName: "Cedar Heights", contractValueNow: 5000000 } });
  });

  test("money: manpower cost is null below manager and marked; a manager sees the figure", async () => {
    const member = await readOk("get_manpower_cost_report", {}, "member");
    expect(member).toEqual({ byTrade: [{ trade: "Mason", totalCost: null, workerDays: 12 }], date: null, financialsRedacted: true });
    for (const role of ["viewer", null]) expect(((await readOk("get_manpower_cost_report", {}, role)).byTrade as Row[])[0].totalCost).toBeNull();
    expect(((await readOk("get_manpower_cost_report", {}, "manager")).byTrade as Row[])[0].totalCost).toBe(48000);
  });

  test("money: the designer report carries the project's part only, with every budget, actual and variance null below manager", async () => {
    const member = await readOk("get_designer_timesheet_report", {}, "member");
    expect(Object.keys(member).sort()).toEqual(["financialsRedacted", "period", "projectScoped"]);
    const ps = member.projectScoped as { overallBudget: unknown; overallActual: unknown; overallVariance: unknown; byCategory: Row[]; byDesignerStatus: Row[]; byUser: Row[] };
    expect([ps.overallBudget, ps.overallActual, ps.overallVariance]).toEqual([null, null, null]);
    expect(ps.byCategory[0]).toMatchObject({ actual: null, budget: null, hours: 32 });
    expect(ps.byDesignerStatus[0]).toMatchObject({ actual: null, budget: null, variance: null });
    expect(ps.byUser[0].totalHours).toBe(32);
    const manager = (await readOk("get_designer_timesheet_report", {}, "manager")).projectScoped as { overallActual: number };
    expect(manager.overallActual).toBe(25600);
    // the org-wide block (every designer and every project of the org, with project B's figures) is never returned, to any role
    for (const role of ["member", "manager"]) expect(keysDeep(await readOk("get_designer_timesheet_report", {}, role)).has("orgWide")).toBe(false);
  });

  test("money: a named report nulls every currency column and drops the totals of money below manager; the note, which quotes an amount, goes too", async () => {
    const member = await readOk("run_named_report", { reportSlug: "budget-summary" }, "member");
    expect(member).toMatchObject({ financialsRedacted: true, rows: [{ head: "Civil", budget: null, done: 40 }], totals: { done: 40 } });
    expect((member.totals as Row).budget).toBeUndefined();
    // category-boq-amounts is built by the REAL table builder, and its note states the uncategorised amount
    const manager = await readOk("run_named_report", { reportSlug: "category-boq-amounts" }, "manager");
    expect(String(manager.note)).toContain("45000");
    for (const role of ["member", "viewer", null]) {
      const table = await readOk("run_named_report", { reportSlug: "category-boq-amounts" }, role);
      expect(JSON.stringify(table)).not.toMatch(/45000|900000|945000/);
      expect(table).toMatchObject({ financialsRedacted: true, rows: [{ name: "Civil", totalAmount: null }] });
    }
    expect((manager.rows as Row[])[0].totalAmount).toBe(900000);
  });

  test("budget-vs-actual and budget-variance are manager reports: a member is refused, and the service is not run", async () => {
    for (const slug of ["budget-vs-actual", "budget-variance"]) {
      for (const role of ["member", "viewer", null]) {
        const out = await read("run_named_report", { reportSlug: slug }, role);
        expect({ slug, role, out }).toMatchObject({ slug, role, out: { ok: false, status: 422, failure: { code: "NOT_PERMITTED" } } });
      }
    }
    expect(fn.budgetVariance).toHaveBeenCalledTimes(0);
    expect((await read("run_named_report", { reportSlug: "budget-variance" }, "manager")).ok).toBe(true);
    expect(fn.budgetVariance).toHaveBeenCalledTimes(1);
  });
});

describe("AW-301: the three writes, through the executor", () => {
  test("create_milestone: created on the link's project under the confirming person; the title is required; nothing is written without a person or for another project", async () => {
    const out = await writeOk("create_milestone", { title: "Structure complete", targetDate: "2026-11-30", description: "Frame and slabs" });
    expect(out).toMatchObject({ id: "ms_new", route: "/milestones" });
    expect(callOf(fn.createMilestone)).toEqual([
      { orgId: ORG, userId: MEMBER, dbUser: null }, PROJECT_A,
      { name: "Structure complete", description: "Frame and slabs", targetDate: "2026-11-30" },
    ]);
    fn.createMilestone.mockClear();
    expect(await refused("create_milestone", {})).toMatchObject({ code: "TITLE_REQUIRED", missing: ["title"] });
    expect(await refused("create_milestone", { title: "   " })).toMatchObject({ code: "TITLE_REQUIRED" });
    expect(await refused("create_milestone", { title: "Structure complete" }, { actorUserId: null })).toMatchObject({ code: "NOT_PERMITTED", context: { reason: "unidentified_actor" } });
    expect(await refused("create_milestone", { title: "Structure complete", projectId: PROJECT_B })).toMatchObject({ code: "PROJECT_NOT_REACHABLE" });
    // a project id that is no project of this org reaches no insert
    expect(await refused("create_milestone", { title: "x" }, { projectId: "no-such-project" })).toMatchObject({ code: "RECORD_NOT_FOUND" });
    expect(fn.createMilestone).toHaveBeenCalledTimes(0);
  });

  test("update_milestone: a milestone of another project is absent (0 writes, the service is not called); nothing to change is a bad request; the project's own is updated", async () => {
    const before = snapshot();
    expect(await refused("update_milestone", { milestoneId: "ms_b", title: "Hijacked" })).toMatchObject({ code: "RECORD_NOT_FOUND" });
    expect(await refused("update_milestone", { milestoneId: "no-such-milestone", title: "x" })).toMatchObject({ code: "RECORD_NOT_FOUND" });
    expect(await refused("update_milestone", { title: "x" })).toMatchObject({ code: "VALUE_REQUIRED", missing: ["value"] });
    expect(await refused("update_milestone", { milestoneId: "ms_a" })).toMatchObject({ code: "VALUE_REQUIRED" });
    expect(await refused("update_milestone", { milestoneId: "ms_a", title: "x" }, { actorUserId: null })).toMatchObject({ code: "NOT_PERMITTED" });
    expect(fn.updateMilestone).toHaveBeenCalledTimes(0);
    expect(snapshot()).toBe(before);
    const out = await writeOk("update_milestone", { milestoneId: "ms_a", title: "Structure done", description: "Frame", targetDate: "2026-12-01", status: "completed" });
    expect(out).toMatchObject({ id: "ms_a", route: "/milestones" });
    expect(callOf(fn.updateMilestone)).toEqual([
      { orgId: ORG, userId: MEMBER, dbUser: null }, "ms_a",
      { name: "Structure done", description: "Frame", targetDate: "2026-12-01", status: "completed" },
    ]);
  });

  test("create_schedule_task: every id is held to the link's project or org, and each refusal happens before the service is called (0 rows written)", async () => {
    const base = { title: "Pour slab", startDate: "2026-10-05" };
    const before = snapshot();
    const cases: Array<[string, Row, string]> = [
      ["a BOQ line of project B", { boqLineItemId: "line_b" }, "BOQ_LINE_NOT_FOUND"],
      ["an activity of project B as predecessor", { predecessorId: "issue_b" }, "RECORD_NOT_FOUND"],
      ["a predecessor that does not exist", { predecessorId: "no-such-issue" }, "RECORD_NOT_FOUND"],
      ["an issue type of another organisation", { typeId: "type_other_org" }, "RECORD_NOT_FOUND"],
      ["an assignee who is on project B's team only", { assigneeIds: [USER_B] }, "RECORD_NOT_FOUND"],
      ["an assignee of another organisation", { assigneeIds: [OUTSIDER] }, "RECORD_NOT_FOUND"],
      ["one good assignee and one who is not on the team", { assigneeIds: [MEMBER, USER_B] }, "RECORD_NOT_FOUND"],
    ];
    for (const [label, extra, code] of cases) {
      const failure = await refused("create_schedule_task", { ...base, ...extra });
      expect({ label, code: String(failure.code) }).toEqual({ label, code });
    }
    expect(fn.createScheduleActivity).toHaveBeenCalledTimes(0);
    expect(snapshot()).toBe(before);
    // the project's own ids, and the org's own type, pass and reach the service
    const out = await writeOk("create_schedule_task", { ...base, boqLineItemId: "line_a", predecessorId: "issue_a", typeId: "type_ok", assigneeIds: [MEMBER, PERSON], priority: "high", dueDate: "2026-10-08", durationDays: 3, description: "Level 1 slab" });
    expect(out).toMatchObject({ id: "task_new", route: "/schedule" });
    expect(callOf(fn.createScheduleActivity)).toEqual([
      { orgId: ORG, userId: MEMBER, dbUser: null },
      {
        projectId: PROJECT_A, typeId: "type_ok", title: "Pour slab", description: "Level 1 slab", priority: "high", dueDate: "2026-10-08",
        startDate: "2026-10-05", durationDays: 3, predecessorId: "issue_a", boqLineItemId: "line_a", assigneeIds: [MEMBER, PERSON],
      },
    ]);
  });

  test("create_schedule_task: required parameters and the person rule; the org's default type is used when none is named", async () => {
    expect(await refused("create_schedule_task", { startDate: "2026-10-05" })).toMatchObject({ code: "TITLE_REQUIRED", missing: ["title"] });
    expect(await refused("create_schedule_task", { title: "Pour slab" })).toMatchObject({ code: "DATE_REQUIRED", missing: ["date"] });
    expect(await refused("create_schedule_task", { title: "Pour slab", startDate: "2026-10-05" }, { actorUserId: null })).toMatchObject({ code: "NOT_PERMITTED" });
    expect(await refused("create_schedule_task", { title: "Pour slab", startDate: "2026-10-05", projectId: PROJECT_B })).toMatchObject({ code: "PROJECT_NOT_REACHABLE" });
    expect(fn.createScheduleActivity).toHaveBeenCalledTimes(0);
    await writeOk("create_schedule_task", { title: "Pour slab", startDate: "2026-10-05" });
    expect((callOf(fn.createScheduleActivity)[1] as Row).typeId).toBe("type_ok");
    fn.createScheduleActivity.mockClear();
    fn.resolveDefaultIssueTypeId.mockImplementationOnce(async () => null);
    expect(await refused("create_schedule_task", { title: "Pour slab", startDate: "2026-10-05" })).toMatchObject({ code: "REQUEST_REJECTED" });
    expect(fn.createScheduleActivity).toHaveBeenCalledTimes(0);
  });

  test("a write on the link is attributed to the person, not to the API key that carried it (the row's author is the confirming person)", async () => {
    await writeOk("create_milestone", { title: "Structure complete" }, { userId: API_KEY, actorUserId: PERSON });
    expect((callOf(fn.createMilestone)[0] as Row).userId).toBe(PERSON);
    expect((callOf(fn.createMilestone)[0] as Row).userId).not.toBe(API_KEY);
  });
});

describe("AW-301: free text written through a link is cleaned and capped (spec 9.11) for every text parameter of the wave", () => {
  const textRows = ROWS.filter((r) => (r.text ?? []).length > 0);
  /** The `text` fields of a function's card: the names run-submission.ts's withLinkText() adds to the spec 9.11 list. */
  const cardTextFields = (id: string) => (functionSpec(id)?.card?.fields ?? []).filter((f) => f.type === "text").map((f) => f.key);

  test("every text parameter the policy lists is one the write-time rule treats as free text", () => {
    for (const row of textRows) {
      for (const name of row.text ?? []) expect({ id: row.id, name, covered: isFreeTextParam(name, cardTextFields(row.id)) }).toEqual({ id: row.id, name, covered: true });
    }
  });

  test("control characters, zero-width and bidirectional characters are removed and backtick runs are neutralised; the other parameters are left alone", () => {
    for (const row of textRows) {
      const dirty = Object.fromEntries((row.text ?? []).map((n) => [n, `a\u0000b​c‮d\`\`\`e\tf\ng`]));
      const rules = applyLinkTextRules({ ...row.valid, ...dirty, milestoneId: "ms_a" }, cardTextFields(row.id));
      expect(rules.ok).toBe(true);
      if (!rules.ok) continue;
      for (const name of row.text ?? []) expect({ id: row.id, name, value: rules.params[name] }).toEqual({ id: row.id, name, value: "abcd''e\tf\ng" });
      expect(rules.params.milestoneId).toBe("ms_a");
    }
  });

  test("text over 2,000 characters after cleaning is refused with TEXT_TOO_LONG and the field's name; exactly 2,000 is kept whole; invisible padding does not count", () => {
    for (const row of textRows) {
      for (const name of row.text ?? []) {
        const tooLong = applyLinkTextRules({ [name]: "x".repeat(AI_LINK_TEXT_MAX + 1) }, cardTextFields(row.id));
        expect({ id: row.id, name, tooLong }).toEqual({ id: row.id, name, tooLong: { ok: false, code: "TEXT_TOO_LONG", field: name, length: AI_LINK_TEXT_MAX + 1 } });
        const exact = applyLinkTextRules({ [name]: "x".repeat(AI_LINK_TEXT_MAX) }, cardTextFields(row.id));
        expect(exact.ok && (exact.params[name] as string).length).toBe(AI_LINK_TEXT_MAX);
        const padded = applyLinkTextRules({ [name]: "x".repeat(AI_LINK_TEXT_MAX) + "​".repeat(50) }, cardTextFields(row.id));
        expect(padded.ok && (padded.params[name] as string).length).toBe(AI_LINK_TEXT_MAX);
      }
    }
  });
});
