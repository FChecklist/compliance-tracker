/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-04, register row AW-205: a member-rank link reads BOQ lines with every money value null and cannot call seal_boq.
//
// TWO LAYERS, both proven here.
//   The link's own read (the record kinds `boq_lines` and `boqs`, through the REAL handler over the link-database fake, whose row builder
//   applies the same money_columns the SQL does; the real SQL is proven on PGlite in ai-work-link-functions.pglite.test.ts):
//     - a member link sees every money column of a BOQ line as null, and a manager link sees them; when the database forgets to null them
//       the Edge nulls them on its own (redactItem); filtering or sorting a hidden column is refused (HIDDEN_FIELD);
//     - which functions a link may use follows its rank: a member link has add_boq_lines and create_boq but not seal_boq (403
//       FUNCTION_NOT_ON_LINK on /check), a manager link has all three.
//   The executor's own answers for the BOQ functions (over the store double), which the person or the AI reads back:
//     - a task below the manager rank, and a task with no known role, gets a create_boq answer whose money is null at every depth (the lines'
//       rate, amount and costs, the header's contract override, and the computed money views), marked financialsRedacted; the STORED rows
//       keep every number; a manager's answer carries them;
//     - add_boq_lines answers with ids, codes and counts and no money key at all, for every rank;
//     - seal_boq is refused below the manager rank BEFORE anything is read, so its refusal states no amount;
//     - the executor's list of money keys and the record kinds' money columns cannot drift apart: every money column of `boq_lines` and
//       `boqs` is a key the executor nulls, and every key it nulls is either a column of the kinds or a named computed value.
//
// Run: bun test --isolate src/lib/pipeline/executor-boq-redaction.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fakeWithTenantContext, keysDeep, rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { API_KEY, makeStore, MANAGER, MEMBER, ORG, PROJECT_A, zoomiesLines } from "./__test-helpers__/boq-payload-fixtures";
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler";
import { TOKENS, makeFake, req, testConfig } from "../services/__test-helpers__/awl-edge-fake";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let BOQ_MONEY_KEYS: ReadonlySet<string>;
let withholdBoqMoney: typeof import("./executors/boq-payload").withholdBoqMoney;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ BOQ_MONEY_KEYS, withholdBoqMoney } = await import("./executors/boq-payload"));
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

const KINDS = JSON.parse(readFileSync(new URL("../../../supabase/functions/ai-work-link/record-kinds.generated.json", import.meta.url), "utf8")) as Array<{
  kind: string; money_columns: string[]; filters: { omit_when_hidden?: string[] }
}>;
const kind = (name: string) => KINDS.find((k) => k.kind === name)!;
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

// ---------------------------------------------------------------------------------------------------------------------------------
describe("AW-205: a member-rank link reads BOQ lines with every money value null", () => {
  function link(leaksMoney = false) {
    const fake = makeFake({ writesEnabled: true, leaksMoney });
    const run = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc: fake.rpc, config: testConfig(), log: () => {} });
    const lines = async (token: string, query = "") => ((await (await run(`/${token}/records/boq_lines${query}`, { headers: { accept: "application/json" } })).json()) as { items: Row[]; hidden_fields: string[] });
    return { run, lines };
  }
  const MONEY = kind("boq_lines").money_columns;

  test("*** THE ROW: every money column of a BOQ line is null for a member link and has a value for a manager link ***", async () => {
    const { lines } = link();
    const member = await lines(TOKENS.member);
    expect(member.items.length).toBeGreaterThan(0);
    expect(member.hidden_fields.sort()).toEqual([...MONEY].sort());
    for (const item of member.items) for (const c of MONEY) expect({ c, value: item[c] }).toEqual({ c, value: null });
    const manager = await lines(TOKENS.manager);
    expect(manager.hidden_fields).toEqual([]);
    for (const item of manager.items) for (const c of MONEY) expect({ c, isNumber: typeof item[c] === "number" }).toEqual({ c, isNumber: true });
    // a member still reads the non-money columns of the same rows
    expect(member.items[0].item_code).toBe(manager.items[0].item_code);
  });

  test("the same holds for the BOQ header (contract override) and when the database forgets to null: the Edge nulls on its own", async () => {
    const { run, lines } = link(true);
    const member = await lines(TOKENS.member);
    for (const item of member.items) for (const c of MONEY) expect({ c, value: item[c] }).toEqual({ c, value: null });
    const boqs = (await (await run(`/${TOKENS.member}/records/boqs`, { headers: { accept: "application/json" } })).json()) as { items: Row[] };
    for (const item of boqs.items) expect(item.contract_value_override).toBeNull();
  });

  test("a member link may not filter or sort by a money column (that would recover the value)", async () => {
    const { run } = link();
    for (const q of ["?amount_gt=0", "?rate_lt=5", "?sort=rate", "?sort=-amount"]) {
      const res = await run(`/${TOKENS.member}/records/boq_lines${q}`, { headers: { accept: "application/json" } });
      expect({ q, status: res.status }).toEqual({ q, status: 400 });
    }
    expect((await run(`/${TOKENS.manager}/records/boq_lines?amount_gt=0`, { headers: { accept: "application/json" } })).status).toBe(200);
  });

  test("a member link has add_boq_lines and create_boq but not seal_boq; a manager link has all three", async () => {
    const { run } = link();
    const allowed = async (token: string) => ((await (await run(`/${token}/context`, { headers: { accept: "application/json" } })).json()) as { allowed_functions: string[] }).allowed_functions;
    const member = await allowed(TOKENS.member);
    expect(member).toEqual(expect.arrayContaining(["add_boq_lines", "create_boq", "create_boq_revision"]));
    expect(member).not.toContain("seal_boq");
    expect(await allowed(TOKENS.manager)).toEqual(expect.arrayContaining(["add_boq_lines", "create_boq", "seal_boq"]));
  });

  test("a member link cannot call seal_boq: /check answers 403 FUNCTION_NOT_ON_LINK and nothing is proposed; a manager link's check is valid", async () => {
    const { run } = link();
    const body = { function: "seal_boq", params: { boqId: "b1", controlTotals: { areas: {}, grand: 0 }, expectedLineCount: 0 } };
    const member = await run(`/${TOKENS.member}/check`, { method: "POST", body });
    expect(member.status).toBe(403);
    expect(((await member.json()) as { code: string }).code).toBe("FUNCTION_NOT_ON_LINK");
    const asDraft = await run(`/${TOKENS.member}/drafts`, { method: "POST", body });
    expect(asDraft.status).toBe(403);
    const manager = await run(`/${TOKENS.manager}/check`, { method: "POST", body });
    expect(manager.status).toBe(200);
    expect(((await manager.json()) as { valid: boolean }).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("AW-205: the executor's answers below the manager rank carry no money", () => {
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
  /** Every value of every key in `keys`, at any depth. */
  const valuesOf = (value: unknown, keys: ReadonlySet<string>, out: unknown[] = []): unknown[] => {
    if (Array.isArray(value)) value.forEach((v) => valuesOf(v, keys, out));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (keys.has(k)) out.push(v);
        valuesOf(v, keys, out);
      }
    }
    return out;
  };

  const withMoney = (): Row[] => zoomiesLines().map((l) => ({ ...l, materialCost: 10, labourCost: 20, equipmentCost: 5, vendorAmount: 100, budgetPercentage: 30 }));

  test("*** THE ROW: a member's create_boq answer has every money key null at every depth; the stored rows keep the numbers ***", async () => {
    const outcome = await run("create_boq", { title: "Zoomies BOQ", lineItems: withMoney() }, { role: "member", actorUserId: MEMBER });
    const record = recordOf(outcome);
    const shown = valuesOf(record, BOQ_MONEY_KEYS);
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.every((v) => v === null)).toBe(true);
    expect(record.financialsRedacted).toBe(true);
    // the lines are still listed, with their non-money fields
    expect((record.lineItems as Row[]).map((l) => l.itemCode).sort()).toEqual(zoomiesLines().map((l) => l.itemCode as string).sort());
    // stored rows are untouched by the redaction
    const stored = rowsOf(store, "construction_boq_line_items").find((l) => l.itemCode === "PLAY-1.01")!;
    expect([Number(stored.rate), Number(stored.amount), Number(stored.materialCost)]).toEqual([65000, 650000, 10]);
  });

  test("a manager's answer carries the numbers; a role that is absent or unknown is treated as below manager", async () => {
    const manager = recordOf(await run("create_boq", { title: "M", lineItems: withMoney() }));
    const line = (manager.lineItems as Row[]).find((l) => l.itemCode === "PLAY-1.01")!;
    expect([line.rate, line.amount]).toEqual(["65000", "650000"]);
    expect(manager.financialsRedacted).toBeUndefined();
    for (const role of [undefined, null, "viewer", "nonsense"]) {
      const r = recordOf(await run("create_boq", { title: `R ${String(role)}`, lineItems: withMoney() }, { role }));
      expect({ role, allNull: valuesOf(r, BOQ_MONEY_KEYS).every((v) => v === null) }).toEqual({ role, allNull: true });
    }
  });

  test("add_boq_lines answers with ids, codes and counts and NO money key at all, for every rank", async () => {
    const made = await run("create_boq", { title: "B" });
    const boqId = (made as { result: { id: string } }).result.id;
    let batchNo = 0;
    for (const [role, actorUserId] of [["member", MEMBER], ["manager", MANAGER], ["admin", MANAGER]] as const) {
      batchNo += 1;
      const lines = withMoney().map((l) => ({ ...l, itemCode: `${role}-${l.itemCode}`, parentItemCode: l.parentItemCode ? `${role}-${l.parentItemCode}` : undefined }));
      const record = recordOf(await run("add_boq_lines", { boqId, batchNo, lines }, { role, actorUserId }));
      const keys = keysDeep(record);
      for (const money of BOQ_MONEY_KEYS) expect({ role, money, present: keys.has(money) }).toEqual({ role, money, present: false });
      expect(record.accepted).toBe(6);
    }
  });

  test("seal_boq is refused below the manager rank before anything is read: no transaction opens, no amount is named, nothing is written", async () => {
    const made = await run("create_boq", { title: "B", lineItems: withMoney() });
    const boqId = (made as { result: { id: string } }).result.id;
    const before = snapshot();
    const transactions = store.transactions;
    const params = { boqId, controlTotals: { areas: { "Play Area": 1343445, "Vet Area": 252835 }, grand: 1596280 }, expectedLineCount: 6 };
    for (const role of ["member", "team_member", "viewer", undefined, null]) {
      const outcome = await run("seal_boq", params, { role, actorUserId: MEMBER });
      expect({ role, code: codeOf(outcome) }).toEqual({ role, code: "NOT_PERMITTED" });
      expect(JSON.stringify(outcome)).not.toMatch(/1343445|252835|1596280|650000/);
    }
    expect(store.transactions).toBe(transactions);
    expect(snapshot()).toBe(before);
    // and even with the totals wrong: the refusal is the same, so a member cannot probe the amounts through the mismatch answer
    const probe = await run("seal_boq", { ...params, controlTotals: { areas: {}, grand: 1 } }, { role: "member", actorUserId: MEMBER });
    expect(codeOf(probe)).toBe("NOT_PERMITTED");
  });

  test("withholdBoqMoney nulls every listed key at any depth, adds the marker below manager, and returns a manager's row as it is", () => {
    const row = { id: "b", contractValueOverride: "5", lineItems: [{ id: "l", rate: "1", amount: "2", nested: { rateContract: "3", note: "keep" } }], moneyView: { total: 9 } };
    expect(withholdBoqMoney("manager", row)).toBe(row);
    expect(withholdBoqMoney("member", row) as unknown).toEqual({
      id: "b", contractValueOverride: null, lineItems: [{ id: "l", rate: null, amount: null, nested: { rateContract: null, note: "keep" } }], moneyView: null, financialsRedacted: true,
    });
    // the input is not changed
    expect(row.lineItems[0].rate).toBe("1");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("AW-205: the executor's money keys and the record kinds' money columns cannot drift apart", () => {
  // computed on read by construction-boq-service.ts (withComputedRate, getBoqRow): they have no column, so no record kind lists them
  const COMPUTED = ["computedRate", "computedBudget", "contractValue", "moneyView", "costCoverage"];

  test("every money column of `boq_lines` and `boqs` is a key the executor nulls", () => {
    const columns = [...kind("boq_lines").money_columns, ...kind("boqs").money_columns].map(camel);
    expect(columns.length).toBeGreaterThan(10);
    for (const c of columns) expect({ c, nulled: BOQ_MONEY_KEYS.has(c) }).toEqual({ c, nulled: true });
  });

  test("every key the executor nulls is a column of those kinds or one of the five computed values", () => {
    const columns = new Set([...kind("boq_lines").money_columns, ...kind("boqs").money_columns].map(camel));
    for (const key of BOQ_MONEY_KEYS) expect({ key, known: columns.has(key) || COMPUTED.includes(key) }).toEqual({ key, known: true });
  });
});
