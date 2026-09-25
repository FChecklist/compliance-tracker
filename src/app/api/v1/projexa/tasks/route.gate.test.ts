/// <reference types="bun-types" />
// PROJEXA-BUILD-001 Phase 1, item T-3 (route level): what a typed message from
// someone the provider gate refuses actually leaves behind.
//
// POST /api/v1/projexa/tasks with { rawInput } and no flags runs
// submitForVerdict(): it inserts a compliance.submissions row, proposes, and
// updates that row with the Level 1 telemetry. When the gate refuses (Level 1
// resolves to claude-cli or claude-cli-remote and the caller is not
// RAJAT_USER_ID) the route still answers HTTP 200 with a gap verdict, and the
// row must end up with level1_outcome = 'refused' and
// level1_refusal_code = 'provider_not_allowed'.
//
// WHAT IS REAL: the route, submitForVerdict, dryRunSubmission, the Level 0
// tiers, the reuse and fuzzy tiers, runLevel1, assertAiProviderAllowed and
// refusalCodeFor all run unmodified. WHAT IS FAKED: only the database layer
// (@/lib/db/tenant-scoped) and the two auth entry points, following the
// transactional-fake pattern of the sibling BOQ route tests (staged writes,
// commit on success, discard on throw).
//
// The assertions read the persisted row back out of the fake store. They do not
// trust the response body, because the response is the same whether or not the
// telemetry write happened.
//
// Cases that must NOT be read as "a non-owner is served": the second describe
// block shows the same non-owner is not refused when Level 0 answers, because
// the gate sits in front of the model and nothing else.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { submissions } from "@/lib/db/schema";

const ORG_ID = "org_gate_1";
const OWNER = "owner_user_id_1";
const NONOWNER = "user_2";
const APIKEY = "apikey_3";
// A message no Level 0 tier recognises: not an acknowledgement, no promoted
// phrase, no item-code plus percent shape, no logging verb with a duration.
const L0_MISS_TEXT = "arrange the site handover paperwork";

type Row = { id: string } & Record<string, unknown>;

type Store = {
  committed: Row[];
  reads: string[];
  nextId: number;
  /** what db.query.phraseMap.findFirst returns; null means no promoted phrase */
  phraseMapRow: Record<string, unknown> | null;
};

function makeStore(): Store {
  return { committed: [], reads: [], nextId: 1, phraseMapRow: null };
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

function makeTransaction(store: Store) {
  const working: Row[] = store.committed.map((r) => ({ ...r }));

  const query = new Proxy(
    {},
    {
      get: (_target, table) => {
        if (typeof table !== "string" || table === "then") return undefined;
        return {
          findFirst: async () => {
            store.reads.push(`query.${table}.findFirst`);
            return table === "phraseMap" ? (store.phraseMapRow ?? undefined) : undefined;
          },
          findMany: async () => {
            store.reads.push(`query.${table}.findMany`);
            return [];
          },
        };
      },
    }
  );

  const db = {
    query,
    // makePhraseFuzzyRepo runs raw SQL through db.execute; no row scores high enough.
    execute: async () => {
      store.reads.push("execute");
      return [];
    },
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (getTableName(table) !== "submissions") {
            throw new Error(`unexpected insert into ${getTableName(table)} on the refusal path`);
          }
          const row: Row = { ...v, id: `sub_${store.nextId++}` };
          working.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          // drizzle builders run when awaited, so this one does too
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => {
                if (getTableName(table) !== "submissions") {
                  throw new Error(`unexpected update of ${getTableName(table)} on the refusal path`);
                }
                for (const row of working) {
                  if (sqlBinds(cond, row.id)) Object.assign(row, values);
                }
              })
              .then(resolve, reject),
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
let identityCtx: { dbUser: { id: string; role: string } | null; apiKey: { id: string } | null };

const realAuthGuard = await import("@/lib/supabase/auth-guard");
const realTenantScoped = await import("@/lib/db/tenant-scoped");

mock.module("@/lib/supabase/auth-guard", () => ({
  // The rest of the module stays real: the pipeline reached through
  // run-submission reads other exports from it.
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => ({ orgId: ORG_ID, response: null, ...identityCtx })),
  requireRoleOrScope: mock(() => null),
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

const ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_PROVIDER_PIPELINE_L2", "AI_ALLOWED_PROVIDERS", "RAJAT_USER_ID"] as const;
const SAVED = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makeStore();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.RAJAT_USER_ID = OWNER;
  // The gate, the dry run and submitForVerdict each log this path; keep the test output readable.
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  for (const s of silenced) s.mockRestore();
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard);
});

let POST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = (await import("./route")) as unknown as { POST: (req: Request) => Promise<Response> });
});

function typedRequest(rawInput: string): Request {
  return new Request("https://x/api/v1/projexa/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rawInput }),
  });
}

const CALLERS = [
  { label: "a signed-in person who is not the owner", id: NONOWNER, ctx: { dbUser: { id: NONOWNER, role: "member" }, apiKey: null } },
  { label: "a PROJEXA org API key (the gate sees the key id)", id: APIKEY, ctx: { dbUser: null, apiKey: { id: APIKEY } } },
];

describe("POST /api/v1/projexa/tasks -- a refused Level 1 miss is persisted as refused", () => {
  test("the column names the fake store keys are the ones the spec names", () => {
    const cols = getTableColumns(submissions);
    expect(cols.level1Outcome.name).toBe("level1_outcome");
    expect(cols.level1RefusalCode.name).toBe("level1_refusal_code");
  });

  for (const provider of ["claude-cli", "claude-cli-remote"] as const) {
    for (const caller of CALLERS) {
      test(`L1=${provider}, RAJAT_USER_ID=owner, caller is ${caller.label}: HTTP 200 gap verdict, row re-read as refused / provider_not_allowed`, async () => {
        process.env.AI_PROVIDER_PIPELINE_L1 = provider;
        identityCtx = caller.ctx;

        const res = await POST(typedRequest(L0_MISS_TEXT));
        const body = await res.json();

        // Not the 400 dead end the assistant, submissions, classify and execute paths give.
        expect(res.status).toBe(200);
        expect(body.error).toBeUndefined();
        expect(body.status).toBe("gap");

        // Everything below is read from the store, not from the response.
        expect(store.committed).toHaveLength(1);
        const row = store.committed[0];
        expect(row.level1Outcome).toBe("refused");
        expect(row.level1RefusalCode).toBe("provider_not_allowed");
        expect(row.modelCalls).toBe(0);
        expect(row.id).toBe(body.submissionId);
        expect(row.orgId).toBe(ORG_ID);
        expect(row.userId).toBe(caller.id);

        // The free tiers ran first; the refusal came at the Level 1 boundary.
        expect(store.reads).toContain("query.phraseMap.findFirst");
        expect(store.reads).toContain("query.reuseCache.findFirst");
        expect(store.reads).toContain("execute");
      });
    }
  }
});

describe("POST /api/v1/projexa/tasks -- the gate sits in front of the model, not in front of the records", () => {
  test("a non-owner whose phrase is answered at Level 0 is persisted as not_needed with no refusal code", async () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
    identityCtx = CALLERS[0].ctx;
    store.phraseMapRow = { functionId: "record_work_progress", fixedParams: { percent: 50 }, promotedAt: new Date() };

    const res = await POST(typedRequest(L0_MISS_TEXT));

    expect(res.status).toBe(200);
    expect(store.committed).toHaveLength(1);
    const row = store.committed[0];
    expect(row.level1Outcome).toBe("not_needed");
    expect(row.level1RefusalCode).toBeNull();
    expect(row.modelCalls).toBe(0);
    // The reuse tier is only consulted after a Level 0 miss.
    expect(store.reads).not.toContain("query.reuseCache.findFirst");
  });
});
