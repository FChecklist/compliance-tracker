/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-19 (register row BR-213, PMD-07/PMD-08, drizzle/0613):
// a project_ai API key for project A gets HTTP 403 on project B -- at
// validateApiKey (the key carries its kind and project) and at the routes
// that call runSubmission -- and an org_service key behaves exactly as today.
//
// WHAT IS REAL: validateApiKey, hashSHA256, requireAuthOrApiKey's Bearer fast
// path, requireRoleOrScope, POST /api/v1/projexa/submissions and
// POST /api/v1/projexa/tasks, runSubmission / runDirectTask and the executor
// registry. WHAT IS FAKED: only the database -- the key lookup
// (@/lib/db/preauth-lookups, which is the SECURITY DEFINER read of
// compliance.api_keys), the raw `db` the audit queue writes through, and
// @/lib/db/tenant-scoped (staged writes committed on success, discarded on
// throw, the pattern of the route gate tests). Nothing reaches a network.
//
// Run: bun test --isolate src/lib/supabase/api-key-project-scope.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";

const ORG = "org_px";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
// Answered at Level 0 by the promoted phrase below, so these routes (which run
// the default internal Level 1) never reach the model or its provider gate.
const TEXT = "show the project dashboard";
const PHRASE_HIT = { functionId: "get_construction_project_dashboard", fixedParams: {}, promotedAt: new Date() };

const TOKENS = {
  projectA: "vk_project_a_key_0000000000000000",
  orgService: "vk_org_service_key_000000000000000",
  unbound: "vk_project_key_without_project_00",
  oddKind: "vk_unknown_kind_key_0000000000000",
} as const;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function keyRow(id: string, keyKind: string, projectId: string | null) {
  return { id, orgId: ORG, name: id, scopes: "read,write", rateLimitPerMinute: null, isActive: true, keyKind, projectId };
}
const KEYS_BY_HASH: Record<string, ReturnType<typeof keyRow>> = {
  [sha(TOKENS.projectA)]: keyRow("key_project_a", "project_ai", PROJECT_A),
  [sha(TOKENS.orgService)]: keyRow("key_org_service", "org_service", null),
  // Both below are impossible while 0613's CHECKs exist; validateApiKey must
  // refuse them rather than read them as org-wide.
  [sha(TOKENS.unbound)]: keyRow("key_unbound", "project_ai", null),
  [sha(TOKENS.oddKind)]: keyRow("key_odd", "personal", null),
};

type Row = { id: string; table: string } & Record<string, unknown>;
let committed: Row[] = [];
let nextId = 1;

function thenable(run: () => unknown) {
  return {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  };
}

function makeTransaction() {
  const working: Row[] = committed.map((r) => ({ ...r }));
  const stage = (table: Parameters<typeof getTableName>[0], v: Record<string, unknown>): Row => {
    const row: Row = { ...v, id: `row_${nextId++}`, table: getTableName(table) };
    working.push(row);
    return row;
  };
  const query = new Proxy(
    {},
    {
      get: (_t, table) =>
        typeof table !== "string" || table === "then"
          ? undefined
          : { findFirst: async () => (table === "phraseMap" ? PHRASE_HIT : undefined), findMany: async () => [] },
    }
  );
  const db = {
    query,
    execute: async () => [],
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: stage(table, v).id }],
        onConflictDoUpdate: () => thenable(() => stage(table, v)),
        ...thenable(() => stage(table, v)),
      }),
    }),
    // Every update on these paths targets a row by id; the store is
    // inspected by table and projectId only, so updates are recorded as no-ops.
    update: () => ({ set: () => ({ where: () => thenable(() => undefined) }) }),
  };
  return {
    db,
    commit: () => {
      committed = working;
    },
  };
}

const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realDb = await import("@/lib/db");
const realPreauth = await import("@/lib/db/preauth-lookups");

mock.module("@/lib/db/preauth-lookups", () => ({
  ...realPreauth,
  lookupApiKeyByHash: mock(async (hash: string) => KEYS_BY_HASH[hash] ?? null),
  countRecentApiKeyRequests: mock(async () => 0),
}));
// The audit queue (recordApiKeyUse) flushes through the raw client; a no-op
// here, so nothing is written anywhere.
mock.module("@/lib/db", () => ({
  ...realDb,
  db: {
    execute: async () => [],
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
  },
}));
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const txn = makeTransaction();
    const result = await fn(txn.db);
    txn.commit();
    return result;
  }),
}));

let validateApiKey: typeof import("./api-key-auth").validateApiKey;
let assertKeyProjectScope: typeof import("./api-key-auth").assertKeyProjectScope;
let keyProjectScope: typeof import("./api-key-auth").keyProjectScope;
let submissionsPOST: (req: Request) => Promise<Response>;
let tasksPOST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ validateApiKey, assertKeyProjectScope, keyProjectScope } = await import("./api-key-auth"));
  ({ POST: submissionsPOST } = (await import("@/app/api/v1/projexa/submissions/route")) as unknown as { POST: typeof submissionsPOST });
  ({ POST: tasksPOST } = (await import("@/app/api/v1/projexa/tasks/route")) as unknown as { POST: typeof tasksPOST });
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  committed = [];
  nextId = 1;
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
  const { flushApiKeyAuditNow } = await import("@/lib/auth/api-key-audit");
  await flushApiKeyAuditNow();
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/db", () => realDb);
  await mock.module("@/lib/db/preauth-lookups", () => realPreauth);
});

function bearer(token: string, url = "https://x/api/v1/projexa/submissions", body?: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const submissionsOf = () => committed.filter((r) => r.table === "submissions");

describe("validateApiKey exposes the key's kind and project (BR-213)", () => {
  test("a project_ai key carries keyKind project_ai and its project", async () => {
    const result = await validateApiKey(bearer(TOKENS.projectA));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.context).toEqual({
      orgId: ORG,
      scopes: ["read", "write"],
      keyId: "key_project_a",
      keyName: "key_project_a",
      keyKind: "project_ai",
      projectId: PROJECT_A,
    });
  });

  test("an org_service key carries keyKind org_service and no project -- otherwise exactly as before", async () => {
    const result = await validateApiKey(bearer(TOKENS.orgService));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.context.keyKind).toBe("org_service");
    expect(result.context.projectId).toBeNull();
    expect(result.context.orgId).toBe(ORG);
  });

  test("a project_ai key with no project, or an unknown kind, is refused as invalid -- never read as org-wide", async () => {
    expect((await validateApiKey(bearer(TOKENS.unbound))).status).toBe("invalid");
    expect((await validateApiKey(bearer(TOKENS.oddKind))).status).toBe("invalid");
  });
});

describe("assertKeyProjectScope: the rule every call site applies", () => {
  const projectKey = { keyKind: "project_ai" as const, projectId: PROJECT_A };
  const orgKey = { keyKind: "org_service" as const, projectId: null };

  test("a project_ai key for A: 403 on B, allowed on A or on no named project (which then runs on A)", () => {
    expect(assertKeyProjectScope(projectKey, PROJECT_B)).toEqual({ ok: false, status: 403, message: expect.stringContaining("one project") });
    expect(assertKeyProjectScope(projectKey, PROJECT_A)).toEqual({ ok: true });
    expect(assertKeyProjectScope(projectKey, null)).toEqual({ ok: true });
    expect(keyProjectScope(projectKey)).toBe(PROJECT_A);
  });

  test("an org_service key, a session (no key) and a key object without the new fields are unchanged: any project", () => {
    for (const key of [orgKey, null, undefined, {}]) {
      expect(assertKeyProjectScope(key, PROJECT_B)).toEqual({ ok: true });
      expect(keyProjectScope(key)).toBeNull();
    }
  });
});

describe("POST /api/v1/projexa/submissions with a project_ai key (runSubmission call site)", () => {
  test("project A key naming project B: HTTP 403 and 0 rows staged", async () => {
    const res = await submissionsPOST(bearer(TOKENS.projectA, undefined, { rawInput: TEXT, projectId: PROJECT_B }));

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("one project");
    expect(committed).toEqual([]);
  });

  test("project A key naming project A: 201, the submission is on A", async () => {
    const res = await submissionsPOST(bearer(TOKENS.projectA, undefined, { rawInput: TEXT, projectId: PROJECT_A }));

    expect(res.status).toBe(201);
    expect(submissionsOf().map((r) => r.projectId)).toEqual([PROJECT_A]);
  });

  test("project A key naming no project: 201, pinned to A", async () => {
    const res = await submissionsPOST(bearer(TOKENS.projectA, undefined, { rawInput: TEXT }));

    expect(res.status).toBe(201);
    expect(submissionsOf().map((r) => r.projectId)).toEqual([PROJECT_A]);
  });

  test("an org_service key naming project B is unchanged: 201, on B", async () => {
    const res = await submissionsPOST(bearer(TOKENS.orgService, undefined, { rawInput: TEXT, projectId: PROJECT_B }));

    expect(res.status).toBe(201);
    expect(submissionsOf().map((r) => r.projectId)).toEqual([PROJECT_B]);
  });
});

describe("POST /api/v1/projexa/tasks with a project_ai key (runSubmission / runDirectTask call sites)", () => {
  const TASKS = "https://x/api/v1/projexa/tasks";

  test("the typed execute path naming project B: 403, 0 rows", async () => {
    const res = await tasksPOST(bearer(TOKENS.projectA, TASKS, { rawInput: TEXT, execute: true, projectId: PROJECT_B }));
    expect(res.status).toBe(403);
    expect(committed).toEqual([]);
  });

  test("the pill path with project B only in params: 403, 0 rows", async () => {
    const res = await tasksPOST(
      bearer(TOKENS.projectA, TASKS, { functionId: "record_attendance", params: { projectId: PROJECT_B, rosterId: "roster_b", date: "2026-09-25" } })
    );
    expect(res.status).toBe(403);
    expect(committed).toEqual([]);
  });

  test("the typed execute path naming no project runs on A", async () => {
    const res = await tasksPOST(bearer(TOKENS.projectA, TASKS, { rawInput: TEXT, execute: true }));
    expect(res.status).toBe(201);
    expect(submissionsOf().map((r) => r.projectId)).toEqual([PROJECT_A]);
  });

  test("an org_service key on the pill path naming project B is unchanged: it reaches the pipeline on B", async () => {
    const res = await tasksPOST(bearer(TOKENS.orgService, TASKS, { functionId: "get_construction_project_dashboard", projectId: PROJECT_B, params: {} }));
    expect(res.status).toBe(201);
    expect(submissionsOf().map((r) => r.projectId)).toEqual([PROJECT_B]);
  });
});
