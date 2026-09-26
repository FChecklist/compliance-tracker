/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-04, register row AW-204: seal_boq compares the control totals an AI read from its own source with the totals of the
// stored BOQ lines, and either seals (the totals agree) or answers TOTAL_MISMATCH with every difference listed and seals nothing. The
// numbers are the ZOOMIES workbook's: Play Area 1,343,445 + Vet Area 252,835 = 1,596,280 (AED, excluding VAT), carried by a small synthetic
// line set that adds up to exactly those figures (__test-helpers__/boq-payload-fixtures.ts).
//
// PROVEN HERE
//   - matching totals seal the BOQ: the answer says sealed, and the seal is a ledger row that names the person; the BOQ's status is NOT
//     touched (sealing does not approve: approval stays the existing approve flow);
//   - the sums are over ROOT lines only: the sub-task under PLAY-1.01 has a derived amount of 260,000 and is not added again;
//   - the real ZOOMIES shortfall (the sheet's detail lines reach 1,332,645 against the stated 1,343,445, 10,800 short) answers TOTAL_MISMATCH
//     with that difference, and nothing is sealed, so the corrected call afterwards seals;
//   - a wrong grand total, a wrong line count, an area the BOQ has and the AI left out, and an area the AI named that the BOQ has not, are each
//     listed; areas match without regard to case; a line with no category is only in the grand total;
//   - a second seal with the same totals is a replay (nothing written), with different totals BOQ_SEALED; a sealed BOQ takes no more lines;
//   - the manager rank is needed; a bad shape is REQUEST_REJECTED with the reason; the BOQ of another project or org is absent;
//   - the pure comparison and the area rule.
//
// WHAT IS REAL: executor.ts, executors/boq-payload.ts, construction-boq-payload-service.ts, createBoq(), logActivity(). WHAT IS FAKED: only
// @/lib/db/tenant-scoped, by __test-helpers__/boq-store-double.ts.
//
// Run: bun test --isolate src/lib/pipeline/executor-boq-seal.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fakeWithTenantContext, rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { API_KEY, flatLines, makeStore, MANAGER, MEMBER, ORG, OTHER_ORG, PROJECT_A, PROJECT_B, ZOOMIES, zoomiesLines } from "./__test-helpers__/boq-payload-fixtures";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let boqAreaOf: typeof import("@/lib/services/construction-boq-payload-service").boqAreaOf;
let compareControlTotals: typeof import("@/lib/services/construction-boq-payload-service").compareControlTotals;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ boqAreaOf, compareControlTotals } = await import("@/lib/services/construction-boq-payload-service"));
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
const task = (functionId: string, params: Row, overrides: Partial<Task> = {}): Task => ({
  orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId, params, actorUserId: MANAGER, role: "manager", ...overrides,
});
const run = (functionId: string, params: Row, overrides: Partial<Task> = {}) => executeTask(task(functionId, params, overrides));
const codeOf = (o: Awaited<ReturnType<typeof executeTask>>) => (o.success ? "OK" : o.failure.code);
const resultOf = (o: Awaited<ReturnType<typeof executeTask>>) => {
  if (!o.success) throw new Error(`expected success, got ${JSON.stringify(o.failure)}`);
  return (o.result as { id: string; record: Row }).record;
};
const diffsOf = (o: Awaited<ReturnType<typeof executeTask>>) => JSON.parse(String(!o.success && o.failure.context?.diffs)) as Array<{ field: string; expected: number | null; actual: number; difference: number | null }>;

/** A BOQ on PROJECT_A holding the ZOOMIES lines, made and filled through the real functions. */
async function zoomiesBoq(): Promise<string> {
  const made = await run("create_boq", { title: "Zoomies BOQ" });
  const id = (made as { result: { id: string } }).result.id;
  const added = await run("add_boq_lines", { boqId: id, batchNo: 1, lines: zoomiesLines() });
  expect(codeOf(added)).toBe("OK");
  return id;
}

const TOTALS = { areas: { "Play Area": ZOOMIES.play, "Vet Area": ZOOMIES.vet }, grand: ZOOMIES.grand };
const seal = (boqId: string, controlTotals: unknown = TOTALS, expectedLineCount: unknown = 6, overrides: Partial<Task> = {}) =>
  run("seal_boq", { boqId, controlTotals, expectedLineCount }, overrides);
const ledger = (action: string) => rowsOf(store, "audit_logs").filter((r) => r.action === action);
const snapshot = () => JSON.stringify(store.tables);

describe("AW-204: seal_boq seals when the AI's control totals match, and only then", () => {
  test("the ZOOMIES numbers themselves: 1343445 + 252835 = 1596280, and the fixture lines add up to them", () => {
    expect(ZOOMIES.play + ZOOMIES.vet).toBe(ZOOMIES.grand);
    expect(ZOOMIES.grand).toBe(1596280);
    const roots = zoomiesLines().filter((l) => !l.parentItemCode);
    const sum = (prefix: string) => roots.filter((l) => String(l.category).startsWith(prefix)).reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0);
    expect([sum("Play Area"), sum("Vet Area")]).toEqual([1343445, 252835]);
  });

  test("*** THE ROW: matching totals seal the BOQ; the seal is recorded under the person; the BOQ is NOT approved ***", async () => {
    const boqId = await zoomiesBoq();
    const before = rowsOf(store, "construction_boqs").find((b) => b.id === boqId)!;

    const outcome = await seal(boqId);

    expect(codeOf(outcome)).toBe("OK");
    const record = resultOf(outcome);
    expect(record).toMatchObject({ boqId, sealed: true, lineCount: 6, replayed: false });
    expect(record.controlTotals).toEqual(TOTALS);
    const rows = ledger("construction_boq.sealed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "construction_boq", entityId: boqId, orgId: ORG, userId: MANAGER, actorName: "Asha Manager", actorRole: "manager" });
    // sealing is not approval: the header row is exactly as it was
    const after = rowsOf(store, "construction_boqs").find((b) => b.id === boqId)!;
    expect(after).toEqual(before);
    expect(after).toMatchObject({ status: "draft", approvedById: null });
    expect(store.maxOpen).toBe(1);
  });

  test("the sums are over root lines: the sub-task's derived 260,000 is not added again (a sum over every line would be 1,856,280)", async () => {
    const boqId = await zoomiesBoq();
    const child = rowsOf(store, "construction_boq_line_items").find((l) => l.itemCode === "PLAY-1.01.1")!;
    expect(Number(child.quantity) * Number(child.rate)).toBe(260000);
    const allLines = rowsOf(store, "construction_boq_line_items").filter((l) => l.boqId === boqId);
    const everyLine = allLines.reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0);
    expect(everyLine).toBe(ZOOMIES.grand + 260000);
    expect(codeOf(await seal(boqId))).toBe("OK");
  });

  test("the real ZOOMIES shortfall: detail lines reaching 1,332,645 against the stated 1,343,445 is TOTAL_MISMATCH by 10,800, and nothing is sealed", async () => {
    const boqId = await zoomiesBoq();
    const before = snapshot();
    // the AI added up the lines it could read (the Glass and Metal line hidden in a merged cell was missing) but states the sheet's own total
    const outcome = await seal(boqId, { areas: { "Play Area": 1332645, "Vet Area": ZOOMIES.vet }, grand: 1585480 });
    expect(codeOf(outcome)).toBe("TOTAL_MISMATCH");
    expect(!outcome.success && outcome.failure.context).toMatchObject({ status: 422, functionId: "seal_boq", diffCount: 2 });
    expect(diffsOf(outcome)).toEqual([
      { field: "Play Area", expected: 1332645, actual: 1343445, difference: 10800 },
      { field: "grand", expected: 1585480, actual: 1596280, difference: 10800 },
    ]);
    expect(snapshot()).toBe(before);
    expect(ledger("construction_boq.sealed")).toEqual([]);
    // the corrected call seals
    expect(codeOf(await seal(boqId))).toBe("OK");
    expect(ledger("construction_boq.sealed")).toHaveLength(1);
  });

  test("a wrong grand total and a wrong line count are each their own difference", async () => {
    const boqId = await zoomiesBoq();
    const outcome = await seal(boqId, { areas: TOTALS.areas, grand: 1596281 }, 5);
    expect(diffsOf(outcome)).toEqual([
      { field: "grand", expected: 1596281, actual: 1596280, difference: -1 },
      { field: "lineCount", expected: 5, actual: 6, difference: 1 },
    ]);
  });

  test("an area the BOQ has and the AI left out is listed with expected null; an area the AI named that the BOQ has not is listed with actual 0", async () => {
    const boqId = await zoomiesBoq();
    const outcome = await seal(boqId, { areas: { "Play Area": ZOOMIES.play, "Joinery BOQ": 500 }, grand: ZOOMIES.grand });
    expect(diffsOf(outcome)).toEqual([
      { field: "Vet Area", expected: null, actual: 252835, difference: null },
      { field: "Joinery BOQ", expected: 500, actual: 0, difference: -500 },
    ]);
  });

  test("areas match without regard to case or surrounding space; an uncategorised line counts only in the grand total", async () => {
    const boqId = await zoomiesBoq();
    await run("add_boq_lines", { boqId, batchNo: 2, lines: [{ itemCode: "EXTRA-1", description: "Uncategorised extra", unit: "nos", quantity: 2, rate: 50 }] });
    const totals = { areas: { " play AREA ": ZOOMIES.play, "VET area": ZOOMIES.vet }, grand: ZOOMIES.grand + 100 };
    expect(codeOf(await seal(boqId, totals, 7))).toBe("OK");
  });

  test("a second seal with the same totals is a replay and writes nothing; different totals are BOQ_SEALED; a sealed BOQ takes no more lines", async () => {
    const boqId = await zoomiesBoq();
    await seal(boqId);
    const sealed = snapshot();
    const again = await seal(boqId);
    expect(resultOf(again)).toMatchObject({ sealed: true, replayed: true, lineCount: 6 });
    expect(snapshot()).toBe(sealed);
    const different = await seal(boqId, { areas: { "Play Area": 1, "Vet Area": 1 }, grand: 2 });
    expect(codeOf(different)).toBe("BOQ_SEALED");
    const more = await run("add_boq_lines", { boqId, batchNo: 9, lines: flatLines(1, "NEW") });
    expect(codeOf(more)).toBe("BOQ_SEALED");
    expect(snapshot()).toBe(sealed);
  });

  test("a member cannot seal (the manager rank is needed), and nothing is read or written for the refusal", async () => {
    const boqId = await zoomiesBoq();
    const before = snapshot();
    const transactionsBefore = store.transactions;
    for (const role of ["member", "viewer", undefined, null]) {
      const outcome = await seal(boqId, TOTALS, 6, { role, actorUserId: MEMBER });
      expect({ role, code: codeOf(outcome) }).toEqual({ role, code: "NOT_PERMITTED" });
    }
    expect(store.transactions).toBe(transactionsBefore);
    expect(snapshot()).toBe(before);
    expect(codeOf(await seal(boqId, TOTALS, 6, { role: "admin" }))).toBe("OK");
  });

  test("a task with no person is refused; the BOQ of another project or org is absent; a params.projectId that is not the task's is PROJECT_NOT_REACHABLE", async () => {
    const boqId = await zoomiesBoq();
    expect(codeOf(await seal(boqId, TOTALS, 6, { actorUserId: null }))).toBe("NOT_PERMITTED");
    expect(codeOf(await seal(boqId, TOTALS, 6, { projectId: PROJECT_B }))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await seal(boqId, TOTALS, 6, { orgId: OTHER_ORG }))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await run("seal_boq", { boqId, controlTotals: TOTALS, expectedLineCount: 6, projectId: PROJECT_B }))).toBe("PROJECT_NOT_REACHABLE");
    expect(ledger("construction_boq.sealed")).toEqual([]);
  });

  test("a bad shape is REQUEST_REJECTED with the reason, and nothing is written", async () => {
    const boqId = await zoomiesBoq();
    const before = snapshot();
    const bad: Array<[unknown, unknown]> = [
      [undefined, 6], [null, 6], ["1596280", 6], [[1], 6], [{ grand: 1 }, 6], [{ areas: {}, grand: "x" }, 6], [{ areas: [], grand: 1 }, 6],
      [{ areas: { A: -1 }, grand: 1 }, 6], [{ areas: { A: "1" }, grand: 1 }, 6], [{ areas: { "": 1 }, grand: 1 }, 6], [{ areas: {}, grand: -5 }, 6],
      [TOTALS, -1], [TOTALS, 2.5], [TOTALS, "six"],
    ];
    for (const [totals, count] of bad) {
      const params: Row = { boqId };
      if (totals !== undefined) params.controlTotals = totals;
      params.expectedLineCount = count;
      const outcome = await run("seal_boq", params);
      expect({ totals, count, code: codeOf(outcome) }).toMatchObject({ code: expect.stringMatching(/^(REQUEST_REJECTED|VALUE_REQUIRED)$/) });
    }
    expect(snapshot()).toBe(before);
    // a bad total explains itself so an AI can correct it without a person
    const explained = await run("seal_boq", { boqId, controlTotals: { areas: {}, grand: -5 }, expectedLineCount: 6 });
    expect(!explained.success && String(explained.failure.context?.detail)).toContain("controlTotals.grand");
  });
});

describe("AW-204: the comparison and the area rule, on their own", () => {
  const line = (category: string | null, quantity: number, rate: number, parentLineItemId: string | null = null) => ({ quantity: String(quantity), rate: String(rate), category, parentLineItemId });

  test("the area of a category is the text before the first slash, trimmed; a category with no slash is its own area; none is no area", () => {
    expect(boqAreaOf("Play Area / Joinery")).toBe("Play Area");
    expect(boqAreaOf("  Vet Area/Fit-out / Extra ")).toBe("Vet Area");
    expect(boqAreaOf("Civil")).toBe("Civil");
    expect(boqAreaOf("")).toBeNull();
    expect(boqAreaOf("   ")).toBeNull();
    expect(boqAreaOf("/ Joinery")).toBeNull();
    expect(boqAreaOf(null)).toBeNull();
    expect(boqAreaOf(undefined)).toBeNull();
  });

  test("equal totals give no difference; the smallest difference (one cent) is one", () => {
    const lines = [line("A / x", 3, 33.33), line("B / y", 1, 10)];
    expect(compareControlTotals(lines, { areas: { A: 99.99, B: 10 }, grand: 109.99 }, 2)).toEqual([]);
    expect(compareControlTotals(lines, { areas: { A: 100, B: 10 }, grand: 109.99 }, 2)).toEqual([{ field: "A", expected: 100, actual: 99.99, difference: -0.01 }]);
  });

  test("quantity times rate is rounded to whole cents per line, so 0.1 x 3 is 0.30 and not 0.30000000000000004", () => {
    expect(compareControlTotals([line("A", 3, 0.1)], { areas: { A: 0.3 }, grand: 0.3 }, 1)).toEqual([]);
    // 0.29 x 100 is 28.999999999999996 in floating point: rounding (not truncating) is what makes 0.29 + 0.01 equal 0.30
    expect(compareControlTotals([line("A", 1, 0.29), line("A", 1, 0.01)], { areas: { A: 0.3 }, grand: 0.3 }, 2)).toEqual([]);
  });

  test("a sub-task (a line with a parent) is not added", () => {
    const lines = [line("A", 10, 100), line("A", 10, 40, "parent-id")];
    expect(compareControlTotals(lines, { areas: { A: 1000 }, grand: 1000 }, 2)).toEqual([]);
  });

  test("an empty BOQ agrees with zero totals and a zero line count", () => {
    expect(compareControlTotals([], { areas: {}, grand: 0 }, 0)).toEqual([]);
  });
});
