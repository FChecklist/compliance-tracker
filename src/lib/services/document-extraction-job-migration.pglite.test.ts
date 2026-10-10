/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02: offline proof of drizzle/0646_build002_source_object_job_state.sql (the nullable job_state and job_result
// columns of compliance.source_object and the CHECK source_object_job_state_check) and its down file, on PGlite (real Postgres
// compiled to WASM). No live database is touched.
//
// BASE: the definition of compliance.source_object as it is live (SOURCE_OBJECT_BASE_SQL in __test-helpers__/document-extraction-
// pglite.ts: 30 columns, the primary key, the three CHECKs, the unique doc_uid and the partial unique index on (org_id, sha256),
// read from pcrjmlpuqsbocqfwoxod on 2026-09-25 and read again on 2026-09-26 for this file: 30 columns, four constraints).
//
// WHAT IS PROVEN, in order (the tests share one database and run in order):
//   1. before 0646 the two columns do not exist;
//   2. 0646 adds exactly two nullable columns with no default (text and jsonb) and one validated CHECK; every existing row keeps
//      every value and reads NULL in the new columns; a second run changes nothing;
//   3. the CHECK accepts NULL and each of the six states and refuses any other value (SQLSTATE 23514, on INSERT and on UPDATE), and
//      job_result takes any JSON value;
//   4. the table after 0646 equals SOURCE_OBJECT_BASE_SQL plus SOURCE_OBJECT_JOB_SQL, the definition the from-document tests run
//      against: nothing else about the table changed (columns, constraints, indexes), so the test double and the migration agree;
//   5. the down file removes the check and the two columns, restores the exact prior schema, keeps every row apart from the two
//      values (the data loss its header states), is safe to run twice, and the forward file applies again after it.
//
// Run: bun test --isolate src/lib/services/document-extraction-job-migration.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { SOURCE_OBJECT_BASE_SQL, SOURCE_OBJECT_JOB_SQL } from "./__test-helpers__/document-extraction-pglite"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const FORWARD = read("drizzle/0646_build002_source_object_job_state.sql")
const DOWN = read("drizzle/down/0646_build002_source_object_job_state.down.sql")

const SEED_SQL = `
INSERT INTO compliance.source_object (id, org_id, origin, origin_ref, mime_type, byte_size, sha256, title, linked_entity_type, linked_entity_id, extract_status, doc_uid, content_sha256, display_name)
VALUES
  ('so-ledger-1', 'org_a', 'upload', 'projexa-from-document:v1', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1234, 'key-1', 'zoomies.xlsx', 'project', 'project-1', 'SKIPPED_UNSUPPORTED', 'doc-1', 'hash-1', 'zoomies.xlsx'),
  ('so-claim-1', 'org_a', 'upload', 'projexa-from-document:v1', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 99, 'key-2', 'other.xlsx', 'project', NULL, 'SKIPPED_UNSUPPORTED', 'doc-2', 'hash-2', 'other.xlsx'),
  ('so-doc-1', 'org_b', 'inapp', NULL, 'application/pdf', 4096, 'realhash', 'notice.pdf', 'document', 'doc_9', 'EMBEDDED', 'doc-3', 'realhash', 'notice.pdf');
`

// Columns, constraints and indexes of the table, one string each, so that two definitions compare as lists.
const SHAPE_SQL = `
with cols as (
  select 'col:'||lpad(ordinal_position::text, 3, '0')||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default, '') s
  from information_schema.columns where table_schema = 'compliance' and table_name = 'source_object'
), cons as (
  select 'con:'||k.conname||':'||k.contype::text||':'||k.convalidated::text||':'||pg_get_constraintdef(k.oid) s
  from pg_constraint k where k.conrelid = 'compliance.source_object'::regclass
), idx as (
  select 'idx:'||indexname||':'||indexdef s from pg_indexes where schemaname = 'compliance' and tablename = 'source_object'
)
select s from (select * from cols union all select * from cons union all select * from idx) a order by s`

let pg: PGlite

async function shape(db: PGlite = pg): Promise<string[]> {
  return (await db.query<{ s: string }>(SHAPE_SQL)).rows.map((r) => r.s)
}
async function columnNames(): Promise<string[]> {
  return (await pg.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'compliance' and table_name = 'source_object' order by ordinal_position`)).rows.map((r) => r.c)
}
async function rowsJson(): Promise<string[]> {
  return (await pg.query<{ j: string }>(`select to_jsonb(r)::text j from compliance.source_object r order by id`)).rows.map((r) => r.j)
}
async function failure(sqlText: string): Promise<{ code: string; constraint: string | null }> {
  try {
    await pg.exec(sqlText)
  } catch (err) {
    const e = err as { code?: string; constraint?: string }
    return { code: String(e.code), constraint: e.constraint ?? null }
  }
  throw new Error(`expected this SQL to fail: ${sqlText}`)
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec("CREATE SCHEMA compliance;")
  await pg.exec(SOURCE_OBJECT_BASE_SQL)
  await pg.exec(SEED_SQL)
})

afterAll(async () => {
  await pg.close()
})

describe("0646 on the live definition of compliance.source_object", () => {
  let baseShape: string[] = []
  let baseRows: string[] = []
  let baseColumns: string[] = []

  test("before the migration the two columns do not exist and the table has the 30 live columns", async () => {
    baseColumns = await columnNames()
    expect(baseColumns).toHaveLength(30)
    expect(baseColumns).not.toContain("job_state")
    expect(baseColumns).not.toContain("job_result")
    baseShape = await shape()
    baseRows = await rowsJson()
    expect(baseRows).toHaveLength(3)
  })

  test("0646 adds two nullable columns with no default and one validated check; every existing row keeps its values and reads NULL", async () => {
    await pg.exec(FORWARD)
    const after = await columnNames()
    expect(after).toEqual([...baseColumns, "job_state", "job_result"])
    const cols = (await pg.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'compliance' and table_name = 'source_object' and column_name in ('job_state', 'job_result') order by column_name`,
    )).rows
    expect(cols).toEqual([
      { column_name: "job_result", data_type: "jsonb", is_nullable: "YES", column_default: null },
      { column_name: "job_state", data_type: "text", is_nullable: "YES", column_default: null },
    ])
    const check = (await pg.query<{ convalidated: boolean; def: string }>(
      `select convalidated, pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'compliance.source_object'::regclass and conname = 'source_object_job_state_check'`,
    )).rows
    expect(check).toHaveLength(1)
    expect(check[0].convalidated).toBe(true)
    // Every row is what it was, plus two NULLs.
    const rows = (await rowsJson()).map((j) => JSON.parse(j) as Record<string, unknown>)
    expect(rows.every((r) => r.job_state === null && r.job_result === null)).toBe(true)
    const stripped = rows.map((r) => {
      const { job_state: _s, job_result: _r, ...rest } = r
      return JSON.stringify(Object.fromEntries(Object.keys(rest).sort().map((k) => [k, rest[k]])))
    })
    const canonBase = baseRows.map((j) => {
      const o = JSON.parse(j) as Record<string, unknown>
      return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))
    })
    expect(stripped).toEqual(canonBase)
  })

  test("a second run changes nothing", async () => {
    const before = await shape()
    await pg.exec(FORWARD)
    expect(await shape()).toEqual(before)
    expect(await columnNames()).toHaveLength(32)
  })

  test("the check accepts NULL and each of the six states and refuses any other value, on INSERT and on UPDATE", async () => {
    const insert = (id: string, state: string | null) =>
      `INSERT INTO compliance.source_object (id, org_id, origin, sha256, extract_status, doc_uid, job_state) VALUES ('${id}', 'org_c', 'upload', 'k-${id}', 'SKIPPED_UNSUPPORTED', 'd-${id}', ${state === null ? "NULL" : `'${state}'`})`
    for (const state of [null, "received", "reading", "needs_answers", "ready", "created", "rejected"]) {
      await pg.exec(insert(`ok-${state ?? "null"}`, state))
    }
    const bad = await failure(insert("bad-1", "done"))
    expect(bad).toEqual({ code: "23514", constraint: "source_object_job_state_check" })
    const badUpdate = await failure(`UPDATE compliance.source_object SET job_state = 'NEEDS_ANSWERS' WHERE id = 'so-claim-1'`)
    expect(badUpdate).toEqual({ code: "23514", constraint: "source_object_job_state_check" })
    // job_result takes any JSON value, an object, an array or a scalar.
    await pg.exec(`UPDATE compliance.source_object SET job_result = '{"v":1,"questions":[{"kind":"no_rate"}]}'::jsonb, job_state = 'needs_answers' WHERE id = 'so-claim-1'`)
    expect((await pg.query<{ v: string }>(`select job_result->'questions'->0->>'kind' v from compliance.source_object where id = 'so-claim-1'`)).rows[0].v).toBe("no_rate")
    await pg.exec(`DELETE FROM compliance.source_object WHERE id like 'ok-%'`)
    await pg.exec(`UPDATE compliance.source_object SET job_result = NULL, job_state = NULL WHERE id = 'so-claim-1'`)
  })

  test("the table after 0646 is exactly SOURCE_OBJECT_BASE_SQL plus SOURCE_OBJECT_JOB_SQL, the definition the from-document tests run against", async () => {
    const twin = new PGlite()
    try {
      await twin.exec("CREATE SCHEMA compliance;")
      await twin.exec(SOURCE_OBJECT_BASE_SQL)
      await twin.exec(SOURCE_OBJECT_JOB_SQL)
      expect(await shape(twin)).toEqual(await shape())
    } finally {
      await twin.close()
    }
    // Nothing else about the table moved: the base's constraints and indexes are all still there, unchanged.
    const now = await shape()
    for (const s of baseShape.filter((x) => !x.startsWith("col:"))) expect(now).toContain(s)
  })
})

describe("the down file", () => {
  test("removes the check and both columns and restores the exact prior schema, keeping every row", async () => {
    await pg.exec(`UPDATE compliance.source_object SET job_state = 'rejected', job_result = '{"code":"x"}'::jsonb WHERE id = 'so-doc-1'`)
    const before = (await rowsJson()).length
    await pg.exec(DOWN)
    const cols = await columnNames()
    expect(cols).toHaveLength(30)
    expect(cols).not.toContain("job_state")
    expect(cols).not.toContain("job_result")
    expect((await pg.query(`select 1 from pg_constraint where conrelid = 'compliance.source_object'::regclass and conname = 'source_object_job_state_check'`)).rows).toHaveLength(0)
    expect((await rowsJson()).length).toBe(before)
    // The prior schema exactly: the shape of a fresh base.
    const fresh = new PGlite()
    try {
      await fresh.exec("CREATE SCHEMA compliance;")
      await fresh.exec(SOURCE_OBJECT_BASE_SQL)
      expect(await shape()).toEqual(await shape(fresh))
    } finally {
      await fresh.close()
    }
  })

  test("is safe to run twice, and the forward file applies again after it", async () => {
    await pg.exec(DOWN)
    expect(await columnNames()).toHaveLength(30)
    await pg.exec(FORWARD)
    expect(await columnNames()).toHaveLength(32)
  })
})
