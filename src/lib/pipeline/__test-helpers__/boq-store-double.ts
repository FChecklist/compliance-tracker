// PROJEXA-BUILD-001 U-28 -- the database double for the BOQ registry tests
// (src/lib/pipeline/executor.create-boq.test.ts, BR-406, and
// src/lib/pipeline/executor.boq-revision.test.ts, BR-408).
//
// The same approach as src/lib/pipeline/executor-project-scope.test.ts (U-18):
// only @/lib/db/tenant-scoped is replaced, and its stand-in compiles the REAL
// drizzle `where` each query builds (PgDialect.sqlToQuery, the compiler the
// driver uses) and evaluates it against fixture rows. That double reads only a
// conjunction of `column = $n`; createBoq()/createBoqRevision() also read with
// `in (...)` and `or` (loadLatestProgressDetailByLineItem, the scope-reduction
// guard), insert a list of line items in one statement, and read back through
// `.returning({ id, itemCode })`. So this one parses and/or/in/= /is null with
// parentheses, and anything else matches nothing and is recorded in
// `store.unparsed`, so a test can assert that every lookup was evaluated for
// real rather than silently matching nothing.
//
// Transactions: each withTenantContext call works on a copy of the tables and
// commits it only when the callback resolves and wrote something; a throw
// discards every staged write (the rollback createBoqRevision's scope-reduction
// block and assertLineItemsPersisted rely on). `store.maxOpen` records the
// most transactions open at once, so a nested withTenantContext (a pool hazard,
// forbidden by D-06) is visible to a test.
//
// NOT modelled: orderBy (a fixture holds at most one row per ordering key that
// matters), `columns` projection on db.query reads (full rows come back),
// ON CONFLICT (an upsert inserts), joins.
//
// Lives in __test-helpers__ for the same reason as pipeline-store-double.ts: a
// test seam is not a module that owes the repo a sibling test.
import { and, eq, getTableColumns, getTableName, inArray, is, isNotNull, isNull, ne, or, SQL, Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

export type Row = Record<string, unknown>;
/** Rows by SQL table name, e.g. "construction_boqs". */
export type Tables = Record<string, Row[]>;

export type BoqStore = {
  tables: Tables;
  nextId: number;
  /** compiled where clauses the parser could not read (each matched nothing) */
  unparsed: string[];
  /** transactions open right now, the most ever open at once, and how many ran */
  open: number;
  maxOpen: number;
  transactions: number;
};

// Every schema table by its relational-query key (db.query.<key>).
const TABLES: Record<string, Table> = Object.fromEntries(
  Object.entries(schema).filter(([, v]) => is(v, Table)) as [string, Table][]
);
const TABLE_BY_NAME: Record<string, Table> = Object.fromEntries(Object.values(TABLES).map((t) => [getTableName(t), t]));
const dialect = new PgDialect();

type ColumnLike = { name: string; default?: unknown; defaultFn?: () => unknown; columnType?: string };

function columnsOf(table: Table): Record<string, ColumnLike> {
  return getTableColumns(table) as unknown as Record<string, ColumnLike>;
}

/** A row as Postgres would store it: every declared column present, unset ones at their default or null. */
function withDefaults(table: Table, values: Row, store: BoqStore): Row {
  const row: Row = {};
  for (const [key, col] of Object.entries(columnsOf(table))) {
    if (values[key] !== undefined) {
      row[key] = values[key];
    } else if (key === "id") {
      row[key] = `${getTableName(table)}_${store.nextId++}`;
    } else {
      const fallback = col.defaultFn ? col.defaultFn() : col.default;
      // defaultNow() and friends are SQL; a timestamp gets "now", anything else null.
      row[key] = is(fallback, SQL) ? (col.columnType?.startsWith("PgTimestamp") ? new Date() : null) : (fallback ?? null);
    }
  }
  return row;
}

/** Seed rows for a fixture, with the same defaults an insert gets. */
export function seedRows(store: BoqStore, tableName: string, rows: Row[]): void {
  const table = TABLE_BY_NAME[tableName];
  if (!table) throw new Error(`boq-store-double: no schema table named ${tableName}`);
  store.tables[tableName] = [...(store.tables[tableName] ?? []), ...rows.map((r) => withDefaults(table, r, store))];
}

export function makeBoqStore(): BoqStore {
  return { tables: {}, nextId: 1, unparsed: [], open: 0, maxOpen: 0, transactions: 0 };
}

export function rowsOf(store: BoqStore, tableName: string): Row[] {
  return store.tables[tableName] ?? [];
}

const TOKEN = /"[^"]+"(?:\."[^"]+")*|\$\d+|[(),=]|[A-Za-z_]+|\S/g;

/**
 * The real where clause, compiled and evaluated. Reads `col = $n`,
 * `col in ($a, $b)`, `col is [not] null`, `and`, `or` and parentheses; any
 * other shape matches nothing and is recorded, so the fake can never silently
 * match everything.
 */
function predicate(table: Table, where: unknown, unparsed: string[]): (r: Row) => boolean {
  if (typeof where === "function") {
    where = (where as (t: unknown, ops: unknown) => unknown)(getTableColumns(table), { and, or, eq, ne, inArray, isNull, isNotNull });
  }
  if (!where) return () => true;
  const { sql, params } = dialect.sqlToQuery(where as SQL);
  const keyOf = Object.fromEntries(Object.entries(columnsOf(table)).map(([key, col]) => [col.name, key]));
  const tokens = sql.match(TOKEN) ?? [];
  let i = 0;
  const peek = () => tokens[i]?.toLowerCase();
  const fail = (): never => {
    throw new Error("unparsed");
  };
  const expect = (t: string) => {
    if (tokens[i++]?.toLowerCase() !== t) fail();
  };
  const column = (): string => {
    const token = tokens[i++] ?? "";
    if (!token.startsWith('"')) fail();
    const key = keyOf[token.split('"."').pop()!.replace(/"/g, "")];
    return key ?? fail();
  };
  const param = (): unknown => {
    const m = /^\$(\d+)$/.exec(tokens[i++] ?? "");
    return m ? params[Number(m[1]) - 1] : fail();
  };
  const primary = (): ((r: Row) => boolean) => {
    if (peek() === "(") {
      i++;
      const inner = anyOf();
      expect(")");
      return inner;
    }
    const key = column();
    const op = tokens[i++]?.toLowerCase();
    if (op === "=") {
      const value = param();
      return (r) => r[key] === value;
    }
    if (op === "in") {
      expect("(");
      const values = [param()];
      while (peek() === ",") {
        i++;
        values.push(param());
      }
      expect(")");
      return (r) => values.includes(r[key]);
    }
    if (op === "is") {
      const negated = peek() === "not";
      if (negated) i++;
      expect("null");
      return negated ? (r) => r[key] !== null && r[key] !== undefined : (r) => r[key] === null || r[key] === undefined;
    }
    return fail();
  };
  const allOf = (): ((r: Row) => boolean) => {
    const parts = [primary()];
    while (peek() === "and") {
      i++;
      parts.push(primary());
    }
    return (r) => parts.every((p) => p(r));
  };
  const anyOf = (): ((r: Row) => boolean) => {
    const parts = [allOf()];
    while (peek() === "or") {
      i++;
      parts.push(allOf());
    }
    return (r) => parts.some((p) => p(r));
  };
  try {
    const matches = anyOf();
    if (i !== tokens.length) fail();
    return matches;
  } catch {
    unparsed.push(sql);
    return () => false;
  }
}

function thenable<T>(run: () => T) {
  return {
    then: (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  };
}

/** `.returning({ id: table.id })` or `db.select({ ... })`: alias -> the row's value for that column. */
function project(table: Table, row: Row, selection?: Record<string, unknown>): Row {
  if (!selection) return { ...row };
  const columns = Object.entries(getTableColumns(table));
  return Object.fromEntries(
    Object.entries(selection).map(([alias, col]) => [alias, row[columns.find(([, c]) => c === col)?.[0] ?? alias]])
  );
}

function makeTransaction(store: BoqStore) {
  const working: Tables = Object.fromEntries(Object.entries(store.tables).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  let dirty = false;
  const rows = (table: Table) => (working[getTableName(table)] ??= []);

  const query = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== "string" || key === "then") return undefined;
        const table = TABLES[key];
        return {
          findFirst: async (cfg: { where?: unknown } = {}) => {
            if (!table) return undefined;
            const found = rows(table).find(predicate(table, cfg.where, store.unparsed));
            return found ? { ...found } : undefined;
          },
          findMany: async (cfg: { where?: unknown; limit?: number } = {}) => {
            if (!table) return [];
            const found = rows(table).filter(predicate(table, cfg.where, store.unparsed)).map((r) => ({ ...r }));
            return cfg.limit === undefined ? found : found.slice(0, cfg.limit);
          },
        };
      },
    }
  );

  const insert = (table: Table) => ({
    values: (values: Row | Row[]) => {
      let staged: Row[] | null = null;
      const stage = () => {
        if (!staged) {
          dirty = true;
          staged = (Array.isArray(values) ? values : [values]).map((v) => withDefaults(table, v, store));
          rows(table).push(...staged);
        }
        return staged;
      };
      const returning = async (selection?: Record<string, unknown>) => stage().map((r) => project(table, r, selection));
      return {
        returning,
        onConflictDoUpdate: () => ({ returning, ...thenable(stage) }),
        onConflictDoNothing: () => ({ returning, ...thenable(stage) }),
        ...thenable(stage),
      };
    },
  });

  const update = (table: Table) => ({
    set: (values: Row) => ({
      where: (cond: unknown) => {
        let changed: Row[] | null = null;
        const apply = () => {
          if (!changed) {
            dirty = true;
            changed = rows(table).filter(predicate(table, cond, store.unparsed));
            for (const row of changed) Object.assign(row, values);
          }
          return changed;
        };
        return {
          returning: async (selection?: Record<string, unknown>) => apply().map((r) => project(table, r, selection)),
          ...thenable(apply),
        };
      },
    }),
  });

  const select = (selection?: Record<string, unknown>) => ({
    from: (table: Table) => {
      const run = (cond: unknown, limit?: number) => {
        const found = rows(table).filter(predicate(table, cond, store.unparsed)).map((r) => project(table, r, selection));
        return limit === undefined ? found : found.slice(0, limit);
      };
      return {
        where: (cond: unknown) => ({ limit: async (n: number) => run(cond, n), ...thenable(() => run(cond)) }),
        limit: async (n: number) => run(undefined, n),
        ...thenable(() => run(undefined)),
      };
    },
  });

  return {
    db: { query, insert, update, select, execute: async () => [] },
    commit: () => {
      if (dirty) store.tables = working;
    },
  };
}

/** The withTenantContext stand-in: one transaction per call, committed on success, discarded on throw. */
export function fakeWithTenantContext(getStore: () => BoqStore) {
  return async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const store = getStore();
    store.open += 1;
    store.maxOpen = Math.max(store.maxOpen, store.open);
    store.transactions += 1;
    try {
      const txn = makeTransaction(store);
      const result = await fn(txn.db);
      txn.commit();
      return result;
    } finally {
      store.open -= 1;
    }
  };
}

/** Every key, at any depth, of a JSON-like value -- for "no project-side cost field anywhere in it". */
export function keysDeep(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, out);
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, v] of Object.entries(value)) {
      out.add(key);
      keysDeep(v, out);
    }
  }
  return out;
}
