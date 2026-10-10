/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-18 (register row BR-288, audit A-11 / F-S02-11): an id
// parameter that names a record of ANOTHER project of the same org is refused
// by the executor, and nothing is written.
//
// Before this, the executors behind four id-taking functions trusted the id
// as long as it was in the org: recordAttendance found the roster member, logTime
// the issue and createBoqRevision the parent BOQ by id and org only. So a
// worker of project B posted with project A got attendance booked on A, hours
// were logged against B's task, and B's BOQ was revised -- for a caller whose
// link or key is scoped to A, a write outside its project. (The BOQ line of
// record_work_progress was already looked up inside the project's own BOQ; it
// is proven here with the other three.)
//
// It also proves run-submission.ts's projectScope: the submission is pinned to
// the scope, a conflicting projectId is a ServiceError 403 before any write, a
// project named in the params is PROJECT_NOT_REACHABLE, and a stored
// submission of another project cannot be confirmed. Without a scope nothing
// changes.
//
// WHAT IS REAL: executor.ts and the services it calls (recordAttendance,
// logTime, createBoqRevision's entry), run-submission.ts, validate(), the
// registry. WHAT IS FAKED: only @/lib/db/tenant-scoped. Its fake compiles the
// REAL drizzle `where` each query builds (PgDialect.sqlToQuery, the compiler
// the driver uses) and evaluates it against fixture rows, with staged writes
// committed on success and discarded on throw -- so if an executor stops
// scoping a lookup to its project, the other project's row becomes visible and
// the write lands in the store, and these tests fail.
//
// Run: bun test --isolate src/lib/pipeline/executor-project-scope.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { getTableColumns, getTableName, is, Table, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { ServiceError } from "@/lib/services/compliance-service";

const ORG = "org_1";
const USER = "user_1";
const PROJECT_A = "project_a";
const PROJECT_B = "project_b";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fixtures(): Tables {
  return {
    projects: [
      { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
      { id: PROJECT_B, orgId: ORG, name: "Oakwood" },
    ],
    construction_labour_roster: [
      { id: "roster_a", orgId: ORG, projectId: PROJECT_A, name: "Asha", dailyRate: "800" },
      { id: "roster_b", orgId: ORG, projectId: PROJECT_B, name: "Babu", dailyRate: "900" },
    ],
    construction_attendance: [],
    pms_issues: [
      { id: "issue_a", orgId: ORG, projectId: PROJECT_A, number: 12, title: "Joinery shop drawings" },
      { id: "issue_b", orgId: ORG, projectId: PROJECT_B, number: 7, title: "Facade cladding" },
    ],
    pms_time_entries: [],
    construction_boqs: [
      { id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1 },
      { id: "boq_b", orgId: ORG, projectId: PROJECT_B, version: 1 },
    ],
    construction_boq_line_items: [
      { id: "line_a", boqId: "boq_a", itemCode: "EX-01", quantity: "10" },
      { id: "line_b", boqId: "boq_b", itemCode: "EX-01", quantity: "10" },
    ],
    construction_activities: [{ id: "act_a", orgId: ORG, projectId: PROJECT_A }],
    users: [{ id: USER, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.com" }],
    submissions: [],
    pipeline_tasks: [],
  };
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

type Store = { tables: Tables; nextId: number; phraseMapRow: Row | null; unparsed: string[] };
let store: Store;

function thenable(run: () => unknown) {
  return {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  };
}

function makeTransaction() {
  const working: Tables = Object.fromEntries(Object.entries(store.tables).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  const rowsOf = (table: Table) => (working[getTableName(table)] ??= []);

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
    const row: Row = { id: `${getTableName(table)}_${store.nextId++}`, ...v };
    rowsOf(table).push(row);
    return row;
  };

  const db = {
    query,
    execute: async () => [],
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
            for (const row of rowsOf(table).filter(predicate(table, cond, store.unparsed))) Object.assign(row, values);
          }),
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

const realTenantScoped = await import("@/lib/db/tenant-scoped");
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const txn = makeTransaction();
    const result = await fn(txn.db);
    txn.commit();
    return result;
  }),
}));

let executeTask: typeof import("./executor").executeTask;
let runSubmission: typeof import("./run-submission").runSubmission;
let runDirectTask: typeof import("./run-submission").runDirectTask;
let confirmSubmission: typeof import("./run-submission").confirmSubmission;
beforeAll(async () => {
  ({ executeTask } = await import("./executor"));
  ({ runSubmission, runDirectTask, confirmSubmission } = await import("./run-submission"));
});

let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = { tables: fixtures(), nextId: 1, phraseMapRow: null, unparsed: [] };
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
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
});

const rows = (table: string) => store.tables[table] ?? [];
const task = (functionId: string, params: Row) => ({ orgId: ORG, userId: USER, projectId: PROJECT_A, functionId, params, actorUserId: USER });
const TODAY = "2026-09-25";

describe("executor: an id of another project of the same org is refused and writes 0 rows (BR-288)", () => {
  test("record_attendance: a roster member of project B, on project A -> RECORD_NOT_FOUND (worker), no attendance row", async () => {
    const outcome = await executeTask(task("record_attendance", { rosterId: "roster_b", date: TODAY }));

    expect(outcome).toEqual({ success: false, failure: { code: "RECORD_NOT_FOUND", missing: ["worker"], picker: "none" } });
    expect(rows("construction_attendance")).toEqual([]);
  });

  test("record_attendance: a roster member of project A, on project A -> written, on A", async () => {
    const outcome = await executeTask(task("record_attendance", { rosterId: "roster_a", date: TODAY }));

    expect(outcome.success).toBe(true);
    expect(rows("construction_attendance").map((r) => [r.projectId, r.rosterId])).toEqual([[PROJECT_A, "roster_a"]]);
  });

  test("record_timesheet: an issue of project B, on project A -> RECORD_NOT_FOUND (task), no hours logged", async () => {
    const outcome = await executeTask(task("record_timesheet", { issueId: "issue_b", hours: 2 }));

    expect(outcome).toEqual({ success: false, failure: { code: "RECORD_NOT_FOUND", missing: ["task"], picker: "none" } });
    expect(rows("pms_time_entries")).toEqual([]);
  });

  test("record_timesheet: an issue of project A, on project A -> hours logged against it", async () => {
    const outcome = await executeTask(task("record_timesheet", { issueId: "issue_a", hours: 2 }));

    expect(outcome.success).toBe(true);
    expect(rows("pms_time_entries").map((r) => [r.issueId, r.userId, r.hours])).toEqual([["issue_a", USER, "2.00"]]);
  });

  test("record_work_progress: a BOQ line of project B, on project A -> BOQ_LINE_NOT_FOUND, no progress entry", async () => {
    const before = JSON.stringify(store.tables);

    const outcome = await executeTask(task("record_work_progress", { boqLineItemId: "line_b", percent: 40 }));

    expect(outcome.success).toBe(false);
    expect(outcome.success === false && outcome.failure.code).toBe("BOQ_LINE_NOT_FOUND");
    expect(JSON.stringify(store.tables)).toBe(before);
  });

  test("create_boq_revision: a BOQ of project B, on project A -> RECORD_NOT_FOUND (boqVersion), no BOQ written", async () => {
    const before = JSON.stringify(store.tables);

    const outcome = await executeTask(task("create_boq_revision", { boqId: "boq_b", title: "Rev 2" }));

    expect(outcome).toEqual({ success: false, failure: { code: "RECORD_NOT_FOUND", missing: ["boqVersion"], picker: "none" } });
    expect(JSON.stringify(store.tables)).toBe(before);
  });

  test("every lookup above was evaluated for real (the fake refused no where clause)", async () => {
    await executeTask(task("record_attendance", { rosterId: "roster_b", date: TODAY }));
    await executeTask(task("record_timesheet", { issueId: "issue_b", hours: 2 }));
    await executeTask(task("create_boq_revision", { boqId: "boq_b" }));
    expect(store.unparsed).toEqual([]);
  });
});

describe("run-submission projectScope: a scoped submission runs on its project only (BR-288, BR-210)", () => {
  const MISS_TEXT = "xyzzy unmatched phrase";

  test("runSubmission with a projectId other than the scope is a ServiceError 403, and nothing is written", async () => {
    const before = JSON.stringify(store.tables);

    const error = await runSubmission({ orgId: ORG, userId: USER, mode: "Projects", projectId: PROJECT_B, rawInput: MISS_TEXT, level1: "off", projectScope: PROJECT_A }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(403);
    expect(JSON.stringify(store.tables)).toBe(before);
  });

  test("runSubmission naming no project is pinned to the scope", async () => {
    await runSubmission({ orgId: ORG, userId: USER, mode: "Projects", projectId: null, rawInput: MISS_TEXT, level1: "off", projectScope: PROJECT_A });

    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_A]);
  });

  test("runSubmission: a project named by a promoted phrase is PROJECT_NOT_REACHABLE for a scoped caller, and no task is minted", async () => {
    store.phraseMapRow = { functionId: "record_attendance", fixedParams: { projectId: PROJECT_B, rosterId: "roster_b", date: TODAY }, promotedAt: new Date() };

    const result = await runSubmission({ orgId: ORG, userId: USER, mode: "Projects", projectId: PROJECT_A, rawInput: MISS_TEXT, level1: "off", projectScope: PROJECT_A });

    expect(result.failures.map((f) => f.code)).toEqual(["PROJECT_NOT_REACHABLE"]);
    expect(rows("pipeline_tasks")).toEqual([]);
    expect(rows("construction_attendance")).toEqual([]);
  });

  test("runDirectTask: params naming project B under a project-A scope -> PROJECT_NOT_REACHABLE, no task, no attendance", async () => {
    const result = await runDirectTask({
      orgId: ORG, userId: USER, mode: "Projects", functionId: "record_attendance",
      params: { projectId: PROJECT_B, rosterId: "roster_b", date: TODAY },
      projectScope: PROJECT_A,
    });

    expect(result.failures.map((f) => f.code)).toEqual(["PROJECT_NOT_REACHABLE"]);
    expect(rows("submissions").map((r) => r.projectId)).toEqual([PROJECT_A]);
    expect(rows("pipeline_tasks")).toEqual([]);
    expect(rows("construction_attendance")).toEqual([]);
  });

  test("runDirectTask: a project-B worker under a project-A scope reaches the executor, which refuses it; no attendance", async () => {
    const result = await runDirectTask({
      orgId: ORG, userId: USER, mode: "Projects", functionId: "record_attendance",
      params: { rosterId: "roster_b", date: TODAY },
      projectScope: PROJECT_A,
    });

    expect(result.status).toBe("failed");
    expect(result.tasks[0].failure).toEqual({ code: "RECORD_NOT_FOUND", missing: ["worker"], picker: "none" });
    expect(rows("pipeline_tasks").map((r) => r.projectId)).toEqual([PROJECT_A]);
    expect(rows("construction_attendance")).toEqual([]);
  });

  test("runDirectTask: a project-A worker under a project-A scope is written, on A", async () => {
    const result = await runDirectTask({
      orgId: ORG, userId: USER, mode: "Projects", functionId: "record_attendance",
      params: { rosterId: "roster_a", date: TODAY },
      projectScope: PROJECT_A,
    });

    expect(result.status).toBe("done");
    expect(rows("construction_attendance").map((r) => [r.projectId, r.rosterId])).toEqual([[PROJECT_A, "roster_a"]]);
  });

  test("without a scope nothing changes: an org-wide caller still writes on the project it names", async () => {
    const result = await runDirectTask({
      orgId: ORG, userId: USER, mode: "Projects", projectId: PROJECT_B, functionId: "record_attendance",
      params: { rosterId: "roster_b", date: TODAY },
    });

    expect(result.status).toBe("done");
    expect(rows("construction_attendance").map((r) => [r.projectId, r.rosterId])).toEqual([[PROJECT_B, "roster_b"]]);
  });

  test("confirmSubmission of a stored project-B submission under a project-A scope is a ServiceError 403, nothing run", async () => {
    store.tables.submissions.push({ id: "sub_b", orgId: ORG, projectId: PROJECT_B, mode: "Projects", rawInput: MISS_TEXT, userId: "someone_else" });
    const before = JSON.stringify(store.tables);

    const error = await confirmSubmission({ orgId: ORG, userId: USER, submissionId: "sub_b", projectScope: PROJECT_A }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(403);
    expect(JSON.stringify(store.tables)).toBe(before);
  });
});
