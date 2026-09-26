/// <reference types="bun-types" />
// PROJEXA-BUILD-002 AW-312: the write path for the eight owner exception items that had none (GAP_A section 3.3: EXC-ITEM-03, 04, 10, 11, 12, 15,
// 16, 21). The 28-item report could DETECT each of them and no code anywhere could RECORD the fact, so an AI (or a person) could never make the
// detector go quiet for the right reason. Each item now has a small service and a function:
//
//   items 3, 4    set_progress_drawing        the drawing a progress entry was built from, and whether it was confirmed      level 2, rank 2
//   item 10       record_vendor_dispute       an open dispute with a vendor (money: the disputed amount)                     level 2, rank 2
//   items 11, 12  record_customer_complaint   an open complaint; category 'work_dispute' is item 11, any other is item 12    level 2, rank 2
//   items 15, 16  record_customer_approval    the customer's approval of an internally approved BOQ, with the evidence       level 2, rank 3
//   item 21       link_roster_employee        a roster row tied to an employee profile                                       on NO link (a reason)
//
// PROVEN HERE
//   the link, through the REAL Edge handler (coverage-link-checks-w56.ts), for the four that are on links: level 2 (a draft the person confirms:
//     refused on /actions, a valid check and a proposal instead), the ranks, the money flag, the free-text and id parameters; and link_roster_employee is
//     on no link, with its reason, and a link of a manager gets 403 FUNCTION_NOT_ON_LINK for it;
//   the services and the executors, over the store double with the REAL services (construction-exception-capture-service.ts) and the REAL detectors of
//     construction-exceptions-service.ts:
//     - THE LOOP CLOSES: the detector flags the item, the function records the fact, the fact is RE-READ from the stored row, and the detector no longer
//       flags it (items 3, 10, 11, 12, 15, 21); a complaint with category 'work_dispute' clears item 11 and 12, any other category only item 12;
//     - every id must be the project's: a progress entry, a drawing (a project document of category drawing or drawing_3d, not any document), a BOQ line, a
//       BOQ, an evidence document, a roster row of ANOTHER project reads as absent, and the store is unchanged; an organisation supplier, customer or
//       employee of ANOTHER organisation reads as absent;
//     - the rank and the person: no person, a role below the rank, an absent or unknown role are refused before anything is read;
//     - money: the disputed amount is stored, and null in the answer below the manager rank;
//     - the customer's approval cannot be invented: the BOQ must be internally approved, an existing approval is never overwritten, the evidence document is
//       required and kept in the audit row, the date is a real past or present day; the recording person is stored;
//     - one audit row per recorded fact, under the acting person, and none for a refused call;
//     - free text is cleaned and refused above 2,000 characters.
//
// WHAT IS REAL: executor.ts, executors/exception-capture.ts, executors/scope.ts, the five services, the detectors, function-registry.ts, the generated policy,
// the Edge handler. WHAT IS FAKED: only @/lib/db/tenant-scoped (boq-store-double.ts) and the link's database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-exception-capture.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { describeLinkContract, registryRow, type LinkExpectation, REGISTRY } from "./__test-helpers__/coverage-link-checks-w56";
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler";
import { TOKENS, makeFake, req, testConfig } from "../services/__test-helpers__/awl-edge-fake";

const ORG = "org_1";
const OTHER_ORG = "org_2";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const MANAGER = "person_manager";
const MEMBER = "person_member";
const VIEWER = "person_viewer";
const API_KEY = "apikey_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Zoomies Dubai", status: "active" },
    { id: PROJECT_B, orgId: ORG, name: "Oakwood", status: "active" },
  ]);
  seedRows(s, "users", [
    { id: MANAGER, orgId: ORG, isActive: true, role: "manager", name: "Asha Manager", email: "asha@example.com" },
    { id: MEMBER, orgId: ORG, isActive: true, role: "member", name: "Ravi Member", email: "ravi@example.com" },
    { id: VIEWER, orgId: ORG, isActive: true, role: "viewer", name: "Meera Viewer", email: "meera@example.com" },
    { id: "person_inactive", orgId: ORG, isActive: false, role: "manager", name: "Gone Manager", email: "gone@example.com" },
  ]);
  seedRows(s, "construction_work_progress_entries", [
    { id: "pe_a", orgId: ORG, projectId: PROJECT_A, activityId: "act_a", entryDate: "2026-09-20", percentComplete: "10", recordedById: MEMBER },
    { id: "pe_named", orgId: ORG, projectId: PROJECT_A, activityId: "act_a", entryDate: "2026-09-21", percentComplete: "20", recordedById: MEMBER, drawingDocumentId: "dwg_old" },
    { id: "pe_b", orgId: ORG, projectId: PROJECT_B, activityId: "act_b", entryDate: "2026-09-20", percentComplete: "10", recordedById: MEMBER },
  ]);
  seedRows(s, "documents", [
    { id: "dwg_a", orgId: ORG, name: "AR-101 rev B", fileUrl: "https://example.com/a", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_A, isLatestVersion: true },
    { id: "dwg_old", orgId: ORG, name: "AR-101 rev A", fileUrl: "https://example.com/o", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_A, isLatestVersion: false },
    { id: "dwg_3d", orgId: ORG, name: "Walkthrough", fileUrl: "https://example.com/w", category: "drawing_3d", linkedEntityType: "project", linkedEntityId: PROJECT_A, isLatestVersion: true },
    { id: "dwg_b", orgId: ORG, name: "Other drawing", fileUrl: "https://example.com/b", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_B, isLatestVersion: true },
    { id: "doc_mail", orgId: ORG, name: "Customer e-mail", fileUrl: "https://example.com/m", category: "correspondence", linkedEntityType: "project", linkedEntityId: PROJECT_A, isLatestVersion: true },
    { id: "doc_permit", orgId: ORG, name: "Permit", fileUrl: "https://example.com/p", category: "permit", linkedEntityType: "permit", linkedEntityId: "permit_1", isLatestVersion: true },
    { id: "doc_b", orgId: ORG, name: "Other mail", fileUrl: "https://example.com/x", category: "correspondence", linkedEntityType: "project", linkedEntityId: PROJECT_B, isLatestVersion: true },
    { id: "dwg_x", orgId: OTHER_ORG, name: "Elsewhere", fileUrl: "https://example.com/e", category: "drawing", linkedEntityType: "project", linkedEntityId: PROJECT_A, isLatestVersion: true },
  ]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, status: "approved" },
    { id: "boq_draft", orgId: ORG, projectId: PROJECT_A, version: 2, status: "draft" },
    { id: "boq_done", orgId: ORG, projectId: PROJECT_A, version: 3, status: "approved", customerApprovedAt: new Date("2026-09-01T00:00:00Z"), customerApprovedById: MANAGER },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, status: "approved" },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "line_a", orgId: ORG, boqId: "boq_a", itemCode: "EX-01", quantity: "10" },
    { id: "line_b", orgId: ORG, boqId: "boq_b", itemCode: "EX-01", quantity: "10" },
  ]);
  seedRows(s, "construction_labour_roster", [
    { id: "r_a", orgId: ORG, projectId: PROJECT_A, name: "Asha Worker", isActive: true },
    { id: "r_linked", orgId: ORG, projectId: PROJECT_A, name: "Babu Worker", isActive: true, employeeId: "emp_1" },
    { id: "r_b", orgId: ORG, projectId: PROJECT_B, name: "Other Worker", isActive: true },
  ]);
  seedRows(s, "employee_profiles", [
    { id: "emp_1", orgId: ORG, userId: "user_e1" },
    { id: "emp_2", orgId: ORG, userId: "user_e2" },
    { id: "emp_x", orgId: OTHER_ORG, userId: "user_ex" },
  ]);
  seedRows(s, "erp_suppliers", [
    { id: "sup_a", orgId: ORG, supplierName: "Shree Cement Traders" },
    { id: "sup_x", orgId: OTHER_ORG, supplierName: "Elsewhere Suppliers" },
  ]);
  seedRows(s, "erp_customers", [
    { id: "cus_a", orgId: ORG, customerName: "Mr. Sumeet" },
    { id: "cus_x", orgId: OTHER_ORG, customerName: "Elsewhere Customer" },
  ]);
  return s;
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
let exceptions: typeof import("@/lib/services/construction-exceptions-service");
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
  exceptions = await import("@/lib/services/construction-exceptions-service");
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
const audit = (action?: string) => rowsOf(store, "audit_logs").filter((r) => action === undefined || r.action === action);
const row = (table: string, id: string) => rowsOf(store, table).find((r) => r.id === id)!;
/** Runs one of the real detectors of the 28-item report against the store, in its own transaction. */
async function detector(name: "findUnconfirmedDrawingProgress" | "findOpenVendorDisputes" | "findOpenCustomerComplaints" | "findBoqWithoutCustomerApproval" | "findUnlinkedRoster", ...extra: string[]) {
  const fakeTx = fakeWithTenantContext(() => store);
  const fn = exceptions[name] as unknown as (db: unknown, orgId: string, projectId: string, ...rest: string[]) => Promise<Array<{ id: string }>>;
  return (await fakeTx({ orgId: ORG }, (db) => fn(db, ORG, PROJECT_A, ...extra))) as Array<{ id: string }>;
}
const CTRL = String.fromCharCode(0x202e, 0x200b, 0x7);

// ── the five functions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Case = {
  id: string;
  rank: 2 | 3;
  valid: Row;
  required: Array<[string, string, string]>;
  /** id parameters that name a record of another project (or of no project's drawing), each with its refusal. */
  foreign: Array<[string, string]>;
};
const CASES: Case[] = [
  { id: "set_progress_drawing", rank: 2, valid: { progressEntryId: "pe_a", drawingDocumentId: "dwg_a" }, required: [["progressEntryId", "VALUE_REQUIRED", "value"], ["drawingDocumentId", "VALUE_REQUIRED", "value"]], foreign: [["progressEntryId", "pe_b"], ["drawingDocumentId", "dwg_b"], ["drawingDocumentId", "doc_mail"], ["drawingDocumentId", "dwg_x"], ["drawingDocumentId", "doc_permit"]] },
  { id: "record_vendor_dispute", rank: 2, valid: { description: "Tiles delivered short by 40 sqm", amountDisputed: 5000, boqLineItemId: "line_a" }, required: [["description", "VALUE_REQUIRED", "value"]], foreign: [["boqLineItemId", "line_b"], ["boqLineItemId", "line_missing"]] },
  { id: "record_customer_complaint", rank: 2, valid: { description: "Client says the flooring is uneven", category: "work_dispute", severity: "high" }, required: [["description", "VALUE_REQUIRED", "value"]], foreign: [] },
  { id: "record_customer_approval", rank: 3, valid: { boqId: "boq_a", evidenceDocumentId: "doc_mail", approvedOn: "2026-09-20" }, required: [["boqId", "BOQ_VERSION_REQUIRED", "boqVersion"], ["evidenceDocumentId", "VALUE_REQUIRED", "value"]], foreign: [["boqId", "boq_b"], ["evidenceDocumentId", "doc_b"], ["evidenceDocumentId", "doc_permit"]] },
  { id: "link_roster_employee", rank: 3, valid: { rosterId: "r_a", employeeId: "emp_2" }, required: [["rosterId", "WORKER_REQUIRED", "worker"], ["employeeId", "VALUE_REQUIRED", "value"]], foreign: [["rosterId", "r_b"], ["employeeId", "emp_x"], ["employeeId", "emp_missing"]] },
];
const BELOW = (rank: number) => (rank === 3 ? "member" : "viewer");

// ═══ THE LINK ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const EXPECT: LinkExpectation[] = [
  { id: "set_progress_drawing", kind: "write", level: 2, rank: 2, money: false, text: [], ids: ["drawingDocumentId", "progressEntryId"], valid: { progressEntryId: "pe_a", drawingDocumentId: "dwg_a", confirmed: true }, required: ["progressEntryId", "drawingDocumentId"] },
  { id: "record_vendor_dispute", kind: "write", level: 2, rank: 2, money: true, text: ["description"], ids: ["boqLineItemId"], valid: { description: "Tiles short", amountDisputed: 5000, boqLineItemId: "line_a" }, required: ["description"] },
  { id: "record_customer_complaint", kind: "write", level: 2, rank: 2, money: false, text: ["description", "category"], ids: [], valid: { description: "Uneven flooring", category: "work_dispute", severity: "high" }, required: ["description"] },
  { id: "record_customer_approval", kind: "write", level: 2, rank: 3, money: false, text: [], ids: ["boqId", "evidenceDocumentId"], valid: { boqId: "boq_a", evidenceDocumentId: "doc_mail", approvedOn: "2026-09-20" }, required: ["boqId", "evidenceDocumentId"] },
];
for (const e of EXPECT) describeLinkContract(e);

describe("AW-312: link_roster_employee is on no link, with a reason; an organisation-level id is not a link parameter", () => {
  test("the generated row is on no link and says why; a manager's link does not list it and a check of it is 403 FUNCTION_NOT_ON_LINK", async () => {
    const r = registryRow("link_roster_employee")!;
    expect({ level: r.link_level, rank: r.min_role_rank, kind: r.kind }).toEqual({ level: null, rank: 0, kind: "write" });
    expect(r.excluded_reason).toMatch(/HR record/);
    const fake = makeFake({ writesEnabled: true });
    const go = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc: fake.rpc, config: testConfig({ execPresent: true }), log: () => {} });
    const listed = ((await (await go(`/${TOKENS.manager}/context`, { headers: { accept: "application/json" } })).json()) as { allowed_functions: string[] }).allowed_functions;
    expect(listed).not.toContain("link_roster_employee");
    const res = await go(`/${TOKENS.manager}/check`, { method: "POST", body: { function: "link_roster_employee", params: { rosterId: "r_a", employeeId: "emp_2" } } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("FUNCTION_NOT_ON_LINK");
  });

  test("customerId and employeeId are declared by no function that is on a link, and vendorId only by the two functions WP-05a put there (a supplier, a customer and an employee are not project records)", () => {
    for (const f of REGISTRY.filter((x) => x.link_level !== null)) {
      // run_named_report (a vendor filter) and update_line_item_budget (a vendor on a line) took an optional vendorId in WP-05a; none of the functions of waves 5 and 6 or AW-312 declares one
      const allowed = new Set(["run_named_report", "update_line_item_budget"]);
      for (const name of ["vendorId", "customerId", "employeeId"]) expect({ id: f.function_id, name, declared: f.declared_params.includes(name) && !(name === "vendorId" && allowed.has(f.function_id)) }).toEqual({ id: f.function_id, name, declared: false });
    }
  });

  test("the five functions have an executor and write; four are on links, all four at level 2 (none can be run directly)", () => {
    for (const c of CASES) expect({ id: c.id, executor: hasExecutor(c.id), writes: functionWrites(c.id), row: !!registryRow(c.id) }).toEqual({ id: c.id, executor: true, writes: true, row: true });
    expect(REGISTRY.filter((f) => CASES.some((c) => c.id === f.function_id) && f.link_level !== null).map((f) => [f.function_id, f.link_level])).toEqual([
      ["record_customer_approval", 2], ["record_customer_complaint", 2], ["record_vendor_dispute", 2], ["set_progress_drawing", 2],
    ]);
  });
});

// ═══ THE EXECUTORS AND SERVICES ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("AW-312: valid parameters succeed and the fact is on the stored row", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s succeeds, writes one audit row under the person, and answers the id and the screen route", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    const out = await result(c.id, c.valid);
    expect(typeof out.id).toBe("string");
    expect(typeof out.route).toBe("string");
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ orgId: ORG, userId: MANAGER, actorName: "Asha Manager", actorRole: "manager" });
    expect(store.unparsed).toEqual([]);
  });
});

describe("AW-312: THE LOOP CLOSES -- the detector flags, the function records the fact, the stored row says so, the detector goes quiet", () => {
  test("items 3 and 4: an entry that names a drawing with no confirmation is flagged; set_progress_drawing confirms it and the row keeps the drawing, the person and the time", async () => {
    expect((await detector("findUnconfirmedDrawingProgress")).map((r) => r.id)).toEqual(["pe_named"]);
    const out = await result("set_progress_drawing", { progressEntryId: "pe_named", drawingDocumentId: "dwg_a" });
    expect((out.record as Row)).toMatchObject({ drawingDocumentId: "dwg_a", drawingConfirmed: true, drawingIsLatestVersion: true });
    const stored = row("construction_work_progress_entries", "pe_named");
    expect(stored).toMatchObject({ drawingDocumentId: "dwg_a", drawingConfirmedById: MANAGER });
    expect(stored.drawingConfirmedAt).toBeInstanceOf(Date);
    expect(await detector("findUnconfirmedDrawingProgress")).toEqual([]);
    expect(JSON.parse(String(audit("construction_progress.drawing_recorded")[0].details))).toEqual({ drawingDocumentId: "dwg_a", confirmed: true, previousDrawingDocumentId: "dwg_old" });
  });

  test("naming a drawing on an entry that had none, without confirming it (confirmed: false), leaves it flagged: named but not confirmed is exactly item 3", async () => {
    await result("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_a", confirmed: false });
    expect(row("construction_work_progress_entries", "pe_a")).toMatchObject({ drawingDocumentId: "dwg_a", drawingConfirmedById: null, drawingConfirmedAt: null });
    expect((await detector("findUnconfirmedDrawingProgress")).map((r) => r.id).sort()).toEqual(["pe_a", "pe_named"]);
    // a later call that confirms it clears it
    await result("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_a" });
    expect((await detector("findUnconfirmedDrawingProgress")).map((r) => r.id)).toEqual(["pe_named"]);
  });

  test("naming a DIFFERENT drawing without confirming clears an earlier confirmation (the person confirmed the old drawing, not the new one); naming the same one keeps it", async () => {
    await result("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_a" });
    expect(row("construction_work_progress_entries", "pe_a").drawingConfirmedById).toBe(MANAGER);
    await result("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_a", confirmed: false });
    expect(row("construction_work_progress_entries", "pe_a").drawingConfirmedById).toBe(MANAGER);
    const out = await result("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_3d", confirmed: false });
    expect((out.record as Row).drawingConfirmed).toBe(false);
    expect(row("construction_work_progress_entries", "pe_a")).toMatchObject({ drawingDocumentId: "dwg_3d", drawingConfirmedById: null, drawingConfirmedAt: null });
  });

  test("item 4: a superseded drawing is accepted (the site did build from it) and the answer says it is no longer the latest version", async () => {
    const out = await result("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_old" });
    expect((out.record as Row).drawingIsLatestVersion).toBe(false);
    expect(row("construction_work_progress_entries", "pe_a").drawingDocumentId).toBe("dwg_old");
  });

  test("item 10: an open vendor dispute is recorded with the vendor, the BOQ line and the amount; the detector sees it as one open dispute", async () => {
    expect(await detector("findOpenVendorDisputes")).toEqual([]);
    const out = await result("record_vendor_dispute", { description: "Tiles delivered short by 40 sqm", amountDisputed: 5000, boqLineItemId: "line_a", vendorId: "sup_a" });
    const stored = row("construction_vendor_disputes", String(out.id));
    expect(stored).toMatchObject({ orgId: ORG, projectId: PROJECT_A, vendorId: "sup_a", boqLineItemId: "line_a", description: "Tiles delivered short by 40 sqm", amountDisputed: "5000", status: "open", raisedById: MANAGER });
    const flagged = await detector("findOpenVendorDisputes");
    expect(flagged.map((r) => r.id)).toEqual([out.id as string]);
  });

  test("items 11 and 12: a work_dispute complaint is both; any other category is only item 12", async () => {
    expect(await detector("findOpenCustomerComplaints")).toEqual([]);
    const work = await result("record_customer_complaint", { description: "Client says the flooring is uneven", category: "work_dispute", severity: "high" });
    const general = await result("record_customer_complaint", { description: "Site is untidy" });
    expect(row("construction_customer_complaints", String(work.id))).toMatchObject({ category: "work_dispute", severity: "high", status: "open", raisedById: MANAGER, projectId: PROJECT_A });
    expect(row("construction_customer_complaints", String(general.id))).toMatchObject({ category: "general", severity: "medium", status: "open" });
    expect((await detector("findOpenCustomerComplaints", "work_dispute")).map((r) => r.id)).toEqual([work.id as string]);
    expect((await detector("findOpenCustomerComplaints")).map((r) => r.id).sort()).toEqual([work.id as string, general.id as string].sort());
  });

  test("items 15 and 16: an internally approved BOQ with no customer approval is flagged; record_customer_approval records it on the date given, by the person, and the detector goes quiet", async () => {
    expect((await detector("findBoqWithoutCustomerApproval")).map((r) => r.id)).toEqual(["boq_a"]);
    const out = await result("record_customer_approval", { boqId: "boq_a", evidenceDocumentId: "doc_mail", approvedOn: "2026-09-20" });
    const stored = row("construction_boqs", "boq_a");
    expect(stored.customerApprovedById).toBe(MANAGER);
    expect((stored.customerApprovedAt as Date).toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(out.record).toMatchObject({ id: "boq_a", customerApprovedAt: "2026-09-20T00:00:00.000Z", customerApprovedById: MANAGER, evidenceDocumentId: "doc_mail" });
    expect(await detector("findBoqWithoutCustomerApproval")).toEqual([]);
    expect(JSON.parse(String(audit("construction_boq.customer_approval_recorded")[0].details))).toEqual({ evidenceDocumentId: "doc_mail", approvedOn: "2026-09-20" });
  });

  test("item 21: an active roster row with no employee is flagged; link_roster_employee ties it to the profile and the detector goes quiet", async () => {
    expect((await detector("findUnlinkedRoster")).map((r) => r.id)).toEqual(["r_a"]);
    const out = await result("link_roster_employee", { rosterId: "r_a", employeeId: "emp_2" });
    expect(out.record).toEqual({ id: "r_a", projectId: PROJECT_A, employeeId: "emp_2" });
    expect(row("construction_labour_roster", "r_a").employeeId).toBe("emp_2");
    expect(await detector("findUnlinkedRoster")).toEqual([]);
  });
});

describe("AW-312: each required parameter left out is refused with the registry's code and the key it names, and nothing is written", () => {
  for (const c of CASES) {
    for (const [name, code, key] of c.required) {
      test(`${c.id} without ${name} -> ${code} [${key}]`, async () => {
        const params = { ...c.valid };
        delete params[name];
        const before = snapshot();
        const refused = await failure(c.id, params);
        expect({ code: refused.code, missing: refused.missing }).toEqual({ code, missing: [key] });
        expect(snapshot()).toBe(before);
      });
    }
  }
});

describe("AW-312: the person, the rank and the project", () => {
  test.each(CASES.map((c) => [c.id] as const))("%s: no person, a role below the rank, an absent or unknown role are refused; nothing is written", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    const before = snapshot();
    expect(await run(c.id, c.valid, { actorUserId: null })).toMatchObject({ success: false, failure: { code: "NOT_PERMITTED", context: { reason: "unidentified_actor" } } });
    for (const role of [BELOW(c.rank), undefined, null, "no_such_role"]) {
      const refused = await run(c.id, c.valid, { role });
      expect({ id: c.id, role, ok: refused.success }).toEqual({ id: c.id, role, ok: false });
      expect(refused).toMatchObject({ failure: { code: "NOT_PERMITTED" } });
    }
    expect(snapshot()).toBe(before);
    expect((await run(c.id, c.valid, { role: c.rank === 3 ? "manager" : "member", actorUserId: c.rank === 3 ? MANAGER : MEMBER })).success).toBe(true);
  });

  test.each(CASES.map((c) => [c.id] as const))("%s: a params.projectId naming another project is PROJECT_NOT_REACHABLE; with no project it is PROJECT_REQUIRED", async (id) => {
    const c = CASES.find((x) => x.id === id)!;
    const before = snapshot();
    expect(await failure(c.id, { ...c.valid, projectId: PROJECT_B })).toEqual({ code: "PROJECT_NOT_REACHABLE", missing: ["projectId"], picker: "project" });
    expect(await failure(c.id, c.valid, { projectId: null })).toMatchObject({ code: "PROJECT_REQUIRED" });
    expect(snapshot()).toBe(before);
  });

  test("an acting person who is unknown, inactive or of no organisation is refused by the service, and nothing is written", async () => {
    const before = snapshot();
    for (const actorUserId of ["person_nobody", "person_inactive", API_KEY]) {
      const refused = await failure("record_customer_complaint", { description: "x" }, { actorUserId, role: "manager" });
      expect({ actorUserId, code: refused.code }).toEqual({ actorUserId, code: "NOT_PERMITTED" });
    }
    expect(snapshot()).toBe(before);
  });
});

describe("AW-312: an id of a record of ANOTHER project (or another organisation, or of the wrong kind) reads as absent and the store is unchanged", () => {
  for (const c of CASES) {
    for (const [param, value] of c.foreign) {
      test(`${c.id} with ${param} = ${value}`, async () => {
        const before = snapshot();
        const refused = await failure(c.id, { ...c.valid, [param]: value });
        expect({ id: c.id, param, value, code: refused.code }).toEqual({ id: c.id, param, value, code: "RECORD_NOT_FOUND" });
        expect(snapshot()).toBe(before);
        expect(audit()).toHaveLength(0);
      });
    }
  }

  test("an organisation supplier and customer of ANOTHER organisation are absent; the organisation's own are kept on the record", async () => {
    const before = snapshot();
    expect((await failure("record_vendor_dispute", { description: "x", vendorId: "sup_x" })).code).toBe("RECORD_NOT_FOUND");
    expect((await failure("record_customer_complaint", { description: "x", customerId: "cus_x" })).code).toBe("RECORD_NOT_FOUND");
    expect(snapshot()).toBe(before);
    const dispute = await result("record_vendor_dispute", { description: "x", vendorId: "sup_a" });
    const complaint = await result("record_customer_complaint", { description: "x", customerId: "cus_a" });
    expect(row("construction_vendor_disputes", String(dispute.id)).vendorId).toBe("sup_a");
    expect(row("construction_customer_complaints", String(complaint.id)).customerId).toBe("cus_a");
  });

  test("a drawing must be a DRAWING of this project (the refusals are in the table above: another category, a permit, another project, another organisation); drawing_3d is a drawing", async () => {
    expect((await run("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_3d" })).success).toBe(true);
  });

  test("evidence may be any document of THIS project, but not a permit filed under another entity, another project's document or a missing one", async () => {
    for (const evidenceDocumentId of ["doc_b", "doc_permit", "doc_missing", "dwg_x"]) {
      expect({ evidenceDocumentId, code: (await failure("record_customer_approval", { boqId: "boq_a", evidenceDocumentId })).code }).toEqual({ evidenceDocumentId, code: "RECORD_NOT_FOUND" });
    }
    expect((await run("record_customer_approval", { boqId: "boq_a", evidenceDocumentId: "dwg_a" })).success).toBe(true);
  });
});

describe("AW-312: the customer's approval cannot be invented", () => {
  test("a BOQ that is not internally approved is refused (the service's 409): a draft cannot be approved by the customer; nothing is written", async () => {
    const before = snapshot();
    const refused = await failure("record_customer_approval", { boqId: "boq_draft", evidenceDocumentId: "doc_mail" });
    expect(refused.code).toBe("ALREADY_RECORDED");
    expect(snapshot()).toBe(before);
    expect(row("construction_boqs", "boq_draft").customerApprovedAt).toBeNull();
  });

  test("an approval already on record is never overwritten", async () => {
    const before = snapshot();
    expect((await failure("record_customer_approval", { boqId: "boq_done", evidenceDocumentId: "doc_mail" })).code).toBe("ALREADY_RECORDED");
    expect(snapshot()).toBe(before);
    expect((row("construction_boqs", "boq_done").customerApprovedAt as Date).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    // and the same call twice: the second is refused
    await result("record_customer_approval", { boqId: "boq_a", evidenceDocumentId: "doc_mail" });
    expect((await failure("record_customer_approval", { boqId: "boq_a", evidenceDocumentId: "doc_mail" })).code).toBe("ALREADY_RECORDED");
    expect(audit("construction_boq.customer_approval_recorded")).toHaveLength(1);
  });

  test("the date must be a real day, written YYYY-MM-DD, and not in the future; without one it is today", async () => {
    const before = snapshot();
    for (const approvedOn of ["2026-02-30", "20/09/2026", "2026-9-1", "tomorrow", "2999-01-01"]) {
      expect({ approvedOn, code: (await failure("record_customer_approval", { boqId: "boq_a", evidenceDocumentId: "doc_mail", approvedOn })).code }).toEqual({ approvedOn, code: "REQUEST_REJECTED" });
    }
    expect((await failure("record_customer_approval", { boqId: "boq_a", evidenceDocumentId: "doc_mail", approvedOn: 20260920 })).code).toBe("DATE_REQUIRED");
    expect(snapshot()).toBe(before);
    const t0 = Date.now();
    await result("record_customer_approval", { boqId: "boq_a", evidenceDocumentId: "doc_mail" });
    const at = (row("construction_boqs", "boq_a").customerApprovedAt as Date).getTime();
    expect(at).toBeGreaterThanOrEqual(t0 - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("AW-312: money, free text and the small rules of each fact", () => {
  test("the disputed amount is stored as given and is null in the answer below the manager rank (with the redaction flag)", async () => {
    const manager = await result("record_vendor_dispute", { description: "Tiles short", amountDisputed: 5000 });
    expect((manager.record as Row).amountDisputed).toBe("5000");
    const member = await result("record_vendor_dispute", { description: "Tiles short again", amountDisputed: 7500 }, { role: "member", actorUserId: MEMBER });
    expect(member.record).toMatchObject({ amountDisputed: null, financialsRedacted: true });
    expect(JSON.stringify(member)).not.toContain("7500");
    expect(row("construction_vendor_disputes", String(member.id))).toMatchObject({ amountDisputed: "7500", raisedById: MEMBER });
  });

  test("a negative or non-numeric amount is refused; no amount is fine and stores none", async () => {
    const before = snapshot();
    expect((await failure("record_vendor_dispute", { description: "x", amountDisputed: -1 })).code).toBe("REQUEST_REJECTED");
    expect((await failure("record_vendor_dispute", { description: "x", amountDisputed: "lots" })).code).toBe("REQUEST_REJECTED");
    expect(snapshot()).toBe(before);
    const none = await result("record_vendor_dispute", { description: "no amount yet" });
    expect(row("construction_vendor_disputes", String(none.id)).amountDisputed).toBeNull();
    expect((await run("record_vendor_dispute", { description: "zero", amountDisputed: 0 })).success).toBe(true);
  });

  test("free text is cleaned and capped: control characters out; over 2,000 characters (and a category over 100) refused; only control characters is the missing-value refusal", async () => {
    const before = snapshot();
    const ok = await result("record_customer_complaint", { description: `Uneven${CTRL} flooring`, category: `work${CTRL}_dispute` });
    expect(row("construction_customer_complaints", String(ok.id))).toMatchObject({ description: "Uneven flooring", category: "work_dispute" });
    const after = snapshot();
    expect((await failure("record_customer_complaint", { description: "x".repeat(2001) })).code).toBe("REQUEST_REJECTED");
    expect((await failure("record_vendor_dispute", { description: "x".repeat(2001) })).code).toBe("REQUEST_REJECTED");
    expect((await failure("record_customer_complaint", { description: "x", category: "x".repeat(101) })).code).toBe("REQUEST_REJECTED");
    expect((await failure("record_customer_complaint", { description: CTRL })).code).toBe("VALUE_REQUIRED");
    expect((await failure("record_vendor_dispute", { description: CTRL })).code).toBe("VALUE_REQUIRED");
    expect(snapshot()).toBe(after);
    expect(after).not.toBe(before);
    expect((await run("record_customer_complaint", { description: "x".repeat(2000) })).success).toBe(true);
  });

  test("a complaint's severity is low, medium or high (blank is the default, medium); another word is refused", async () => {
    for (const severity of ["low", "medium", "high"]) expect((await run("record_customer_complaint", { description: "x", severity })).success).toBe(true);
    const blank = await result("record_customer_complaint", { description: "x", severity: "" });
    expect(row("construction_customer_complaints", String(blank.id)).severity).toBe("medium");
    const before = snapshot();
    for (const severity of ["critical", "HIGH", 3]) expect({ severity, code: (await failure("record_customer_complaint", { description: "x", severity })).code }).toEqual({ severity, code: "REQUEST_REJECTED" });
    expect(snapshot()).toBe(before);
  });

  test("set_progress_drawing: `confirmed` must be true or false", async () => {
    expect((await failure("set_progress_drawing", { progressEntryId: "pe_a", drawingDocumentId: "dwg_a", confirmed: "yes" })).code).toBe("REQUEST_REJECTED");
    expect(row("construction_work_progress_entries", "pe_a").drawingDocumentId ?? null).toBeNull();
  });

  test("link_roster_employee: a roster row already linked to another employee is not re-pointed (409), the same employee again is fine, and the answer carries ids only", async () => {
    const before = snapshot();
    expect((await failure("link_roster_employee", { rosterId: "r_linked", employeeId: "emp_2" })).code).toBe("ALREADY_RECORDED");
    expect(snapshot()).toBe(before);
    expect(row("construction_labour_roster", "r_linked").employeeId).toBe("emp_1");
    const again = await result("link_roster_employee", { rosterId: "r_linked", employeeId: "emp_1" });
    expect(again.record).toEqual({ id: "r_linked", projectId: PROJECT_A, employeeId: "emp_1" });
  });

  test("a refused call writes no audit row; every recorded fact writes exactly one", async () => {
    await failure("record_customer_complaint", { description: "x", severity: "critical" });
    await failure("set_progress_drawing", { progressEntryId: "pe_b", drawingDocumentId: "dwg_a" });
    expect(audit()).toHaveLength(0);
    await result("record_customer_complaint", { description: "x" });
    await result("record_vendor_dispute", { description: "y" });
    expect(audit().map((r) => r.action).sort()).toEqual(["construction_customer_complaint.recorded", "construction_vendor_dispute.recorded"]);
  });
});
