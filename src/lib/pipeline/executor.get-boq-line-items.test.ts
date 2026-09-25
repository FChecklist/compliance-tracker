/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-28 part 2, register row BR-407: the registry entry
// `get_boq_line_items` is read-only (not in WRITE_FUNCTION_IDS) and returns at
// most 50 line items, each with description and itemCode, plus a nextCursor.
//
// Also proven here, because they are what makes the entry safe to register:
//   - classify-only reports it as a read this pipeline can run
//     (writes:false, executable:true);
//   - a 153-line BOQ read at the default page size walks 50, 50, 50, 3 lines by
//     following each returned nextCursor, 153 distinct ids, nextCursor null on
//     the last page, whether BUILD001_BOQ_KEYSET_PAGINATION is on or off;
//   - a limit above 50 still returns at most 50, and the database is asked for
//     at most 51 rows (the keyset reader's limit + 1) per call;
//   - no project-side cost field leaves the executor, whatever the role, although
//     the stored rows carry them;
//   - the read is scoped to the task's org and project: a boqId of another
//     project or org is RECORD_NOT_FOUND, a tampered or foreign cursor is
//     REQUEST_REJECTED 400, and neither reads a line item;
//   - each call runs in ONE transaction, never nested (D-06).
//
// WHAT IS REAL: executor.ts, function-registry.ts, classify-only.ts,
// getProjectBoqLinePage() and the U-27 keyset reader and cursor codec it calls.
// The paging runs on PGlite (real Postgres in process, the U-27 test helper
// src/lib/services/__test-helpers__/boq-keyset-pglite.ts), so the keyset SQL is
// the real statement. WHAT IS FAKED: only @/lib/db/tenant-scoped. For the
// paging tests it is the PGlite helper's double (one real transaction per call,
// throws on nesting); for the classify-only test it is the U-28 part 1 store
// double (__test-helpers__/boq-store-double.ts), which is enough for a phrase
// lookup and needs no BOQ tables.
//
// Run: bun test --isolate src/lib/pipeline/executor.get-boq-line-items.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { PROJECT_SIDE_COST_FIELDS } from "@/lib/services/cost-visibility-service";
import { BOQ_KEYSET_PAGINATION_FLAG, encodeBoqLineCursor } from "@/lib/boq-line-keyset";
import {
  boqRow,
  createBoqPglite,
  fakeCuid,
  insertRows,
  lineRow,
  seededRandom,
} from "@/lib/services/__test-helpers__/boq-keyset-pglite";
import { fakeWithTenantContext, keysDeep, makeBoqStore, seedRows, type BoqStore } from "./__test-helpers__/boq-store-double";
import { normaliseForMatch } from "./classify";
import type { ExecutableTask, ExecutionOutcome } from "./executor";
import type { PipelineFailure } from "./error-codes";

const ORG = "org-u28b-a";
const OTHER_ORG = "org-u28b-x";
const PROJECT = "project-u28b-a";
const PROJECT_B = "project-u28b-b";
const PROJECT_X = "project-u28b-x";
const PROJECT_EMPTY = "project-u28b-empty";
/** The approved revision: the project's current BOQ, 153 lines (the largest live BOQ, 2026-09-25). */
const CURRENT = "boq-u28b-rev2";
/** The revision CURRENT supersedes. */
const OLDER = "boq-u28b-rev1";
/** An independent draft with a HIGHER version: "current" is the approved one, not the newest. */
const DRAFT = "boq-u28b-draft";
/** Same org, another project. */
const BOQ_B = "boq-u28b-project-b";
/** Another org. */
const BOQ_X = "boq-u28b-org-x";
const API_KEY = "apikey_1";
const FN = "get_boq_line_items";

// ---- the database seam ------------------------------------------------------
let backend: "pglite" | "store" = "pglite";
let h: Awaited<ReturnType<typeof createBoqPglite>>;
let store: BoqStore = makeBoqStore();
const storeTransaction = fakeWithTenantContext(() => store);

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: (ctx: unknown, fn: (db: any) => Promise<unknown>) =>
    backend === "pglite" ? h.withTenantContextDouble(ctx, fn) : storeTransaction(ctx, fn),
}));

let executeTask: typeof import("./executor").executeTask;
let functionWrites: typeof import("./executor").functionWrites;
let hasExecutor: typeof import("./executor").hasExecutor;
let EXECUTABLE_FUNCTION_IDS: typeof import("./executor").EXECUTABLE_FUNCTION_IDS;
let functionSpec: typeof import("./function-registry").functionSpec;
let WRITE_FUNCTION_IDS: typeof import("./function-registry").WRITE_FUNCTION_IDS;
let ALL_FUNCTION_SPECS: typeof import("./function-registry").ALL_FUNCTION_SPECS;
let classifyOnly: typeof import("./classify-only").classifyOnly;
let getProjectBoqLinePage: typeof import("@/lib/services/construction-boq-service").getProjectBoqLinePage;

/** The fixture's line ids per BOQ, and what each current line was stored with. */
const idsOf: Record<string, string[]> = { [CURRENT]: [], [OLDER]: [], [DRAFT]: [], [BOQ_B]: [], [BOQ_X]: [] };
const storedLine = new Map<string, { itemCode: string; description: string }>();

beforeAll(async () => {
  h = await createBoqPglite();
  ({ executeTask, functionWrites, hasExecutor, EXECUTABLE_FUNCTION_IDS } = await import("./executor"));
  ({ functionSpec, WRITE_FUNCTION_IDS, ALL_FUNCTION_SPECS } = await import("./function-registry"));
  ({ classifyOnly } = await import("./classify-only"));
  ({ getProjectBoqLinePage } = await import("@/lib/services/construction-boq-service"));

  await insertRows(h.pg, "construction_boqs", [
    boqRow({ id: OLDER, org_id: ORG, project_id: PROJECT, version: 1, status: "superseded", created_at: "2026-09-01T00:00:00Z" }),
    boqRow({ id: CURRENT, org_id: ORG, project_id: PROJECT, version: 2, parent_boq_id: OLDER, status: "approved", created_at: "2026-09-02T00:00:00Z" }),
    boqRow({ id: DRAFT, org_id: ORG, project_id: PROJECT, version: 3, status: "draft", created_at: "2026-09-03T00:00:00Z" }),
    boqRow({ id: BOQ_B, org_id: ORG, project_id: PROJECT_B, version: 1, status: "approved", created_at: "2026-09-03T00:00:00Z" }),
    boqRow({ id: BOQ_X, org_id: OTHER_ORG, project_id: PROJECT_X, version: 1, status: "approved", created_at: "2026-09-03T00:00:00Z" }),
  ]);

  // Random cuid-shaped ids plus upper-case and uuid-shaped ones, so byte order
  // is neither insertion order nor a case-insensitive order. Every current line
  // stores project-side figures, so the redaction has something to remove.
  const random = seededRandom(407);
  const special = ["LA-01", "Zz-top", "0f8fad5b-d9cb-469f-a165-70867728950e"];
  const lines: Record<string, unknown>[] = [];
  for (let k = 0; k < 153; k++) {
    const id = k < special.length ? special[k] : fakeCuid(random);
    const itemCode = `CIV-${String(k).padStart(3, "0")}`;
    const description = `Line ${k}: supply and fix 12 mm gypsum board, bay ${k}`;
    idsOf[CURRENT].push(id);
    storedLine.set(id, { itemCode, description });
    lines.push(
      lineRow({
        id,
        boq_id: CURRENT,
        org_id: ORG,
        item_code: itemCode,
        description,
        qty_project: "10",
        rate_project: "700",
        qty_contract: "10",
        rate_contract: "845",
      })
    );
  }
  const others: Array<[string, string, number, string]> = [
    [OLDER, ORG, 12, "Older revision line"],
    [DRAFT, ORG, 4, "Draft line"],
    [BOQ_B, ORG, 3, "PROJECT-B-LINE"],
    [BOQ_X, OTHER_ORG, 3, "ORG-X-SECRET"],
  ];
  for (const [boqId, orgId, count, description] of others) {
    for (let k = 0; k < count; k++) {
      const id = fakeCuid(random);
      idsOf[boqId].push(id);
      lines.push(lineRow({ id, boq_id: boqId, org_id: orgId, item_code: `OT-${k}`, description, qty_project: "1", rate_project: "1" }));
    }
  }
  await insertRows(h.pg, "construction_boq_line_items", lines);
}, 60_000);

let silenced: Array<{ mockRestore: () => void }> = [];
let flagBefore: string | undefined;
beforeEach(() => {
  backend = "pglite";
  flagBefore = process.env[BOQ_KEYSET_PAGINATION_FLAG];
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
  if (flagBefore === undefined) delete process.env[BOQ_KEYSET_PAGINATION_FLAG];
  else process.env[BOQ_KEYSET_PAGINATION_FLAG] = flagBefore;
});
afterAll(async () => {
  await h.pg.close();
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

// ---- helpers -----------------------------------------------------------------
type Line = Record<string, unknown> & { id: string; itemCode: string; description: string };
type Page = { boqId: string | null; lineItems: Line[]; nextCursor: string | null };

function task(params: Record<string, unknown>, overrides: Partial<ExecutableTask> = {}): ExecutableTask {
  return { orgId: ORG, userId: API_KEY, projectId: PROJECT, functionId: FN, params, role: "member", ...overrides };
}

async function read(params: Record<string, unknown>, overrides: Partial<ExecutableTask> = {}): Promise<Page> {
  const outcome = await executeTask(task(params, overrides));
  if (!outcome.success) throw new Error(`expected a page, got ${JSON.stringify(outcome.failure)}`);
  return outcome.result as Page;
}

async function refused(params: Record<string, unknown>, overrides: Partial<ExecutableTask> = {}) {
  const outcome: ExecutionOutcome = await executeTask(task(params, overrides));
  if (outcome.success) throw new Error("expected a refusal");
  return outcome.failure;
}

/** Every page of one read, following each returned nextCursor, with the database traffic it caused. */
async function walk(params: Record<string, unknown> = {}, overrides: Partial<ExecutableTask> = {}) {
  const logStart = h.queryLog.length;
  const callsBefore = h.stats.calls;
  const pages: Page[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const page: Page = await read(cursor === null ? params : { ...params, cursor }, overrides);
    pages.push(page);
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  const lineStatements = h.queryLog.slice(logStart).filter((q) => q.sql.includes("construction_boq_line_items"));
  return {
    pages,
    sizes: pages.map((p) => p.lineItems.length),
    ids: pages.flatMap((p) => p.lineItems.map((l) => l.id)),
    transactions: h.stats.calls - callsBefore,
    lineStatements,
  };
}

/** Line-item statements sent to the database since `from` (the keyset read is the only one this entry may send). */
function lineStatementsSince(from: number) {
  return h.queryLog.slice(from).filter((q) => q.sql.includes("construction_boq_line_items"));
}

const byteOrder = (ids: string[]) => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** The shape part 1 (BR-406/BR-408) gives a malformed request, and a BOQ of another project. */
const REJECTED: PipelineFailure = { code: "REQUEST_REJECTED", missing: [], context: { status: 400, functionId: FN }, picker: "none" };
const NOT_FOUND: PipelineFailure = { code: "RECORD_NOT_FOUND", missing: ["boqVersion"], picker: "none" };

// ---- (a) read-only ------------------------------------------------------------
describe("BR-407 (a): get_boq_line_items is a registered READ", () => {
  test("not in WRITE_FUNCTION_IDS, functionWrites() is false, and it has an executor in the candidate set", () => {
    expect(WRITE_FUNCTION_IDS.has(FN)).toBe(false);
    expect(functionWrites(FN)).toBe(false);
    expect(hasExecutor(FN)).toBe(true);
    expect(EXECUTABLE_FUNCTION_IDS).toContain(FN);
  });

  test("its registry spec: a project-scoped ask with no required parameter and no card, after the dashboard", () => {
    const spec = functionSpec(FN)!;
    expect([spec.kind, spec.writes, spec.requiresProject, spec.module, spec.label]).toEqual(["ask", false, true, "scope", "View BOQ line items"]);
    expect(spec.requiredParams).toEqual([]);
    expect(spec.card).toBeUndefined();
    // The MCP link's unmatched `ask` lists reads in registry order; the dashboard stays first.
    const ids = ALL_FUNCTION_SPECS.map((s) => s.functionId);
    expect(ids.indexOf(FN)).toBeGreaterThan(ids.indexOf("get_construction_project_dashboard"));
  });

  test("classify-only resolves a phrase to it and reports writes:false, executable:true, executed:false, writing nothing", async () => {
    backend = "store";
    store = makeBoqStore();
    const phrase = "show the boq lines";
    seedRows(store, "projects", [{ id: PROJECT, orgId: ORG, name: "Cedar Heights" }]);
    seedRows(store, "phrase_map", [{ orgId: ORG, normalisedPhrase: normaliseForMatch(phrase), functionId: FN, fixedParams: null, promotedAt: new Date() }]);
    const before = JSON.stringify(store.tables);

    const result = await classifyOnly({ orgId: ORG, userId: API_KEY, mode: "Projects", projectId: PROJECT, rawInput: phrase });

    expect(result.executed).toBe(false);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ functionId: FN, verdict: "chat", level: 0, source: "phrase_map", writes: false, executable: true });
    expect(JSON.stringify(store.tables)).toBe(before);
    expect(store.unparsed).toEqual([]);
  });
});

// ---- (b) the 153-line walk ------------------------------------------------------
describe("BR-407 (b): a 153-line BOQ at the default page size walks 50, 50, 50, 3", () => {
  test("*** THE ROW: 153 distinct ids in (boq_id, id) byte order, each page <= 50, nextCursor null only on the last ***", async () => {
    const run = await walk();

    expect(run.sizes).toEqual([50, 50, 50, 3]);
    expect(new Set(run.ids).size).toBe(153);
    expect(run.ids).toEqual(byteOrder(idsOf[CURRENT]));
    // No boqId named: the project's CURRENT (approved) BOQ, not the newer draft, on every page.
    expect(run.pages.map((p) => p.boqId)).toEqual([CURRENT, CURRENT, CURRENT, CURRENT]);
    expect(run.pages.map((p) => p.nextCursor === null)).toEqual([false, false, false, true]);
    // The database was asked for at most limit + 1 rows each time, never for the whole BOQ.
    expect(run.lineStatements.map((q) => q.rows)).toEqual([51, 51, 51, 3]);
    expect(run.lineStatements.every((q) => q.sql.includes('COLLATE "C"'))).toBe(true);
  });

  test("the same walk with boqId named gives the same pages", async () => {
    const run = await walk({ boqId: CURRENT });

    expect(run.sizes).toEqual([50, 50, 50, 3]);
    expect(run.ids).toEqual(byteOrder(idsOf[CURRENT]));
  });

  test("the same walk whether BUILD001_BOQ_KEYSET_PAGINATION is on, off or unset", async () => {
    const results: string[][] = [];
    for (const flag of ["1", "0", undefined]) {
      if (flag === undefined) delete process.env[BOQ_KEYSET_PAGINATION_FLAG];
      else process.env[BOQ_KEYSET_PAGINATION_FLAG] = flag;
      const run = await walk();
      expect(run.sizes).toEqual([50, 50, 50, 3]);
      results.push(run.ids);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  test("another BOQ of the same project, named by boqId, is one page; a project with no BOQ is an empty page", async () => {
    const older = await read({ boqId: OLDER });
    expect(older.boqId).toBe(OLDER);
    expect(older.lineItems.map((l) => l.id)).toEqual(byteOrder(idsOf[OLDER]));
    expect(older.nextCursor).toBeNull();

    expect(await read({}, { projectId: PROJECT_EMPTY })).toEqual({ boqId: null, lineItems: [], nextCursor: null });
  });
});

// ---- (c) the cap ------------------------------------------------------------------
describe("BR-407 (c): a limit above 50 still returns at most 50", () => {
  test("limit 51, 200, 500, \"75\" and 10^9 each return 50 lines, and the database is asked for 51 rows", async () => {
    for (const limit of [51, 200, 500, "75", 1_000_000_000]) {
      const logStart = h.queryLog.length;
      const page = await read({ limit });
      expect(page.lineItems).toHaveLength(50);
      expect(page.nextCursor).not.toBeNull();
      expect(lineStatementsSince(logStart).map((q) => q.rows)).toEqual([51]);
    }
  });

  test("a walk asking for 200 per page still walks 50, 50, 50, 3", async () => {
    const run = await walk({ limit: 200 });

    expect(run.sizes).toEqual([50, 50, 50, 3]);
    expect(new Set(run.ids).size).toBe(153);
  });

  test("a smaller limit is honoured: 7 (or \"7\") returns 7 lines", async () => {
    expect((await read({ limit: 7 })).lineItems).toHaveLength(7);
    expect((await read({ limit: "7" })).lineItems).toHaveLength(7);
  });

  test("a limit that is not a whole number from 1 up is REQUEST_REJECTED 400, before any transaction", async () => {
    for (const limit of [0, -1, 1.5, "0", "abc", "1e2", "-5", true, { n: 5 }, Number.POSITIVE_INFINITY]) {
      const callsBefore = h.stats.calls;
      expect(await refused({ limit })).toEqual(REJECTED);
      expect(h.stats.calls).toBe(callsBefore);
    }
  });
});

// ---- (d) what each line carries ----------------------------------------------------
describe("BR-407 (d): description and itemCode on every line", () => {
  test("every one of the 153 lines carries its stored id, itemCode and description, and the contract side a reader needs", async () => {
    const run = await walk();

    const lines = run.pages.flatMap((p) => p.lineItems);
    expect(lines).toHaveLength(153);
    for (const line of lines) {
      expect(typeof line.itemCode).toBe("string");
      expect(line.itemCode.length).toBeGreaterThan(0);
      expect(typeof line.description).toBe("string");
      expect(line.description.length).toBeGreaterThan(0);
      expect({ itemCode: line.itemCode, description: line.description }).toEqual(storedLine.get(line.id)!);
      expect([line.boqId, line.unit, line.quantity, line.rate, line.amount]).toEqual([CURRENT, "m2", "10", "845", "8450"]);
    }
  });
});

// ---- (e) no project-side cost field -----------------------------------------------
describe("BR-407 (e): project-side cost fields never leave the executor", () => {
  test("absent for every role, although the stored rows carry them and the unredacted service read returns them", async () => {
    const stored = await h.pg.query<{ n: number }>(
      "select count(*)::int as n from compliance.construction_boq_line_items where boq_id = $1 and qty_project is not null and rate_project is not null",
      [CURRENT]
    );
    expect(stored.rows[0].n).toBe(153);
    // The service's own page still has them (so the executor's redaction is what removes them).
    const raw = await getProjectBoqLinePage({ orgId: ORG }, PROJECT, { limit: 50 });
    expect(keysDeep(raw).has("qtyProject")).toBe(true);
    expect(keysDeep(raw).has("projectValue")).toBe(true);

    for (const role of ["member", "manager", "admin", undefined, null]) {
      const page = await read({}, { role });
      const shipped = keysDeep(page);
      for (const field of PROJECT_SIDE_COST_FIELDS) expect(shipped.has(field)).toBe(false);
      // The contract side stays (cost-visibility-service's rule).
      expect(shipped.has("rate")).toBe(true);
      expect(shipped.has("amount")).toBe(true);
    }
  });
});

// ---- (f) scope: another project's BOQ, a tampered or foreign cursor -------------------
describe("BR-407 (f): the read is scoped to the task's org and project", () => {
  test("a boqId of another project, another org, or none at all is RECORD_NOT_FOUND, and no line item is read", async () => {
    for (const boqId of [BOQ_B, BOQ_X, "no-such-boq"]) {
      const logStart = h.queryLog.length;
      expect(await refused({ boqId })).toEqual(NOT_FOUND);
      expect(lineStatementsSince(logStart)).toEqual([]);
    }
  });

  test("a boqId of another project with that BOQ's own cursor is still RECORD_NOT_FOUND", async () => {
    const cursor = encodeBoqLineCursor({ boqId: BOQ_B, id: idsOf[BOQ_B][0] });
    const logStart = h.queryLog.length;
    expect(await refused({ boqId: BOQ_B, cursor })).toEqual(NOT_FOUND);
    expect(lineStatementsSince(logStart)).toEqual([]);
  });

  test("a tampered cursor is REQUEST_REJECTED 400, before any transaction opens", async () => {
    const good = (await read({})).nextCursor!;
    const decoded = JSON.parse(Buffer.from(good, "base64url").toString("utf8")) as { b: string; i: string };
    const tampered = [
      "not a cursor",
      good + "=",
      good.slice(0, -2),
      Buffer.from(JSON.stringify({ i: decoded.i, b: decoded.b })).toString("base64url"),
      Buffer.from(JSON.stringify({ ...decoded, o: ORG })).toString("base64url"),
      Buffer.from(JSON.stringify({ b: decoded.b })).toString("base64url"),
      Buffer.from(JSON.stringify({ b: 1, i: 2 })).toString("base64url"),
    ];
    for (const cursor of tampered) {
      const callsBefore = h.stats.calls;
      expect(await refused({ cursor })).toEqual(REJECTED);
      expect(h.stats.calls).toBe(callsBefore);
    }
    // Not a string at all.
    expect(await refused({ cursor: 12345 })).toEqual(REJECTED);
    expect(await refused({ cursor: { b: CURRENT, i: decoded.i } })).toEqual(REJECTED);
  });

  test("a well-formed cursor into another project's or org's BOQ is REQUEST_REJECTED 400, and that BOQ's lines are never read", async () => {
    for (const [boqId, lineId] of [[BOQ_B, idsOf[BOQ_B][0]], [BOQ_X, idsOf[BOQ_X][0]]]) {
      const logStart = h.queryLog.length;
      const outcome = await executeTask(task({ cursor: encodeBoqLineCursor({ boqId, id: lineId }) }));
      expect(outcome.success).toBe(false);
      if (outcome.success) return;
      expect(outcome.failure).toEqual(REJECTED);
      expect(lineStatementsSince(logStart)).toEqual([]);
      expect(JSON.stringify(outcome)).not.toContain("PROJECT-B-LINE");
      expect(JSON.stringify(outcome)).not.toContain("ORG-X-SECRET");
    }
  });

  test("a cursor of one BOQ of this project sent with boqId naming another is REQUEST_REJECTED 400", async () => {
    const cursor = (await read({})).nextCursor!;
    expect(await refused({ boqId: OLDER, cursor })).toEqual(REJECTED);
  });

  test("a boqId that is not a string is REQUEST_REJECTED 400, never read as 'no boqId'", async () => {
    expect(await refused({ boqId: 42 })).toEqual(REJECTED);
    expect(await refused({ boqId: [CURRENT] })).toEqual(REJECTED);
  });

  test("params.projectId naming another project is PROJECT_NOT_REACHABLE; no project at all is PROJECT_REQUIRED", async () => {
    expect(await refused({ projectId: PROJECT_B })).toEqual({ code: "PROJECT_NOT_REACHABLE", missing: ["projectId"], picker: "project" });
    expect(await refused({}, { projectId: null })).toEqual({ code: "PROJECT_REQUIRED", missing: ["projectId"], picker: "project" });
  });

  test("the task's org decides: another org's task on this project's id reads nothing of this org", async () => {
    expect(await read({}, { orgId: OTHER_ORG })).toEqual({ boqId: null, lineItems: [], nextCursor: null });
    expect(await refused({ boqId: CURRENT }, { orgId: OTHER_ORG })).toEqual(NOT_FOUND);
  });
});

// ---- (g) one transaction per call ----------------------------------------------------
describe("BR-407 (g): each call runs in ONE transaction, never nested", () => {
  test("a four-page walk opens four transactions, one per call, and never two at once", async () => {
    const depthBefore = h.stats.maxDepth;
    const run = await walk();

    expect(run.transactions).toBe(4);
    // The PGlite double throws on a nested withTenantContext, so nesting would have failed the walk itself.
    expect(Math.max(depthBefore, h.stats.maxDepth)).toBe(1);
  });

  test("a named boqId and a refused boqId are also one transaction each", async () => {
    for (const params of [{ boqId: CURRENT }, { boqId: BOQ_B }]) {
      const callsBefore = h.stats.calls;
      await executeTask(task(params));
      expect(h.stats.calls - callsBefore).toBe(1);
    }
  });
});
