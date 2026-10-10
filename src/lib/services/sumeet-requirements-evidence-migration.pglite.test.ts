/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-22: offline proof of drizzle/0616_build001_requirement_evidence.sql
// (two evidence columns on platform.sumeet_requirements) and
// drizzle/0617_build001_requirement_evidence_data.sql (the 31 EXC-ITEM rows and the
// verify_command / evidence_ref values of the 80 register rows), with both down files, on
// PGlite (real Postgres compiled to WASM). No live database is touched.
//
// BASE: platform.sumeet_requirements exactly as it was live on 2026-09-25 (read with SELECT
// from information_schema.columns, pg_constraint, pg_policies and
// information_schema.role_table_grants on project pcrjmlpuqsbocqfwoxod, and the same shape
// as scripts/verify/fixtures/0616_build001_requirement_evidence.base.sql): 23 columns, primary
// key on id, the closure_state and closure_repo checks, RLS enabled (not forced), one
// service_role policy, table grants to app_runtime and service_role. SEED: the 80 live ids
// with their live sort_order, built and closure_state; status is 'DONE - seed' where the live
// status starts with DONE (45 rows) and 'CLOSED - seed' / 'OPEN - seed' otherwise.
//
// WHAT IS PROVEN, in order (the tests share one database and run in order):
//   1. before 0616 the register rows read their documented 'today' values (BR-307 0,
//      BR-308 61, BR-309 0, BR-310 0, BR-311 45), and 0617 refuses to run and changes nothing;
//   2. 0616 adds exactly two nullable text columns, keeps every row value, and a second run
//      changes nothing;
//   3. 0617 inserts the 31 EXC-ITEM rows (sort_order 84..114, every NOT NULL column filled,
//      source for BR-307, status OPEN, never DONE), fills the two columns only where they are
//      NULL (a hand-written value is kept), changes no status, updated_at or updated_by of an
//      existing row, and a second run changes nothing;
//   4. after 0617 the register rows read BR-307 31, BR-309 31, BR-310 3, and BR-308 / BR-311
//      read exactly the gaps U22_REQUIREMENT_CHECKS.md lists for the PM (R-15, R-31, R-92 and
//      R-A1, R-A2, R-A3, R-A7);
//   5. every verify_command has one of the four allowed forms, every evidence_ref one of the
//      three, and the three META verify_commands are valid SQL that reads
//      platform.sumeet_requirements and returns 0, 28 and 0 on this data;
//   6. 0617's down file removes the 31 rows and clears only what 0617 wrote (the hand-written
//      value stays), and is safe to run twice;
//   7. 0616's down file restores the base schema and every original row exactly, and is safe
//      to run twice;
//   8. the files also unwind in the wrong order: with 0616's columns already gone, 0617's down
//      file still deletes its rows and does not fail.
//
// Run: bun test --isolate src/lib/services/sumeet-requirements-evidence-migration.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const F0616 = read("drizzle/0616_build001_requirement_evidence.sql")
const D0616 = read("drizzle/down/0616_build001_requirement_evidence.down.sql")
const F0617 = read("drizzle/0617_build001_requirement_evidence_data.sql")
const D0617 = read("drizzle/down/0617_build001_requirement_evidence_data.down.sql")

// Live shape, 2026-09-25.
const BASE_SQL = `
CREATE ROLE app_runtime NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA platform;
CREATE TABLE platform.sumeet_requirements (
  id text NOT NULL,
  sort_order integer NOT NULL,
  area text,
  requirement text,
  source text,
  status text,
  built text,
  verified_in_db text,
  tested_in_live_ui text,
  route text,
  file_path text,
  evidence text,
  github_pr text,
  vercel text,
  next_action text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text DEFAULT 'claude-chat'::text,
  closure_state text,
  closure_test_path text,
  closure_test_run_at timestamp with time zone,
  closure_commit_sha text,
  closure_repo text,
  closure_ci_run_id text,
  CONSTRAINT sumeet_requirements_pkey PRIMARY KEY (id),
  CONSTRAINT sumeet_requirements_closure_repo_check CHECK (((closure_repo IS NULL) OR (closure_repo = ANY (ARRAY['compliance-tracker'::text, 'projexa'::text])))),
  CONSTRAINT sumeet_requirements_closure_state_check CHECK ((closure_state = ANY (ARRAY['CLOSED'::text, 'OPEN'::text, 'BLOCKED'::text, 'NOT_TESTABLE'::text])))
);
ALTER TABLE platform.sumeet_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_sumeet_requirements ON platform.sumeet_requirements AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.sumeet_requirements TO app_runtime, service_role;
`

// [id, sort_order, built, status starts with DONE, closure_state], the 80 live rows of 2026-09-25.
const LIVE_ROWS: Array<[string, number, string | null, boolean, string]> = [
  ["R-01", 1, "YES", true, "CLOSED"], ["R-02", 2, "YES", true, "CLOSED"], ["R-03", 3, "YES", true, "CLOSED"],
  ["R-04", 4, "YES", true, "CLOSED"], ["R-10", 5, "YES", true, "CLOSED"], ["R-11", 6, "YES", true, "CLOSED"],
  ["R-12", 7, "YES", true, "CLOSED"], ["R-13", 8, "YES", true, "CLOSED"], ["R-14", 9, "YES", true, "CLOSED"],
  ["R-15", 10, "YES", false, "CLOSED"], ["R-16", 11, "YES", true, "CLOSED"], ["R-17", 12, "YES", true, "CLOSED"],
  ["R-18", 13, "YES", true, "CLOSED"], ["R-19", 14, "YES", true, "CLOSED"], ["R-20", 15, "YES", true, "CLOSED"],
  ["R-21", 16, "YES", true, "CLOSED"], ["R-22", 17, "YES", true, "CLOSED"], ["R-23", 18, "YES", true, "CLOSED"],
  ["R-24", 19, "YES", true, "CLOSED"], ["R-30", 20, "YES", true, "CLOSED"], ["R-31", 21, "YES", true, "CLOSED"],
  ["R-32", 22, "YES", true, "CLOSED"], ["R-33", 23, "YES", false, "CLOSED"], ["R-40", 24, "YES", false, "CLOSED"],
  ["R-41", 25, "YES", false, "CLOSED"], ["R-42", 26, "YES", false, "CLOSED"], ["R-43", 27, "YES", false, "CLOSED"],
  ["R-44", 28, "YES", false, "CLOSED"], ["R-45", 29, "YES", false, "CLOSED"], ["R-46", 30, "YES", true, "CLOSED"],
  ["R-47", 31, "YES", false, "CLOSED"], ["R-48", 32, "YES", true, "CLOSED"], ["R-50", 33, "NO", false, "CLOSED"],
  ["R-51", 34, "YES", true, "CLOSED"], ["R-52", 35, "YES", false, "CLOSED"], ["R-60", 36, "YES", true, "CLOSED"],
  ["R-61", 37, "YES", true, "CLOSED"], ["R-62", 38, "YES", false, "CLOSED"], ["R-63", 39, "YES", false, "CLOSED"],
  ["R-70", 40, "YES", true, "CLOSED"], ["R-71", 41, "YES", false, "CLOSED"], ["R-72", 42, "YES", true, "CLOSED"],
  ["R-80", 43, "YES", true, "CLOSED"], ["R-81", 44, "YES", true, "CLOSED"], ["R-82", 45, "YES", true, "CLOSED"],
  ["R-90", 46, "YES", false, "CLOSED"], ["R-91", 47, "n/a", true, "CLOSED"], ["R-A1", 48, "n/a", true, "CLOSED"],
  ["R-A2", 49, "n/a", true, "CLOSED"], ["R-A3", 50, "n/a", true, "CLOSED"], ["R-A4", 51, "YES", false, "CLOSED"],
  ["R-A5", 52, "n/a", false, "CLOSED"], ["R-B1", 53, "YES", false, "CLOSED"], ["R-B2", 54, "n/a", false, "CLOSED"],
  ["R-A6", 55, "n/a", true, "CLOSED"], ["R-A7", 56, "n/a", true, "CLOSED"], ["R-C01", 60, "YES", true, "CLOSED"],
  ["R-C02", 61, "YES", true, "CLOSED"], ["R-C03", 62, "YES", true, "CLOSED"], ["R-C04", 63, "YES", true, "CLOSED"],
  ["R-C07", 64, "YES", true, "CLOSED"], ["R-C08", 65, "YES", true, "CLOSED"], ["R-C09", 66, "YES", true, "CLOSED"],
  ["R-C10", 67, "YES", false, "CLOSED"], ["R-C11", 68, "YES", false, "CLOSED"], ["R-C12", 69, "YES", false, "CLOSED"],
  ["R-C13", 70, "YES", false, "CLOSED"], ["R-C14", 71, "YES", true, "CLOSED"], ["R-C15", 72, "YES", false, "CLOSED"],
  ["R-C16", 73, "NO", false, "CLOSED"], ["R-C17", 74, null, false, "OPEN"], ["R-92", 75, "YES", false, "CLOSED"],
  ["R-93", 76, null, false, "CLOSED"], ["R-94", 77, null, false, "CLOSED"], ["R-95", 78, null, false, "CLOSED"],
  ["R-96", 79, null, false, "CLOSED"], ["R-97", 80, null, false, "CLOSED"], ["R-98", 81, null, false, "CLOSED"],
  ["R-99", 82, null, false, "CLOSED"], ["R-100", 83, null, false, "CLOSED"],
]

const q = (s: string | null) => (s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`)
const SEED_SQL = `INSERT INTO platform.sumeet_requirements (id, sort_order, built, status, closure_state, updated_at, updated_by) VALUES\n${LIVE_ROWS.map(
  ([id, sort, built, done, cs]) =>
    `(${q(id)}, ${sort}, ${q(built)}, ${q(done ? "DONE - seed" : `${cs} - seed`)}, ${q(cs)}, '2026-09-20 10:00:00+00', 'seed')`,
).join(",\n")};`

// Register rows BR-307..BR-311, verbatim from ai-os/projexa-build-001/BOOLEAN_REGISTER.csv.
const BR = {
  307: "select count(*) from platform.sumeet_requirements where id ~ '^EXC-ITEM-(0[1-9]|[12][0-9]|3[01])$' and source like 'construction-exceptions-service.ts@6d531f53%'",
  308: "select count(*) from platform.sumeet_requirements r where r.built = 'YES' and nullif(to_jsonb(r)->>'verify_command', '') is null",
  309: "select count(*) from platform.sumeet_requirements r where r.id like 'EXC-ITEM-%' and nullif(to_jsonb(r)->>'verify_command', '') is not null",
  310: "select count(*) from platform.sumeet_requirements r where r.id in ('EXC-ITEM-29', 'EXC-ITEM-30', 'EXC-ITEM-31') and to_jsonb(r)->>'verify_command' like '%platform.sumeet_requirements%'",
  311: "select count(*) from platform.sumeet_requirements r where r.status like 'DONE%' and coalesce(to_jsonb(r)->>'evidence_ref', '') !~ '^([0-9a-f]{7,40}|PR#[0-9]+|SQL [0-9]{4}-[0-9]{2}-[0-9]{2}: .+)$'",
} as const

const SNAPSHOT_SQL = `
with cols as (
  select 'col:'||table_name||'.'||lpad(ordinal_position::text, 3, '0')||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default, '') s
  from information_schema.columns where table_schema = 'platform'
), cons as (
  select 'con:'||c.relname||'.'||k.conname||':'||k.contype::text||':'||pg_get_constraintdef(k.oid) s
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform'
), idx as (
  select 'idx:'||tablename||'.'||indexname||':'||indexdef s from pg_indexes where schemaname = 'platform'
), pol as (
  select 'pol:'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual, '')||':'||coalesce(with_check, '') s
  from pg_policies where schemaname = 'platform'
), rls as (
  select 'rls:'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = 'platform'
), grants as (
  select 'grant:'||table_name||':'||grantee||':'||privilege_type s from information_schema.role_table_grants where table_schema = 'platform'
)
select s from (select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from rls union all select * from grants) a order by s`

let pg: PGlite

async function snapshot(): Promise<string[]> {
  return (await pg.query<{ s: string }>(SNAPSHOT_SQL)).rows.map((r) => r.s)
}
async function rows(where = "true"): Promise<string[]> {
  return (await pg.query<{ j: string }>(`select to_jsonb(r)::text j from platform.sumeet_requirements r where ${where} order by id`)).rows.map((r) => r.j)
}
// One JSON text per row with its keys sorted, so rows built in JS compare equal to rows read back from to_jsonb.
function canon(rowsJson: string[]): string[] {
  return rowsJson.map((j) => {
    const o = JSON.parse(j) as Record<string, unknown>
    return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))
  })
}
async function scalar(sql: string): Promise<string | null> {
  return (await pg.query<{ v: string | null }>(`select ((${sql}))::text as v`)).rows[0]?.v ?? null
}
async function ids(sql: string): Promise<string[]> {
  return (await pg.query<{ id: string }>(sql)).rows.map((r) => r.id)
}
async function fails(sqlText: string): Promise<string> {
  try {
    await pg.exec(sqlText)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error("expected this SQL to fail")
}
// The SELECT inside a `node scripts/verify/sql-assert.mjs ... --sql "<SELECT>" ...` command, as the shell passes it.
function sqlOf(cmd: string): string {
  const m = /--sql "((?:[^"\\]|\\.)*)"/.exec(cmd)
  if (!m) throw new Error(`no --sql in: ${cmd}`)
  return m[1].replace(/\\([$"\\`])/g, "$1")
}

const EXC_IDS = Array.from({ length: 31 }, (_, i) => `EXC-ITEM-${String(i + 1).padStart(2, "0")}`)
const EVIDENCE_FORM = /^([0-9a-f]{7,40}|PR#[0-9]+|SQL [0-9]{4}-[0-9]{2}-[0-9]{2}: .+)$/
const COMMAND_FORMS = [
  /^bun test --isolate (?:"?(?:src|e2e)\/[^\s"]+\.test\.tsx?"? ?)+(?:-t "[^"]+")?$/,
  /^node scripts\/verify\/sql-assert\.mjs --project ct --sql "(?:[^"\\]|\\.)+" --(?:equals|not-equals|gte|lte|gt|lt) \S+$/,
  /^test "\$\(git grep -c -F '[^']+' -- \S+ \| awk -F: '\{s\+=\$2\} END \{print s\+0\}'\)" = "\d+"$/,
  /^bash scripts\/verify\/[\w.-]+\.sh(?: .*)?$/,
]

let original: string[] = []
let s0: string[] = []
let s1: string[] = []
let afterForward: string[] = []

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(BASE_SQL)
  await pg.exec(SEED_SQL)
  original = await rows()
  s0 = await snapshot()
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe("drizzle/0616 + 0617 build001_requirement_evidence on the 2026-09-25 base (PGlite)", () => {
  test("1. before 0616 the register rows read today's values, and 0617 refuses and changes nothing", async () => {
    expect(original).toHaveLength(80)
    expect(await scalar(BR[307])).toBe("0")
    expect(await scalar(BR[308])).toBe("61")
    expect(await scalar(BR[309])).toBe("0")
    expect(await scalar(BR[310])).toBe("0")
    expect(await scalar(BR[311])).toBe("45")

    const message = await fails(F0617)
    await pg.exec("ROLLBACK")
    expect(message).toContain("0617 REFUSED")
    expect(await rows()).toEqual(original)
    expect(await snapshot()).toEqual(s0)
  })

  test("2. 0616 adds exactly two nullable text columns, keeps every row, and a second run changes nothing", async () => {
    await pg.exec(F0616)
    s1 = await snapshot()
    expect(s1.filter((l) => !s0.includes(l))).toEqual([
      "col:sumeet_requirements.024.verify_command:text:YES:",
      "col:sumeet_requirements.025.evidence_ref:text:YES:",
    ])
    expect(s0.filter((l) => !s1.includes(l))).toEqual([])
    // Same rows, plus the two new keys at NULL.
    const withNulls = original.map((j) => JSON.stringify({ ...JSON.parse(j), verify_command: null, evidence_ref: null }))
    expect(canon(await rows())).toEqual(canon(withNulls))
    await pg.exec(F0616)
    expect(await snapshot()).toEqual(s1)
  })

  test("3. 0617 inserts the 31 rows, fills only NULL cells, changes no status or audit column, and a second run changes nothing", async () => {
    // A value written by hand before 0617 must survive it.
    await pg.exec(`UPDATE platform.sumeet_requirements SET evidence_ref = 'PR#1' WHERE id = 'R-A4'`)
    const before = await rows()
    await pg.exec(F0617)
    afterForward = await rows()

    const exc = await pg.query<{ id: string; sort_order: number; source: string; status: string; built: string; closure_state: string; updated_by: string; updated_at: string | null; verified_in_db: string | null; tested_in_live_ui: string | null; area: string; requirement: string }>(
      `select id, sort_order, source, status, built, closure_state, updated_by, updated_at::text, verified_in_db, tested_in_live_ui, area, requirement
       from platform.sumeet_requirements where id like 'EXC-ITEM-%' order by id`,
    )
    expect(exc.rows.map((r) => r.id)).toEqual(EXC_IDS)
    expect(exc.rows.map((r) => r.sort_order)).toEqual(Array.from({ length: 31 }, (_, i) => 84 + i))
    for (const r of exc.rows) {
      expect(r.source).toBe("construction-exceptions-service.ts@6d531f53")
      expect(r.status.startsWith("OPEN - ")).toBe(true)
      expect(r.closure_state).toBe("OPEN")
      expect(r.updated_by).toBe("BUILD-001 U-22")
      expect(r.updated_at).not.toBeNull()
      expect(r.verified_in_db).toBeNull()
      expect(r.tested_in_live_ui).toBeNull()
      expect(r.requirement.length).toBeGreaterThan(5)
      const n = Number(r.id.slice(-2))
      expect(r.built).toBe(n <= 28 ? "YES" : "n/a")
      expect(r.area).toBe(n <= 28 ? "Exceptions" : "Exceptions (META)")
    }
    expect(exc.rows.find((r) => r.id === "EXC-ITEM-24")?.requirement).toBe("Snags lost, retention held")

    // Existing rows: only the two new columns may differ, and only from NULL.
    const beforeById = new Map(before.map((j) => [JSON.parse(j).id as string, JSON.parse(j)]))
    let filled = 0
    for (const j of afterForward.filter((x) => !JSON.parse(x).id.startsWith("EXC-ITEM-"))) {
      const now = JSON.parse(j)
      const was = beforeById.get(now.id)
      for (const k of Object.keys(was)) {
        if (k === "verify_command" || k === "evidence_ref") {
          if (was[k] !== null) expect(now[k]).toBe(was[k])
          else if (now[k] !== null) filled++
        } else {
          expect({ id: now.id, k, v: now[k] }).toEqual({ id: now.id, k, v: was[k] })
        }
      }
    }
    expect(filled).toBe(69 + 71) // 69 verify_command; 72 evidence_ref minus the hand-written R-A4
    expect(await scalar(`select evidence_ref from platform.sumeet_requirements where id = 'R-A4'`)).toBe("PR#1")
    expect(await scalar(`select count(*) from platform.sumeet_requirements where id = 'R-A4' and verify_command like 'bun test --isolate %'`)).toBe("1")

    await pg.exec(F0617)
    expect(await rows()).toEqual(afterForward)
    expect(await snapshot()).toEqual(s1)
  })

  test("4. after 0617: BR-307 31, BR-309 31, BR-310 3, and BR-308 / BR-311 read exactly the gaps left for the PM", async () => {
    expect(await scalar(BR[307])).toBe("31")
    expect(await scalar(BR[309])).toBe("31")
    expect(await scalar(BR[310])).toBe("3")
    // built = 'YES' with no compliance-tracker-runnable check (UI-only PROJEXA rows).
    expect(await scalar(BR[308])).toBe("3")
    expect(await ids(`select id from platform.sumeet_requirements r where r.built = 'YES' and nullif(to_jsonb(r)->>'verify_command', '') is null order by id`)).toEqual(["R-15", "R-31", "R-92"])
    // DONE with no commit, PR or dated query result to cite.
    expect(await scalar(BR[311])).toBe("4")
    expect(await ids(`select id from platform.sumeet_requirements r where r.status like 'DONE%' and coalesce(r.evidence_ref, '') = '' order by id`)).toEqual(["R-A1", "R-A2", "R-A3", "R-A7"])
  })

  test("5. every verify_command and evidence_ref has an allowed form; the META checks are valid SQL on the register", async () => {
    const all = await pg.query<{ id: string; verify_command: string | null; evidence_ref: string | null }>(
      `select id, verify_command, evidence_ref from platform.sumeet_requirements order by id`,
    )
    for (const r of all.rows) {
      if (r.verify_command !== null) expect({ id: r.id, ok: COMMAND_FORMS.some((re) => re.test(r.verify_command!)) }).toEqual({ id: r.id, ok: true })
      if (r.evidence_ref !== null) expect({ id: r.id, ok: EVIDENCE_FORM.test(r.evidence_ref) }).toEqual({ id: r.id, ok: true })
    }
    expect(all.rows.filter((r) => r.verify_command !== null)).toHaveLength(69 + 31)

    // Items 1-28 run the detector tests; 29-31 are register-level SELECTs.
    for (const r of all.rows.filter((x) => /^EXC-ITEM-(0[1-9]|1[0-9]|2[0-8])$/.test(x.id))) {
      expect(r.verify_command!.startsWith("bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t ")).toBe(true)
      expect(r.verify_command!).toContain("returns exactly the 28 numbered items")
    }
    const meta = Object.fromEntries(all.rows.filter((r) => ["EXC-ITEM-29", "EXC-ITEM-30", "EXC-ITEM-31"].includes(r.id)).map((r) => [r.id, r.verify_command!]))
    for (const cmd of Object.values(meta)) expect(sqlOf(cmd)).toContain("platform.sumeet_requirements")
    // 29: all 28 detector items DONE with valid evidence -- none is, today.
    expect(await scalar(sqlOf(meta["EXC-ITEM-29"]))).toBe("0")
    expect(meta["EXC-ITEM-29"].endsWith("--equals 28")).toBe(true)
    // 30: all 28 built, each with a detector-test verify_command -- true once 0617 is applied.
    expect(await scalar(sqlOf(meta["EXC-ITEM-30"]))).toBe("28")
    expect(meta["EXC-ITEM-30"].endsWith("--equals 28")).toBe(true)
    // 31: all 28 checked on the PROJEXA screen -- none is, today.
    expect(await scalar(sqlOf(meta["EXC-ITEM-31"]))).toBe("0")

    // The two register-level SELECTs written for R-10 and R-63 are single SELECTs too.
    for (const id of ["R-10", "R-63"]) expect(sqlOf(all.rows.find((r) => r.id === id)!.verify_command!).startsWith("select count(*) from ")).toBe(true)
  })

  test("6. 0617's down file removes the 31 rows, clears only what 0617 wrote, and is safe to run twice", async () => {
    await pg.exec(D0617)
    expect(await scalar(`select count(*) from platform.sumeet_requirements where id like 'EXC-ITEM-%'`)).toBe("0")
    // Back to the state just before 0617 (which included the hand-written R-A4 value).
    const expected = original.map((j) => {
      const o = { ...JSON.parse(j), verify_command: null, evidence_ref: null }
      if (o.id === "R-A4") o.evidence_ref = "PR#1"
      return JSON.stringify(o)
    })
    expect(canon(await rows())).toEqual(canon(expected))
    await pg.exec(D0617)
    expect(canon(await rows())).toEqual(canon(expected))
    await pg.exec(`UPDATE platform.sumeet_requirements SET evidence_ref = NULL WHERE id = 'R-A4'`)
  })

  test("7. 0616's down file restores the base schema and every original row exactly, and is safe to run twice", async () => {
    await pg.exec(D0616)
    expect(await snapshot()).toEqual(s0)
    expect(await rows()).toEqual(original)
    await pg.exec(D0616)
    expect(await snapshot()).toEqual(s0)
  })

  test("8. unwinding in the wrong order still works: with the columns gone, 0617's down file deletes its rows and does not fail", async () => {
    await pg.exec(F0616)
    await pg.exec(F0617)
    expect(await scalar(BR[307])).toBe("31")
    await pg.exec(D0616)
    expect(await scalar(`select count(*) from platform.sumeet_requirements where id like 'EXC-ITEM-%'`)).toBe("31")
    await pg.exec(D0617)
    expect(await scalar(`select count(*) from platform.sumeet_requirements where id like 'EXC-ITEM-%'`)).toBe("0")
    expect(await rows()).toEqual(original)
    expect(await snapshot()).toEqual(s0)
  })
})
