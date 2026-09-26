/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05a wave 2, register row AW-302: the BOQ import, change order, site instruction, line budget and billing read functions
// are on an AI work link, and each one validates its parameters, refuses another project's ids, respects the person's role, withholds money
// below manager, and caps and cleans free text. Money, commercial and contract-affecting writes are level 2: a draft the person confirms.
//
// THE NINE (all had an executor since U-38 and were on no link until this wave; create_boq, the tenth of the wave, is on links since WP-04
// and is proven by executor-boq-payload.test.ts, so it is not repeated here)
//   reads   preview_boq_import (rank 3)  list_change_orders (2)  get_change_order (2)  list_billing_claims (3)  get_billing_due_queue (3)
//   writes  apply_boq_import (2)  create_change_order (2)  create_site_instruction (2)  update_line_item_budget (3), all level 2
//
// TWO LAYERS, both proven for every function, as in coverage-wave1.test.ts
//   1. THE LINK (coverage-link-matrix.ts): policy, rank ladder, parameters, text rule, size limit, level rule of /actions, /propose and /drafts.
//   2. THE EXECUTOR (the REAL executor.ts and execute-read.ts): ids of another project, the person's role, money, free text.
//
// WHAT IS REAL: executor.ts, execute-read.ts, function-registry.ts, validate(), applyLinkTextRules(), the generated link registry, the Edge
// handler, the executors' own lookups, and the change order service's reads (getChangeOrder(), listChangeOrders(): their queries run against
// fixture rows, so a change order of another project is refused for real). WHAT IS FAKED: @/lib/db/tenant-scoped (the store double) and the
// services whose queries the double cannot run (an aggregate count, a spreadsheet parser, a storage download): recording fakes, so the call and
// its arguments are what is asserted.
//
// Run: bun test --isolate src/lib/pipeline/coverage-wave2.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fakeWithTenantContext, makeBoqStore, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { effectiveList, registerLinkMatrix, type PolicyRow } from "./__test-helpers__/coverage-link-matrix";
import { AI_LINK_TEXT_MAX, applyLinkTextRules, isFreeTextParam } from "./ai-link-text";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const PERSON = "person_manager";
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
  ]);
  seedRows(s, "users", [
    { id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" },
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Babu K", email: "babu@example.com" },
  ]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, status: "approved" },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, status: "approved" },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "line_a", orgId: ORG, boqId: "boq_a", itemCode: "EX-01", quantity: "10", rate: "450", amount: "4500", budgetPercentage: "25" },
    { id: "line_b", orgId: ORG, boqId: "boq_b", itemCode: "EX-01", quantity: "10", rate: "450", amount: "4500" },
  ]);
  seedRows(s, "erp_suppliers", [
    { id: "sup_a", orgId: ORG, supplierName: "Shree Cement Traders" },
    { id: "sup_x", orgId: OTHER_ORG, supplierName: "Elsewhere Suppliers" },
  ]);
  seedRows(s, "construction_change_orders", [
    { id: "co_1", orgId: ORG, projectId: PROJECT_A, number: 1, title: "Extra plinth", status: "draft", costImpact: "125000", scheduleImpactDays: 3 },
    { id: "co_2", orgId: ORG, projectId: PROJECT_A, number: 2, title: "Extra door", status: "approved", costImpact: "18000", scheduleImpactDays: 0 },
    { id: "co_b", orgId: ORG, projectId: PROJECT_B, number: 1, title: "Other project's change", status: "draft", costImpact: "999000", scheduleImpactDays: 9 },
  ]);
  seedRows(s, "documents", [
    { id: "sheet_a", orgId: ORG, name: "Villa BOQ.xlsx", fileUrl: `${ORG}/sheet-a.xlsx`, fileType: SHEET_TYPE, fileSize: 2048, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_A, metadata: null },
    { id: "sheet_b", orgId: ORG, name: "Other BOQ.xlsx", fileUrl: `${ORG}/sheet-b.xlsx`, fileType: SHEET_TYPE, fileSize: 2048, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_B, metadata: null },
    { id: "sheet_link", orgId: ORG, name: "Linked BOQ", fileUrl: "https://example.com/boq.xlsx", fileType: null, fileSize: null, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_A, metadata: { isExternalLink: true } },
    { id: "sheet_big", orgId: ORG, name: "Huge BOQ.xlsx", fileUrl: `${ORG}/sheet-big.xlsx`, fileType: SHEET_TYPE, fileSize: 11 * 1024 * 1024, category: "boq", linkedEntityType: "project", linkedEntityId: PROJECT_A, metadata: null },
  ]);
  return s;
}

const PARSED = {
  lineItems: [
    { itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450 },
    { itemCode: "1.02", description: "PCC 1:4:8 below footings", unit: "cum", quantity: 30, rate: 5200 },
  ],
  warnings: ["Row 9 has no unit"],
  issues: [{ row: 9, message: "no unit", blocking: false }],
  mapping: { itemCode: "Item", description: "Description" },
  headers: ["Item", "Description", "Unit", "Qty", "Rate"],
  totalRows: 2,
};
/** Claims of both projects, and what each service answers for the project it is asked about. */
const CLAIMS = [
  { id: "claim_a", projectId: PROJECT_A, status: "submitted", scheduledDate: "2020-01-01", retentionPercent: "5", customerId: "cust_1", interimBillId: "bill_1" },
  { id: "claim_b", projectId: PROJECT_B, status: "submitted", scheduledDate: "2020-01-01", retentionPercent: "10", customerId: "cust_2", interimBillId: null },
];

type Args = unknown[];
const fn = {
  createChangeOrder: mock(async (_c: unknown, input: Row) => ({ id: "co_new", number: 3, ...input, costImpact: String(input.costImpact ?? 0) })),
  createSiteInstruction: mock(async (_c: unknown, input: Row) => ({ id: "si_1", siNumber: 1, ...input })),
  updateLineItemBudget: mock(async (_c: unknown, id: string, input: Row) => ({
    id, boqId: "boq_a", itemCode: "EX-01", rate: "450", amount: "54000",
    budgetPercentage: String(input.budgetPercentage ?? 25), vendorAmount: "5000", materialAmount: "3000", manpowerAmount: "2000", computedBudget: 13500,
    rateProject: "380", qtyProject: "110", projectValue: 41800, variance: 12200, variancePercent: 22,
  })),
  listClaims: mock(async (_c: unknown, projectId: string) => CLAIMS.filter((c) => c.projectId === projectId)),
  listBillingDueQueue: mock(async (_c: unknown, projectId?: string) => CLAIMS.filter((c) => projectId === undefined || c.projectId === projectId).map((c) => ({ ...c, isOverdue: true }))),
  parseBoqSpreadsheet: mock(async (..._a: Args) => PARSED),
  createBoq: mock(async (_c: unknown, input: Row) => ({
    id: "boq_new", version: 1, status: "draft", title: input.title, projectId: input.projectId, contractValueOverride: "475000", contractValue: 475000,
    lineItems: [{ id: "l1", itemCode: "1.01", rate: "450", amount: "54000", materialCost: "1000" }],
  })),
  createBoqRevision: mock(async (_c: unknown, parent: string, input: Row) => ({ id: "boq_rev", parentBoqId: parent, version: 2, title: input.title, contractValue: 480000 })),
};
const downloads: Array<{ bucket: string; path: string }> = [];
const allMocks = (): Array<ReturnType<typeof mock>> => Object.values(fn);
const totalCalls = () => allMocks().reduce((sum, m) => sum + m.mock.calls.length, 0) + downloads.length;

const restores: Array<[string, unknown]> = [];
function stub(path: string, real: object, overrides: object) {
  mock.module(path, () => ({ ...real, ...overrides }));
  restores.push([path, real]);
}

// LOAD ORDER: see coverage-wave1.test.ts. Each real module is loaded in executor.ts's own order and mocked right after it is loaded.
const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));
restores.push(["@/lib/db/tenant-scoped", realTenantScoped]);

await import("@/lib/services/construction-progress-service");
await import("@/lib/services/pms-time-service");
await import("@/lib/services/construction-dashboard-service");
await import("@/lib/services/construction-labour-service");
stub("@/lib/services/construction-boq-service", { ...(await import("@/lib/services/construction-boq-service")) }, {
  createBoq: fn.createBoq, createBoqRevision: fn.createBoqRevision, updateLineItemBudget: fn.updateLineItemBudget,
});
await import("@/lib/services/cost-visibility-service");
await import("@/lib/services/pms-meeting-service");
await import("@/lib/services/document-service");
// the change order service is REAL for its two reads, and a recording fake for its write (an aggregate count the double cannot run)
stub("@/lib/services/construction-change-order-service", { ...(await import("@/lib/services/construction-change-order-service")) }, { createChangeOrder: fn.createChangeOrder });
stub("@/lib/services/construction-site-instruction-service", { ...(await import("@/lib/services/construction-site-instruction-service")) }, { createSiteInstruction: fn.createSiteInstruction });
await import("@/lib/services/construction-reports-service");
await import("@/lib/services/erp-accounting-service");
await import("@/lib/services/boq-analysis-service");
await import("@/lib/services/pms-issue-service");
await import("@/lib/services/schedule-service");
await import("@/lib/services/pms-taxonomy-service");
const realBilling = { ...(await import("@/lib/services/construction-billing-workflow-service")) };
const billingOthers: Record<string, ReturnType<typeof mock>> = {};
for (const [name, value] of Object.entries(realBilling)) {
  // Functions only: the module also re-exports the ServiceError class. Every billing function but the two reads must never be called (R-95).
  if (typeof value !== "function" || !/^[a-z]/.test(name) || name === "listClaims" || name === "listBillingDueQueue") continue;
  billingOthers[name] = mock(async (..._a: Args) => {
    throw new Error(`billing function ${name} must not be called`);
  });
}
stub("@/lib/services/construction-billing-workflow-service", realBilling, { listClaims: fn.listClaims, listBillingDueQueue: fn.listBillingDueQueue, ...billingOthers });
await import("@/lib/services/veri-meeting-service");
await import("@/lib/services/construction-materials-service");
await import("@/lib/services/timesheet-review-task-service");
await import("@/lib/services/memory-recall-service");
await import("@/lib/crr/capture");
await import("@/lib/services/report-share-service");
stub("@/lib/services/construction-boq-import-service", { ...(await import("@/lib/services/construction-boq-import-service")) }, { parseBoqSpreadsheet: fn.parseBoqSpreadsheet });
stub("@supabase/supabase-js", { ...(await import("@supabase/supabase-js")) }, {
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
  for (const m of Object.values(billingOthers)) m.mockClear();
  downloads.length = 0;
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
  ({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, role: "manager", actorUserId: PERSON, ...overrides });
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
  { id: "apply_boq_import", kind: "write", level: 2, rank: 2, money: true, valid: { documentId: "sheet_a" }, required: ["documentId"],
    optional: { parentBoqId: "boq_a", title: "Villa BOQ" }, text: ["title"], ids: ["documentId", "parentBoqId"] },
  { id: "preview_boq_import", kind: "read", level: 0, rank: 3, money: true, valid: { documentId: "sheet_a" }, required: ["documentId"], ids: ["documentId"] },
  { id: "create_change_order", kind: "write", level: 2, rank: 2, money: true, valid: { title: "Extra plinth" }, required: ["title"],
    optional: { description: "Plinth raised by 150 mm", reason: "Client request", trade: "Civil", costImpact: 125000, scheduleImpactDays: 3 }, text: ["title", "description", "reason", "trade"] },
  { id: "list_change_orders", kind: "read", level: 0, rank: 2, money: true, valid: {}, required: [], optional: { status: "draft" } },
  { id: "get_change_order", kind: "read", level: 0, rank: 2, money: true, valid: { changeOrderId: "co_1" }, required: ["changeOrderId"], ids: ["changeOrderId"] },
  { id: "create_site_instruction", kind: "write", level: 2, rank: 2, money: false, valid: { issueDate: "2026-10-05", toContractor: "Bharat Builders", description: "Move the door by 300 mm" },
    required: ["issueDate", "toContractor", "description"], optional: { drawingRef: "AR-101 rev B", costImpact: true, timeImpact: false, boqId: "boq_a" },
    text: ["toContractor", "description", "drawingRef"], ids: ["boqId"] },
  { id: "update_line_item_budget", kind: "write", level: 2, rank: 3, money: true, valid: { boqLineItemId: "line_a" }, required: ["boqLineItemId"],
    optional: { budgetPercentage: 40, vendorId: "sup_a", vendorAmount: 5000, materialAmount: 3000, manpowerAmount: 2000, category: "Civil" }, text: ["category"], ids: ["boqLineItemId", "vendorId"] },
  { id: "list_billing_claims", kind: "read", level: 0, rank: 3, money: true, valid: {}, required: [] },
  { id: "get_billing_due_queue", kind: "read", level: 0, rank: 3, money: true, valid: {}, required: [] },
];

registerLinkMatrix("AW-302 wave 2", ROWS);

// ═══ 2. THE EXECUTOR ══════════════════════════════════════════════════════════════════════════

const READ_IDS = ROWS.filter((r) => r.kind === "read").map((r) => r.id);
const WRITE_IDS = ROWS.filter((r) => r.kind === "write").map((r) => r.id);

describe("AW-302: the registry, the ranks end to end, and create_boq of WP-04", () => {
  test("each function has the kind the policy says; a write is refused by the read mode; a read is not on the list of a link below its rank", async () => {
    for (const row of ROWS) {
      const spec = functionSpec(row.id)!;
      expect({ id: row.id, kind: spec.kind }).toEqual({ id: row.id, kind: row.kind === "read" ? "ask" : "write" });
    }
    for (const id of WRITE_IDS) expect({ id, out: await read(id, {}, "manager", { allowed: [id] }) }).toEqual({ id, out: { ok: false, status: 403, code: "FUNCTION_NOT_READ" } });
    for (const rank of [1, 2, 3] as const) {
      const list = await effectiveList(rank);
      for (const row of ROWS.filter((r) => r.kind === "read")) {
        const calls = totalCalls();
        const out = await read(row.id, row.valid, rank >= 3 ? "manager" : rank === 2 ? "member" : "viewer", { allowed: list });
        if (rank < row.rank) {
          expect({ id: row.id, rank, out }).toEqual({ id: row.id, rank, out: { ok: false, status: 403, code: "FUNCTION_NOT_ALLOWED" } });
          // refused before anything ran: no service and no storage read
          expect({ id: row.id, rank, ran: totalCalls() - calls }).toEqual({ id: row.id, rank, ran: 0 });
        } else {
          expect({ id: row.id, rank, refused: !out.ok && out.status === 403 }).toEqual({ id: row.id, rank, refused: false });
        }
      }
    }
  });

  test("create_boq, the tenth function of the wave, is on links since WP-04 at level 2 and rank 2 (a draft): not built again here", async () => {
    const list = await effectiveList(2);
    expect(list).toContain("create_boq");
    expect(ROWS.map((r) => r.id)).not.toContain("create_boq");
  });
});

describe("AW-302: what the read mode hands to the executor", () => {
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

describe("AW-302: the four reads, in the link's read mode", () => {
  test("a complete parameter set succeeds; the link's project is the one every service is asked about, whatever the caller names", async () => {
    for (const id of READ_IDS) {
      for (const named of [undefined, PROJECT_B]) {
        const params = { ...(ROWS.find((r) => r.id === id)!.valid), ...(named ? { projectId: named } : {}) };
        const out = await read(id, params);
        expect({ id, named, ok: out.ok }).toEqual({ id, named, ok: true });
      }
    }
    expect(fn.listClaims.mock.calls.map((c) => c[1])).toEqual([PROJECT_A, PROJECT_A]);
    expect(fn.listBillingDueQueue.mock.calls.map((c) => c[1])).toEqual([PROJECT_A, PROJECT_A]);
    expect(downloads.map((d) => d.path)).toEqual([`${ORG}/sheet-a.xlsx`, `${ORG}/sheet-a.xlsx`]);
  });

  test("the billing reads are project reads on a link: project B's claims are not returned, though the queue with no project (the internal org list) would return both", async () => {
    const claims = (await readOk("list_billing_claims", { projectId: PROJECT_B })).claims as Row[];
    expect(claims.map((c) => c.id)).toEqual(["claim_a"]);
    const queue = (await readOk("get_billing_due_queue", { projectId: PROJECT_B })).claims as Row[];
    expect(queue.map((c) => c.id)).toEqual(["claim_a"]);
    // the executor itself, called with no project as the internal pipeline can, lists the org: the link never runs it that way
    const orgWide = await executeTask({ orgId: ORG, userId: PERSON, projectId: null, functionId: "get_billing_due_queue", params: {}, role: "manager", actorUserId: PERSON });
    expect(orgWide.success && ((orgWide.result as Row).claims as Row[]).map((c) => c.id)).toEqual(["claim_a", "claim_b"]);
  });

  test("no billing function other than the two reads is ever called (R-95: no billing write on any surface)", async () => {
    await readOk("list_billing_claims");
    await readOk("get_billing_due_queue");
    for (const [name, m] of Object.entries(billingOthers)) expect({ name, calls: m.mock.calls.length }).toEqual({ name, calls: 0 });
  });

  test("list_change_orders: the project's own change orders only, filtered by status; money is null below manager and marked", async () => {
    const all = (await readOk("list_change_orders")).changeOrders as Row[];
    expect(all.map((c) => c.id).sort()).toEqual(["co_1", "co_2"]);
    const draft = (await readOk("list_change_orders", { status: "draft" })).changeOrders as Row[];
    expect(draft.map((c) => c.id)).toEqual(["co_1"]);
    expect(all.find((c) => c.id === "co_1")!.costImpact).toBe("125000");
    for (const role of ["member", "viewer", null]) {
      const out = await readOk("list_change_orders", {}, role);
      expect(out.financialsRedacted).toBe(true);
      expect((out.changeOrders as Row[]).map((c) => c.costImpact)).toEqual([null, null]);
      expect(JSON.stringify(out)).not.toMatch(/125000|18000|999000/);
    }
  });

  test("get_change_order: a change order of another project is refused as absent (nothing is returned of it); a missing id is a 422; the project's own comes back with cost null below manager", async () => {
    const before = snapshot();
    expect(await read("get_change_order", { changeOrderId: "co_b" })).toMatchObject({ ok: false, status: 422, failure: { code: "RECORD_NOT_FOUND" } });
    expect(await read("get_change_order", { changeOrderId: "no-such-change-order" })).toMatchObject({ ok: false, status: 422, failure: { code: "RECORD_NOT_FOUND" } });
    expect(await read("get_change_order", {})).toMatchObject({ ok: false, status: 422, failure: { code: "VALUE_REQUIRED", missing: ["value"] } });
    expect(snapshot()).toBe(before);
    const outcome = await read("get_change_order", { changeOrderId: "co_b" });
    expect(JSON.stringify(outcome)).not.toContain("999000");
    expect(await readOk("get_change_order", { changeOrderId: "co_1" })).toMatchObject({ id: "co_1", costImpact: "125000" });
    expect(await readOk("get_change_order", { changeOrderId: "co_1" }, "member")).toMatchObject({ id: "co_1", costImpact: null, financialsRedacted: true });
  });

  test("money: a progress claim's retention share and the ids of its customer and its interim bill are null below manager and marked; a manager sees them", async () => {
    for (const id of ["list_billing_claims", "get_billing_due_queue"]) {
      const manager = ((await readOk(id, {}, "manager")).claims as Row[])[0];
      expect({ id, retentionPercent: manager.retentionPercent, customerId: manager.customerId, interimBillId: manager.interimBillId }).toEqual({ id, retentionPercent: "5", customerId: "cust_1", interimBillId: "bill_1" });
      for (const role of ["member", "viewer", null]) {
        const out = await readOk(id, {}, role);
        const claim = (out.claims as Row[])[0];
        expect({ id, role, retentionPercent: claim.retentionPercent, customerId: claim.customerId, interimBillId: claim.interimBillId, marked: out.financialsRedacted }).toEqual({
          id, role, retentionPercent: null, customerId: null, interimBillId: null, marked: true,
        });
        // what is not commercial stays: the status and the date
        expect(claim).toMatchObject({ id: "claim_a", status: "submitted", scheduledDate: "2020-01-01" });
      }
    }
  });

  test("preview_boq_import: a stored sheet of this project is read (a dry run, nothing written); another project's, a link-only record, an oversize file and a missing id are refused", async () => {
    const before = snapshot();
    const out = await readOk("preview_boq_import", { documentId: "sheet_a" });
    expect(out).toMatchObject({ dryRun: true, fileName: "Villa BOQ.xlsx", summary: { totalRows: 2, readyLines: 2 } });
    expect(snapshot()).toBe(before);
    expect(fn.createBoq).toHaveBeenCalledTimes(0);
    downloads.length = 0;
    fn.parseBoqSpreadsheet.mockClear();
    for (const [documentId, code] of [["sheet_b", "RECORD_NOT_FOUND"], ["no-such-sheet", "RECORD_NOT_FOUND"], ["sheet_link", "REQUEST_REJECTED"], ["sheet_big", "REQUEST_REJECTED"]] as const) {
      const refusal = await read("preview_boq_import", { documentId });
      expect({ documentId, refusal }).toMatchObject({ documentId, refusal: { ok: false, status: 422, failure: { code } } });
    }
    expect(await read("preview_boq_import", {})).toMatchObject({ ok: false, status: 422, failure: { code: "VALUE_REQUIRED", missing: ["value"] } });
    // the server never fetched a byte for any of them
    expect(downloads).toEqual([]);
    expect(fn.parseBoqSpreadsheet).toHaveBeenCalledTimes(0);
  });

  test("preview_boq_import shows the sheet's rates to whoever the executor is run for: that is why a link needs rank 3 for it (a member link never has it)", async () => {
    const out = await readOk("preview_boq_import", { documentId: "sheet_a" }, "manager");
    expect(JSON.stringify(out.rows)).toContain("450");
    expect(ROWS.find((r) => r.id === "preview_boq_import")!.rank).toBe(3);
    expect(await effectiveList(2)).not.toContain("preview_boq_import");
    expect(await effectiveList(3)).toContain("preview_boq_import");
  });
});

describe("AW-302: the four level-2 writes, through the executor (what the person's confirmation runs)", () => {
  test("apply_boq_import: a stored sheet of this project becomes a BOQ under the confirming person; the sheet, the parent BOQ and the person are all checked before anything is written", async () => {
    const before = snapshot();
    const cases: Array<[string, Row, Overrides, string]> = [
      ["a sheet of project B", { documentId: "sheet_b" }, {}, "RECORD_NOT_FOUND"],
      ["a sheet that does not exist", { documentId: "no-such-sheet" }, {}, "RECORD_NOT_FOUND"],
      ["a link-only record", { documentId: "sheet_link" }, {}, "REQUEST_REJECTED"],
      ["an oversize file", { documentId: "sheet_big" }, {}, "REQUEST_REJECTED"],
      ["a parent BOQ of project B", { documentId: "sheet_a", parentBoqId: "boq_b" }, {}, "RECORD_NOT_FOUND"],
      ["no person", { documentId: "sheet_a" }, { actorUserId: null }, "NOT_PERMITTED"],
      ["another project named in the params", { documentId: "sheet_a", projectId: PROJECT_B }, {}, "PROJECT_NOT_REACHABLE"],
      ["no document", {}, {}, "VALUE_REQUIRED"],
    ];
    for (const [label, params, overrides, code] of cases) {
      const failure = await refused("apply_boq_import", params, overrides);
      expect({ label, code: String(failure.code) }).toEqual({ label, code });
    }
    expect(fn.createBoq).toHaveBeenCalledTimes(0);
    expect(fn.createBoqRevision).toHaveBeenCalledTimes(0);
    expect(downloads).toEqual([]);
    expect(snapshot()).toBe(before);

    const out = await writeOk("apply_boq_import", { documentId: "sheet_a", title: "Villa BOQ v1" });
    expect(out).toMatchObject({ id: "boq_new", route: "/scope/boq_new" });
    expect(callOf(fn.createBoq)).toEqual([{ orgId: ORG, userId: PERSON }, { projectId: PROJECT_A, title: "Villa BOQ v1", lineItems: PARSED.lineItems }]);
    const revised = await writeOk("apply_boq_import", { documentId: "sheet_a", parentBoqId: "boq_a" });
    expect(revised).toMatchObject({ id: "boq_rev", route: "/scope/boq_rev" });
    expect(callOf(fn.createBoqRevision)).toEqual([{ orgId: ORG, userId: PERSON }, "boq_a", { title: "Villa BOQ", lineItems: PARSED.lineItems }]);
  });

  test("apply_boq_import: below manager the answer carries no money (the BOQ's contract value, its lines' rates, the sheet's total), marked; a manager's answer carries them; no project-side cost field for anyone", async () => {
    const manager = await writeOk("apply_boq_import", { documentId: "sheet_a" });
    const shown = JSON.stringify(manager);
    expect(shown).toContain("475000");
    expect((manager.record as { importSummary: { totalValue: number } }).importSummary.totalValue).toBe(120 * 450 + 30 * 5200);
    for (const role of ["member", "viewer", null]) {
      const out = await writeOk("apply_boq_import", { documentId: "sheet_a" }, { role, actorUserId: MEMBER });
      const record = out.record as { boq: Row & { lineItems: Row[] }; importSummary: Row; financialsRedacted?: boolean };
      expect({ role, marked: record.financialsRedacted, totalValue: record.importSummary.totalValue, contractValue: record.boq.contractValue, contractValueOverride: record.boq.contractValueOverride }).toEqual({
        role, marked: true, totalValue: null, contractValue: null, contractValueOverride: null,
      });
      expect(record.boq.lineItems[0]).toMatchObject({ rate: null, amount: null, materialCost: null, itemCode: "1.01" });
      expect(JSON.stringify(out)).not.toMatch(/475000|54000|171000|156000/);
      for (const field of ["rateProject", "qtyProject", "projectValue"]) expect(keysDeep(out).has(field)).toBe(false);
    }
  });

  test("create_change_order: recorded on the link's project under the confirming person with its cost, days and trade; the title is required; another project or no person writes nothing", async () => {
    const out = await writeOk("create_change_order", { title: "Extra plinth", description: "Raised 150 mm", reason: "Client request", trade: "Civil", costImpact: 125000, scheduleImpactDays: 3 });
    expect(out).toMatchObject({ id: "co_new", route: "/change-orders/co_new" });
    expect(callOf(fn.createChangeOrder)).toEqual([
      { orgId: ORG, userId: PERSON },
      { projectId: PROJECT_A, title: "Extra plinth", description: "Raised 150 mm", reason: "Client request", costImpact: 125000, scheduleImpactDays: 3, trade: "Civil" },
    ]);
    fn.createChangeOrder.mockClear();
    const before = snapshot();
    expect(await refused("create_change_order", {})).toMatchObject({ code: "TITLE_REQUIRED", missing: ["title"] });
    expect(await refused("create_change_order", { title: "   " })).toMatchObject({ code: "TITLE_REQUIRED" });
    expect(await refused("create_change_order", { title: "x" }, { actorUserId: null })).toMatchObject({ code: "NOT_PERMITTED", context: { reason: "unidentified_actor" } });
    expect(await refused("create_change_order", { title: "x", projectId: PROJECT_B })).toMatchObject({ code: "PROJECT_NOT_REACHABLE" });
    // an id that is no project of this org reaches no insert (the service does not look the project up)
    expect(await refused("create_change_order", { title: "x" }, { projectId: "no-such-project" })).toMatchObject({ code: "RECORD_NOT_FOUND" });
    expect(fn.createChangeOrder).toHaveBeenCalledTimes(0);
    expect(snapshot()).toBe(before);
  });

  test("create_change_order: the cost the caller sent comes back null below manager (the row is stored in full), marked; a manager sees it", async () => {
    const manager = await writeOk("create_change_order", { title: "Extra plinth", costImpact: 125000 });
    expect((manager.record as Row).costImpact).toBe("125000");
    for (const role of ["member", null]) {
      const out = await writeOk("create_change_order", { title: "Extra plinth", costImpact: 125000 }, { role, actorUserId: MEMBER });
      expect(out.record).toMatchObject({ costImpact: null, financialsRedacted: true });
      expect(JSON.stringify(out)).not.toContain("125000");
    }
    // the stored row kept the figure: the fake service was handed it whole
    expect((callOf(fn.createChangeOrder, 1)[1] as Row).costImpact).toBe(125000);
  });

  test("create_site_instruction: a formal instruction to a contractor on this project; the BOQ it varies must be this project's; the two flags are booleans only; nothing is written on a refusal", async () => {
    const before = snapshot();
    expect(await refused("create_site_instruction", { issueDate: "2026-10-05", toContractor: "Bharat Builders", description: "Move the door", boqId: "boq_b" })).toMatchObject({ code: "RECORD_NOT_FOUND" });
    for (const missing of ["issueDate", "toContractor", "description"]) {
      const params: Row = { issueDate: "2026-10-05", toContractor: "Bharat Builders", description: "Move the door" };
      delete params[missing];
      const failure = await refused("create_site_instruction", params);
      expect({ missing, code: failure.code }).toEqual({ missing, code: missing === "issueDate" ? "DATE_REQUIRED" : "VALUE_REQUIRED" });
    }
    expect(await refused("create_site_instruction", { issueDate: "2026-10-05", toContractor: "B", description: "d" }, { actorUserId: null })).toMatchObject({ code: "NOT_PERMITTED" });
    expect(await refused("create_site_instruction", { issueDate: "2026-10-05", toContractor: "B", description: "d", projectId: PROJECT_B })).toMatchObject({ code: "PROJECT_NOT_REACHABLE" });
    expect(fn.createSiteInstruction).toHaveBeenCalledTimes(0);
    expect(snapshot()).toBe(before);
    const out = await writeOk("create_site_instruction", { issueDate: "2026-10-05", toContractor: "Bharat Builders", description: "Move the door", drawingRef: "AR-101", costImpact: "yes", timeImpact: true, boqId: "boq_a" });
    expect(out).toMatchObject({ id: "si_1", route: "/site-instructions" });
    expect(callOf(fn.createSiteInstruction)).toEqual([
      { orgId: ORG, userId: PERSON },
      { projectId: PROJECT_A, issueDate: "2026-10-05", toContractor: "Bharat Builders", description: "Move the door", drawingRef: "AR-101", costImpact: false, timeImpact: true, boqId: "boq_a" },
    ]);
  });

  test("update_line_item_budget: a line of another project and a vendor who is no supplier of this org are refused before the write; nothing to change is a bad request", async () => {
    const before = snapshot();
    expect(await refused("update_line_item_budget", { boqLineItemId: "line_b", budgetPercentage: 40 })).toMatchObject({ code: "BOQ_LINE_NOT_FOUND", missing: ["boqLineItemId"] });
    expect(await refused("update_line_item_budget", { boqLineItemId: "line_a", vendorId: "sup_x", vendorAmount: 5000 })).toMatchObject({ code: "RECORD_NOT_FOUND", missing: ["vendor"] });
    expect(await refused("update_line_item_budget", { boqLineItemId: "line_a", vendorId: "no-such-supplier" })).toMatchObject({ code: "RECORD_NOT_FOUND" });
    expect(await refused("update_line_item_budget", { boqLineItemId: "line_a" })).toMatchObject({ code: "VALUE_REQUIRED", missing: ["value"] });
    expect(await refused("update_line_item_budget", {})).toMatchObject({ code: "BOQ_LINE_REQUIRED" });
    expect(await refused("update_line_item_budget", { boqLineItemId: "line_a", budgetPercentage: 40 }, { projectId: PROJECT_B })).toMatchObject({ code: "BOQ_LINE_NOT_FOUND" });
    expect(await refused("update_line_item_budget", { boqLineItemId: "line_a", budgetPercentage: 40, projectId: PROJECT_B })).toMatchObject({ code: "PROJECT_NOT_REACHABLE" });
    expect(fn.updateLineItemBudget).toHaveBeenCalledTimes(0);
    expect(snapshot()).toBe(before);
    const out = await writeOk("update_line_item_budget", { boqLineItemId: "line_a", budgetPercentage: 40, vendorId: "sup_a", vendorAmount: 5000, materialAmount: 3000, manpowerAmount: 2000, category: "Civil" });
    expect(out).toMatchObject({ id: "line_a", route: "/scope" });
    expect(callOf(fn.updateLineItemBudget)).toEqual([
      { orgId: ORG }, "line_a", { budgetPercentage: 40, vendorId: "sup_a", vendorAmount: 5000, materialAmount: 3000, manpowerAmount: 2000, category: "Civil" },
    ]);
  });

  test("update_line_item_budget: the answer's budget fields are null below manager, and no project-side cost field is ever shipped, to any role", async () => {
    const manager = await writeOk("update_line_item_budget", { boqLineItemId: "line_a", budgetPercentage: 40 });
    expect(manager.record).toMatchObject({ budgetPercentage: "40", vendorAmount: "5000", computedBudget: 13500 });
    for (const role of ["manager", "member", null]) {
      const out = await writeOk("update_line_item_budget", { boqLineItemId: "line_a", budgetPercentage: 40 }, { role });
      for (const field of ["rateProject", "qtyProject", "projectValue"]) expect({ role, field, shipped: keysDeep(out).has(field) }).toEqual({ role, field, shipped: false });
    }
    for (const role of ["member", null]) {
      const out = await writeOk("update_line_item_budget", { boqLineItemId: "line_a", budgetPercentage: 40 }, { role });
      expect(out.record).toMatchObject({ budgetPercentage: null, vendorAmount: null, materialAmount: null, manpowerAmount: null, computedBudget: null, financialsRedacted: true });
    }
  });
});

describe("AW-302: free text written through a link is cleaned and capped (spec 9.11) for every text parameter of the wave", () => {
  const textRows = ROWS.filter((r) => (r.text ?? []).length > 0);
  /** The `text` fields of a function's card: the names run-submission.ts's withLinkText() adds to the spec 9.11 list. */
  const cardTextFields = (id: string) => (functionSpec(id)?.card?.fields ?? []).filter((f) => f.type === "text").map((f) => f.key);

  test("every text parameter the policy lists is one the write-time rule treats as free text", () => {
    for (const row of textRows) {
      for (const name of row.text ?? []) expect({ id: row.id, name, covered: isFreeTextParam(name, cardTextFields(row.id)) }).toEqual({ id: row.id, name, covered: true });
    }
  });

  test("control characters, zero-width and bidirectional characters are removed and backtick runs are neutralised; ids, dates and numbers are left alone", () => {
    for (const row of textRows) {
      const dirty = Object.fromEntries((row.text ?? []).map((n) => [n, `a\u0000b​c‮d\`\`\`e\tf\ng`]));
      const rules = applyLinkTextRules({ ...row.valid, ...dirty, documentId: "sheet_a", costImpact: 125000 }, cardTextFields(row.id));
      expect(rules.ok).toBe(true);
      if (!rules.ok) continue;
      for (const name of row.text ?? []) expect({ id: row.id, name, value: rules.params[name] }).toEqual({ id: row.id, name, value: "abcd''e\tf\ng" });
      expect(rules.params.documentId).toBe("sheet_a");
      expect(rules.params.costImpact).toBe(125000);
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
