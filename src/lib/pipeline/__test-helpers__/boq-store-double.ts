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
// U-29 fix round 1 adds six things, each opt-in or unreachable to a test that
// never uses it (the tests written before it still pass unchanged):
//   - a where clause may read a jsonb column's text field (`col ->> 'key'`) in
//     `=`, `in` and `is [not] null`, which is how the approval list filters on
//     selected_chain and how an approval claims a proposal;
//   - an update's set value may be `col || $n::jsonb` (merge a JSON object into
//     the column), which is how a proposal is claimed and marked;
//   - select().from().where() takes orderBy(...) and limit(n), sorted before the
//     limit as SQL does;
//   - `store.serialise = true` runs the transactions one after another, in call
//     order, so two overlapping requests see each other's committed rows. A real
//     UPDATE ... WHERE waits for a row another transaction has updated and then
//     re-reads the row, so a conditional update that matches once matches once
//     across two requests; without this switch the double gives each transaction
//     a private snapshot and the last commit wins. A transaction that opens
//     another inside itself waits for its own parent, so a nested call hangs
//     the test instead of passing;
//   - failNext() makes the next insert or update on a table throw, to test what
//     a caller does when a write after the one that matters fails; and
//     store.updateLog records how many rows each update matched, so a test can
//     show that a conditional update lost by matching none.
//
// NOT modelled: orderBy on db.query reads, `columns` projection on db.query reads
// (full rows come back), ON CONFLICT (an upsert inserts), joins, row locks between
// overlapping transactions (see serialise above).
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
  /** true: transactions run one after another in call order (see the header) */
  serialise?: boolean;
  /** the tail of the serialised transactions; never rejects */
  queue?: Promise<void>;
  /** writes armed to fail by failNext() */
  faults?: Array<{ table: string; op: "insert" | "update"; skip: number; remaining: number }>;
  /** every update statement that ran, with the number of rows its where clause matched (a conditional update that lost matches 0) */
  updateLog?: Array<{ table: string; matched: number }>;
};

/**
 * Make an insert or update on `table` throw. `skip` lets that many matching writes through first (an approval's own
 * claim is the first update of a submission, so a test that wants the write after it to fail skips one); `times` is
 * how many writes then fail. Each armed fault is consumed as it fires.
 */
export function failNext(store: BoqStore, table: string, op: "insert" | "update", options: { skip?: number; times?: number } = {}): void {
  (store.faults ??= []).push({ table, op, skip: options.skip ?? 0, remaining: options.times ?? 1 });
}

function fireFault(store: BoqStore, table: Table, op: "insert" | "update"): void {
  const name = getTableName(table);
  const fault = store.faults?.find((f) => f.table === name && f.op === op && f.remaining > 0);
  if (!fault) return;
  if (fault.skip > 0) {
    fault.skip -= 1;
    return;
  }
  fault.remaining -= 1;
  throw new Error(`boq-store-double: injected ${op} failure on ${name}`);
}

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

const TOKEN = /'[^']*'|->>|"[^"]+"(?:\."[^"]+")*|\$\d+|[(),=]|[A-Za-z_]+|\S/g;

/** `col ->> 'key'`: the text of one field of a jsonb object, or null (SQL NULL) when it is absent or JSON null. */
function jsonText(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined || field === null) return null;
  return typeof field === "string" ? field : typeof field === "object" ? JSON.stringify(field) : String(field);
}

/**
 * The real where clause, compiled and evaluated. Reads `col = $n`,
 * `col in ($a, $b)`, `col is [not] null`, the same three on `col ->> 'key'`,
 * `and`, `or` and parentheses; any other shape matches nothing and is recorded,
 * so the fake can never silently match everything.
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
    let read = (r: Row): unknown => r[key];
    if (peek() === "->>") {
      i++;
      const literal = tokens[i++] ?? "";
      if (!literal.startsWith("'")) fail();
      const field = literal.slice(1, -1);
      read = (r) => jsonText(r[key], field);
    }
    const op = tokens[i++]?.toLowerCase();
    if (op === "=") {
      const value = param();
      return (r) => read(r) === value;
    }
    if (op === "in") {
      expect("(");
      const values = [param()];
      while (peek() === ",") {
        i++;
        values.push(param());
      }
      expect(")");
      return (r) => values.includes(read(r));
    }
    if (op === "is") {
      const negated = peek() === "not";
      if (negated) i++;
      expect("null");
      return negated ? (r) => read(r) !== null && read(r) !== undefined : (r) => read(r) === null || read(r) === undefined;
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

/**
 * An update's set clause. A plain value is assigned. `col || $n::jsonb` merges a JSON object into the column (as
 * Postgres does: NULL stays NULL, the right side's keys win). Any other SQL is recorded in `unparsed` and leaves the
 * column as it was, so a test that asserts `store.unparsed` is empty fails instead of passing on an unmodelled write.
 */
function setValues(table: Table, values: Row, row: Row, unparsed: string[]): Row {
  const keyOf = Object.fromEntries(Object.entries(columnsOf(table)).map(([key, col]) => [col.name, key]));
  const out: Row = {};
  for (const [key, value] of Object.entries(values)) {
    if (!is(value, SQL)) {
      out[key] = value;
      continue;
    }
    const { sql, params } = dialect.sqlToQuery(value);
    const m = /^(?:"[^"]+"\.)*"([^"]+)"\s*\|\|\s*\$(\d+)::jsonb$/.exec(sql.trim());
    const target = m ? keyOf[m[1]] : undefined;
    if (!m || target !== key) {
      unparsed.push(sql);
      continue;
    }
    const current = row[key];
    if (current === null || current === undefined) {
      out[key] = null;
      continue;
    }
    out[key] = { ...(current as Record<string, unknown>), ...(JSON.parse(String(params[Number(m[2]) - 1])) as Record<string, unknown>) };
  }
  return out;
}

/** ORDER BY over `"col" [asc|desc]` terms; NULLs sort last ascending and first descending, as in Postgres. */
function sortRows(table: Table, found: Row[], orders: unknown[], unparsed: string[]): Row[] {
  if (orders.length === 0) return found;
  const keyOf = Object.fromEntries(Object.entries(columnsOf(table)).map(([key, col]) => [col.name, key]));
  const terms: Array<{ key: string; desc: boolean }> = [];
  for (const order of orders) {
    const { sql } = dialect.sqlToQuery(order as SQL);
    const m = /^(?:"[^"]+"\.)*"([^"]+)"(?:\s+(asc|desc))?$/i.exec(sql.trim());
    const key = m ? keyOf[m[1]] : undefined;
    if (!m || !key) {
      unparsed.push(sql);
      return found;
    }
    terms.push({ key, desc: (m[2] ?? "asc").toLowerCase() === "desc" });
  }
  const scalar = (v: unknown) => (v instanceof Date ? v.getTime() : v);
  return [...found].sort((a, b) => {
    for (const { key, desc } of terms) {
      const x = scalar(a[key]);
      const y = scalar(b[key]);
      if (x === y) continue;
      if (x === null || x === undefined) return desc ? -1 : 1;
      if (y === null || y === undefined) return desc ? 1 : -1;
      const cmp = (x as number | string) < (y as number | string) ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
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
          fireFault(store, table, "insert");
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
            fireFault(store, table, "update");
            dirty = true;
            changed = rows(table).filter(predicate(table, cond, store.unparsed));
            for (const row of changed) Object.assign(row, setValues(table, values, row, store.unparsed));
            (store.updateLog ??= []).push({ table: getTableName(table), matched: changed.length });
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
      // Filter, then sort, then limit, then project: the order SQL applies them in.
      const run = (cond: unknown, orders: unknown[] = [], limit?: number) => {
        const found = sortRows(table, rows(table).filter(predicate(table, cond, store.unparsed)), orders, store.unparsed).map((r) => project(table, r, selection));
        return limit === undefined ? found : found.slice(0, limit);
      };
      return {
        where: (cond: unknown) => ({
          orderBy: (...orders: unknown[]) => ({ limit: async (n: number) => run(cond, orders, n), ...thenable(() => run(cond, orders)) }),
          limit: async (n: number) => run(cond, [], n),
          ...thenable(() => run(cond)),
        }),
        limit: async (n: number) => run(undefined, [], n),
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
    const run = async () => {
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
    if (!store.serialise) return run();
    // One transaction at a time, in call order: the next starts when the previous has committed or thrown.
    const turn = (store.queue ?? Promise.resolve()).then(run);
    store.queue = turn.then(
      () => undefined,
      () => undefined
    );
    return turn;
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
