/// <reference types="bun-types" />
// OFFLINE WRITERS 2 (R-C09): the budget overlay of a BOQ scope line -- budget percent (default 25), vendor and vendor amount -- edited on the laptop
// with no network is update_line_item_budget on the AI work link. This file proves the server end through the real executor and the REAL
// updateLineItemBudget() service, re-reading the stored row (never a spy):
//   - a line starts at the default 25 %; setting 40 %, a vendor and a vendor amount is stored; the computed budget (amount x percent / 100) follows;
//   - refused with the row UNCHANGED: a percent below 0 or above 100, a negative vendor amount, a vendor who is no supplier of this organisation,
//     a line of another project, a call that changes nothing;
//   - the link's gate for this function is the manager rank (generated registry), and below manager the answer carries no budget money.
//
// WHAT IS REAL: executor.ts, function-registry.ts, updateLineItemBudget(). WHAT IS FAKED: only @/lib/db/tenant-scoped (boq-store-double.ts).
//
// Run: bun test --isolate src/lib/pipeline/executor.offline-budget-writer.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import registry from "../../../supabase/functions/ai-work-link/function-registry.generated.json";
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";

const ORG = "org_1";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const PERSON = "person_1";

let store: BoqStore;

function fixtures(): BoqStore {
  const s = makeBoqStore();
  seedRows(s, "projects", [{ id: PROJECT_A, orgId: ORG, name: "Cedar Heights" }, { id: PROJECT_B, orgId: ORG, name: "Oakwood" }]);
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }]);
  seedRows(s, "construction_boqs", [
    { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, title: "Scope", status: "approved", createdById: "x" },
    { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1, title: "Other", status: "approved", createdById: "x" },
  ]);
  seedRows(s, "construction_boq_line_items", [
    { id: "line_a", orgId: ORG, boqId: "boq_a", itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: "100", rate: "50", amount: "5000", budgetPercentage: "25" },
    { id: "line_b", orgId: ORG, boqId: "boq_b", itemCode: "B1", description: "Cladding", unit: "sqm", quantity: "10", rate: "900", amount: "9000", budgetPercentage: "25" },
  ]);
  seedRows(s, "erp_suppliers", [{ id: "sup_a", orgId: ORG, supplierName: "Alpha Contracting" }]);
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

const run = (params: Row, role = "manager") =>
  executeTask({ orgId: ORG, userId: "apikey_1", projectId: PROJECT_A, functionId: "update_line_item_budget", params, actorUserId: PERSON, role });
const line = (id = "line_a") => rowsOf(store, "construction_boq_line_items").find((l) => l.id === id)!;

async function refused(params: Row) {
  const before = JSON.stringify(store.tables);
  const outcome = await run(params);
  expect(JSON.stringify(store.tables)).toBe(before); // the row is unchanged
  if (outcome.success) throw new Error("expected a refusal");
  return outcome.failure;
}

test("the link gates this function at the manager rank, level 2, and marks it money", () => {
  const fn = (registry as { function_id: string; min_role_rank: number; link_level: number; money_sensitive: boolean }[]).find((f) => f.function_id === "update_line_item_budget")!;
  expect([fn.min_role_rank, fn.link_level, fn.money_sensitive]).toEqual([3, 2, true]);
});

test("a line starts at the default 25 %; 40 % with a vendor and a vendor amount is stored and re-read", async () => {
  expect(line().budgetPercentage).toBe("25");
  const outcome = await run({ boqLineItemId: "line_a", budgetPercentage: 40, vendorId: "sup_a", vendorAmount: 3500 });
  expect(outcome.success).toBe(true);
  expect([line().budgetPercentage, line().vendorId, Number(line().vendorAmount)]).toEqual(["40", "sup_a", 3500]);
  // the computed budget is read-time: amount x percent / 100
  expect((Number(line().amount) * Number(line().budgetPercentage)) / 100).toBe(2000);
});

test("0 % and 100 % are allowed (the range is inclusive); only the percent can be sent alone", async () => {
  expect((await run({ boqLineItemId: "line_a", budgetPercentage: 0 })).success).toBe(true);
  expect(line().budgetPercentage).toBe("0");
  expect((await run({ boqLineItemId: "line_a", budgetPercentage: 100 })).success).toBe(true);
  expect(line().budgetPercentage).toBe("100");
});

test("a percent below 0 or above 100 is refused, row unchanged", async () => {
  expect((await refused({ boqLineItemId: "line_a", budgetPercentage: -1 })).code).toBe("REQUEST_REJECTED");
  expect((await refused({ boqLineItemId: "line_a", budgetPercentage: 100.5 })).code).toBe("REQUEST_REJECTED");
});

test("a negative vendor amount is refused, row unchanged", async () => {
  expect((await refused({ boqLineItemId: "line_a", vendorId: "sup_a", vendorAmount: -1 })).code).toBe("REQUEST_REJECTED");
});

test("a vendor who is no supplier of this organisation, a line of another project, and a call that changes nothing are refused", async () => {
  expect((await refused({ boqLineItemId: "line_a", vendorId: "sup_nobody", vendorAmount: 10 })).code).toBe("RECORD_NOT_FOUND");
  expect((await refused({ boqLineItemId: "line_b", budgetPercentage: 40 })).code).toBe("BOQ_LINE_NOT_FOUND");
  expect((await refused({ boqLineItemId: "line_a" })).code).toBe("VALUE_REQUIRED");
});

test("below the manager rank the answer carries no budget money", async () => {
  const outcome = await run({ boqLineItemId: "line_a", budgetPercentage: 40 }, "member");
  if (!outcome.success) throw new Error("expected success");
  expect(JSON.stringify(outcome.result)).not.toContain('"budgetPercentage":"40"');
});
