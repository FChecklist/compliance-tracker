/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-18 (register row BR-210, F-R10-4): a link minted for
// project A cannot act on project B through POST /api/mcp/[token].
//
// Before this, the route handed the tool's own `projectId` argument straight
// to runSubmission for every link, so any link could write to any project of
// its org. Now a link carries its project (drizzle/0614, resolveAiLinkToken):
//   - a tools/call whose arguments name another project is refused with HTTP
//     403 and a JSON-RPC error, before anything is resolved or written;
//   - a call naming no project runs on the link's project;
//   - a project the pipeline itself finds in the text (a promoted phrase that
//     carries a projectId) is refused by validate() as PROJECT_NOT_REACHABLE,
//     and no task is minted;
//   - a VERIDIAN link (projectId null) is org-wide, exactly as before.
//
// WHAT IS REAL: the route, runSubmission, segmentation, the Level 0 tiers,
// validate(), the executor registry. WHAT IS FAKED: the link-token lookup and
// the owner-role read (@/lib/ai-links/user-links -- the database side of both
// is proven by user-ai-links-resolve-by-hash.pglite.test.ts), the database
// layer (@/lib/db/tenant-scoped: staged writes committed on success and
// discarded on throw, the pattern of route.gate.test.ts beside this file), and
// runLevel1, a spy that throws so any model call fails the test.
//
// Run: bun test --isolate "src/app/api/mcp/[token]/route.project-scope.test.ts"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { AiProviderRefusalError } from "@/lib/ai/adapter";
import { NO_COMMENTARY_SENTENCE } from "@/lib/ai/refusal";
import type { AiLinkIdentity } from "@/lib/ai-links/user-links";

const ORG_ID = "org_1";
const LINK_USER = "user_2";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
// No Level 0 tier recognises it; the reuse and fuzzy tiers return nothing.
const MISS_TEXT = "xyzzy unmatched phrase";

const PROJEXA_A: AiLinkIdentity = {
  orgId: ORG_ID,
  userId: LINK_USER,
  product: "projexa",
  projectId: PROJECT_A,
  authorityLevel: 1,
  allowedFunctions: [],
  hidePersonal: true,
};
const VERIDIAN: AiLinkIdentity = {
  orgId: ORG_ID,
  userId: LINK_USER,
  product: "veridian",
  projectId: null,
  authorityLevel: 0,
  allowedFunctions: [],
  hidePersonal: true,
};

type Row = { id: string; table: string } & Record<string, unknown>;

type Store = {
  committed: Row[];
  nextId: number;
  /** what db.query.phraseMap.findFirst returns; null means no promoted phrase */
  phraseMapRow: Record<string, unknown> | null;
};

function makeStore(): Store {
  return { committed: [], nextId: 1, phraseMapRow: null };
}

/** True when a drizzle SQL fragment carries `value` as one of its bound parameters. */
function sqlBinds(node: unknown, value: string, seen = new Set<unknown>(), depth = 0): boolean {
  if (node === value) return true;
  if (!node || typeof node !== "object" || depth > 10 || seen.has(node)) return false;
  seen.add(node);
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) return chunks.some((c) => sqlBinds(c, value, seen, depth + 1));
  if ("value" in node) return sqlBinds((node as { value: unknown }).value, value, seen, depth + 1);
  return false;
}

function thenable(run: () => unknown) {
  return {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  };
}

function makeTransaction(store: Store) {
  const working: Row[] = store.committed.map((r) => ({ ...r }));

  const query = new Proxy(
    {},
    {
      get: (_target, table) => {
        if (typeof table !== "string" || table === "then") return undefined;
        return {
          findFirst: async () => (table === "phraseMap" ? (store.phraseMapRow ?? undefined) : undefined),
          findMany: async () => [],
        };
      },
    }
  );

  const stage = (table: Parameters<typeof getTableName>[0], v: Record<string, unknown>): Row => {
    const row: Row = { ...v, id: `row_${store.nextId++}`, table: getTableName(table) };
    working.push(row);
    return row;
  };

  const db = {
    query,
    // makePhraseFuzzyRepo runs raw SQL through db.execute; no row scores high enough.
    execute: async () => [],
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (v: Record<string, unknown>) => ({
        // submissions / pipeline_tasks: `.returning()`; gap_log: awaited directly;
        // pill_usage / chain_history: `.onConflictDoUpdate()`.
        returning: async () => [{ id: stage(table, v).id }],
        onConflictDoUpdate: () => thenable(() => stage(table, v)),
        ...thenable(() => stage(table, v)),
      }),
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) =>
          thenable(() => {
            for (const row of working) {
              if (row.table === getTableName(table) && sqlBinds(cond, row.id)) Object.assign(row, values);
            }
          }),
      }),
    }),
  };

  return {
    db,
    commit: () => {
      store.committed = working;
    },
  };
}

let store: Store;
let identity: AiLinkIdentity;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realUserLinks = await import("@/lib/ai-links/user-links");
const realLevel1 = await import("@/lib/pipeline/level1");

const runLevel1Spy = mock(async (_texts: string[], _ctx: unknown): Promise<never> => {
  throw new AiProviderRefusalError(NO_COMMENTARY_SENTENCE);
});
const ownerRoleSpy = mock(async () => "member");

mock.module("@/lib/ai-links/user-links", () => ({
  ...realUserLinks,
  resolveAiLinkToken: mock(async () => identity),
  resolveAiLinkOwnerRole: ownerRoleSpy,
}));
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const txn = makeTransaction(store);
    const result = await fn(txn.db);
    txn.commit();
    return result;
  }),
}));
mock.module("@/lib/pipeline/level1", () => ({ ...realLevel1, runLevel1: runLevel1Spy }));

let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makeStore();
  identity = PROJEXA_A;
  runLevel1Spy.mockClear();
  ownerRoleSpy.mockClear();
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  for (const s of silenced) s.mockRestore();
});

afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/pipeline/level1", () => realLevel1);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/ai-links/user-links", () => realUserLinks);
});

type RouteContext = { params: Promise<{ token: string }> };
let POST: (req: Request, ctx: RouteContext) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
});

async function callTool(tool: "submit_task" | "ask", args: Record<string, unknown>) {
  const res = await POST(
    new Request("https://x/api/mcp/tok", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: tool, arguments: args } }),
    }),
    { params: Promise.resolve({ token: "tok" }) }
  );
  const body = (await res.json()) as {
    id?: unknown;
    error?: { code: number; message: string };
    result?: { content: { type: string; text: string }[] };
  };
  return { res, body };
}

const rows = (table: string) => store.committed.filter((r) => r.table === table);

describe("POST /api/mcp/[token] -- a project-A link cannot act on project B (BR-210)", () => {
  test("submit_task naming project B: HTTP 403, a JSON-RPC error, and 0 rows staged", async () => {
    const { res, body } = await callTool("submit_task", { rawInput: "PP1 is 50% done", projectId: PROJECT_B });

    expect(res.status).toBe(403);
    expect(body.id).toBe(11);
    expect(body.result).toBeUndefined();
    expect(body.error?.code).toBe(-32003);
    expect(body.error?.message).toContain("limited to one project");
    // Nothing ran: no submission, no gap, no task, no business row, and the
    // owner's role was never even read.
    expect(store.committed).toEqual([]);
    expect(ownerRoleSpy.mock.calls.length).toBe(0);
    expect(runLevel1Spy.mock.calls.length).toBe(0);
  });

  test("ask carrying a projectId for project B is refused the same way", async () => {
    const { res, body } = await callTool("ask", { question: "show the budget", projectId: PROJECT_B });

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe(-32003);
    expect(store.committed).toEqual([]);
  });

  test("a project the pipeline finds in the text (a promoted phrase naming project B) is refused, and no task is minted", async () => {
    store.phraseMapRow = { functionId: "get_construction_project_dashboard", fixedParams: { projectId: PROJECT_B }, promotedAt: new Date() };

    const { res, body } = await callTool("submit_task", { rawInput: MISS_TEXT });

    expect(res.status).toBe(200);
    const result = JSON.parse(body.result!.content[0].text) as { failures: { code: string }[] };
    expect(result.failures.map((f) => f.code)).toEqual(["PROJECT_NOT_REACHABLE"]);
    // The submission is recorded on the link's own project; nothing was minted or read.
    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_A]);
    expect(rows("pipeline_tasks")).toEqual([]);
  });
});

describe("POST /api/mcp/[token] -- a project-A link works on project A", () => {
  test("submit_task naming project A runs, on project A", async () => {
    const { res, body } = await callTool("submit_task", { rawInput: MISS_TEXT, projectId: PROJECT_A });

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.result!.content[0].text).toContain(`No built-in function matched "${MISS_TEXT}"`);
    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_A]);
    expect(runLevel1Spy.mock.calls.length).toBe(0);
  });

  test("a call naming no project is pinned to the link's project: the task is minted and run on project A", async () => {
    store.phraseMapRow = { functionId: "get_construction_project_dashboard", fixedParams: {}, promotedAt: new Date() };

    const { res, body } = await callTool("submit_task", { rawInput: MISS_TEXT });

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_A]);
    const tasks = rows("pipeline_tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].projectId).toBe(PROJECT_A);
    expect((tasks[0].params as Record<string, unknown>).projectId).toBe(PROJECT_A);
    // Past to_do: the executor was reached (its outcome depends on the fake
    // database, not on the scope, so it is not asserted).
    expect(tasks[0].status).not.toBe("to_do");
  });

  test("ask is pinned to the link's project too", async () => {
    const { res } = await callTool("ask", { question: MISS_TEXT });

    expect(res.status).toBe(200);
    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_A]);
  });
});

describe("POST /api/mcp/[token] -- a VERIDIAN (org-wide) link is unchanged", () => {
  test("naming project B is allowed and runs on project B, as before U-18", async () => {
    identity = VERIDIAN;

    const { res, body } = await callTool("submit_task", { rawInput: MISS_TEXT, projectId: PROJECT_B });

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_B]);
  });

  test("naming no project stays org-wide (no project is invented)", async () => {
    identity = VERIDIAN;

    const { res } = await callTool("submit_task", { rawInput: MISS_TEXT });

    expect(res.status).toBe(200);
    expect(rows("submissions").map((r) => r.projectId)).toEqual([null]);
  });

  test("a link resolved without scope fields (the pre-U-18 identity shape) is org-wide", async () => {
    identity = { orgId: ORG_ID, userId: LINK_USER } as AiLinkIdentity;

    const { res } = await callTool("submit_task", { rawInput: MISS_TEXT, projectId: PROJECT_B });

    expect(res.status).toBe(200);
    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_B]);
  });
});
