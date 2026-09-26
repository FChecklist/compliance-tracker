// PROJEXA-BUILD-001 U-43 / U-46c: the fake database layer the link tests share.
// It is test support, not a test (no `.test.` in the name), and nothing in the
// application imports it.
//
// It stands in for @/lib/db/tenant-scoped's withTenantContext ONLY. Its `where`
// handling is the one executor-project-scope.test.ts uses: the REAL drizzle
// clause each query builds is compiled with PgDialect.sqlToQuery (the compiler
// the driver uses) and evaluated against fixture rows, so a lookup that stops
// scoping itself changes what the fake returns. Writes are staged and committed
// when the transaction function returns, discarded when it throws.
//
// What it adds over that harness: EVERY write is recorded by table
// (`store.writes`, as "insert:submissions", "update:pipeline_tasks", ...), and a
// raw `execute` whose SQL starts with insert, update or delete is recorded as
// "execute:<verb>". That record is what execute-read.test.ts asserts is empty.
import { getTableColumns, getTableName, is, Table, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type FakeStore = {
  tables: Tables;
  nextId: number;
  /** what db.query.phraseMap.findFirst returns: a promoted phrase, or nothing. */
  phraseMapRow: Row | null;
  /** where clauses the fake could not evaluate. Must stay empty, or a test would be matching everything. */
  unparsed: string[];
  /** every write, in order, as "<verb>:<table>". */
  writes: string[];
};

export function createFakeStore(tables: Tables): FakeStore {
  return { tables, nextId: 1, phraseMapRow: null, unparsed: [], writes: [] };
}

// Every schema table by its relational-query key (db.query.<key>).
const TABLES: Record<string, Table> = Object.fromEntries(
  Object.entries(schema).filter(([, v]) => is(v, Table)) as [string, Table][]
);
const dialect = new PgDialect();

/**
 * The real where clause, compiled and evaluated. Only a conjunction of
 * `column = $n` terms is understood; anything else matches nothing and is
 * recorded, so the fake can never silently match everything.
 */
function predicate(table: Table, where: SQL | undefined, unparsed: string[]): (r: Row) => boolean {
  if (!where) return () => true;
  const { sql, params } = dialect.sqlToQuery(where);
  const keyOf = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, col]) => [col.name, key]));
  const body = sql.startsWith("(") && sql.endsWith(")") ? sql.slice(1, -1) : sql;
  const checks: ((r: Row) => boolean)[] = [];
  for (const term of body.split(" and ")) {
    const m = /^(?:"\w+"\.)?"\w+"\."(\w+)" = \$(\d+)$/.exec(term);
    if (!m || !keyOf[m[1]]) {
      unparsed.push(sql);
      return () => false;
    }
    const key = keyOf[m[1]];
    const value = params[Number(m[2]) - 1];
    checks.push((r) => r[key] === value);
  }
  return (r) => checks.every((c) => c(r));
}

function thenable(run: () => unknown) {
  return {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  };
}

function makeTransaction(store: FakeStore) {
  const working: Tables = Object.fromEntries(Object.entries(store.tables).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  const rowsOf = (table: Table) => (working[getTableName(table)] ??= []);
  const wrote = (verb: string, table: Table) => store.writes.push(`${verb}:${getTableName(table)}`);

  const query = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== "string" || key === "then") return undefined;
        const table = TABLES[key];
        return {
          findFirst: async (cfg: { where?: SQL } = {}) => {
            if (key === "phraseMap") return store.phraseMapRow ?? undefined;
            if (!table) return undefined;
            return rowsOf(table).find(predicate(table, cfg.where, store.unparsed));
          },
          findMany: async (cfg: { where?: SQL } = {}) => {
            if (!table) return [];
            return rowsOf(table).filter(predicate(table, cfg.where, store.unparsed));
          },
        };
      },
    }
  );

  const stage = (table: Table, v: Row): Row => {
    wrote("insert", table);
    const row: Row = { id: `${getTableName(table)}_${store.nextId++}`, ...v };
    rowsOf(table).push(row);
    return row;
  };

  const db = {
    query,
    execute: async (statement?: SQL) => {
      if (statement) {
        const text = dialect.sqlToQuery(statement).sql.trim().toLowerCase();
        const verb = /^(insert|update|delete)\b/.exec(text)?.[1];
        if (verb) store.writes.push(`execute:${verb}`);
      }
      return [];
    },
    insert: (table: Table) => ({
      values: (v: Row) => ({
        returning: async () => [stage(table, v)],
        onConflictDoUpdate: () => thenable(() => stage(table, v)),
        ...thenable(() => stage(table, v)),
      }),
    }),
    update: (table: Table) => ({
      set: (values: Row) => ({
        where: (cond: SQL) =>
          thenable(() => {
            wrote("update", table);
            for (const row of rowsOf(table).filter(predicate(table, cond, store.unparsed))) Object.assign(row, values);
          }),
      }),
    }),
    delete: (table: Table) => ({
      where: (cond: SQL) =>
        thenable(() => {
          wrote("delete", table);
          const doomed = new Set(rowsOf(table).filter(predicate(table, cond, store.unparsed)));
          working[getTableName(table)] = rowsOf(table).filter((r) => !doomed.has(r));
        }),
    }),
    select: () => ({
      from: (table: Table) => ({
        where: (cond: SQL) => ({
          limit: async (n: number) => rowsOf(table).filter(predicate(table, cond, store.unparsed)).slice(0, n),
        }),
      }),
    }),
  };

  return {
    db,
    commit: () => {
      store.tables = working;
    },
  };
}

/** The replacement for withTenantContext: one fake transaction per call, committed on success. */
export function makeFakeWithTenantContext(getStore: () => FakeStore) {
  return async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const txn = makeTransaction(getStore());
    const result = await fn(txn.db);
    txn.commit();
    return result;
  };
}

/** Fixture rows for one org, two projects, one manager, and nothing written. */
export const FAKE_ORG = "org_1";
export const FAKE_USER = "user_1";
export const FAKE_PROJECT_A = "project_a";
export const FAKE_PROJECT_B = "project_b";

export function fakeFixtures(): Tables {
  return {
    projects: [
      { id: FAKE_PROJECT_A, orgId: FAKE_ORG, name: "Cedar Heights" },
      { id: FAKE_PROJECT_B, orgId: FAKE_ORG, name: "Oakwood" },
    ],
    construction_labour_roster: [
      { id: "roster_a", orgId: FAKE_ORG, projectId: FAKE_PROJECT_A, name: "Asha", dailyRate: "800" },
      { id: "roster_b", orgId: FAKE_ORG, projectId: FAKE_PROJECT_B, name: "Babu", dailyRate: "900" },
    ],
    construction_attendance: [],
    construction_boqs: [
      { id: "boq_a", orgId: FAKE_ORG, projectId: FAKE_PROJECT_A, version: 1 },
      { id: "boq_b", orgId: FAKE_ORG, projectId: FAKE_PROJECT_B, version: 1 },
    ],
    users: [{ id: FAKE_USER, orgId: FAKE_ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }],
    submissions: [],
    pipeline_tasks: [],
  };
}
