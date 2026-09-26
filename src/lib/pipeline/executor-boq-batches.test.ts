/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-04, register row AW-203: add_boq_lines takes at most 25 lines per batch, and a replay of the same boq id and batch
// number stores one write.
//
// PROVEN HERE
//   - a BOQ built the way the ZOOMIES run builds it: create_boq (empty), then batches of 25, 25 and 21 lines, 71 lines in all, each line
//     re-read from the stored rows; the running count in each answer is the stored count;
//   - a batch of 26 lines is refused whole, and 0 lines, a non-list and a bad batch number are refused, each with nothing written;
//   - a line with no itemCode, a duplicate code inside the batch, a parent that is not in the batch and a line the service rejects are refused
//     with the service's reason in the answer (so an AI can correct it), and nothing of the batch is stored;
//   - an item code already on the BOQ from an earlier batch is DUPLICATE_ITEM_CODE and the WHOLE batch rolls back (the batch's other, new codes
//     are not stored either), so the same batch number can be sent again after the fix;
//   - REPLAY: the same boq id, batch number and lines answer the stored outcome (the same line ids, replayed true) and write NOTHING (the tables
//     are byte-identical before and after); the same batch number with different lines is a 409 and writes nothing;
//   - each batch is one ledger row that names the person; a failed batch leaves none;
//   - the BOQ of another project or org is absent; a task with no person and a role below member are refused;
//   - the answer carries no money; one transaction at a time (D-06);
//   - a sub-task and its parent may be in one batch and the child's amount is derived, as in createBoq.
//
// WHAT IS REAL: executor.ts, executors/boq-payload.ts, construction-boq-payload-service.ts, insertLineItems(), logActivity(). WHAT IS FAKED:
// only @/lib/db/tenant-scoped, by __test-helpers__/boq-store-double.ts (a transaction commits only when it resolves, so a throw is a real
// rollback).
//
// Run: bun test --isolate src/lib/pipeline/executor-boq-batches.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { failNext, fakeWithTenantContext, keysDeep, rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { API_KEY, flatLines, makeStore, MANAGER, MEMBER, ORG, OTHER_ORG, PROJECT_A, PROJECT_B } from "./__test-helpers__/boq-payload-fixtures";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionSpec: typeof import("./function-registry").functionSpec;
let MAX_LINES_PER_BATCH: number;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ functionSpec } = await import("./function-registry"));
  ({ MAX_LINES_PER_BATCH } = await import("@/lib/services/construction-boq-payload-service"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makeStore();
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

type Task = import("./executor").ExecutableTask;
type Outcome = Awaited<ReturnType<typeof executeTask>>;
const run = (functionId: string, params: Row, overrides: Partial<Task> = {}): Promise<Outcome> =>
  executeTask({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, actorUserId: MANAGER, role: "manager", ...overrides });
const codeOf = (o: Outcome) => (o.success ? "OK" : o.failure.code);
const recordOf = (o: Outcome) => {
  if (!o.success) throw new Error(`expected success, got ${JSON.stringify(o.failure)}`);
  return (o.result as { id: string; record: Row }).record;
};
const snapshot = () => JSON.stringify(store.tables);
const linesOf = (boqId: unknown) => rowsOf(store, "construction_boq_line_items").filter((l) => l.boqId === boqId);
const batchRows = () => rowsOf(store, "audit_logs").filter((r) => r.action === "construction_boq.lines_batch_added");

async function emptyBoq(): Promise<string> {
  const made = await run("create_boq", { title: "Zoomies BOQ" });
  return (made as { result: { id: string } }).result.id;
}
const add = (boqId: string, batchNo: unknown, lines: unknown, overrides: Partial<Task> = {}) => run("add_boq_lines", { boqId, batchNo, lines }, overrides);

describe("AW-203: the registry entry", () => {
  test("add_boq_lines is a write with an executor that needs a project, a BOQ, a batch number and the lines", () => {
    const spec = functionSpec("add_boq_lines")!;
    expect(spec.kind).toBe("write");
    expect(spec.requiresProject).toBe(true);
    expect(spec.requiredParams.map((p) => p.name)).toEqual(["projectId", "boqId", "batchNo", "lines"]);
    expect(MAX_LINES_PER_BATCH).toBe(25);
  });
});

describe("AW-203: a BOQ built in batches", () => {
  test("*** THE ROW: 71 lines in batches of 25, 25 and 21 are 71 stored lines, and the running count is the stored count ***", async () => {
    const boqId = await emptyBoq();
    const all = flatLines(71);
    const counts: number[] = [];
    for (const [batchNo, from, to] of [[1, 0, 25], [2, 25, 50], [3, 50, 71]] as const) {
      const outcome = await add(boqId, batchNo, all.slice(from, to));
      expect(codeOf(outcome)).toBe("OK");
      const record = recordOf(outcome);
      expect(record).toMatchObject({ boqId, batchNo, accepted: to - from, replayed: false, sealed: false });
      counts.push(Number(record.linesInBoq));
      expect(linesOf(boqId)).toHaveLength(to);
    }
    expect(counts).toEqual([25, 50, 71]);
    const stored = linesOf(boqId);
    expect(stored).toHaveLength(71);
    expect(stored.map((l) => l.itemCode).sort()).toEqual(all.map((l) => l.itemCode as string).sort());
    expect(new Set(stored.map((l) => l.id)).size).toBe(71);
    expect(stored.every((l) => l.orgId === ORG)).toBe(true);
    expect(rowsOf(store, "construction_boqs")).toHaveLength(1);
    expect(store.maxOpen).toBe(1);
    expect(store.unparsed).toEqual([]);
  });

  test("the answer names the new lines' ids in the order sent, and they are the stored rows", async () => {
    const boqId = await emptyBoq();
    const lines = flatLines(5);
    const record = recordOf(await add(boqId, 1, lines));
    const ids = record.lineIds as string[];
    expect(ids).toHaveLength(5);
    expect(record.itemCodes).toEqual(lines.map((l) => l.itemCode));
    ids.forEach((id, i) => expect(linesOf(boqId).find((l) => l.id === id)!.itemCode).toBe(lines[i].itemCode));
  });

  test("a sub-task and its parent may be in one batch: the child's quantity and rate are derived, as createBoq derives them", async () => {
    const boqId = await emptyBoq();
    const lines: Row[] = [
      { itemCode: "P-1", description: "Parent", unit: "nos", quantity: 10, rate: 1000, category: "Play Area / X" },
      { itemCode: "P-1.1", parentItemCode: "P-1", breakdownPercentage: 40, description: "Child", unit: "", quantity: 0, rate: 0, category: "Play Area / X" },
    ];
    expect(codeOf(await add(boqId, 1, lines))).toBe("OK");
    const child = linesOf(boqId).find((l) => l.itemCode === "P-1.1")!;
    const parent = linesOf(boqId).find((l) => l.itemCode === "P-1")!;
    expect([Number(child.quantity), Number(child.rate), child.parentLineItemId]).toEqual([10, 400, parent.id]);
  });

  test("the answer carries no money: no rate, amount or cost of any kind", async () => {
    const boqId = await emptyBoq();
    const outcome = await add(boqId, 1, flatLines(3));
    const keys = keysDeep(recordOf(outcome));
    for (const money of ["rate", "amount", "materialCost", "labourCost", "equipmentCost", "budgetPercentage", "vendorAmount", "rateProject", "rateContract", "moneyView"]) {
      expect({ money, present: keys.has(money) }).toEqual({ money, present: false });
    }
  });
});

describe("AW-203: the size of a batch", () => {
  test("25 lines are accepted; 26 are refused whole with the limit in the answer, and nothing is written", async () => {
    const boqId = await emptyBoq();
    expect(codeOf(await add(boqId, 1, flatLines(25)))).toBe("OK");
    const before = snapshot();
    const outcome = await add(boqId, 2, flatLines(26, "M"));
    expect(codeOf(outcome)).toBe("REQUEST_REJECTED");
    expect(!outcome.success && outcome.failure.context).toMatchObject({ reason: "batch_too_large", max: 25, sent: 26 });
    expect(snapshot()).toBe(before);
  });

  test("the service holds the same limit for a caller that does not come through the executor", async () => {
    const boqId = await emptyBoq();
    const { appendBoqLines } = await import("@/lib/services/construction-boq-payload-service");
    await expect(appendBoqLines({ orgId: ORG, userId: MANAGER }, { projectId: PROJECT_A, boqId, batchNo: 1, lines: flatLines(26) as never })).rejects.toThrow(/at most 25 lines/);
    expect(linesOf(boqId)).toHaveLength(0);
  });

  test("no lines, lines that are not a list, a line that is not an object and a bad batch number are refused with nothing written", async () => {
    const boqId = await emptyBoq();
    const before = snapshot();
    for (const [batchNo, lines] of [[1, []], [1, "many"], [1, { a: 1 }], [1, [1, 2]], [1, [null]], [0, flatLines(1)], [-1, flatLines(1)], [1.5, flatLines(1)], ["one", flatLines(1)], [100001, flatLines(1)]] as Array<[unknown, unknown]>) {
      const outcome = await add(boqId, batchNo, lines);
      expect({ batchNo, lines, code: codeOf(outcome) }).toMatchObject({ code: "REQUEST_REJECTED" });
    }
    expect(snapshot()).toBe(before);
  });
});

describe("AW-203: what a batch may not contain", () => {
  test("every line needs an itemCode; a duplicate code inside the batch and a parent outside it are refused, with the reason", async () => {
    const boqId = await emptyBoq();
    const before = snapshot();
    const noCode = await add(boqId, 1, [{ description: "No code", unit: "nos", quantity: 1, rate: 1 }]);
    expect(codeOf(noCode)).toBe("REQUEST_REJECTED");
    expect(!noCode.success && String(noCode.failure.context?.detail)).toContain("itemCode is required");
    const dup = await add(boqId, 1, [...flatLines(2), ...flatLines(1)]);
    expect(codeOf(dup)).toBe("REQUEST_REJECTED");
    expect(!dup.success && String(dup.failure.context?.detail)).toContain("duplicate itemCode");
    const orphan = await add(boqId, 1, [{ itemCode: "C-1", parentItemCode: "NOT-HERE", breakdownPercentage: 10, description: "Orphan", unit: "", quantity: 0, rate: 0 }]);
    expect(codeOf(orphan)).toBe("REQUEST_REJECTED");
    expect(!orphan.success && String(orphan.failure.context?.detail)).toContain("same batch");
    const bad = await add(boqId, 1, [{ itemCode: "B-1", description: "", unit: "nos", quantity: 1, rate: 1 }]);
    expect(!bad.success && String(bad.failure.context?.detail)).toContain("description is required");
    const snake = await add(boqId, 1, [{ itemCode: "S-1", description: "x", unit: "nos", quantity: 1, rate: 1, item_code: "X" }]);
    expect(codeOf(snake)).toBe("REQUEST_REJECTED");
    expect(snapshot()).toBe(before);
  });

  test("an item code from an earlier batch is DUPLICATE_ITEM_CODE and the WHOLE batch rolls back; the same batch number works after the fix", async () => {
    const boqId = await emptyBoq();
    await add(boqId, 1, flatLines(3)); // L-001..L-003
    const before = snapshot();
    // batch 2 holds two new codes and one clash: none of the three may be stored
    const outcome = await add(boqId, 2, [...flatLines(2, "N"), ...flatLines(1, "L")]);
    expect(codeOf(outcome)).toBe("DUPLICATE_ITEM_CODE");
    expect(!outcome.success && outcome.failure.context).toMatchObject({ status: 409, itemCode: "L-001", clashes: 1 });
    expect(snapshot()).toBe(before);
    expect(linesOf(boqId)).toHaveLength(3);
    expect(batchRows()).toHaveLength(1);
    // fixed and sent again under the same batch number
    expect(codeOf(await add(boqId, 2, flatLines(3, "N")))).toBe("OK");
    expect(linesOf(boqId)).toHaveLength(6);
    expect(batchRows()).toHaveLength(2);
  });

  test("the duplicate check is per BOQ: the same code on another BOQ of the project is allowed", async () => {
    const first = await emptyBoq();
    const second = await emptyBoq();
    expect(codeOf(await add(first, 1, flatLines(2)))).toBe("OK");
    expect(codeOf(await add(second, 1, flatLines(2)))).toBe("OK");
  });
});

describe("AW-203: a replay of the same boq id and batch number stores one write", () => {
  test("*** THE ROW: the same batch sent twice answers the stored outcome and changes NOTHING ***", async () => {
    const boqId = await emptyBoq();
    const lines = flatLines(25);
    const first = recordOf(await add(boqId, 1, lines));
    const stored = snapshot();
    const inserts = store.transactions;

    const second = recordOf(await add(boqId, 1, lines));

    expect(snapshot()).toBe(stored);
    expect(linesOf(boqId)).toHaveLength(25);
    expect(batchRows()).toHaveLength(1);
    expect(second).toMatchObject({ boqId, batchNo: 1, accepted: 25, replayed: true });
    expect(second.lineIds).toEqual(first.lineIds);
    expect(second.itemCodes).toEqual(first.itemCodes);
    expect(second.linesInBoq).toBe(first.linesInBoq);
    expect(first.replayed).toBe(false);
    expect(store.transactions).toBe(inserts + 1);
  });

  test("a replay is answered as the same batch even when the keys of a line are written in another order", async () => {
    const boqId = await emptyBoq();
    const a: Row = { itemCode: "K-1", description: "Keys", unit: "nos", quantity: 2, rate: 5, category: "Play Area / K" };
    const b: Row = { category: "Play Area / K", rate: 5, quantity: 2, unit: "nos", description: "Keys", itemCode: "K-1" };
    await add(boqId, 1, [a]);
    const stored = snapshot();
    expect(recordOf(await add(boqId, 1, [b])).replayed).toBe(true);
    expect(snapshot()).toBe(stored);
  });

  test("the same batch number with different lines is a 409 and writes nothing", async () => {
    const boqId = await emptyBoq();
    await add(boqId, 1, flatLines(3));
    const stored = snapshot();
    const outcome = await add(boqId, 1, flatLines(3, "OTHER"));
    expect(codeOf(outcome)).toBe("ALREADY_RECORDED");
    expect(snapshot()).toBe(stored);
    // a changed rate on the same codes is also a different batch
    const changed = flatLines(3).map((l) => ({ ...l, rate: 999 }));
    expect(codeOf(await add(boqId, 1, changed))).toBe("ALREADY_RECORDED");
    expect(snapshot()).toBe(stored);
  });

  test("a batch number is per BOQ: batch 1 of another BOQ is its own batch", async () => {
    const first = await emptyBoq();
    const second = await emptyBoq();
    await add(first, 1, flatLines(2));
    expect(recordOf(await add(second, 1, flatLines(2, "Z"))).replayed).toBe(false);
  });
});

describe("AW-203: the ledger and who may call", () => {
  test("each batch is one ledger row that names the person and the batch; a failed batch leaves none", async () => {
    const boqId = await emptyBoq();
    await add(boqId, 1, flatLines(2));
    await add(boqId, 2, flatLines(1)); // clashes with batch 1's L-001
    const rows = batchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "construction_boq", entityId: boqId, orgId: ORG, userId: MANAGER, actorName: "Asha Manager", actorRole: "manager" });
    const details = JSON.parse(String(rows[0].details)) as { batchNo: number; accepted: number; itemCodes: string[]; lineIds: string[] };
    expect([details.batchNo, details.accepted, details.itemCodes]).toEqual([1, 2, ["L-001", "L-002"]]);
  });

  test("if the ledger row cannot be written the batch is not stored either (they commit together)", async () => {
    const boqId = await emptyBoq();
    failNext(store, "audit_logs", "insert");
    const outcome = await add(boqId, 1, flatLines(4));
    expect(outcome.success).toBe(false);
    expect(linesOf(boqId)).toHaveLength(0);
    expect(batchRows()).toHaveLength(0);
    // and the same batch works once the fault is gone
    expect(codeOf(await add(boqId, 1, flatLines(4)))).toBe("OK");
  });

  test("the BOQ of another project or org is absent; a params.projectId that is not the task's is refused; nothing is written", async () => {
    const boqId = await emptyBoq();
    const before = snapshot();
    expect(codeOf(await add(boqId, 1, flatLines(1), { projectId: PROJECT_B }))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await add(boqId, 1, flatLines(1), { orgId: OTHER_ORG }))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await run("add_boq_lines", { boqId, batchNo: 1, lines: flatLines(1), projectId: PROJECT_B }))).toBe("PROJECT_NOT_REACHABLE");
    expect(codeOf(await run("add_boq_lines", { boqId: "no-such-boq", batchNo: 1, lines: flatLines(1) }))).toBe("RECORD_NOT_FOUND");
    expect(snapshot()).toBe(before);
  });

  test("a task with no person, an unknown person and a role below member are refused with nothing written; a member may add lines", async () => {
    const boqId = await emptyBoq();
    const before = snapshot();
    expect(codeOf(await add(boqId, 1, flatLines(1), { actorUserId: null }))).toBe("NOT_PERMITTED");
    expect(codeOf(await add(boqId, 1, flatLines(1), { actorUserId: "nobody" }))).toBe("NOT_PERMITTED");
    for (const role of ["viewer", undefined, null]) expect(codeOf(await add(boqId, 1, flatLines(1), { role }))).toBe("NOT_PERMITTED");
    expect(snapshot()).toBe(before);
    expect(codeOf(await add(boqId, 1, flatLines(1), { role: "member", actorUserId: MEMBER }))).toBe("OK");
  });

  test("missing parameters are named: no BOQ, no batch number, no lines", async () => {
    const boqId = await emptyBoq();
    for (const [params, missing] of [
      [{ batchNo: 1, lines: flatLines(1) }, "boqId"],
      [{ boqId, lines: flatLines(1) }, "value"],
      [{ boqId, batchNo: 1 }, "value"],
    ] as Array<[Row, string]>) {
      const outcome = await run("add_boq_lines", params);
      expect(!outcome.success && outcome.failure.missing).toEqual([missing]);
    }
  });
});
