/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-38, register row BR-512: the 26 registry entries that
// follow create_boq and get_boq_line_items (U-28) are registered, and each one
// calls the service function the matching PROJEXA route calls -- with the task's
// org, the task's project and the confirming person, and nothing else.
//
// The 26 (PROJEXA_BUILD_SPEC section 5, minus the U-28 entries and the email
// promotion of U-31):
//   reads   list_change_orders get_change_order run_named_report get_project_analysis
//           get_manpower_cost_report get_designer_timesheet_report get_project_schedule
//           list_milestones list_billing_claims get_billing_due_queue recall_precedent
//           preview_boq_import
//   writes  create_change_order create_site_instruction update_line_item_budget
//           create_schedule_task create_milestone update_milestone create_drawing
//           create_mom record_material_receipt approve_timesheet reject_timesheet
//           capture_artifact create_report_share_link apply_boq_import
//
// What is proven, beyond "the right function is called":
//   - billing claims are read-only: the two billing entries call only the two
//     billing reads, no billing write function is ever reached, and no billing
//     write id is registered (R-95 is held for the owner);
//   - cost fields come back null below manager rank (and for a caller with no
//     known role), and are shown to a manager: change-order cost, the line budget
//     overlay, manpower and designer cost, a material receipt's unit cost, the
//     currency columns of a named report; project analysis and the manager-only
//     report are refused below manager rank, as their routes refuse them;
//   - every write refuses a caller that names no person before any service is
//     reached (PMD-34), and every entry refuses a params.projectId naming another
//     project (PROJECT_NOT_REACHABLE);
//   - an id parameter naming a record of another project reads as absent (U-18),
//     and a material named in words is looked up on the task's own project only;
//   - a material receipt that cannot succeed (a date that is not a real day, a
//     vendor that is no supplier of the org) is refused before a new material is
//     created, so it leaves no material without a receipt;
//   - a write is a proposal until a person confirms it (PMD-05).
//
// WHAT IS REAL: executor.ts, function-registry.ts, run-submission.ts, validate()
// and the executors' own lookups (their where clauses evaluated against fixture
// rows). WHAT IS FAKED: @/lib/db/tenant-scoped (boq-store-double.ts), the service
// functions each entry wraps (recording fakes, so the call and its arguments are
// what is asserted), and the storage client the BOQ import reads a stored sheet
// with.
//
// Run: bun test --isolate src/lib/pipeline/executor-registry-u38.test.ts
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
const MEMBER = "person_member";
/** What task.userId holds for PROJEXA's proxy: the org API key's id, not a person. */
const API_KEY = "apikey_1";
const SHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere" },
  ]);
  seedRows(s, "users", [
    { id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" },
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Babu K", email: "babu@example.com" },
  ]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1 },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1 },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "line_a", orgId: ORG, boqId: "boq_a", itemCode: "EX-01", quantity: "10" },
    { id: "line_b", orgId: ORG, boqId: "boq_b", itemCode: "EX-01", quantity: "10" },
  ]);
  // BUILD-002 WP-05a: create_schedule_task holds a named issue type to the org (an issue type has no project) and a predecessor to the project
  seedRows(s, "pms_issue_types", [{ id: "type_named", orgId: ORG, name: "Activity" }]);
  seedRows(s, "pms_issues", [{ id: "issue_1", orgId: ORG, projectId: PROJECT_A, title: "Joinery shop drawings" }]);
  seedRows(s, "construction_materials", [
    { id: "mat_a", orgId: ORG, projectId: PROJECT_A, name: "Cement OPC 53", unit: "bag" },
    { id: "mat_b", orgId: ORG, projectId: PROJECT_B, name: "Steel TMT", unit: "kg" },
  ]);
  seedRows(s, "erp_suppliers", [
    { id: "sup_a", orgId: ORG, supplierName: "Shree Cement Traders" },
    { id: "sup_x", orgId: OTHER_ORG, supplierName: "Elsewhere Suppliers" },
  ]);
  seedRows(s, "documents", [
    { id: "sheet_a", orgId: ORG, name: "Villa BOQ.xlsx", fileUrl: `${ORG}/sheet-a.xlsx`, fileType: SHEET_TYPE, fileSize: 2048, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_A, metadata: null },
    { id: "sheet_meta", orgId: ORG, name: "Meta filed.xlsx", fileUrl: `${ORG}/sheet-meta.xlsx`, fileType: SHEET_TYPE, fileSize: 2048, category: "boq", linkedEntityType: "permit", linkedEntityId: "permit_1", metadata: { projectId: PROJECT_A } },
    { id: "sheet_b", orgId: ORG, name: "Other BOQ.xlsx", fileUrl: `${ORG}/sheet-b.xlsx`, fileType: SHEET_TYPE, fileSize: 2048, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_B, metadata: null },
    { id: "sheet_link", orgId: ORG, name: "Linked BOQ", fileUrl: "https://example.com/boq.xlsx", fileType: null, fileSize: null, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_A, metadata: { isExternalLink: true } },
    { id: "sheet_big", orgId: ORG, name: "Huge BOQ.xlsx", fileUrl: `${ORG}/sheet-big.xlsx`, fileType: SHEET_TYPE, fileSize: 11 * 1024 * 1024, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_A, metadata: null },
  ]);
  return s;
}

// ── the service functions each entry wraps, as recording fakes ───────────────
type Args = unknown[];
const PARSED = {
  lineItems: [
    { itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450 },
    { itemCode: "1.02", description: "PCC 1:4:8 below footings", unit: "cum", quantity: 30, rate: 5200 },
    { itemCode: "1.02.1", parentItemCode: "1.02", breakdownPercentage: 40, description: "PCC labour", unit: "", quantity: 0, rate: 0 },
  ],
  warnings: ["Row 9 has no unit"],
  issues: [{ row: 9, message: "no unit", blocking: false }],
  mapping: { itemCode: "Item", description: "Description" },
  headers: ["Item", "Description", "Unit", "Qty", "Rate"],
  totalRows: 3,
};
const REPORT_TABLE = {
  columns: [
    { key: "head", label: "Head", unit: "text", align: "left" },
    { key: "budget", label: "Budget", unit: "currency", align: "right" },
    { key: "done", label: "Done", unit: "percent", align: "right" },
  ],
  rows: [{ head: "Civil", budget: 900000, done: 40 }],
  totals: { budget: 900000, done: 40 },
};

const fn = {
  listChangeOrders: mock(async (..._a: Args) => [{ id: "co_1", projectId: PROJECT_A, number: 1, title: "Extra plinth", costImpact: "125000", scheduleImpactDays: 3 }]),
  getChangeOrder: mock(async (_c: unknown, id: string) => ({ id, projectId: id === "co_b" ? PROJECT_B : PROJECT_A, number: 1, title: "Extra plinth", costImpact: "125000" })),
  createChangeOrder: mock(async (_c: unknown, input: Row) => ({ id: "co_new", number: 2, ...input, costImpact: String(input.costImpact ?? 0) })),
  createSiteInstruction: mock(async (_c: unknown, input: Row) => ({ id: "si_1", siNumber: 1, ...input })),
  manpowerCostReport: mock(async (..._a: Args) => ({ byTrade: [{ trade: "Mason", totalCost: 48000, workerDays: 12 }], date: null })),
  designerTimesheetReport: mock(async (..._a: Args) => ({
    period: { from: null, to: null },
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
  budgetVsActual: mock(async (..._a: Args) => ({ payload: "budget-vs-actual" })),
  weeklyProject: mock(async (..._a: Args) => ({ payload: "weekly-project" })),
  buildReportTable: mock((_slug: string, _payload: unknown, currency: string | null) => ({ ...REPORT_TABLE, currency })),
  getBaseCurrency: mock(async (..._a: Args) => ({ baseCurrency: { code: "INR" } })),
  getProjectAnalysis: mock(async (_c: unknown, projectId: string) => ({ projectId, projectName: "Cedar Heights", contractValueNow: 5000000 })),
  listOrgAnalysis: mock(async (..._a: Args) => [{ projectId: PROJECT_A, actualProfit: { profitOnGross: 100 } }, { projectId: PROJECT_B, actualProfit: { profitOnGross: 900 } }]),
  listIssues: mock(async (..._a: Args) => [{ id: "issue_1", number: 12, title: "Joinery shop drawings" }]),
  resolveDefaultIssueTypeId: mock(async (..._a: Args): Promise<string | null> => "type_default"),
  createScheduleActivity: mock(async (_c: unknown, input: Row) => ({ id: "task_new", number: 13, ...input })),
  listMilestones: mock(async (..._a: Args) => [{ id: "ms_a", name: "Structure complete", completionPercentage: 40 }]),
  createMilestone: mock(async (_c: unknown, _p: string, input: Row) => ({ id: "ms_new", ...input, completionPercentage: 0 })),
  updateMilestone: mock(async (_c: unknown, id: string, patch: Row) => ({ id, ...patch, completionPercentage: 40 })),
  listClaims: mock(async (..._a: Args) => [{ id: "claim_1", status: "submitted", retentionPercent: "5" }]),
  listBillingDueQueue: mock(async (..._a: Args) => [{ id: "claim_1", status: "submitted", isOverdue: false }]),
  createDrawingRecord: mock(async (_c: unknown, input: Row) => ({ id: "drawing_new", ...input })),
  createDocumentRecord: mock(async (_c: unknown, input: Row) => ({ id: "doc_new", ...input })),
  createVeriMeeting: mock(async (_c: unknown, input: Row) => ({ id: "veri_meeting_1", ...input })),
  createMeeting: mock(async (_c: unknown, _p: string, input: Row) => ({ id: "pms_meeting_1", ...input })),
  createMaterial: mock(async (_c: unknown, input: Row) => ({ id: "mat_new", ...input, unitCost: String(input.unitCost ?? 0) })),
  createMaterialReceipt: mock(async (_c: unknown, input: Row) => ({ id: "receipt_1", ...input, unitCost: String(input.unitCost ?? 0) })),
  getTimeEntry: mock(async (_c: unknown, id: string) => ({ id, projectId: id === "te_b" ? PROJECT_B : PROJECT_A, hours: "6.00" })),
  approveTimeEntry: mock(async (_c: unknown, id: string) => ({ id, userId: MEMBER, hours: "6.00", spentOn: "2026-09-22", approvalStatus: "approved" })),
  rejectTimeEntry: mock(async (_c: unknown, id: string, reason?: string) => ({ id, userId: MEMBER, hours: "6.00", spentOn: "2026-09-22", approvalStatus: "rejected", rejectionReason: reason })),
  recordTimesheetDecisionTasks: mock(async (..._a: Args) => ({ reviewTaskClosed: 1, returnedTaskCreated: false })),
  recallMemory: mock(async (..._a: Args) => ({ tier: "keyword", mayExecute: false, proposals: [{ entityId: "mem_1", score: 0.8 }], skipped: [] })),
  createSourceObject: mock(async (..._a: Args) => "source_1"),
  createReportShareLink: mock(async (_c: unknown, input: Row) => ({ id: "link_1", token: "tok_abc", expiresAt: new Date("2026-10-02T00:00:00Z"), createdById: PERSON, reportRef: JSON.stringify(input.reportRef) })),
  parseBoqSpreadsheet: mock(async (..._a: Args) => PARSED),
  createBoq: mock(async (_c: unknown, input: Row) => ({ id: "boq_new", version: 1, status: "draft", ...input, lineItems: undefined })),
  createBoqRevision: mock(async (_c: unknown, parent: string, input: Row) => ({ id: "boq_rev", parentBoqId: parent, version: 2, ...input, lineItems: undefined })),
  updateLineItemBudget: mock(async (_c: unknown, id: string, input: Row) => ({
    id, boqId: "boq_a", itemCode: "EX-01", rate: "450", amount: "54000",
    budgetPercentage: String(input.budgetPercentage ?? 25), vendorAmount: "5000", materialAmount: "3000", manpowerAmount: "2000", computedBudget: 13500,
    rateProject: "380", qtyProject: "110", projectValue: 41800, variance: 12200, variancePercent: 22,
  })),
};
const downloads: Array<{ bucket: string; path: string }> = [];

const downloadsCount = () => downloads.length;
// Every other function the billing workflow module exports. The two billing
// entries must never reach one of them. Filled in below, once the real module is
// loaded (see the note on load order).
const billingOthers: Record<string, ReturnType<typeof mock>> = {};
const allMocks = (): Array<ReturnType<typeof mock>> => [...Object.values(fn), ...Object.values(billingOthers)];
const totalCalls = () => allMocks().reduce((sum, m) => sum + m.mock.calls.length, 0) + downloadsCount();

const restores: Array<[string, unknown]> = [];
function stub(path: string, real: object, overrides: object) {
  mock.module(path, () => ({ ...real, ...overrides }));
  restores.push([path, real]);
}

// LOAD ORDER. The service modules import each other in cycles (compliance-service
// and the BOQ services), and a cycle only resolves for one entry order: the one
// executor.ts itself uses, which starts at construction-progress-service. Loading
// a service in some other order first fails with "superclass's prototype property
// is not an object". So the real modules below are loaded in executor.ts's own
// order, each one mocked right after it is loaded.
const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));
restores.push(["@/lib/db/tenant-scoped", realTenantScoped]);

await import("@/lib/services/construction-progress-service");
stub("@/lib/services/pms-time-service", await import("@/lib/services/pms-time-service"), {
  getTimeEntry: fn.getTimeEntry, approveTimeEntry: fn.approveTimeEntry, rejectTimeEntry: fn.rejectTimeEntry,
});
await import("@/lib/services/construction-dashboard-service");
await import("@/lib/services/construction-labour-service");
stub("@/lib/services/construction-boq-service", await import("@/lib/services/construction-boq-service"), {
  createBoq: fn.createBoq, createBoqRevision: fn.createBoqRevision, updateLineItemBudget: fn.updateLineItemBudget,
});
await import("@/lib/services/cost-visibility-service");
stub("@/lib/services/pms-meeting-service", await import("@/lib/services/pms-meeting-service"), { createMeeting: fn.createMeeting });
stub("@/lib/services/document-service", await import("@/lib/services/document-service"), { createDrawingRecord: fn.createDrawingRecord, createDocumentRecord: fn.createDocumentRecord });
stub("@/lib/services/construction-change-order-service", await import("@/lib/services/construction-change-order-service"), { listChangeOrders: fn.listChangeOrders, getChangeOrder: fn.getChangeOrder, createChangeOrder: fn.createChangeOrder });
stub("@/lib/services/construction-site-instruction-service", await import("@/lib/services/construction-site-instruction-service"), { createSiteInstruction: fn.createSiteInstruction });
const realReports = await import("@/lib/services/construction-reports-service");
stub("@/lib/services/construction-reports-service", realReports, {
  manpowerCostReport: fn.manpowerCostReport,
  designerTimesheetReport: fn.designerTimesheetReport,
  buildReportTable: fn.buildReportTable,
  REPORT_REGISTRY: { ...realReports.REPORT_REGISTRY, "budget-summary": fn.budgetSummary, "budget-vs-actual": fn.budgetVsActual, "weekly-project": fn.weeklyProject },
});
stub("@/lib/services/erp-accounting-service", await import("@/lib/services/erp-accounting-service"), { getBaseCurrency: fn.getBaseCurrency });
stub("@/lib/services/boq-analysis-service", await import("@/lib/services/boq-analysis-service"), { getProjectAnalysis: fn.getProjectAnalysis, listOrgAnalysis: fn.listOrgAnalysis });
stub("@/lib/services/pms-issue-service", await import("@/lib/services/pms-issue-service"), { listIssues: fn.listIssues });
stub("@/lib/services/schedule-service", await import("@/lib/services/schedule-service"), { createScheduleActivity: fn.createScheduleActivity });
stub("@/lib/services/pms-taxonomy-service", await import("@/lib/services/pms-taxonomy-service"), {
  listMilestones: fn.listMilestones, createMilestone: fn.createMilestone, updateMilestone: fn.updateMilestone, resolveDefaultIssueTypeId: fn.resolveDefaultIssueTypeId,
});
const realBilling = await import("@/lib/services/construction-billing-workflow-service");
for (const [name, value] of Object.entries(realBilling)) {
  // Functions only: the module also re-exports the ServiceError class.
  if (typeof value !== "function" || !/^[a-z]/.test(name) || name === "listClaims" || name === "listBillingDueQueue") continue;
  billingOthers[name] = mock(async (..._a: Args) => {
    throw new Error(`billing function ${name} must not be called`);
  });
}
stub("@/lib/services/construction-billing-workflow-service", realBilling, { listClaims: fn.listClaims, listBillingDueQueue: fn.listBillingDueQueue, ...billingOthers });
stub("@/lib/services/veri-meeting-service", await import("@/lib/services/veri-meeting-service"), { createVeriMeeting: fn.createVeriMeeting });
stub("@/lib/services/construction-materials-service", await import("@/lib/services/construction-materials-service"), { createMaterial: fn.createMaterial, createMaterialReceipt: fn.createMaterialReceipt });
stub("@/lib/services/timesheet-review-task-service", await import("@/lib/services/timesheet-review-task-service"), { recordTimesheetDecisionTasks: fn.recordTimesheetDecisionTasks });
stub("@/lib/services/memory-recall-service", await import("@/lib/services/memory-recall-service"), { recallMemory: fn.recallMemory });
stub("@/lib/crr/capture", await import("@/lib/crr/capture"), { createSourceObject: fn.createSourceObject });
stub("@/lib/services/report-share-service", await import("@/lib/services/report-share-service"), { createReportShareLink: fn.createReportShareLink });
stub("@/lib/services/construction-boq-import-service", await import("@/lib/services/construction-boq-import-service"), { parseBoqSpreadsheet: fn.parseBoqSpreadsheet });
stub("@supabase/supabase-js", await import("@supabase/supabase-js"), {
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push({ bucket, path });
          return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
        },
      }),
    },
  }),
});

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
let EXECUTABLE_FUNCTION_IDS: typeof import("./executor").EXECUTABLE_FUNCTION_IDS;
let functionSpec: typeof import("./function-registry").functionSpec;
let WRITE_FUNCTION_IDS: typeof import("./function-registry").WRITE_FUNCTION_IDS;
let proposeSubmission: typeof import("./run-submission").proposeSubmission;
let confirmSubmission: typeof import("./run-submission").confirmSubmission;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor, EXECUTABLE_FUNCTION_IDS } = await import("./executor"));
  ({ functionSpec, WRITE_FUNCTION_IDS } = await import("./function-registry"));
  ({ proposeSubmission, confirmSubmission } = await import("./run-submission"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = fixtures();
  for (const m of allMocks()) m.mockClear();
  downloads.length = 0;
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
  for (const [path, real] of restores) await mock.module(path, () => real as object);
});

// ── the 26 entries, each with a complete parameter set ───────────────────────
const READS: Record<string, Row> = {
  list_change_orders: {},
  get_change_order: { changeOrderId: "co_1" },
  run_named_report: { reportSlug: "budget-summary" },
  get_project_analysis: {},
  get_manpower_cost_report: {},
  get_designer_timesheet_report: {},
  get_project_schedule: {},
  list_milestones: {},
  list_billing_claims: {},
  get_billing_due_queue: {},
  recall_precedent: { query: "slab shuttering" },
  preview_boq_import: { documentId: "sheet_a" },
};
const WRITES: Record<string, Row> = {
  create_change_order: { title: "Extra plinth" },
  create_site_instruction: { issueDate: "2026-09-20", toContractor: "Bharat Builders", description: "Revise the plinth level" },
  update_line_item_budget: { boqLineItemId: "line_a", budgetPercentage: 40 },
  create_schedule_task: { title: "Pour slab", startDate: "2026-09-28" },
  create_milestone: { title: "Structure complete" },
  update_milestone: { milestoneId: "ms_a", title: "Structure done" },
  create_drawing: { name: "AR-101 Ground floor plan", externalUrl: "https://example.com/AR-101-A" },
  create_mom: { title: "Site meeting", scheduledAt: "2026-09-24T10:00:00.000Z" },
  record_material_receipt: { materialId: "mat_a", quantity: 20 },
  approve_timesheet: { timeEntryId: "te_a" },
  reject_timesheet: { timeEntryId: "te_a", rejectionReason: "Hours do not match the task" },
  capture_artifact: { title: "Precedent", text: "Slab shuttering was left for 7 days." },
  create_report_share_link: { reportType: "work_progress", from: "2026-09-01", to: "2026-09-30" },
  apply_boq_import: { documentId: "sheet_a" },
};
const ALL: Record<string, Row> = { ...READS, ...WRITES };

function task(functionId: string, params: Row = ALL[functionId] ?? {}, overrides: Partial<import("./executor").ExecutableTask> = {}): import("./executor").ExecutableTask {
  return { orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, role: "manager", actorUserId: PERSON, ...overrides };
}
const run = (functionId: string, params?: Row, overrides?: Partial<import("./executor").ExecutableTask>) => executeTask(task(functionId, params, overrides));
/** The result of a task that must have succeeded. */
async function result(functionId: string, params?: Row, overrides?: Partial<import("./executor").ExecutableTask>): Promise<Row> {
  const outcome = await run(functionId, params, overrides);
  if (!outcome.success) throw new Error(`expected ${functionId} to succeed, got ${JSON.stringify(outcome.failure)}`);
  return outcome.result as Row;
}
/** The failure of a task that must have been refused. */
async function failure(functionId: string, params?: Row, overrides?: Partial<import("./executor").ExecutableTask>) {
  const outcome = await run(functionId, params, overrides);
  if (outcome.success) throw new Error(`expected ${functionId} to be refused`);
  return outcome.failure;
}
const nothingWritten = (before: string) => expect(JSON.stringify(store.tables)).toBe(before);
const callOf = (m: { mock: { calls: unknown[][] } }, n = 0) => m.mock.calls[n];

// ═══ THE 26 ARE REGISTERED, AND ARE WHAT THEY SAY THEY ARE ═════════════════

describe("BR-512: the 26 entries are registered with an executor, a spec and the right write flag", () => {
  test("there are exactly 26, none of them one of the earlier entries", () => {
    expect(Object.keys(ALL)).toHaveLength(26);
    for (const earlier of ["create_boq", "create_boq_revision", "get_boq_line_items", "create_document", "create_meeting"]) {
      expect(ALL[earlier]).toBeUndefined();
    }
  });

  test("each has an executor, a registry spec and a place in the candidate set", () => {
    for (const id of Object.keys(ALL)) {
      expect(hasExecutor(id)).toBe(true);
      expect(functionSpec(id)).toBeDefined();
      expect(EXECUTABLE_FUNCTION_IDS).toContain(id);
    }
  });

  test("the 14 writes are writes with a confirm card; the 12 reads are reads with none of it", () => {
    for (const id of Object.keys(WRITES)) {
      expect(functionWrites(id)).toBe(true);
      expect(WRITE_FUNCTION_IDS.has(id)).toBe(true);
      expect(functionSpec(id)!.kind).toBe("write");
      expect(functionSpec(id)!.card).toBeDefined();
    }
    for (const id of Object.keys(READS)) {
      expect(functionWrites(id)).toBe(false);
      expect(WRITE_FUNCTION_IDS.has(id)).toBe(false);
      expect(functionSpec(id)!.kind).toBe("ask");
    }
  });

  test("every entry succeeds with its complete parameter set", async () => {
    for (const id of Object.keys(ALL)) {
      const outcome = await run(id);
      expect(outcome.success).toBe(true);
    }
  });
});

describe("BR-512: every write refuses a caller that names no person, before any service is reached (PMD-34)", () => {
  test.each(Object.keys(WRITES))("%s -> NOT_PERMITTED (unidentified_actor), 0 service calls, 0 rows written", async (id) => {
    const before = JSON.stringify(store.tables);

    const outcome = await run(id, undefined, { actorUserId: null });

    expect(outcome).toEqual({ success: false, failure: { code: "NOT_PERMITTED", missing: [], context: { reason: "unidentified_actor" }, picker: "none" } });
    expect(totalCalls()).toBe(0);
    nothingWritten(before);
  });
});

describe("BR-512: every entry acts on the task's own project (U-18)", () => {
  test.each(Object.keys(ALL).filter((id) => id !== "recall_precedent"))("%s with params.projectId naming another project -> PROJECT_NOT_REACHABLE, 0 service calls", async (id) => {
    const refused = await failure(id, { ...ALL[id], projectId: PROJECT_B });

    expect(refused).toEqual({ code: "PROJECT_NOT_REACHABLE", missing: ["projectId"], picker: "project" });
    expect(totalCalls()).toBe(0);
  });

  test("the reads name no person and still run: a read has no confirming person", async () => {
    for (const id of Object.keys(READS).filter((r) => r !== "recall_precedent")) {
      expect((await run(id, undefined, { actorUserId: null })).success).toBe(true);
    }
  });

  test("an entry that needs a project and has none -> PROJECT_REQUIRED", async () => {
    for (const id of ["list_change_orders", "get_project_schedule", "list_milestones", "list_billing_claims", "get_manpower_cost_report", "create_change_order", "create_milestone"]) {
      expect((await failure(id, undefined, { projectId: null })).code).toBe("PROJECT_REQUIRED");
    }
    expect(totalCalls()).toBe(0);
  });
});

// ═══ EACH ENTRY CALLS ITS EXISTING FUNCTION ═════════════════════════════════

describe("BR-512: change orders and site instructions", () => {
  test("list_change_orders -> listChangeOrders(org, project, status)", async () => {
    const out = await result("list_change_orders", { status: "pending_approval" });

    expect(fn.listChangeOrders).toHaveBeenCalledTimes(1);
    expect(callOf(fn.listChangeOrders)).toEqual([{ orgId: ORG }, PROJECT_A, { status: "pending_approval" }]);
    expect((out.changeOrders as Row[])[0].id).toBe("co_1");
  });

  test("get_change_order -> getChangeOrder(org, id); a change order of another project reads as absent", async () => {
    await result("get_change_order", { changeOrderId: "co_1" });
    expect(callOf(fn.getChangeOrder)).toEqual([{ orgId: ORG }, "co_1"]);

    const refused = await failure("get_change_order", { changeOrderId: "co_b" });
    expect(refused).toEqual({ code: "RECORD_NOT_FOUND", missing: [], context: { status: 404, functionId: "get_change_order" }, picker: "none" });
  });

  test("create_change_order -> createChangeOrder(org + the person, input); the project must exist in the org", async () => {
    const out = await result("create_change_order", { title: "Extra plinth", reason: "Client change", costImpact: 125000, scheduleImpactDays: 3, trade: "Civil" });

    expect(callOf(fn.createChangeOrder)).toEqual([
      { orgId: ORG, userId: PERSON },
      { projectId: PROJECT_A, title: "Extra plinth", description: undefined, reason: "Client change", costImpact: 125000, scheduleImpactDays: 3, trade: "Civil" },
    ]);
    expect(out.route).toBe("/change-orders/co_new");

    fn.createChangeOrder.mockClear();
    const other = await failure("create_change_order", undefined, { projectId: PROJECT_OTHER_ORG });
    expect(other.code).toBe("RECORD_NOT_FOUND");
    expect(fn.createChangeOrder).toHaveBeenCalledTimes(0);
  });

  test("create_site_instruction -> createSiteInstruction(org + the person, input); a BOQ of another project reads as absent", async () => {
    await result("create_site_instruction", { ...WRITES.create_site_instruction, drawingRef: "AR-101", costImpact: true, boqId: "boq_a" });

    expect(callOf(fn.createSiteInstruction)).toEqual([
      { orgId: ORG, userId: PERSON },
      {
        projectId: PROJECT_A, issueDate: "2026-09-20", toContractor: "Bharat Builders", description: "Revise the plinth level",
        drawingRef: "AR-101", costImpact: true, timeImpact: false, boqId: "boq_a",
      },
    ]);

    fn.createSiteInstruction.mockClear();
    const refused = await failure("create_site_instruction", { ...WRITES.create_site_instruction, boqId: "boq_b" });
    expect(refused.code).toBe("RECORD_NOT_FOUND");
    expect(fn.createSiteInstruction).toHaveBeenCalledTimes(0);
  });

  test("a string 'true' is not a cost impact flag: only a boolean true sets it", async () => {
    await result("create_site_instruction", { ...WRITES.create_site_instruction, costImpact: "true", timeImpact: 1 });

    const input = callOf(fn.createSiteInstruction)[1] as Row;
    expect([input.costImpact, input.timeImpact]).toEqual([false, false]);
  });
});

describe("BR-512: reports and analysis", () => {
  test("run_named_report -> the report's own function with (org, project), read as the route reads it, then buildReportTable", async () => {
    const out = await result("run_named_report", { reportSlug: "budget-summary" });

    expect(callOf(fn.budgetSummary)).toEqual([{ orgId: ORG }, PROJECT_A]);
    expect(fn.buildReportTable).toHaveBeenCalledTimes(1);
    expect(callOf(fn.buildReportTable)).toEqual(["budget-summary", { payload: "budget-summary" }, "INR"]);
    expect(out.rows).toEqual(REPORT_TABLE.rows);
  });

  test("run_named_report passes a report its own parameters (weekStart), and asks for one when it is missing", async () => {
    await result("run_named_report", { reportSlug: "weekly-project", weekStart: "2026-09-21" });
    expect(callOf(fn.weeklyProject)).toEqual([{ orgId: ORG }, PROJECT_A, "2026-09-21"]);

    fn.weeklyProject.mockClear();
    const missing = await failure("run_named_report", { reportSlug: "weekly-project" });
    expect(missing).toEqual({ code: "DATE_REQUIRED", missing: ["date"], picker: "date" });
    expect(fn.weeklyProject).toHaveBeenCalledTimes(0);
  });

  test("run_named_report: an unknown slug, and designer-timesheet (it has its own entry), are REQUEST_REJECTED; no report runs", async () => {
    for (const slug of ["not-a-report", "designer-timesheet", "__proto__"]) {
      const refused = await failure("run_named_report", { reportSlug: slug });
      expect(refused).toEqual({ code: "REQUEST_REJECTED", missing: [], context: { status: 400, functionId: "run_named_report" }, picker: "none" });
    }
    expect(fn.designerTimesheetReport).toHaveBeenCalledTimes(0);
    expect(fn.buildReportTable).toHaveBeenCalledTimes(0);
  });

  test("get_project_analysis -> getProjectAnalysis(org, project); with no project, listOrgAnalysis sorted by profit", async () => {
    const one = await result("get_project_analysis");
    expect(callOf(fn.getProjectAnalysis)).toEqual([{ orgId: ORG }, PROJECT_A]);
    expect((one.row as Row).projectId).toBe(PROJECT_A);

    const all = await result("get_project_analysis", {}, { projectId: null });
    expect(fn.listOrgAnalysis).toHaveBeenCalledTimes(1);
    expect((all.rows as Row[]).map((r) => r.projectId)).toEqual([PROJECT_B, PROJECT_A]);
  });

  test("get_manpower_cost_report -> manpowerCostReport(org, project, date, trade, from, to)", async () => {
    await result("get_manpower_cost_report", { date: "2026-09-22", trade: "Mason", dateFrom: "2026-09-01", dateTo: "2026-09-30" });

    expect(callOf(fn.manpowerCostReport)).toEqual([{ orgId: ORG }, PROJECT_A, "2026-09-22", "Mason", "2026-09-01", "2026-09-30"]);
  });

  test("get_designer_timesheet_report -> designerTimesheetReport(org, project, period); the org-wide block is not returned", async () => {
    const out = await result("get_designer_timesheet_report", { from: "2026-09-01", to: "2026-09-30" });

    expect(callOf(fn.designerTimesheetReport)).toEqual([{ orgId: ORG }, PROJECT_A, { from: "2026-09-01", to: "2026-09-30" }]);
    expect(Object.keys(out).sort()).toEqual(["period", "projectScoped"]);
    expect(keysDeep(out).has("byProject")).toBe(false);
    expect(keysDeep(out).has("byDesigner")).toBe(false);
  });
});

describe("BR-512: line budget, schedule and milestones", () => {
  test("update_line_item_budget -> updateLineItemBudget(org, line, the six fields); a line of another project reads as absent", async () => {
    const out = await result("update_line_item_budget", { boqLineItemId: "line_a", budgetPercentage: 40, vendorAmount: 5000, category: "Civil" });

    expect(callOf(fn.updateLineItemBudget)).toEqual([
      { orgId: ORG }, "line_a",
      { budgetPercentage: 40, vendorId: undefined, vendorAmount: 5000, materialAmount: undefined, manpowerAmount: undefined, category: "Civil" },
    ]);
    expect(out.route).toBe("/scope");

    fn.updateLineItemBudget.mockClear();
    const refused = await failure("update_line_item_budget", { boqLineItemId: "line_b", budgetPercentage: 40 });
    expect(refused).toEqual({ code: "BOQ_LINE_NOT_FOUND", missing: ["boqLineItemId"], picker: "boq-line" });
    expect(fn.updateLineItemBudget).toHaveBeenCalledTimes(0);
  });

  test("update_line_item_budget with nothing to change -> VALUE_REQUIRED, not a silent no-op", async () => {
    expect(await failure("update_line_item_budget", { boqLineItemId: "line_a" })).toEqual({ code: "VALUE_REQUIRED", missing: ["value"], picker: "value" });
    expect(fn.updateLineItemBudget).toHaveBeenCalledTimes(0);
  });

  test("get_project_schedule -> listIssues(org, project, filters)", async () => {
    const out = await result("get_project_schedule", { statusId: "st_1", assigneeId: PERSON });

    expect(callOf(fn.listIssues)).toEqual([{ orgId: ORG }, PROJECT_A, { statusId: "st_1", assigneeId: PERSON }]);
    expect((out.tasks as Row[])[0].id).toBe("issue_1");
  });

  test("create_schedule_task -> createScheduleActivity(org + the person, input) with the org's default issue type", async () => {
    await result("create_schedule_task", { title: "Pour slab", startDate: "2026-09-28", durationDays: 3, predecessorId: "issue_1", boqLineItemId: "line_a" });

    expect(fn.resolveDefaultIssueTypeId).toHaveBeenCalledTimes(1);
    expect(callOf(fn.createScheduleActivity)).toEqual([
      { orgId: ORG, userId: PERSON, dbUser: null },
      {
        projectId: PROJECT_A, typeId: "type_default", title: "Pour slab", description: undefined, priority: undefined, dueDate: undefined,
        startDate: "2026-09-28", durationDays: 3, predecessorId: "issue_1", boqLineItemId: "line_a", assigneeIds: undefined,
      },
    ]);
  });

  test("create_schedule_task: a named type is used as it is; no type configured -> REQUEST_REJECTED; a BOQ line of another project -> BOQ_LINE_NOT_FOUND", async () => {
    await result("create_schedule_task", { title: "Pour slab", startDate: "2026-09-28", typeId: "type_named" });
    expect(fn.resolveDefaultIssueTypeId).toHaveBeenCalledTimes(0);
    expect((callOf(fn.createScheduleActivity)[1] as Row).typeId).toBe("type_named");

    fn.createScheduleActivity.mockClear();
    fn.resolveDefaultIssueTypeId.mockImplementationOnce(async () => null);
    expect((await failure("create_schedule_task")).code).toBe("REQUEST_REJECTED");
    expect((await failure("create_schedule_task", { ...WRITES.create_schedule_task, boqLineItemId: "line_b" })).code).toBe("BOQ_LINE_NOT_FOUND");
    expect(fn.createScheduleActivity).toHaveBeenCalledTimes(0);
  });

  test("list_milestones -> listMilestones(org, project)", async () => {
    const out = await result("list_milestones");

    expect(callOf(fn.listMilestones)).toEqual([{ orgId: ORG }, PROJECT_A]);
    expect((out.milestones as Row[])[0].id).toBe("ms_a");
  });

  test("create_milestone -> createMilestone(org + the person, project, {name from title}); the project must exist in the org", async () => {
    await result("create_milestone", { title: "Structure complete", targetDate: "2026-11-30", description: "Frame and slabs" });

    expect(callOf(fn.createMilestone)).toEqual([
      { orgId: ORG, userId: PERSON, dbUser: null }, PROJECT_A,
      { name: "Structure complete", description: "Frame and slabs", targetDate: "2026-11-30" },
    ]);

    fn.createMilestone.mockClear();
    expect((await failure("create_milestone", undefined, { projectId: PROJECT_OTHER_ORG })).code).toBe("RECORD_NOT_FOUND");
    expect(fn.createMilestone).toHaveBeenCalledTimes(0);
  });

  test("update_milestone -> updateMilestone(org + the person, id, patch); a milestone not on this project reads as absent; an empty patch is refused", async () => {
    await result("update_milestone", { milestoneId: "ms_a", title: "Structure done", status: "in_progress" });
    expect(callOf(fn.updateMilestone)).toEqual([{ orgId: ORG, userId: PERSON, dbUser: null }, "ms_a", { name: "Structure done", status: "in_progress" }]);
    expect(callOf(fn.listMilestones)).toEqual([{ orgId: ORG }, PROJECT_A]);

    fn.updateMilestone.mockClear();
    expect((await failure("update_milestone", { milestoneId: "ms_b", title: "Other" })).code).toBe("RECORD_NOT_FOUND");
    expect(await failure("update_milestone", { milestoneId: "ms_a" })).toEqual({ code: "VALUE_REQUIRED", missing: ["value"], picker: "value" });
    expect(fn.updateMilestone).toHaveBeenCalledTimes(0);
  });
});

describe("BR-512: billing claims are read-only", () => {
  test("list_billing_claims -> listClaims(org, project), and nothing else in the billing workflow is reached", async () => {
    const out = await result("list_billing_claims");

    expect(callOf(fn.listClaims)).toEqual([{ orgId: ORG }, PROJECT_A]);
    expect((out.claims as Row[])[0].id).toBe("claim_1");
    for (const other of Object.values(billingOthers)) expect(other).toHaveBeenCalledTimes(0);
  });

  test("get_billing_due_queue -> listBillingDueQueue(org, project); with no project the whole org's queue", async () => {
    await result("get_billing_due_queue");
    expect(callOf(fn.listBillingDueQueue)).toEqual([{ orgId: ORG }, PROJECT_A]);

    await result("get_billing_due_queue", {}, { projectId: null });
    expect(callOf(fn.listBillingDueQueue, 1)).toEqual([{ orgId: ORG }, undefined]);
    for (const other of Object.values(billingOthers)) expect(other).toHaveBeenCalledTimes(0);
  });

  test("the guard is real: every billing write and transition function is trapped, so 'not called' below is not vacuous", () => {
    expect(Object.keys(billingOthers).sort()).toEqual([
      "approveClaim", "createProgressClaim", "draftClaim", "getClaimTimeline", "invoiceApprovedClaim", "rejectClaim", "submitClaim",
    ]);
  });

  test("neither billing entry is a write, has a card, or writes a row", async () => {
    const before = JSON.stringify(store.tables);
    for (const id of ["list_billing_claims", "get_billing_due_queue"]) {
      expect(functionWrites(id)).toBe(false);
      expect(functionSpec(id)!.writes).toBe(false);
      expect(functionSpec(id)!.card).toBeUndefined();
      expect((await run(id)).success).toBe(true);
    }
    nothingWritten(before);
  });

  test("no billing-claim write id is registered anywhere: the only billing or claim ids are the two reads", () => {
    const billingIds = EXECUTABLE_FUNCTION_IDS.filter((id) => /billing|claim/i.test(id));
    expect(billingIds.sort()).toEqual(["get_billing_due_queue", "list_billing_claims"]);
    expect([...WRITE_FUNCTION_IDS].filter((id) => /billing|claim/i.test(id))).toEqual([]);
  });

  test("the ids an AI would try for a claim write have no executor: FUNCTION_NOT_AVAILABLE, no service called", async () => {
    for (const id of ["create_billing_claim", "create_progress_claim", "submit_billing_claim", "approve_billing_claim", "transition_claim", "mark_claim_invoiced"]) {
      expect(hasExecutor(id)).toBe(false);
      const refused = await failure(id, { projectId: PROJECT_A });
      expect(refused.code).toBe("FUNCTION_NOT_AVAILABLE");
    }
    expect(totalCalls()).toBe(0);
  });
});

describe("BR-512: drawings and minutes reach the service each is meant to reach", () => {
  test("create_drawing -> createDrawingRecord(org + the person, input), and createDocumentRecord is not called", async () => {
    const out = await result("create_drawing", { ...WRITES.create_drawing, drawingNo: "AR-101", rev: "B", status: "current", discipline: "Architectural" });

    expect(fn.createDrawingRecord).toHaveBeenCalledTimes(1);
    expect(fn.createDocumentRecord).toHaveBeenCalledTimes(0);
    expect(callOf(fn.createDrawingRecord)).toEqual([
      { orgId: ORG, userId: PERSON },
      {
        name: "AR-101 Ground floor plan", category: "drawing", projectId: PROJECT_A, discipline: "Architectural", drawingNo: "AR-101", rev: "B",
        status: "current", externalUrl: "https://example.com/AR-101-A",
      },
    ]);
    expect(out.route).toBe("/drawings/drawing_new");
  });

  test("create_mom -> createVeriMeeting(org + the person as a user row, input), and pms createMeeting is not called", async () => {
    await result("create_mom", { ...WRITES.create_mom, minutes: "Slab pour agreed.", attendees: ["Asha"], agenda: ["Slab pour"] });

    expect(fn.createVeriMeeting).toHaveBeenCalledTimes(1);
    expect(fn.createMeeting).toHaveBeenCalledTimes(0);
    const [ctx, input] = callOf(fn.createVeriMeeting) as [{ orgId: string; userId: string; dbUser: Row }, Row];
    expect([ctx.orgId, ctx.userId, ctx.dbUser.id]).toEqual([ORG, PERSON, PERSON]);
    expect(input).toMatchObject({ title: "Site meeting", contextEntityType: "project", contextEntityId: PROJECT_A, minutes: "Slab pour agreed.", attendees: ["Asha"], agenda: ["Slab pour"] });
  });

  test("create_meeting (the earlier entry) still reaches pms createMeeting, not createVeriMeeting", async () => {
    await result("create_meeting", { title: "Coordination", scheduledAt: "2026-09-24T10:00:00.000Z" });

    expect(fn.createMeeting).toHaveBeenCalledTimes(1);
    expect(fn.createVeriMeeting).toHaveBeenCalledTimes(0);
  });
});

describe("BR-512: material receipts", () => {
  test("record_material_receipt with a material id -> createMaterialReceipt(org, input incl. the person as createdById)", async () => {
    const out = await result("record_material_receipt", { materialId: "mat_a", quantity: 20, receivedDate: "2026-09-22", unitCost: 410, reference: "DC-118" });

    expect(fn.createMaterial).toHaveBeenCalledTimes(0);
    expect(callOf(fn.createMaterialReceipt)).toEqual([
      { orgId: ORG },
      { projectId: PROJECT_A, materialId: "mat_a", receivedDate: "2026-09-22", quantity: 20, unitCost: 410, vendorId: undefined, reference: "DC-118", notes: undefined, createdById: PERSON },
    ]);
    expect(out.route).toBe("/materials");
  });

  test("the date defaults to today, and a quantity that is not more than 0 is refused", async () => {
    await result("record_material_receipt", { materialId: "mat_a", quantity: 5 });
    expect((callOf(fn.createMaterialReceipt)[1] as Row).receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    fn.createMaterialReceipt.mockClear();
    for (const quantity of [0, -3, "abc"]) {
      expect(await failure("record_material_receipt", { materialId: "mat_a", quantity })).toEqual({ code: "QUANTITY_REQUIRED", missing: ["value"], picker: "value" });
    }
    expect(fn.createMaterialReceipt).toHaveBeenCalledTimes(0);
  });

  test("a material of another project reads as absent", async () => {
    expect(await failure("record_material_receipt", { materialId: "mat_b", quantity: 5 })).toEqual({ code: "RECORD_NOT_FOUND", missing: ["material"], picker: "none" });
    expect(totalCalls()).toBe(0);
  });

  test("a material named in words: this project's own material of that name is reused, a new one is made only with a unit", async () => {
    await result("record_material_receipt", { materialName: "  cement opc 53 ", quantity: 20 });
    expect(fn.createMaterial).toHaveBeenCalledTimes(0);
    expect((callOf(fn.createMaterialReceipt)[1] as Row).materialId).toBe("mat_a");

    fn.createMaterialReceipt.mockClear();
    expect(await failure("record_material_receipt", { materialName: "Sand", quantity: 4 })).toEqual({ code: "VALUE_REQUIRED", missing: ["value"], picker: "value" });
    expect(fn.createMaterial).toHaveBeenCalledTimes(0);

    await result("record_material_receipt", { materialName: "Sand", unit: "cum", quantity: 4, unitCost: 1800 });
    expect(callOf(fn.createMaterial)).toEqual([{ orgId: ORG }, { projectId: PROJECT_A, name: "Sand", unit: "cum", spec: undefined, unitCost: 1800 }]);
    expect((callOf(fn.createMaterialReceipt)[1] as Row).materialId).toBe("mat_new");
  });

  // mat_b "Steel TMT" belongs to project B. The name lookup is per project: a
  // project that has no material of that name gets its own, and never a receipt
  // against the other project's row (U-18).
  test("a material named in words that exists only on another project is not reused", async () => {
    await result("record_material_receipt", { materialName: "Steel TMT", unit: "kg", quantity: 1 });

    expect(callOf(fn.createMaterial)).toEqual([{ orgId: ORG }, { projectId: PROJECT_A, name: "Steel TMT", unit: "kg", spec: undefined, unitCost: undefined }]);
    const receipt = callOf(fn.createMaterialReceipt)[1] as Row;
    expect(receipt.projectId).toBe(PROJECT_A);
    expect(receipt.materialId).toBe("mat_new");
    expect(JSON.stringify(fn.createMaterialReceipt.mock.calls)).not.toContain("mat_b");
  });

  test("that same name without a unit asks for the unit: it does not fall back to the other project's material", async () => {
    expect(await failure("record_material_receipt", { materialName: "Steel TMT", quantity: 1 })).toEqual({ code: "VALUE_REQUIRED", missing: ["value"], picker: "value" });
    expect(fn.createMaterial).toHaveBeenCalledTimes(0);
    expect(fn.createMaterialReceipt).toHaveBeenCalledTimes(0);
  });

  // createMaterial() commits the new material in its own transaction, before
  // createMaterialReceipt() runs. A receipt request that cannot succeed is
  // refused first, so it leaves no material behind.
  test("a date that is not a real YYYY-MM-DD day is refused before a new material is made", async () => {
    for (const receivedDate of ["22/09/2026", "2026-9-22", "2026-13-01", "2026-02-30", "2026-02-29", "yesterday", 20260922]) {
      expect(await failure("record_material_receipt", { materialName: "Sand", unit: "cum", quantity: 4, receivedDate })).toEqual({ code: "DATE_REQUIRED", missing: ["date"], picker: "date" });
    }
    expect(fn.createMaterial).toHaveBeenCalledTimes(0);
    expect(fn.createMaterialReceipt).toHaveBeenCalledTimes(0);
  });

  test("a leap day is a real day, and a blank date means today", async () => {
    await result("record_material_receipt", { materialId: "mat_a", quantity: 1, receivedDate: "2028-02-29" });
    expect((callOf(fn.createMaterialReceipt)[1] as Row).receivedDate).toBe("2028-02-29");

    fn.createMaterialReceipt.mockClear();
    await result("record_material_receipt", { materialId: "mat_a", quantity: 1, receivedDate: "   " });
    expect((callOf(fn.createMaterialReceipt)[1] as Row).receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("a vendor that is not a supplier of this org is refused before a new material is made", async () => {
    // sup_missing is no supplier at all; sup_x is a supplier of another org.
    for (const vendorId of ["sup_missing", "sup_x"]) {
      expect(await failure("record_material_receipt", { materialName: "Sand", unit: "cum", quantity: 4, vendorId })).toEqual({ code: "RECORD_NOT_FOUND", missing: ["vendor"], picker: "none" });
    }
    expect(fn.createMaterial).toHaveBeenCalledTimes(0);
    expect(fn.createMaterialReceipt).toHaveBeenCalledTimes(0);
  });

  test("a supplier of this org is passed to the service as the vendor", async () => {
    await result("record_material_receipt", { materialId: "mat_a", quantity: 5, vendorId: "sup_a" });
    expect((callOf(fn.createMaterialReceipt)[1] as Row).vendorId).toBe("sup_a");
  });
});

describe("BR-512: timesheet approval", () => {
  test("approve_timesheet -> getTimeEntry, approveTimeEntry(org + the reviewer, id), then the reviewer's Task Master rows", async () => {
    const out = await result("approve_timesheet", { timeEntryId: "te_a" });

    expect(callOf(fn.getTimeEntry)).toEqual([{ orgId: ORG }, "te_a"]);
    expect(callOf(fn.approveTimeEntry)).toEqual([{ orgId: ORG, userId: PERSON }, "te_a"]);
    expect(fn.rejectTimeEntry).toHaveBeenCalledTimes(0);
    const tasks = callOf(fn.recordTimesheetDecisionTasks);
    expect(tasks.slice(0, 4)).toEqual([{ orgId: ORG, userId: PERSON }, "te_a", "approved", null]);
    expect(out.route).toBe("/timesheets");
  });

  test("reject_timesheet -> rejectTimeEntry(org + the reviewer, id, reason); a reason under 5 characters is refused", async () => {
    await result("reject_timesheet", { timeEntryId: "te_a", rejectionReason: "Hours do not match the task" });

    expect(callOf(fn.rejectTimeEntry)).toEqual([{ orgId: ORG, userId: PERSON }, "te_a", "Hours do not match the task"]);
    expect(fn.approveTimeEntry).toHaveBeenCalledTimes(0);
    expect(callOf(fn.recordTimesheetDecisionTasks).slice(2, 4)).toEqual(["rejected", "Hours do not match the task"]);

    fn.rejectTimeEntry.mockClear();
    expect(await failure("reject_timesheet", { timeEntryId: "te_a", rejectionReason: "no" })).toEqual({ code: "VALUE_REQUIRED", missing: ["value"], picker: "value" });
    expect(fn.rejectTimeEntry).toHaveBeenCalledTimes(0);
  });

  test("the decision is a manager-rank person's, judged from the person's own row: a member is refused, whatever role the task carries", async () => {
    for (const id of ["approve_timesheet", "reject_timesheet"]) {
      const refused = await failure(id, undefined, { actorUserId: MEMBER, role: "admin" });
      expect(refused).toEqual({ code: "NOT_PERMITTED", missing: [], context: { reason: "manager_rank_required" }, picker: "none" });
    }
    expect(fn.approveTimeEntry).toHaveBeenCalledTimes(0);
    expect(fn.rejectTimeEntry).toHaveBeenCalledTimes(0);
    expect(fn.getTimeEntry).toHaveBeenCalledTimes(0);
  });

  test("an unknown person is refused, and an entry of another project reads as absent before anything changes", async () => {
    const stranger = await failure("approve_timesheet", undefined, { actorUserId: API_KEY });
    expect(stranger.context).toEqual({ reason: "unknown_actor" });

    const other = await failure("approve_timesheet", { timeEntryId: "te_b" });
    expect(other.code).toBe("RECORD_NOT_FOUND");
    expect(fn.approveTimeEntry).toHaveBeenCalledTimes(0);
    expect(fn.recordTimesheetDecisionTasks).toHaveBeenCalledTimes(0);
  });

  test("with no project on the task the reviewer can approve an entry of any of the org's projects", async () => {
    expect((await run("approve_timesheet", { timeEntryId: "te_b" }, { projectId: null })).success).toBe(true);
    expect(fn.approveTimeEntry).toHaveBeenCalledTimes(1);
  });
});

describe("BR-512: memory, notes and sharing", () => {
  test("recall_precedent -> recallMemory(db, the person as a user row, query, keyword tier at most)", async () => {
    const out = await result("recall_precedent", { query: "slab shuttering", registryRef: "precedent.slab", limit: 5 });

    expect(fn.recallMemory).toHaveBeenCalledTimes(1);
    const [, actor, query, options] = callOf(fn.recallMemory) as [unknown, { orgId: string; userId: string; dbUser: Row }, string, Row];
    expect([actor.orgId, actor.userId, actor.dbUser.id]).toEqual([ORG, PERSON, PERSON]);
    expect(query).toBe("slab shuttering");
    // No embedding provider is called from here (U-43): the vector and graph tiers are out of reach.
    expect(options).toEqual({ limit: 5, maxTier: "keyword", registryRef: "precedent.slab" });
    expect(out.tier).toBe("keyword");
  });

  test("recall_precedent caps the limit at 10 (and floors it at 1), and stands the caller's own id in for a person when none is named", async () => {
    await result("recall_precedent", { query: "slab", limit: 500 }, { actorUserId: null, userId: PERSON });
    await result("recall_precedent", { query: "slab", limit: 0 });
    await result("recall_precedent", { query: "slab" });

    expect([0, 1, 2].map((n) => (callOf(fn.recallMemory, n)[3] as Row).limit)).toEqual([10, 1, 10]);
  });

  test("recall_precedent for a caller that is not a user (an API key) -> NOT_PERMITTED, recallMemory not called", async () => {
    const refused = await failure("recall_precedent", undefined, { actorUserId: null, userId: API_KEY });

    expect(refused.context).toEqual({ reason: "unknown_actor" });
    expect(fn.recallMemory).toHaveBeenCalledTimes(0);
  });

  test("capture_artifact -> createSourceObject with the note's own text as bytes, filed on the project, under the person", async () => {
    const out = await result("capture_artifact", { title: "Precedent", text: "Slab shuttering was left for 7 days." });

    expect(fn.createSourceObject).toHaveBeenCalledTimes(1);
    const input = callOf(fn.createSourceObject)[0] as Row;
    expect(new TextDecoder().decode(input.bytes as Uint8Array)).toBe("Slab shuttering was left for 7 days.");
    expect(input).toMatchObject({ orgId: ORG, origin: "inapp", mimeType: "text/plain", title: "Precedent", linkedEntityType: "project", linkedEntityId: PROJECT_A, createdById: PERSON });
    expect(out).toEqual({ id: "source_1", route: "/documents", record: { id: "source_1", title: "Precedent" } });
  });

  test("capture_artifact with no project on the task is filed on none; a text over the cap is refused", async () => {
    await result("capture_artifact", undefined, { projectId: null });
    expect(callOf(fn.createSourceObject)[0]).toMatchObject({ linkedEntityType: null, linkedEntityId: null });

    fn.createSourceObject.mockClear();
    const refused = await failure("capture_artifact", { title: "Big", text: "x".repeat(50_001) });
    expect(refused.code).toBe("REQUEST_REJECTED");
    expect(fn.createSourceObject).toHaveBeenCalledTimes(0);
  });

  test("create_report_share_link -> createReportShareLink(org + the person, type + the task's project + period); only the token and expiry come back", async () => {
    const out = await result("create_report_share_link", { ...WRITES.create_report_share_link, expiresInHours: 48 });

    expect(callOf(fn.createReportShareLink)).toEqual([
      { orgId: ORG, userId: PERSON },
      { reportType: "work_progress", reportRef: { projectId: PROJECT_A, from: "2026-09-01", to: "2026-09-30" }, expiresInHours: 48 },
    ]);
    expect(out.record).toEqual({ token: "tok_abc", expiresAt: new Date("2026-10-02T00:00:00Z") });
  });

  test("create_report_share_link with an expiry that is not a positive number -> REQUEST_REJECTED", async () => {
    for (const expiresInHours of [0, -5, "soon"]) {
      expect((await failure("create_report_share_link", { ...WRITES.create_report_share_link, expiresInHours })).code).toBe("REQUEST_REJECTED");
    }
    expect(fn.createReportShareLink).toHaveBeenCalledTimes(0);
  });
});

describe("BR-512: BOQ import from a stored document", () => {
  test("preview_boq_import reads the stored sheet and parses it with the import parser; it is a read and writes no BOQ", async () => {
    const out = await result("preview_boq_import", { documentId: "sheet_a" });

    expect(downloads).toEqual([{ bucket: "compliance-documents", path: `${ORG}/sheet-a.xlsx` }]);
    expect(fn.parseBoqSpreadsheet).toHaveBeenCalledTimes(1);
    const [buffer, name, mime] = callOf(fn.parseBoqSpreadsheet) as [Buffer, string, string];
    expect([buffer.length, name, mime]).toEqual([3, "Villa BOQ.xlsx", SHEET_TYPE]);
    expect(out.dryRun).toBe(true);
    expect(out.summary).toEqual({ totalRows: 3, readyLines: 3, rowsWithErrors: 0, willImport: 3, totalParsed: 3 });
    expect((out.rows as Row[]).map((r) => r.code)).toEqual(["1.01", "1.02", "1.02.1"]);
    expect(fn.createBoq).toHaveBeenCalledTimes(0);
    expect(fn.createBoqRevision).toHaveBeenCalledTimes(0);
  });

  test("a sheet filed on the project through the document's metadata counts as the project's", async () => {
    expect((await run("preview_boq_import", { documentId: "sheet_meta" })).success).toBe(true);
  });

  test("a sheet of another project, a document that does not exist, a link-only record and an oversize file are refused before anything is downloaded", async () => {
    expect((await failure("preview_boq_import", { documentId: "sheet_b" })).code).toBe("RECORD_NOT_FOUND");
    expect((await failure("preview_boq_import", { documentId: "no_such_document" })).code).toBe("RECORD_NOT_FOUND");
    expect((await failure("preview_boq_import", { documentId: "sheet_link" })).code).toBe("REQUEST_REJECTED");
    expect((await failure("preview_boq_import", { documentId: "sheet_big" })).code).toBe("REQUEST_REJECTED");
    expect(downloads).toEqual([]);
    expect(fn.parseBoqSpreadsheet).toHaveBeenCalledTimes(0);
  });

  test("a file the parser cannot read -> REQUEST_REJECTED, not INTERNAL_ERROR", async () => {
    fn.parseBoqSpreadsheet.mockImplementationOnce(async () => {
      throw new Error("Cannot parse file");
    });

    expect((await failure("preview_boq_import")).code).toBe("REQUEST_REJECTED");
  });

  test("apply_boq_import -> createBoq(org + the person, {project, title from the file name, lines}); no revision", async () => {
    const out = await result("apply_boq_import", { documentId: "sheet_a" });

    expect(callOf(fn.createBoq)).toEqual([{ orgId: ORG, userId: PERSON }, { projectId: PROJECT_A, title: "Villa BOQ", lineItems: PARSED.lineItems }]);
    expect(fn.createBoqRevision).toHaveBeenCalledTimes(0);
    expect(out.route).toBe("/scope/boq_new");
    // Root lines only: 120 x 450 + 30 x 5200.
    expect((out.record as Row).importSummary).toEqual({ totalRows: 3, importedLineItems: 3, totalValue: 210000, warnings: ["Row 9 has no unit"] });
  });

  test("apply_boq_import with a parent BOQ -> createBoqRevision(org + the person, parent, {title, lines}); a parent of another project reads as absent", async () => {
    await result("apply_boq_import", { documentId: "sheet_a", parentBoqId: "boq_a", title: "Villa revised" });
    expect(callOf(fn.createBoqRevision)).toEqual([{ orgId: ORG, userId: PERSON }, "boq_a", { title: "Villa revised", lineItems: PARSED.lineItems }]);
    expect(fn.createBoq).toHaveBeenCalledTimes(0);

    fn.createBoqRevision.mockClear();
    expect((await failure("apply_boq_import", { documentId: "sheet_a", parentBoqId: "boq_b" })).code).toBe("RECORD_NOT_FOUND");
    expect(fn.createBoqRevision).toHaveBeenCalledTimes(0);
  });

  test("apply_boq_import of a sheet with no usable lines -> REQUEST_REJECTED, nothing created", async () => {
    fn.parseBoqSpreadsheet.mockImplementationOnce(async () => ({ ...PARSED, lineItems: [] }));

    expect((await failure("apply_boq_import")).code).toBe("REQUEST_REJECTED");
    expect(fn.createBoq).toHaveBeenCalledTimes(0);
  });
});

// ═══ COST FIELDS COME BACK NULL BELOW MANAGER RANK ═════════════════════════

describe("BR-512: cost fields are null below manager rank and shown to a manager", () => {
  const MEMBER_TASK = { role: "member" } as const;

  test("change orders: costImpact is null for a member and for an unknown role, the figure for a manager", async () => {
    for (const id of ["list_change_orders", "get_change_order", "create_change_order"]) {
      const manager = JSON.stringify(await result(id));
      const member = JSON.stringify(await result(id, undefined, MEMBER_TASK));
      const unknown = JSON.stringify(await result(id, undefined, { role: undefined }));

      expect(manager).toMatch(/"costImpact":"?(125000|0)"?/);
      expect(manager).not.toContain("financialsRedacted");
      for (const redacted of [member, unknown]) {
        expect(redacted).toContain('"costImpact":null');
        expect(redacted).toContain('"financialsRedacted":true');
        expect(redacted).not.toContain("125000");
      }
    }
  });

  test("a change order's non-cost fields survive the redaction", async () => {
    const out = (await result("list_change_orders", undefined, MEMBER_TASK)).changeOrders as Row[];

    expect(out[0]).toMatchObject({ id: "co_1", title: "Extra plinth", scheduleImpactDays: 3, costImpact: null });
  });

  test("line budget: the budget overlay is null for a member, shown to a manager; the project-side fields never appear for either", async () => {
    const manager = (await result("update_line_item_budget")).record as Row;
    const member = (await result("update_line_item_budget", undefined, MEMBER_TASK)).record as Row;

    expect([manager.vendorAmount, manager.materialAmount, manager.manpowerAmount, manager.computedBudget, manager.budgetPercentage]).toEqual(["5000", "3000", "2000", 13500, "40"]);
    for (const field of ["vendorAmount", "materialAmount", "manpowerAmount", "computedBudget", "budgetPercentage"]) expect(member[field]).toBeNull();
    expect(member.financialsRedacted).toBe(true);
    // The contract side is not cost-visibility's to hide.
    expect([member.rate, member.amount]).toEqual(["450", "54000"]);
    for (const record of [manager, member]) {
      for (const field of PROJECT_SIDE_COST_FIELDS) expect(keysDeep(record).has(field)).toBe(false);
    }
  });

  test("manpower cost: totalCost is null for a member, the figure for a manager; the headcount is not cost", async () => {
    const manager = await result("get_manpower_cost_report");
    const member = await result("get_manpower_cost_report", undefined, MEMBER_TASK);

    expect((manager.byTrade as Row[])[0]).toEqual({ trade: "Mason", totalCost: 48000, workerDays: 12 });
    expect((member.byTrade as Row[])[0]).toEqual({ trade: "Mason", totalCost: null, workerDays: 12 });
    expect(member.financialsRedacted).toBe(true);
  });

  test("designer timesheet: budget, actual and variance are null for a member, hours are kept; a manager sees the figures", async () => {
    const manager = (await result("get_designer_timesheet_report")).projectScoped as Row;
    const member = (await result("get_designer_timesheet_report", undefined, MEMBER_TASK)).projectScoped as Row;

    expect([manager.overallBudget, manager.overallActual, manager.overallVariance]).toEqual([40000, 25600, 14400]);
    expect([member.overallBudget, member.overallActual, member.overallVariance]).toEqual([null, null, null]);
    expect(member.byUser).toEqual([{ userId: PERSON, userName: "Asha M", totalHours: 32 }]);
    expect((member.byCategory as Row[])[0]).toEqual({ category: "drafting", hours: 32, actual: null, budget: null });
    expect((member.byDesignerStatus as Row[])[0]).toEqual({ status: "active", budget: null, actual: null, variance: null });
  });

  test("material receipt: the unit cost is null for a member, shown to a manager", async () => {
    const manager = (await result("record_material_receipt", { materialId: "mat_a", quantity: 5, unitCost: 410 })).record as Row;
    const member = (await result("record_material_receipt", { materialId: "mat_a", quantity: 5, unitCost: 410 }, MEMBER_TASK)).record as Row;

    expect((manager.receipt as Row).unitCost).toBe("410");
    expect((member.receipt as Row).unitCost).toBeNull();
    expect(member.financialsRedacted).toBe(true);
  });

  test("a named report: the columns the report declares as currency are null in every row and lose their total, for a member", async () => {
    const manager = await result("run_named_report");
    const member = await result("run_named_report", undefined, MEMBER_TASK);

    expect(manager.rows).toEqual([{ head: "Civil", budget: 900000, done: 40 }]);
    expect(manager.totals).toEqual({ budget: 900000, done: 40 });
    expect(member.rows).toEqual([{ head: "Civil", budget: null, done: 40 }]);
    expect(member.totals).toEqual({ done: 40 });
    expect(member.financialsRedacted).toBe(true);
    expect(manager.financialsRedacted).toBeUndefined();
  });

  test("the manager-only report and project analysis are refused below manager rank, as their routes refuse them", async () => {
    const refusal = { code: "NOT_PERMITTED", missing: [], context: { reason: "manager_rank_required" }, picker: "none" };

    expect(await failure("run_named_report", { reportSlug: "budget-vs-actual" }, MEMBER_TASK)).toEqual(refusal);
    expect(await failure("get_project_analysis", {}, MEMBER_TASK)).toEqual(refusal);
    expect(await failure("get_project_analysis", {}, { role: undefined })).toEqual(refusal);
    expect(fn.budgetVsActual).toHaveBeenCalledTimes(0);
    expect(fn.getProjectAnalysis).toHaveBeenCalledTimes(0);
    expect(fn.listOrgAnalysis).toHaveBeenCalledTimes(0);

    await result("run_named_report", { reportSlug: "budget-vs-actual" });
    await result("get_project_analysis");
    expect(fn.budgetVsActual).toHaveBeenCalledTimes(1);
    expect(fn.getProjectAnalysis).toHaveBeenCalledTimes(1);
  });
});

// ═══ A WRITE IS A PROPOSAL UNTIL A PERSON CONFIRMS (PMD-05) ═════════════════

describe("BR-512 through the pipeline: create_change_order is proposed, and written only when a person confirms", () => {
  const PHRASE = "new change order";

  beforeEach(() => {
    seedRows(store, "phrase_map", [{ orgId: ORG, normalisedPhrase: normaliseForMatch(PHRASE), functionId: "create_change_order", fixedParams: null, promotedAt: new Date() }]);
    seedRows(store, "submissions", [{ id: "sub_1", orgId: ORG, projectId: PROJECT_A, mode: "Projects", rawInput: PHRASE, userId: API_KEY }]);
  });

  test("proposeSubmission resolves the entry, asks for the title, and calls no service", async () => {
    const proposal = await proposeSubmission({ orgId: ORG, userId: API_KEY, mode: "Projects", projectId: PROJECT_A, rawInput: PHRASE });

    const first = proposal.proposals[0];
    expect(first.functionId).toBe("create_change_order");
    expect(first.status).toBe("needs_input");
    expect(first.missing.map((m) => m.code)).toEqual(["TITLE_REQUIRED"]);
    expect(fn.createChangeOrder).toHaveBeenCalledTimes(0);
    expect(rowsOf(store, "pipeline_tasks")).toEqual([]);
  });

  test("confirmSubmission writes it under the confirming person, and the stored task result carries no cost for a member", async () => {
    const outcome = await confirmSubmission({
      orgId: ORG, userId: API_KEY, submissionId: "sub_1", functionId: "create_change_order",
      params: { title: "Extra plinth", costImpact: 125000 }, role: "member", actorUserId: PERSON,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("done");
    expect(fn.createChangeOrder).toHaveBeenCalledTimes(1);
    expect((callOf(fn.createChangeOrder)[0] as Row).userId).toBe(PERSON);
    const [persisted] = rowsOf(store, "pipeline_tasks");
    expect(persisted.status).toBe("done");
    expect(JSON.stringify(persisted.result)).toContain('"costImpact":null');
    expect(JSON.stringify(persisted.result)).not.toContain("125000");
  });

  test("a confirm with no person behind it is refused by the executor and calls no service", async () => {
    const outcome = await confirmSubmission({
      orgId: ORG, userId: API_KEY, submissionId: "sub_1", functionId: "create_change_order",
      params: { title: "Extra plinth" }, actorUserId: null,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.failures.map((f) => f.code)).toEqual(["NOT_PERMITTED"]);
    expect(fn.createChangeOrder).toHaveBeenCalledTimes(0);
  });
});
