/// <reference types="bun-types" />
// create_material_order (M-ORDER, drizzle/0742): an order is a promise of stock on a date. It writes one row in
// construction_material_orders and nothing else, never changes the stock on hand, and a twin of an open order is refused.
//
// WHAT IS PROVEN: the generated link policy; every parameter rule of the shared coverage suite; the row written, re-read from the store, under
// the acting person; on-hand unchanged; the project checks (material and BOQ line); a twin refused (409 ALREADY_RECORDED) with nothing written,
// while a different quantity, a different date, or a cancelled twin is a new order.
// WHAT IS FAKED: @/lib/db/tenant-scoped (coverage-fixtures.ts), the link's database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/coverage-material-order.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import {
  changedTables, coverageWithTenantContext, makeStore, MANAGER, ORG, PROJECT_A, seedLabourAndMaterials, seedProgressRecords, snapshot, tableJson,
} from "./__test-helpers__/coverage-fixtures";
import { defineCoverageSuite, failureOf, resultOf, task, type Case } from "./__test-helpers__/coverage-suite";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: coverageWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
beforeAll(async () => {
  ({ executeTask, functionWrites, hasExecutor } = await import("./executor"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  seedProgressRecords(store);
  seedLabourAndMaterials(store);
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const run = (fn: string, params: Row) => executeTask(task(fn, params));
const row = (table: string, id: string): Row => rowsOf(store, table).find((r) => r.id === id)!;

const VALID = { materialId: "mat_a", quantity: 200, expectedDate: "2026-09-28", boqLineItemId: "line_a", reference: "PO-1042", notes: "Deliver to gate 2" };

const CASES: Case[] = [
  {
    fn: "create_material_order", level: 2, minRank: 2, money: false, valid: VALID,
    required: [["materialId", "material"], ["quantity", "value"], ["expectedDate", "date"]], text: ["reference", "notes"],
    foreign: [["materialId", "mat_b"], ["boqLineItemId", "line_b"]],
  },
];

defineCoverageSuite(CASES, { execute: (t) => executeTask(t), store: () => store });

describe("create_material_order", () => {
  test("has an executor and is a write", () => {
    expect({ executor: hasExecutor("create_material_order"), write: functionWrites("create_material_order") }).toEqual({ executor: true, write: true });
  });

  test("writes one open order in its own table, under the acting person, and changes no other table", async () => {
    const before = tableJson(store);
    const out = resultOf(await run("create_material_order", VALID));
    expect(out.route).toBe("/materials");
    expect(changedTables(before, store)).toEqual(["construction_material_orders"]);
    expect(row("construction_material_orders", out.id)).toMatchObject({
      orgId: ORG, projectId: PROJECT_A, materialId: "mat_a", quantity: "200", expectedDate: "2026-09-28", status: "ordered",
      boqLineItemId: "line_a", reference: "PO-1042", notes: "Deliver to gate 2", createdById: MANAGER,
    });
  });

  test("the BOQ line, the reference and the notes are optional; an order with no BOQ line is stored as such", async () => {
    const out = resultOf(await run("create_material_order", { materialId: "mat_a", quantity: 5, expectedDate: "2026-09-28" }));
    expect(row("construction_material_orders", out.id)).toMatchObject({ boqLineItemId: null, reference: null, notes: null });
  });

  test("an order is not stock: the stock on hand (100 received) is unchanged, so 101 is still refused to issue", async () => {
    resultOf(await run("create_material_order", { materialId: "mat_a", quantity: 500, expectedDate: "2026-09-28" }));
    expect(failureOf(await run("record_material_issue", { materialId: "mat_a", quantity: 101, issuedDate: "2026-09-20" })).code).toBe("REQUEST_REJECTED");
  });

  test("a twin of an open order is refused as already recorded and writes nothing; another quantity or date is a new order", async () => {
    resultOf(await run("create_material_order", VALID));
    const before = snapshot(store);
    const twin = failureOf(await run("create_material_order", VALID));
    expect(twin.code).toBe("ALREADY_RECORDED");
    expect(snapshot(store)).toBe(before);
    resultOf(await run("create_material_order", { ...VALID, quantity: 201 }));
    resultOf(await run("create_material_order", { ...VALID, expectedDate: "2026-09-29" }));
    expect(rowsOf(store, "construction_material_orders")).toHaveLength(3);
  });

  test("a cancelled order is not a twin", async () => {
    const first = resultOf(await run("create_material_order", VALID));
    row("construction_material_orders", first.id).status = "cancelled";
    resultOf(await run("create_material_order", VALID));
    expect(rowsOf(store, "construction_material_orders")).toHaveLength(2);
  });

  test("a quantity that is not above zero, a date that is not a real day and a text that is not a string are refused with nothing written", async () => {
    const before = snapshot(store);
    for (const bad of [{ quantity: 0 }, { quantity: -2 }, { quantity: "abc" }, { expectedDate: "2026-02-30" }, { reference: 4 }, { notes: ["a"] }, { boqLineItemId: 9 }]) {
      const failure = failureOf(await run("create_material_order", { materialId: "mat_a", quantity: 1, expectedDate: "2026-09-28", ...bad }));
      expect({ bad, code: failure.code }).toEqual({ bad, code: "REQUEST_REJECTED" });
    }
    expect(snapshot(store)).toBe(before);
  });

  test("a material or a BOQ line that is on no record of the project is refused naming the parameter", async () => {
    const before = snapshot(store);
    expect(failureOf(await run("create_material_order", { ...VALID, materialId: "no_such_record" })).context).toMatchObject({ param: "materialId" });
    for (const boqLineItemId of ["line_b", "no_such_line"]) {
      expect(failureOf(await run("create_material_order", { ...VALID, boqLineItemId })).context).toMatchObject({ param: "boqLineItemId" });
    }
    expect(snapshot(store)).toBe(before);
  });
});
