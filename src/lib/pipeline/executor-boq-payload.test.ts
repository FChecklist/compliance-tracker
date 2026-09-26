/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-04, register row AW-202: create_boq on the link is a level-2 draft; lineItems is a DECLARED parameter; the body cap is
// 64 KB for the BOQ functions and 8 KB for every other function, and both come from the generated function policy, not from a list in the
// handler. Also create_boq's retry key and create_boq_revision's declared optional parameters.
//
// PROVEN HERE
//   registry and policy (the committed generated JSON)
//     - create_boq: registry requires only a project and a title (a title-only BOQ stays allowed, R-03); lineItems and idempotency_key are
//       declared; on links it is level 2, rank 2, money sensitive, and the LINK requires idempotency_key;
//     - create_boq_revision declares lineItems, sourceChangeOrderId and allowScopeReductionOverride;
//     - exactly create_boq, add_boq_lines and seal_boq carry a body limit above 8 KB, and it is 64 KB; the limit is data in the generated
//       registry, read by bodyLimitFor();
//   the link, through the REAL handler (supabase/functions/ai-work-link/handler.ts)
//     - a create_boq check with the 71-line ZOOMIES payload (about 14 KB: over 8 KB) is valid; the same size for any other function is 413;
//     - up to 64 KB is accepted for the three BOQ functions on /check, and 413 above it, with the size in the message; the same holds on the
//       MCP endpoint's check_change; a body that is not JSON is still 400 under 8 KB and 413 over;
//     - create_boq without a retry key is not valid and names it; a title-only create_boq with a key is valid; it is a draft, never direct;
//     - create_boq_revision accepts its three optional parameters on /check;
//   the executor, over the store double
//     - a title-only BOQ, and a BOQ with lineItems, are created and re-read; the answer of a call below the manager rank carries no money;
//     - the retry key: the same key on the same project is ONE BOQ (the second call answers the first BOQ, nothing is written), another key is
//       another BOQ, the same key on another project is its own BOQ, and a bad key is refused with nothing written;
//     - the key is recorded with the BOQ: if the BOQ is rolled back (a bad line, or the ledger write failing) no key is left behind, so the
//       corrected call with the same key creates the BOQ.
//
// WHAT IS REAL: executor.ts, function-registry.ts, the generator's committed output, the Edge handler and mcp.ts, createBoq(), logActivity().
// WHAT IS FAKED: only @/lib/db/tenant-scoped (boq-store-double.ts) and the link's database (awl-edge-fake.ts).
//
// Run: bun test --isolate src/lib/pipeline/executor-boq-payload.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { failNext, fakeWithTenantContext, rowsOf, type BoqStore, type Row } from "./__test-helpers__/boq-store-double";
import { API_KEY, flatLines, makeStore, MANAGER, MEMBER, ORG, PROJECT_A, PROJECT_B } from "./__test-helpers__/boq-payload-fixtures";
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler";
import { bodyLimitFor } from "../../../supabase/functions/ai-work-link/api-definition";
import { LIMITS } from "../../../supabase/functions/_shared/ai-link/core";
import { TOKENS, makeFake, req, testConfig } from "../services/__test-helpers__/awl-edge-fake";

let store: BoqStore;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }));

let executeTask: typeof import("./executor").executeTask;
let functionSpec: typeof import("./function-registry").functionSpec;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ functionSpec } = await import("./function-registry"));
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

type Reg = {
  function_id: string; link_level: number | null; min_role_rank: number; money_sensitive: boolean; body_max_bytes?: number
  declared_params: string[]; required_params: Array<{ name: string; any_of: string[] }>; id_params: string[]
};
const REGISTRY = JSON.parse(readFileSync(new URL("../../../supabase/functions/ai-work-link/function-registry.generated.json", import.meta.url), "utf8")) as Reg[];
const fnRow = (id: string) => REGISTRY.find((f) => f.function_id === id)!;

/** The ZOOMIES-sized payload: 71 lines with descriptions of the length a real BOQ has. */
function zoomiesPayload(): Row[] {
  return flatLines(71).map((l, i) => ({ ...l, description: `Supply, fabricate and install item ${i + 1} as per the approved shop drawings, complete with fixings and finishes` }));
}
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

// ---------------------------------------------------------------------------------------------------------------------------------
describe("AW-202: registry and generated policy", () => {
  test("create_boq: the registry needs a project and a title only (title-only stays allowed), and declares lineItems and idempotency_key", () => {
    const spec = functionSpec("create_boq")!;
    expect(spec.requiredParams.map((p) => p.name)).toEqual(["projectId", "title"]);
    expect(spec.optionalParams).toEqual(expect.arrayContaining(["lineItems", "idempotency_key"]));
    const row = fnRow("create_boq");
    expect(row.declared_params).toEqual(expect.arrayContaining(["projectId", "title", "lineItems", "idempotency_key"]));
  });

  test("on links create_boq is a level-2 draft at rank 2, money sensitive, and the link requires a retry key", () => {
    const row = fnRow("create_boq");
    expect({ level: row.link_level, rank: row.min_role_rank, money: row.money_sensitive }).toEqual({ level: 2, rank: 2, money: true });
    expect(row.required_params.map((p) => p.name)).toEqual(["projectId", "title", "idempotency_key"]);
    expect(row.required_params[2].any_of).toEqual(["idempotency_key"]);
  });

  test("create_boq_revision declares lineItems, sourceChangeOrderId and allowScopeReductionOverride, which BR-408's executor already forwards", () => {
    expect(fnRow("create_boq_revision").declared_params).toEqual(expect.arrayContaining(["lineItems", "sourceChangeOrderId", "allowScopeReductionOverride"]));
    expect(fnRow("create_boq_revision").id_params).toContain("sourceChangeOrderId");
  });

  test("exactly create_boq, add_boq_lines and seal_boq may take more than 8 KB, and it is 64 KB; the limit is in the generated data", () => {
    const large = REGISTRY.filter((f) => f.body_max_bytes !== undefined);
    expect(large.map((f) => [f.function_id, f.body_max_bytes]).sort()).toEqual([["add_boq_lines", 65536], ["create_boq", 65536], ["seal_boq", 65536]]);
    expect(LIMITS.bodyMaxBytes).toBe(8192);
    expect(LIMITS.bodyMaxBytesCeiling).toBe(65536);
    for (const id of ["create_boq", "add_boq_lines", "seal_boq"]) expect(bodyLimitFor(id)).toBe(65536);
    for (const f of REGISTRY.filter((f) => f.body_max_bytes === undefined && f.link_level !== null)) expect({ id: f.function_id, cap: bodyLimitFor(f.function_id) }).toEqual({ id: f.function_id, cap: 8192 });
    // a function that is not on links, a name outside the registry and a non-string get the default
    for (const id of ["create_project", "no_such_function", "", undefined, null, 5, {}]) expect(bodyLimitFor(id)).toBe(8192);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("AW-202: the link, through the real handler", () => {
  function link() {
    const fake = makeFake({ writesEnabled: true });
    const run = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc: fake.rpc, config: testConfig(), log: () => {} });
    const check = (token: string, body: unknown) => run(`/${token}/check`, { method: "POST", body });
    return { fake, run, check };
  }
  const checkOf = async (r: Response) => (await r.json()) as { valid: boolean; missing: string[]; problems: string[]; level: number; will_execute_directly: boolean; error?: string };

  test("*** THE ROW: the 71-line ZOOMIES payload (over 8 KB) is a valid create_boq check on a link ***", async () => {
    const { check } = link();
    const params = { title: "Zoomies BOQ", idempotency_key: "zoomies-2026-09-26-a", lineItems: zoomiesPayload() };
    const body = { function: "create_boq", params };
    expect(bytes(body)).toBeGreaterThan(LIMITS.bodyMaxBytes);
    expect(bytes(body)).toBeLessThan(LIMITS.bodyMaxBytesCeiling);
    const res = await check(TOKENS.manager, body);
    expect(res.status).toBe(200);
    expect(await checkOf(res)).toMatchObject({ valid: true, missing: [], problems: [], level: 2, will_execute_directly: false });
  });

  test("the same size is 413 for a function whose policy gives no more than 8 KB, and the message says 8 KB", async () => {
    const { check } = link();
    for (const [fn, params] of [
      ["record_work_progress", { itemCode: "EX-01", percent: 10, remarks: "x".repeat(9000) }],
      ["create_boq_revision", { boqId: "b1", lineItems: zoomiesPayload() }],
      ["create_meeting", { title: "x".repeat(9000), scheduledAt: "2026-10-01T10:00:00Z" }],
    ] as Array<[string, Row]>) {
      const res = await check(TOKENS.manager, { function: fn, params });
      expect({ fn, status: res.status }).toEqual({ fn, status: 413 });
      expect((await checkOf(res)).error).toContain("8 KB");
    }
  });

  test("the three BOQ functions take up to 64 KB and are 413 above it; the message says 64 KB", async () => {
    const { check } = link();
    const under = (n: number) => ({ pad: "x".repeat(n) });
    for (const fn of ["create_boq", "add_boq_lines", "seal_boq"]) {
      const okBody = { function: fn, params: { title: "T", idempotency_key: "k", boqId: "b", batchNo: 1, lines: [], controlTotals: { areas: {}, grand: 0 }, expectedLineCount: 0 }, ...under(60000) };
      expect(bytes(okBody)).toBeLessThan(65536);
      const ok = await check(TOKENS.manager, okBody);
      expect({ fn, status: ok.status }).toEqual({ fn, status: 200 });
      const over = await check(TOKENS.manager, { ...okBody, ...under(66000) });
      expect({ fn, status: over.status }).toEqual({ fn, status: 413 });
      expect((await checkOf(over)).error).toContain("64 KB");
    }
  });

  test("the params of a large check are held to the function's own limit too (the handler and checkChange agree)", async () => {
    const { check } = link();
    const res = await check(TOKENS.manager, { function: "create_boq", params: { title: "T", idempotency_key: "k", lineItems: [{ description: "x".repeat(70000), unit: "nos" }] } });
    expect(res.status).toBe(413);
  });

  test("a body that is not JSON is 400 under 8 KB and 413 over it; an empty body is an empty object (no function named: 403)", async () => {
    const { check, run } = link();
    expect((await check(TOKENS.manager, "{nope")).status).toBe(400);
    expect((await check(TOKENS.manager, "{" + "x".repeat(9000))).status).toBe(413);
    expect((await check(TOKENS.manager, "[" + "1,".repeat(6000) + "1]")).status).toBe(413);
    expect((await check(TOKENS.manager, "[1]")).status).toBe(400);
    // an empty body reads as {}: not a body error, but no function is named, so the scope rule answers 403
    expect((await run(`/${TOKENS.manager}/check`, { method: "POST" })).status).toBe(403);
  });

  test("create_boq without a retry key is not valid and names it; a title-only create_boq with a key is valid (R-03)", async () => {
    const { check } = link();
    const noKey = await checkOf(await check(TOKENS.manager, { function: "create_boq", params: { title: "Zoomies BOQ" } }));
    expect(noKey).toMatchObject({ valid: false, missing: ["idempotency_key"] });
    const titleOnly = await checkOf(await check(TOKENS.manager, { function: "create_boq", params: { title: "Zoomies BOQ", idempotency_key: "k-1" } }));
    expect(titleOnly).toMatchObject({ valid: true, missing: [], problems: [] });
    const noTitle = await checkOf(await check(TOKENS.manager, { function: "create_boq", params: { idempotency_key: "k-1" } }));
    expect(noTitle.missing).toEqual(["title"]);
  });

  test("create_boq is a draft: a link may not run it directly, it goes to /drafts for the person's confirmation", async () => {
    const { run } = link();
    const res = await run(`/${TOKENS.manager}/actions`, { method: "POST", body: { function: "create_boq", params: { title: "T", idempotency_key: "k" } } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("LEVEL_NOT_ALLOWED");
  });

  test("an undeclared parameter is still reported (the link drops nothing silently): line_items is not lineItems", async () => {
    const { check } = link();
    const res = await checkOf(await check(TOKENS.manager, { function: "create_boq", params: { title: "T", idempotency_key: "k", line_items: [] } }));
    expect(res.valid).toBe(false);
    expect(res.problems.join(" ")).toContain("Unknown parameter line_items");
  });

  test("create_boq_revision accepts lineItems, sourceChangeOrderId and allowScopeReductionOverride on /check", async () => {
    const { check } = link();
    const res = await checkOf(
      await check(TOKENS.manager, { function: "create_boq_revision", params: { boqId: "b1", title: "Rev 2", lineItems: flatLines(3), sourceChangeOrderId: "co-1", allowScopeReductionOverride: false } })
    );
    expect(res).toMatchObject({ valid: true, problems: [], level: 2 });
  });

  test("the MCP endpoint's check_change follows the same limits: a large create_boq check passes, a large record_work_progress is 413", async () => {
    const { run } = link();
    const call = (name: string, args: unknown) =>
      run(`/${TOKENS.manager}`, { method: "POST", headers: { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
    const big = await call("check_change", { function: "create_boq", params: { title: "T", idempotency_key: "k", lineItems: zoomiesPayload() } });
    expect(big.status).toBe(200);
    const text = ((await big.json()) as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    expect(text).toContain('"valid":true');
    for (const name of ["check_change", "propose_change"]) {
      const refused = await call(name, { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10, remarks: "x".repeat(9000) } });
      expect({ name, status: refused.status }).toEqual({ name, status: 413 });
    }
    // another tool never gets the larger body, even with a large function named in it
    const search = await call("search", { query: "x".repeat(9000), function: "create_boq" });
    expect(search.status).toBe(413);
    // and nothing over 64 KB, for any tool
    const huge = await call("check_change", { function: "create_boq", params: { title: "x".repeat(70000), idempotency_key: "k" } });
    expect(huge.status).toBe(413);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("AW-202: the executor's create_boq", () => {
  type Task = import("./executor").ExecutableTask;
  type Outcome = Awaited<ReturnType<typeof executeTask>>;
  const create = (params: Row, overrides: Partial<Task> = {}): Promise<Outcome> =>
    executeTask({ orgId: ORG, userId: API_KEY, projectId: PROJECT_A, functionId: "create_boq", params, actorUserId: MANAGER, role: "manager", ...overrides });
  const codeOf = (o: Outcome) => (o.success ? "OK" : o.failure.code);
  const idOf = (o: Outcome) => (o as { result: { id: string } }).result.id;
  const boqs = () => rowsOf(store, "construction_boqs");
  const linesOf = (boqId: unknown) => rowsOf(store, "construction_boq_line_items").filter((l) => l.boqId === boqId);
  const keyRows = () => rowsOf(store, "audit_logs").filter((r) => r.action === "construction_boq.created_with_key");
  const snapshot = () => JSON.stringify(store.tables);

  test("a title-only BOQ is created (R-03) and a BOQ with lineItems keeps every line, each re-read from the store", async () => {
    const empty = await create({ title: "Empty BOQ" });
    expect(codeOf(empty)).toBe("OK");
    expect(linesOf(idOf(empty))).toHaveLength(0);
    const lines = flatLines(30);
    const full = await create({ title: "Full BOQ", lineItems: lines });
    expect(linesOf(idOf(full))).toHaveLength(30);
    expect(boqs()).toHaveLength(2);
    expect(boqs().every((b) => b.projectId === PROJECT_A && b.createdById === MANAGER && b.version === 1)).toBe(true);
  });

  test("*** THE ROW: the same retry key is ONE BOQ; the second call answers the first and writes nothing ***", async () => {
    const first = await create({ title: "Zoomies BOQ", lineItems: flatLines(5), idempotency_key: "zoomies-a" });
    const stored = snapshot();
    const second = await create({ title: "Zoomies BOQ", lineItems: flatLines(5), idempotency_key: "zoomies-a" });
    expect(codeOf(second)).toBe("OK");
    expect(idOf(second)).toBe(idOf(first));
    expect(boqs()).toHaveLength(1);
    expect(linesOf(idOf(first))).toHaveLength(5);
    expect(keyRows()).toHaveLength(1);
    expect(snapshot()).toBe(stored);
    // without a key, a repeated call is two BOQs: this is what the key is for
    await create({ title: "No key" });
    await create({ title: "No key" });
    expect(boqs()).toHaveLength(3);
  });

  test("another key is another BOQ; the same key on another project is its own BOQ; the key is recorded under the person", async () => {
    const a = await create({ title: "A", idempotency_key: "k-1" });
    const b = await create({ title: "B", idempotency_key: "k-2" });
    const c = await create({ title: "C", idempotency_key: "k-1" }, { projectId: PROJECT_B });
    expect(new Set([idOf(a), idOf(b), idOf(c)]).size).toBe(3);
    expect(keyRows()).toHaveLength(3);
    expect(keyRows().find((r) => r.entityId === `${PROJECT_A}:k-1`)).toMatchObject({ entityType: "construction_boq_key", userId: MANAGER, actorName: "Asha Manager", orgId: ORG });
    expect(JSON.parse(String(keyRows().find((r) => r.entityId === `${PROJECT_A}:k-1`)!.details))).toEqual({ boqId: idOf(a) });
  });

  test("a key that is present but not usable is refused with nothing written", async () => {
    const before = snapshot();
    for (const key of [5, "", "   ", "has space", "x".repeat(129), "semi;colon", { k: 1 }, true]) {
      const outcome = await create({ title: "Bad key", idempotency_key: key });
      expect({ key, code: codeOf(outcome) }).toEqual({ key, code: "REQUEST_REJECTED" });
    }
    expect(snapshot()).toBe(before);
    expect(codeOf(await create({ title: "Longest", idempotency_key: "x".repeat(128) }))).toBe("OK");
  });

  test("the key commits with the BOQ: a BOQ rolled back for a bad line leaves no key, so the corrected call with the same key creates it", async () => {
    const before = snapshot();
    const bad = await create({ title: "Zoomies", idempotency_key: "k-roll", lineItems: [{ itemCode: "X", unit: "nos", quantity: 1, rate: 1 }] });
    expect(codeOf(bad)).toBe("REQUEST_REJECTED");
    expect(snapshot()).toBe(before);
    const good = await create({ title: "Zoomies", idempotency_key: "k-roll", lineItems: flatLines(2) });
    expect(codeOf(good)).toBe("OK");
    expect(boqs()).toHaveLength(1);
  });

  test("if the key's ledger row cannot be written the BOQ is not created either", async () => {
    failNext(store, "audit_logs", "insert");
    const outcome = await create({ title: "Zoomies", idempotency_key: "k-fault", lineItems: flatLines(3) });
    expect(outcome.success).toBe(false);
    expect(boqs()).toHaveLength(0);
    expect(rowsOf(store, "construction_boq_line_items")).toHaveLength(0);
    expect(codeOf(await create({ title: "Zoomies", idempotency_key: "k-fault", lineItems: flatLines(3) }))).toBe("OK");
    expect(boqs()).toHaveLength(1);
  });

  test("a project of another organisation, a params.projectId that is not the task's, and no person are refused as before, with nothing written", async () => {
    const before = snapshot();
    expect(codeOf(await create({ title: "T", idempotency_key: "k" }, { projectId: "project_x" }))).toBe("RECORD_NOT_FOUND");
    expect(codeOf(await create({ title: "T", idempotency_key: "k", projectId: PROJECT_B }))).toBe("PROJECT_NOT_REACHABLE");
    expect(codeOf(await create({ title: "T", idempotency_key: "k" }, { actorUserId: null }))).toBe("NOT_PERMITTED");
    expect(snapshot()).toBe(before);
  });

  test("the member-rank person may create a BOQ (rank 2 is the link's floor for it) and its key is recorded under that person", async () => {
    const outcome = await create({ title: "By a member", idempotency_key: "k-m" }, { role: "member", actorUserId: MEMBER });
    expect(codeOf(outcome)).toBe("OK");
    expect(boqs()[0].createdById).toBe(MEMBER);
    expect(keyRows()[0]).toMatchObject({ userId: MEMBER, actorName: "Ravi Member" });
  });
});
