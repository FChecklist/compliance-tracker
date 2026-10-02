/// <reference types="bun-types" />
// lf-b5-ai-crud (owner order 2026-10-02, requirement R7) -- the person's AI can finish the project: the eight edits and deletes that had no service
// (each now has its own service with conservative rules) and the ORGANISATION-SCOPED class (an organisation master changed through a project-bound
// link, its ids checked against the organisation).
//
// THE 19 FUNCTIONS (level, minimum rank; "money" where a money field is written or answered)
//   update_activity (1, 2)  update_progress_category (1, 2)  update_attendance (2, 3, money)  delete_attendance (2, 3, money)
//   update_change_order (2, 2, money)  cancel_change_order (2, 2)  update_boq_line (1, 2)  delete_meeting (2, 2)
//   create_boq_category (1, 2)  rename_boq_category (2, 3)  delete_boq_category (2, 3)  create_vendor (2, 2, money)  update_vendor (2, 2, money)
//   create_customer (2, 2, money)  update_customer (2, 2, money)  create_company (2, 3)  create_currency (2, 3, money)  create_exchange_rate (2, 3, money)
//   list_organisation_records (0, 2, money: a read)
//
// WHAT IS PROVEN, for every function (coverage-suite.ts): the generated link policy is this table; the valid parameters are a valid check on a
// manager's link; a level-2 function is refused on the direct path (403 LEVEL_NOT_ALLOWED) and is a draft; a viewer's link does not carry it (nor a
// member's, at rank 3); another project's id in projectId is refused; a role below the rank and no role is NOT_PERMITTED; a write that names no
// person is refused; an id of ANOTHER PROJECT (project records) or ANOTHER ORGANISATION (organisation records), or of no record, is RECORD_NOT_FOUND
// and the store is byte-identical afterwards; free text is capped at 2,000 characters.
// AND (this file): a valid call as a manager runs the REAL service and changes exactly the tables it should, re-read from the store; a task of another
// organisation is refused for every function and writes nothing; the per-person "act without asking" switch: off, every level-2 function of B5 is a
// draft only; on, it passes the level gate on the direct path; the services' own rules (the 7-day attendance window, a draft change order only, the
// pending e-signature voided with the cancel, a draft BOQ only, a unit locked once progress is logged, no category cycle, the category rename's
// blast radius across projects and never another organisation, a category in use is not retired, a soft-deleted meeting reads as absent); and a
// re-run of the same change (the link's retry) is harmless: an update gives the same row, a delete the second time is RECORD_NOT_FOUND.
//
// WHAT IS REAL: executor.ts, function-registry.ts, the executors of executors/crud-b5-*.ts, the services they wrap, the free-text rule, the generated
// link policy and the Edge handler. WHAT IS FAKED: only @/lib/db/tenant-scoped (coverage-fixtures.ts) and the link's own database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-crud-b5.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import {
  changedTables, makeStore, MANAGER, MEMBER, ORG, OTHER_ORG, PROJECT_A, PROJECT_B, PROJECT_X, seedLabourAndMaterials, snapshot, tableJson,
} from "./__test-helpers__/coverage-fixtures";
import { w79WithTenantContext } from "./__test-helpers__/coverage-w79";
import { defineCoverageSuite, failureOf, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler";
import { TOKENS, makeFake, req, testConfig } from "../services/__test-helpers__/awl-edge-fake";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: w79WithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);

/** For each function: a record of project A, one of project B and one of another organisation; for each organisation master, one of each organisation. */
function seedB5Records(s: BoqStore): void {
  seedLabourAndMaterials(s);
  seedRows(s, "product_branches", [
    { id: "br_erp", branchKey: "erp", displayName: "ERP", domain: "erp" },
    { id: "br_con", branchKey: "construction", displayName: "Construction", domain: "construction" },
  ]);
  seedRows(s, "org_product_branch_enablements", [
    { id: "en_1", orgId: ORG, productBranchId: "br_erp", isEnabled: true },
    { id: "en_2", orgId: ORG, productBranchId: "br_con", isEnabled: true },
  ]);
  seedRows(s, "construction_categories", [
    { id: "cat_a", orgId: ORG, projectId: PROJECT_A, name: "Joinery", parentCategoryId: null },
    { id: "cat_a2", orgId: ORG, projectId: PROJECT_A, name: "Doors", parentCategoryId: "cat_a" },
    { id: "cat_a3", orgId: ORG, projectId: PROJECT_A, name: "Flooring", parentCategoryId: null },
    { id: "cat_b", orgId: ORG, projectId: PROJECT_B, name: "Flooring" },
    { id: "cat_x", orgId: OTHER_ORG, projectId: PROJECT_X, name: "Elsewhere" },
  ]);
  seedRows(s, "construction_activities", [
    { id: "act_a", orgId: ORG, projectId: PROJECT_A, categoryId: "cat_a", name: "Frames", unit: "nos", plannedQuantity: "20" },
    { id: "act_a_logged", orgId: ORG, projectId: PROJECT_A, categoryId: "cat_a", name: "Shutters", unit: "nos", plannedQuantity: "20" },
    { id: "act_b", orgId: ORG, projectId: PROJECT_B, categoryId: "cat_b", name: "Tiles", unit: "sqm" },
    { id: "act_x", orgId: OTHER_ORG, projectId: PROJECT_X, categoryId: "cat_x", name: "Elsewhere", unit: "nos" },
  ]);
  seedRows(s, "construction_work_progress_entries", [
    { id: "entry_logged", orgId: ORG, projectId: PROJECT_A, activityId: "act_a_logged", entryDate: "2026-09-01", quantityDone: "4", percentComplete: "20", recordedById: MEMBER },
  ]);
  seedRows(s, "construction_labour_roster", [{ id: "roster_x", orgId: OTHER_ORG, projectId: PROJECT_X, name: "Elsewhere", dailyRate: "1", isActive: true }]);
  seedRows(s, "construction_attendance", [
    { id: "att_a", orgId: ORG, projectId: PROJECT_A, rosterId: "roster_a", attendanceDate: day(1), status: "present", hoursWorked: "8", dailyCost: "800" },
    { id: "att_a_old", orgId: ORG, projectId: PROJECT_A, rosterId: "roster_a2", attendanceDate: day(10), status: "present", hoursWorked: "8", dailyCost: "700" },
    { id: "att_b", orgId: ORG, projectId: PROJECT_B, rosterId: "roster_b", attendanceDate: day(1), status: "present", dailyCost: "900" },
    { id: "att_x", orgId: OTHER_ORG, projectId: PROJECT_X, rosterId: "roster_x", attendanceDate: day(1), status: "present", dailyCost: "1" },
  ]);
  seedRows(s, "construction_change_orders", [
    { id: "co_a", orgId: ORG, projectId: PROJECT_A, number: 1, title: "Extra partition", costImpact: "12000", scheduleImpactDays: 3, status: "draft", requestedById: MEMBER },
    { id: "co_a_sent", orgId: ORG, projectId: PROJECT_A, number: 2, title: "Oak veneer", costImpact: "500", scheduleImpactDays: 0, status: "pending_approval", requestedById: MEMBER, esignatureRequestId: "esr_a" },
    { id: "co_a_ok", orgId: ORG, projectId: PROJECT_A, number: 3, title: "Approved", costImpact: "900", scheduleImpactDays: 0, status: "approved", requestedById: MEMBER },
    { id: "co_b", orgId: ORG, projectId: PROJECT_B, number: 1, title: "Other project", costImpact: "1", scheduleImpactDays: 0, status: "pending_approval", requestedById: MEMBER },
    { id: "co_x", orgId: OTHER_ORG, projectId: PROJECT_X, number: 1, title: "Elsewhere", costImpact: "1", scheduleImpactDays: 0, status: "draft", requestedById: MEMBER },
  ]);
  seedRows(s, "esignature_requests", [
    { id: "esr_a", orgId: ORG, linkedEntityType: "change_order", linkedEntityId: "co_a_sent", title: "CO #2", documentHash: "h", status: "pending" },
    { id: "esr_b", orgId: ORG, linkedEntityType: "change_order", linkedEntityId: "co_b", title: "CO #1", documentHash: "h", status: "pending" },
  ]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, status: "draft", title: "Draft" },
    { id: "boq_a_sent", orgId: ORG, projectId: PROJECT_A, version: 2, status: "submitted", title: "Submitted" },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, status: "draft", title: "Other" },
    { id: "boq_x", orgId: OTHER_ORG, projectId: PROJECT_X, version: 1, status: "draft", title: "Elsewhere" },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "line_a", orgId: ORG, boqId: "boq_a", itemCode: "EX-01", description: "Partition", unit: "sqm", quantity: "10", category: "Civil" },
    { id: "line_a2", orgId: ORG, boqId: "boq_a", itemCode: "EX-02", description: "Skirting", unit: "rm", quantity: "10", category: "civil" },
    { id: "line_a_sent", orgId: ORG, boqId: "boq_a_sent", itemCode: "EX-01", description: "Partition", unit: "sqm", quantity: "10", category: "Paint" },
    { id: "line_b", orgId: ORG, boqId: "boq_b", itemCode: "EX-01", description: "Tiles", unit: "sqm", quantity: "10", category: "Civil" },
    { id: "line_x", orgId: OTHER_ORG, boqId: "boq_x", itemCode: "EX-01", description: "Elsewhere", unit: "sqm", quantity: "10", category: "Civil" },
  ]);
  seedRows(s, "pms_meetings", [
    { id: "pmeet_a", orgId: ORG, projectId: PROJECT_A, title: "Coordination", scheduledAt: new Date("2026-09-24T10:00:00Z"), durationMinutes: 30, deletedAt: null },
    { id: "pmeet_b", orgId: ORG, projectId: PROJECT_B, title: "Other coordination", scheduledAt: new Date("2026-09-24T10:00:00Z"), deletedAt: null },
    { id: "pmeet_x", orgId: OTHER_ORG, projectId: PROJECT_X, title: "Elsewhere", scheduledAt: new Date("2026-09-24T10:00:00Z"), deletedAt: null },
  ]);
  // organisation masters: one set of this organisation, one of another
  seedRows(s, "construction_boq_categories", [
    { id: "bcat_civil", orgId: ORG, name: "Civil", sortOrder: 1, isActive: true },
    { id: "bcat_misc", orgId: ORG, name: "Misc", sortOrder: 2, isActive: true },
    { id: "bcat_x", orgId: OTHER_ORG, name: "Civil", sortOrder: 1, isActive: true },
  ]);
  seedRows(s, "erp_suppliers", [
    { id: "ven_a", orgId: ORG, supplierName: "Gulf Gypsum", trade: "Gypsum", creditLimit: "50000", isActive: true },
    { id: "ven_x", orgId: OTHER_ORG, supplierName: "Elsewhere", creditLimit: "1", isActive: true },
  ]);
  seedRows(s, "erp_customers", [
    { id: "cust_a", orgId: ORG, customerName: "Marina Club LLC", creditLimit: "90000", isActive: true },
    { id: "cust_x", orgId: OTHER_ORG, customerName: "Elsewhere", creditLimit: "1", isActive: true },
  ]);
  seedRows(s, "erp_companies", [
    { id: "comp_a", orgId: ORG, companyName: "Zoomies LLC", abbr: "ZL", isGroup: false },
    { id: "comp_x", orgId: OTHER_ORG, companyName: "Elsewhere", isGroup: false },
  ]);
  seedRows(s, "erp_currencies", [
    { id: "cur_aed", orgId: ORG, code: "AED", name: "UAE Dirham", isBaseCurrency: true },
    { id: "cur_usd", orgId: ORG, code: "USD", name: "US Dollar", isBaseCurrency: false },
    { id: "cur_x", orgId: OTHER_ORG, code: "EUR", name: "Euro", isBaseCurrency: true },
  ]);
}

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedB5Records(store);
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const run = (fn: string, params: Row, over: Partial<import("./executor").ExecutableTask> = {}) => executeTask(task(fn, params, over));
const row = (table: string, id: string): Row | undefined => rowsOf(store, table).find((r) => r.id === id);
const asMember = { role: "member", actorUserId: MEMBER } as const;

export const CASES: Case[] = [
  // the eight that had no service
  {
    fn: "update_activity", level: 1, minRank: 2, money: false, valid: { activityId: "act_a", name: "Door frames", plannedQuantity: 24, categoryId: "cat_a3" },
    required: [["activityId", "value"]], text: ["name", "unit"], foreign: [["activityId", "act_b", "act_x"], ["categoryId", "cat_b", "cat_x"]],
  },
  {
    fn: "update_progress_category", level: 1, minRank: 2, money: false, valid: { categoryId: "cat_a3", name: "Floor finishes", parentCategoryId: "cat_a" },
    required: [["categoryId", "value"]], text: ["name"], foreign: [["categoryId", "cat_b", "cat_x"], ["parentCategoryId", "cat_b", "cat_x"]],
  },
  {
    fn: "update_attendance", level: 2, minRank: 3, money: true, valid: { attendanceId: "att_a", status: "half_day" },
    required: [["attendanceId", "value"]], text: [], foreign: [["attendanceId", "att_b", "att_x"]],
  },
  { fn: "delete_attendance", level: 2, minRank: 3, money: true, valid: { attendanceId: "att_a" }, required: [["attendanceId", "value"]], text: [], foreign: [["attendanceId", "att_b", "att_x"]] },
  {
    fn: "update_change_order", level: 2, minRank: 2, money: true, valid: { changeOrderId: "co_a", costImpact: 18500, reason: "Client asked for oak" },
    required: [["changeOrderId", "value"]], text: ["title", "description", "reason", "trade"], foreign: [["changeOrderId", "co_b", "co_x"]],
  },
  { fn: "cancel_change_order", level: 2, minRank: 2, money: false, valid: { changeOrderId: "co_a_sent" }, required: [["changeOrderId", "value"]], text: [], foreign: [["changeOrderId", "co_b", "co_x"]] },
  {
    fn: "update_boq_line", level: 1, minRank: 2, money: false, valid: { lineItemId: "line_a", description: "Gypsum partition, 12.5 mm", unit: "m2" },
    required: [["lineItemId", "value"]], text: ["description", "unit"], foreign: [["lineItemId", "line_b", "line_x"]],
  },
  { fn: "delete_meeting", level: 2, minRank: 2, money: false, valid: { meetingId: "pmeet_a" }, required: [["meetingId", "value"]], text: [], foreign: [["meetingId", "pmeet_b", "pmeet_x"]] },
  // the organisation-scoped class: a "foreign" id is another ORGANISATION's (an organisation record has no project)
  { fn: "create_boq_category", level: 1, minRank: 2, money: false, valid: { name: "Facade" }, required: [["name", "value"]], text: ["name"], foreign: [] },
  {
    fn: "rename_boq_category", level: 2, minRank: 3, money: false, valid: { categoryId: "bcat_civil", name: "Civil works" },
    required: [["categoryId", "value"], ["name", "value"]], text: ["name"], foreign: [["categoryId", "bcat_x"]],
  },
  { fn: "delete_boq_category", level: 2, minRank: 3, money: false, valid: { categoryId: "bcat_misc" }, required: [["categoryId", "value"]], text: [], foreign: [["categoryId", "bcat_x"]] },
  {
    fn: "create_vendor", level: 2, minRank: 2, money: true, valid: { vendorName: "Dubai Paints", trade: "Paint", defaultPaymentTermsDays: 30, creditLimit: 20000 },
    required: [["vendorName", "value"]], text: ["vendorName", "vendorType", "gst", "pan", "trade"], foreign: [],
  },
  {
    fn: "update_vendor", level: 2, minRank: 2, money: true, valid: { vendorId: "ven_a", isActive: false, creditLimit: 60000 },
    required: [["vendorId", "value"]], text: ["vendorName", "vendorType", "gst", "pan", "trade"], foreign: [["vendorId", "ven_x"]],
  },
  {
    fn: "create_customer", level: 2, minRank: 2, money: true, valid: { customerName: "Harbour Villas", defaultPaymentTermsDays: 45 },
    required: [["customerName", "value"]], text: ["customerName", "gstin", "pan"], foreign: [],
  },
  {
    fn: "update_customer", level: 2, minRank: 2, money: true, valid: { customerId: "cust_a", defaultPaymentTermsDays: 60 },
    required: [["customerId", "value"]], text: ["customerName", "gstin", "pan"], foreign: [["customerId", "cust_x"]],
  },
  {
    fn: "create_company", level: 2, minRank: 3, money: false, valid: { companyName: "Zoomies Interiors FZ-LLC", abbr: "ZIF", country: "AE", parentCompanyId: "comp_a" },
    required: [["companyName", "value"]], text: ["companyName", "abbr", "country"], foreign: [["parentCompanyId", "comp_x"]],
  },
  { fn: "create_currency", level: 2, minRank: 3, money: true, valid: { code: "GBP", name: "Pound Sterling", symbol: "£" }, required: [["code", "value"], ["name", "value"]], text: ["code", "name", "symbol"], foreign: [] },
  {
    fn: "create_exchange_rate", level: 2, minRank: 3, money: true, valid: { fromCurrencyId: "cur_usd", toCurrencyId: "cur_aed", rate: 3.6725, rateDate: "2026-10-02" },
    required: [["fromCurrencyId", "value"], ["toCurrencyId", "value"], ["rate", "value"], ["rateDate", "date"]], text: [],
    foreign: [["fromCurrencyId", "cur_x"], ["toCurrencyId", "cur_x"]],
  },
  { fn: "list_organisation_records", level: 0, minRank: 2, money: true, valid: { master: "vendors" }, required: [["master", "value"]], text: [], foreign: [] },
];

const WRITES = CASES.filter((c) => c.level !== 0);

/** What a valid call (as a manager) changes: exactly these tables, and the check that the change is there, re-read from the store. */
const EFFECT: Record<string, { tables: string[]; check: () => void }> = {
  update_activity: { tables: ["construction_activities"], check: () => expect(row("construction_activities", "act_a")).toMatchObject({ name: "Door frames", plannedQuantity: "24", categoryId: "cat_a3", unit: "nos" }) },
  update_progress_category: { tables: ["construction_categories"], check: () => expect(row("construction_categories", "cat_a3")).toMatchObject({ name: "Floor finishes", parentCategoryId: "cat_a" }) },
  update_attendance: { tables: ["construction_attendance"], check: () => expect(row("construction_attendance", "att_a")).toMatchObject({ status: "half_day", dailyCost: "400", hoursWorked: "8" }) },
  delete_attendance: {
    tables: ["audit_logs", "construction_attendance"],
    check: () => {
      expect(row("construction_attendance", "att_a")).toBeUndefined();
      expect(row("construction_attendance", "att_a_old")).toBeDefined();
      expect(rowsOf(store, "audit_logs").find((a) => a.entityId === "att_a")).toMatchObject({ action: "construction_attendance.deleted", entityType: "construction_attendance", orgId: ORG, userId: MANAGER });
    },
  },
  update_change_order: { tables: ["construction_change_orders"], check: () => expect(row("construction_change_orders", "co_a")).toMatchObject({ costImpact: "18500", reason: "Client asked for oak", status: "draft", title: "Extra partition" }) },
  cancel_change_order: {
    tables: ["construction_change_orders", "esignature_requests"],
    check: () => {
      expect(row("construction_change_orders", "co_a_sent")!.status).toBe("cancelled");
      expect(row("esignature_requests", "esr_a")!.status).toBe("voided");
      expect(row("esignature_requests", "esr_b")!.status).toBe("pending");
    },
  },
  update_boq_line: {
    tables: ["construction_boq_line_items"],
    check: () => expect(row("construction_boq_line_items", "line_a")).toMatchObject({ description: "Gypsum partition, 12.5 mm", unit: "m2", quantity: "10", itemCode: "EX-01" }),
  },
  delete_meeting: {
    tables: ["pms_meetings"],
    check: () => {
      expect(row("pms_meetings", "pmeet_a")!.deletedAt).toBeInstanceOf(Date);
      expect(row("pms_meetings", "pmeet_b")!.deletedAt).toBeNull();
    },
  },
  create_boq_category: {
    tables: ["construction_boq_categories"],
    check: () => expect(rowsOf(store, "construction_boq_categories").find((c) => c.name === "Facade")).toMatchObject({ orgId: ORG, isActive: true, sortOrder: 3 }),
  },
  rename_boq_category: {
    tables: ["construction_boq_categories", "construction_boq_line_items"],
    check: () => {
      expect(row("construction_boq_categories", "bcat_civil")!.name).toBe("Civil works");
      // every line of THIS organisation carrying the old name, on every project, case-insensitively; never another organisation's
      for (const id of ["line_a", "line_a2", "line_b"]) expect(row("construction_boq_line_items", id)!.category).toBe("Civil works");
      expect(row("construction_boq_line_items", "line_x")!.category).toBe("Civil");
      expect(row("construction_boq_categories", "bcat_x")!.name).toBe("Civil");
    },
  },
  delete_boq_category: { tables: ["construction_boq_categories"], check: () => expect(row("construction_boq_categories", "bcat_misc")).toMatchObject({ isActive: false, name: "Misc" }) },
  create_vendor: {
    tables: ["erp_suppliers"],
    check: () => expect(rowsOf(store, "erp_suppliers").find((v) => v.supplierName === "Dubai Paints")).toMatchObject({ orgId: ORG, trade: "Paint", defaultPaymentTermsDays: 30, creditLimit: "20000" }),
  },
  update_vendor: { tables: ["erp_suppliers"], check: () => expect(row("erp_suppliers", "ven_a")).toMatchObject({ isActive: false, creditLimit: "60000", supplierName: "Gulf Gypsum" }) },
  create_customer: {
    tables: ["erp_customers"],
    check: () => expect(rowsOf(store, "erp_customers").find((c) => c.customerName === "Harbour Villas")).toMatchObject({ orgId: ORG, defaultPaymentTermsDays: 45 }),
  },
  update_customer: { tables: ["erp_customers"], check: () => expect(row("erp_customers", "cust_a")).toMatchObject({ defaultPaymentTermsDays: 60, customerName: "Marina Club LLC" }) },
  create_company: {
    tables: ["audit_logs", "erp_companies"],
    check: () => expect(rowsOf(store, "erp_companies").find((c) => c.companyName === "Zoomies Interiors FZ-LLC")).toMatchObject({ orgId: ORG, abbr: "ZIF", parentCompanyId: "comp_a" }),
  },
  create_currency: {
    tables: ["audit_logs", "erp_currencies"],
    check: () => {
      expect(rowsOf(store, "erp_currencies").find((c) => c.code === "GBP")).toMatchObject({ orgId: ORG, name: "Pound Sterling", isBaseCurrency: false });
      expect(row("erp_currencies", "cur_aed")!.isBaseCurrency).toBe(true);
    },
  },
  create_exchange_rate: {
    tables: ["audit_logs", "erp_exchange_rates"],
    check: () => expect(rowsOf(store, "erp_exchange_rates")[0]).toMatchObject({ orgId: ORG, fromCurrencyId: "cur_usd", toCurrencyId: "cur_aed", rate: "3.6725", rateDate: "2026-10-02" }),
  },
};

describe("lf-b5-ai-crud: the functions are registered and executable", () => {
  test("every function has an executor and the right kind, and every write has a valid-call effect below", () => {
    expect(CASES).toHaveLength(19);
    for (const c of CASES) expect({ fn: c.fn, executor: hasExecutor(c.fn), write: functionWrites(c.fn) }).toEqual({ fn: c.fn, executor: true, write: c.level !== 0 });
    for (const c of WRITES) expect({ fn: c.fn, effect: c.fn in EFFECT }).toEqual({ fn: c.fn, effect: true });
  });

  test("every delete, rename, cancel and money write is a level-2 draft; every organisation write but adding a category is level 2", () => {
    for (const c of WRITES.filter((x) => /^(delete|rename|cancel)_/.test(x.fn) || x.money)) expect({ fn: c.fn, level: c.level }).toEqual({ fn: c.fn, level: 2 });
    const org = ["rename_boq_category", "delete_boq_category", "create_vendor", "update_vendor", "create_customer", "update_customer", "create_company", "create_currency", "create_exchange_rate"];
    for (const fn of org) expect({ fn, level: CASES.find((c) => c.fn === fn)!.level }).toEqual({ fn, level: 2 });
  });
});

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

describe("a valid call runs the real service and changes exactly what it should", () => {
  for (const c of WRITES) {
    test(`${c.fn}: as a manager, writes only ${EFFECT[c.fn].tables.join(", ")}, and the change reads back`, async () => {
      const before = tableJson(store);
      resultOf(await run(c.fn, c.valid));
      expect(store.unparsed).toEqual([]);
      const written = changedTables(before, store).filter((t) => !(before[t] === undefined && JSON.stringify(store.tables[t]) === "[]"));
      expect(written).toEqual(EFFECT[c.fn].tables);
      EFFECT[c.fn].check();
    });
  }

  test("list_organisation_records: each list is this organisation's only; a credit limit is null below the manager rank", async () => {
    const vendors = resultOf<{ rows: Row[] }>(await run("list_organisation_records", { master: "vendors" }));
    expect(vendors.rows.map((r) => r.id)).toEqual(["ven_a"]);
    expect(vendors.rows[0].creditLimit).toBe("50000");
    const asMem = resultOf<{ rows: Row[]; financialsRedacted?: boolean }>(await run("list_organisation_records", { master: "customers" }, asMember));
    expect(asMem).toMatchObject({ rows: [{ id: "cust_a", creditLimit: null }], financialsRedacted: true });
    for (const [master, ids] of [["boq_categories", ["bcat_civil", "bcat_misc"]], ["companies", ["comp_a"]], ["currencies", ["cur_aed", "cur_usd"]]] as const) {
      const out = resultOf<{ rows: Row[] }>(await run("list_organisation_records", { master }));
      expect({ master, ids: out.rows.map((r) => r.id).sort() }).toEqual({ master, ids: [...ids].sort() });
    }
    expect(failureOf(await run("list_organisation_records", { master: "users" })).code).toBe("REQUEST_REJECTED");
    expect(store.unparsed).toEqual([]);
  });
});

describe("a task of another organisation reaches nothing of this one", () => {
  for (const c of CASES) {
    test(`${c.fn}: orgId of another organisation with this organisation's ids is refused, and nothing is written`, async () => {
      const before = snapshot(store);
      const failure = failureOf(await run(c.fn, c.valid, { orgId: OTHER_ORG }));
      expect(failure.code).toBe("RECORD_NOT_FOUND");
      expect(snapshot(store)).toBe(before);
    });
  }
});

// -- the per-person switch (drizzle/0685) over the REAL Edge handler -----------------------------------------------------------------------
function link(actWithoutAsking: string[] = []) {
  const fake = makeFake({ writesEnabled: true, actWithoutAsking });
  const call = async (token: string, path: string, body: unknown) => {
    const res = await handleAwl(req(`/${token}${path}`, { method: "POST", body }), { rpc: fake.rpc, config: testConfig({ execPresent: true }), log: () => {} });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { action: (fn: string, params: Row) => call(TOKENS.manager, "/actions", { function: fn, params }), check: (fn: string, params: Row) => call(TOKENS.manager, "/check", { function: fn, params }) };
}

describe("the draft/direct split follows the person's own switch, for every level-2 function of B5", () => {
  for (const c of WRITES.filter((x) => x.level === 2)) {
    test(`${c.fn}: switch off, a draft only (403 LEVEL_NOT_ALLOWED on /actions); switch on, it passes the level gate and /check says it runs directly`, async () => {
      const off = link();
      expect(await off.action(c.fn, c.valid)).toMatchObject({ status: 403, body: { code: "LEVEL_NOT_ALLOWED" } });
      expect((await off.check(c.fn, c.valid)).body).toMatchObject({ valid: true, level: 2, will_execute_directly: false });
      const on = link(["usr_manager"]);
      const direct = await on.action(c.fn, c.valid);
      expect(direct.status).toBe(503); // the executor is not wired into this handler test: past the level gate, never 403
      expect(direct.body.code).toBe("EXECUTOR_NOT_AVAILABLE");
      expect((await on.check(c.fn, c.valid)).body).toMatchObject({ valid: true, level: 2, will_execute_directly: true });
      // another person's switch does nothing for this person's link
      expect(await link(["usr_member"]).action(c.fn, c.valid)).toMatchObject({ status: 403, body: { code: "LEVEL_NOT_ALLOWED" } });
    });
  }
});

describe("a re-run of the same change (the link's retry) is harmless", () => {
  test("an update run twice gives the same row; a delete run twice is RECORD_NOT_FOUND the second time and writes nothing more", async () => {
    resultOf(await run("update_activity", { activityId: "act_a", name: "Door frames" }));
    const once = snapshot(store);
    resultOf(await run("update_activity", { activityId: "act_a", name: "Door frames" }));
    expect(row("construction_activities", "act_a")!.name).toBe("Door frames");
    expect(rowsOf(store, "construction_activities")).toHaveLength(JSON.parse(once).construction_activities.length);
    for (const [fn, params] of [["delete_meeting", { meetingId: "pmeet_a" }], ["delete_attendance", { attendanceId: "att_a" }], ["cancel_change_order", { changeOrderId: "co_a_sent" }]] as const) {
      resultOf(await run(fn, params));
      const after = snapshot(store);
      const again = failureOf(await run(fn, params));
      expect({ fn, code: again.code }).toEqual({ fn, code: fn === "cancel_change_order" ? "ALREADY_RECORDED" : "RECORD_NOT_FOUND" });
      expect(snapshot(store)).toBe(after);
    }
    expect(rowsOf(store, "audit_logs").filter((a) => a.entityId === "att_a")).toHaveLength(1);
  });

  test("create_boq_category twice: the second is refused (409: already a category) and no second row is made", async () => {
    resultOf(await run("create_boq_category", { name: "Facade" }));
    expect(failureOf(await run("create_boq_category", { name: "facade" })).code).not.toBeUndefined();
    expect(rowsOf(store, "construction_boq_categories").filter((c) => String(c.name).toLowerCase() === "facade")).toHaveLength(1);
  });
});

describe("the new services' own rules hold when the AI calls them", () => {
  test("attendance: a row older than 7 days is refused (edit and delete) and stays; a member cannot edit or delete at all", async () => {
    const before = snapshot(store);
    // a service's 409 is ALREADY_RECORDED in the pipeline's vocabulary (error-codes.ts codeForServiceError)
    expect(failureOf(await run("update_attendance", { attendanceId: "att_a_old", status: "absent" })).code).toBe("ALREADY_RECORDED");
    expect(failureOf(await run("delete_attendance", { attendanceId: "att_a_old" })).code).toBe("ALREADY_RECORDED");
    expect(failureOf(await run("update_attendance", { attendanceId: "att_a", status: "absent" }, asMember)).code).toBe("NOT_PERMITTED");
    expect(failureOf(await run("delete_attendance", { attendanceId: "att_a" }, asMember)).code).toBe("NOT_PERMITTED");
    expect(snapshot(store)).toBe(before);
  });

  test("attendance: the daily cost is recomputed from the roster's rate (absent is 0, present the full rate), never taken from the caller", async () => {
    resultOf(await run("update_attendance", { attendanceId: "att_a", status: "absent", dailyCost: 99999 }));
    expect(row("construction_attendance", "att_a")!.dailyCost).toBe("0");
    resultOf(await run("update_attendance", { attendanceId: "att_a", status: "present" }));
    expect(row("construction_attendance", "att_a")!.dailyCost).toBe("800");
  });

  test("change order: only a draft can be edited (a pending one is under a live e-signature), an approved one can be neither edited nor cancelled", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_change_order", { changeOrderId: "co_a_sent", costImpact: 1 })).code).toBe("ALREADY_RECORDED");
    expect(failureOf(await run("update_change_order", { changeOrderId: "co_a_ok", title: "Rewritten" })).code).toBe("ALREADY_RECORDED");
    expect(failureOf(await run("cancel_change_order", { changeOrderId: "co_a_ok" })).code).toBe("ALREADY_RECORDED");
    expect(snapshot(store)).toBe(before);
    // a draft is cancelled with nothing to void; its cost impact is null in the answer below the manager rank
    const out = resultOf<{ record: Row }>(await run("update_change_order", { changeOrderId: "co_a", title: "Partition, revised" }, asMember));
    expect(out.record).toMatchObject({ costImpact: null, financialsRedacted: true, title: "Partition, revised" });
    expect(resultOf<{ record: Row }>(await run("cancel_change_order", { changeOrderId: "co_a" })).record).toMatchObject({ status: "cancelled", signatureRequestsVoided: [] });
  });

  test("BOQ line: a line of a submitted BOQ is refused and unchanged; quantity, rate and amount are never taken", async () => {
    expect(failureOf(await run("update_boq_line", { lineItemId: "line_a_sent", description: "Rewritten" })).code).toBe("ALREADY_RECORDED");
    expect(row("construction_boq_line_items", "line_a_sent")!.description).toBe("Partition");
    resultOf(await run("update_boq_line", { lineItemId: "line_a", unit: "m2", quantity: 999, rate: 5 }));
    expect(row("construction_boq_line_items", "line_a")).toMatchObject({ unit: "m2", quantity: "10" });
  });

  test("activity: the unit is locked once progress is logged against it (409, unchanged); its name may still change; a category of another project is refused", async () => {
    expect(failureOf(await run("update_activity", { activityId: "act_a_logged", unit: "sets" })).code).toBe("ALREADY_RECORDED");
    expect(row("construction_activities", "act_a_logged")!.unit).toBe("nos");
    resultOf(await run("update_activity", { activityId: "act_a_logged", name: "Door shutters" }));
    expect(row("construction_activities", "act_a_logged")!.name).toBe("Door shutters");
    resultOf(await run("update_activity", { activityId: "act_a", unit: "sets" }));
    expect(row("construction_activities", "act_a")!.unit).toBe("sets");
  });

  test("category: a category cannot sit under itself or one of its own sub-categories (no cycle)", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("update_progress_category", { categoryId: "cat_a", parentCategoryId: "cat_a" })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("update_progress_category", { categoryId: "cat_a", parentCategoryId: "cat_a2" })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });

  test("meeting: a soft-deleted meeting reads as absent: it cannot be rescheduled or deleted again", async () => {
    resultOf(await run("delete_meeting", { meetingId: "pmeet_a" }));
    expect(row("pms_meetings", "pmeet_a")).toBeDefined();
    expect(failureOf(await run("update_meeting", { meetingId: "pmeet_a", title: "Back" })).code).toBe("RECORD_NOT_FOUND");
  });

  test("BOQ category: the rename answers how many lines it rewrote (all projects, this organisation); one in use is not retired and says how many lines use it", async () => {
    const out = resultOf<{ record: Row }>(await run("rename_boq_category", { categoryId: "bcat_civil", name: "Civil works" }));
    expect(out.record).toMatchObject({ name: "Civil works", lineItemsUpdated: 3 });
    const failure = failureOf(await run("delete_boq_category", { categoryId: "bcat_civil" }));
    expect(failure.code).toBe("ALREADY_RECORDED");
    expect(row("construction_boq_categories", "bcat_civil")!.isActive).toBe(true);
  });

  test("BOQ category: renaming to a name another category already has is refused, and no line moves", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("rename_boq_category", { categoryId: "bcat_misc", name: "civil" })).code).toBe("ALREADY_RECORDED");
    expect(snapshot(store)).toBe(before);
  });

  test("exchange rate: the same currency on both sides, or a rate of 0, is refused", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_exchange_rate", { fromCurrencyId: "cur_usd", toCurrencyId: "cur_usd", rate: 1, rateDate: "2026-10-02" })).code).toBe("REQUEST_REJECTED");
    expect(failureOf(await run("create_exchange_rate", { fromCurrencyId: "cur_usd", toCurrencyId: "cur_aed", rate: 0, rateDate: "2026-10-02" })).code).toBe("REQUEST_REJECTED");
    expect(snapshot(store)).toBe(before);
  });

  test("currency: never made the base currency through the AI (an admin's act), even when asked", async () => {
    resultOf(await run("create_currency", { code: "inr", name: "Indian Rupee", isBaseCurrency: true }));
    expect(rowsOf(store, "erp_currencies").find((c) => c.code === "INR")).toMatchObject({ isBaseCurrency: false });
    expect(row("erp_currencies", "cur_aed")!.isBaseCurrency).toBe(true);
  });

  test("an empty patch is refused and nothing is written", async () => {
    const before = snapshot(store);
    for (const [fn, params] of [
      ["update_activity", { activityId: "act_a" }], ["update_progress_category", { categoryId: "cat_a" }], ["update_attendance", { attendanceId: "att_a" }],
      ["update_change_order", { changeOrderId: "co_a" }], ["update_boq_line", { lineItemId: "line_a" }], ["update_vendor", { vendorId: "ven_a" }],
      ["update_customer", { customerId: "cust_a" }],
    ] as const) {
      expect({ fn, code: failureOf(await run(fn, params)).code }).toEqual({ fn, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });
});
