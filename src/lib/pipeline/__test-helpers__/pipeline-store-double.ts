// PROJEXA-BUILD-001 U-49 -- shared test seam for the pipeline's database, the
// acting-person lookup and the Level 1 provider. Used by the BR-219, BR-220
// and BR-221 tests: src/lib/ai/gate-identity.test.ts,
// src/lib/pipeline/run-submission.telemetry.test.ts and the four
// src/app/api/v1/projexa/{assistant,submissions,classify,tasks}/route.refusal.test.ts.
//
// WHAT IT STANDS IN FOR, AND HOW:
//   - withTenantContext: one transaction per call over an in-memory store.
//     Writes are staged and applied only when the callback resolves, and
//     dropped when it throws -- the transactional-fake pattern of
//     src/app/api/v1/projexa/tasks/route.gate.test.ts and the BOQ route tests.
//     Staged writes are applied to the store rather than replacing it, so two
//     transactions that overlap (Level 0 runs one per segment in parallel)
//     cannot overwrite each other's rows.
//     Reads answer from the store: a promoted phrase_map row by its normalised
//     phrase, a project by id; every other read is empty. A table named in
//     `failReads` throws on read, for the "a real fault keeps its status" cases.
//   - @/lib/db's raw client: the users lookup resolveActingUser() makes, by
//     id, auth_user_id or email -- whichever the where clause binds.
//   - the claude-cli provider: a classify() that records each call and maps
//     nothing, so a request the gate lets through makes exactly one model call
//     and leaves a gap, with no binary spawned and no network.
// The routes, acting-role.ts, the pipeline, runLevel1 and the provider gate
// all run for real in the tests that use this. Each test file does its own
// mock.module() calls with these pieces, so what it replaces stays visible there.
//
// Lives in __test-helpers__ for the same reason as
// src/lib/supabase/__test-helpers__/acting-person-double.ts: a test seam is not
// a module that owes the repo a sibling test.
import { getTableName } from "drizzle-orm";
import { normaliseForMatch } from "../classify";

export type StoredRow = { id: string; table: string } & Record<string, unknown>;

export type PipelineStore = {
  committed: StoredRow[];
  nextId: number;
  /** promoted phrase_map rows, keyed by normalised phrase */
  phrases: Map<string, { functionId: string; fixedParams: Record<string, unknown> | null }>;
  /** compliance.projects rows by id -- the chain root's name */
  projects: Map<string, { id: string; name: string }>;
  /** db.query.<table> reads that throw, e.g. "reuseCache" */
  failReads: Set<string>;
};

export function makePipelineStore(): PipelineStore {
  return { committed: [], nextId: 1, phrases: new Map(), projects: new Map(), failReads: new Set() };
}

/** Promote a phrase, so Level 0's phrase-map tier answers the text exactly as it would live. */
export function promotePhrase(store: PipelineStore, text: string, functionId: string, fixedParams: Record<string, unknown> | null = null): void {
  store.phrases.set(normaliseForMatch(text), { functionId, fixedParams });
}

export function rowsIn(store: PipelineStore, table: string): StoredRow[] {
  return store.committed.filter((r) => r.table === table);
}

/** True when a drizzle SQL fragment carries `value` as one of its bound parameters. */
export function sqlBinds(node: unknown, value: string, seen = new Set<unknown>(), depth = 0): boolean {
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

type Table = Parameters<typeof getTableName>[0];

function makeTransaction(store: PipelineStore) {
  const inserts: StoredRow[] = [];
  const updates: Array<{ table: string; cond: unknown; values: Record<string, unknown> }> = [];

  const stage = (table: Table, values: Record<string, unknown>): StoredRow => {
    const row: StoredRow = { ...values, id: `row_${store.nextId++}`, table: getTableName(table) };
    inserts.push(row);
    return row;
  };

  const query = new Proxy(
    {},
    {
      get: (_target, table) => {
        if (typeof table !== "string" || table === "then") return undefined;
        const failIfAsked = () => {
          if (store.failReads.has(table)) throw new Error(`${table} read failed`);
        };
        return {
          findFirst: async (args?: { where?: unknown }) => {
            failIfAsked();
            if (table === "phraseMap") {
              for (const [phrase, row] of store.phrases) {
                if (sqlBinds(args?.where, phrase)) return { ...row, promotedAt: new Date() };
              }
            }
            if (table === "projects") {
              for (const [id, row] of store.projects) {
                if (sqlBinds(args?.where, id)) return row;
              }
            }
            return undefined;
          },
          findMany: async () => {
            failIfAsked();
            return [];
          },
        };
      },
    }
  );

  const db = {
    query,
    // makePhraseFuzzyRepo's trigram query: no row scores high enough.
    execute: async () => [],
    insert: (table: Table) => ({
      values: (values: Record<string, unknown>) => ({
        // submissions / pipeline_tasks: `.returning()`; gap_log: awaited directly;
        // pill_usage / chain_history: `.onConflictDoUpdate()`.
        returning: async () => [{ id: stage(table, values).id }],
        onConflictDoUpdate: () => thenable(() => stage(table, values)),
        ...thenable(() => stage(table, values)),
      }),
    }),
    update: (table: Table) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => thenable(() => updates.push({ table: getTableName(table), cond, values })),
      }),
    }),
  };

  return {
    db,
    commit: () => {
      store.committed.push(...inserts);
      for (const u of updates) {
        for (const row of store.committed) {
          if (row.table === u.table && sqlBinds(u.cond, row.id)) Object.assign(row, u.values);
        }
      }
    },
  };
}

/** The withTenantContext stand-in: staged writes, applied on success, dropped on throw. */
export function fakeWithTenantContext(getStore: () => PipelineStore) {
  return async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const txn = makeTransaction(getStore());
    const result = await fn(txn.db);
    txn.commit();
    return result;
  };
}

/** A compliance.users row, as resolveActingUser() reads it. */
export type PersonRow = { id: string; orgId: string; email: string; authUserId: string | null; role: string; isActive: boolean; name: string };

/** @/lib/db's db.query.users.findFirst stand-in: the person of this org whose id, auth_user_id or email the where clause binds. */
export function usersLookupDouble(getPeople: () => PersonRow[]) {
  return async (args?: { where?: unknown }) =>
    getPeople().find(
      (p) => sqlBinds(args?.where, p.orgId) && [p.id, p.email, p.authUserId].some((v) => typeof v === "string" && sqlBinds(args?.where, v))
    );
}

export type ClassifyCall = { segments: string[]; candidateFunctionIds: string[] };

/** The claude-cli provider stand-in: records every classify() call and maps nothing. */
export function mapsNothingProvider(calls: ClassifyCall[]) {
  return {
    classify: async (segments: string[], candidateFunctionIds: string[]) => {
      calls.push({ segments, candidateFunctionIds });
      return segments.map(() => ({ functionId: null, params: {}, missingParams: [], confidence: 0, unmappedIntent: "nothing in the candidate set" }));
    },
    analyse: async () => [],
  };
}

/** The five variables that decide Level 1's provider and the gate's one permitted person. */
export const AI_ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_PROVIDER_PIPELINE_L2", "AI_ALLOWED_PROVIDERS", "RAJAT_USER_ID"] as const;

/** Snapshot of those variables, taken once; `restore()` puts them back after each test. */
export function aiEnvSnapshot() {
  const saved = Object.fromEntries(AI_ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof AI_ENV_KEYS)[number], string | undefined>;
  return {
    clear: () => {
      for (const k of AI_ENV_KEYS) delete process.env[k];
    },
    restore: () => {
      for (const k of AI_ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    },
  };
}

/** A JSON POST, the way PROJEXA's proxy sends one. */
export function jsonPost(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
