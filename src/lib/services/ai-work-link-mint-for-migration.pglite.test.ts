/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (register rows AW-401 to AW-404, AW-406; BR-484 pattern): drizzle/0631_build001_awl_mint_for.sql on PGlite (real
// Postgres as WASM), applied on top of 0621 to 0628 the way the live database has them. It holds what the route tests cannot see:
//   * the forward file adds exactly five functions and nothing else (no table, no column), and is safe to run twice
//   * every one is SECURITY DEFINER with a pinned search_path, and executable by service_role alone (BR-484: not anon, not authenticated,
//     not app_runtime, not PUBLIC), although Supabase's default privileges would grant anon and authenticated
//   * the down file drops exactly those five, leaves the 33 functions of 0624 to 0628 in place, is safe to run twice, and the forward file
//     applies again after it
//   * the journal has the entry, after every link migration, and the down file exists
// Run: bun test --isolate src/lib/services/ai-work-link-mint-for-migration.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"
import { createAwlDb, downSql, forwardSql, one } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

const NAME = "0631_build001_awl_mint_for"
const NEW = ["ai_work_link_list_for", "ai_work_link_mint_for", "ai_work_link_new_project_for", "ai_work_link_revoke_for", "ai_work_link_warning_for"]

let db: PGlite

const functionNames = async () =>
  (await db.query<{ n: string }>("select p.proname n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like 'ai\\_work\\_link%' order by 1")).rows.map((r) => r.n)
const tableCount = async () => (await one<{ n: number }>(db, "select count(*)::int n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname in ('compliance', 'platform', 'public') and c.relkind in ('r', 'p')")).n
const columnCount = async () => (await one<{ n: number }>(db, "select count(*)::int n from information_schema.columns where table_schema in ('compliance', 'platform', 'public')")).n

let before: string[]

beforeAll(async () => {
  db = await createAwlDb("0628")
  before = await functionNames()
}, 120_000)
afterAll(async () => {
  await db.close()
})

describe("forward", () => {
  test("adds exactly the five functions and no table or column; a second run changes nothing", async () => {
    expect(before.length).toBe(33)
    const tables = await tableCount()
    const columns = await columnCount()
    await db.exec(forwardSql(NAME))
    expect(await functionNames()).toEqual([...before, ...NEW].sort())
    expect(await tableCount()).toBe(tables)
    expect(await columnCount()).toBe(columns)
    await db.exec(forwardSql(NAME))
    expect(await functionNames()).toEqual([...before, ...NEW].sort())
  })

  test("the file is additive: no DDL on a table, no DPDP object, and its only write is the shell project insert inside a function", () => {
    const sql = forwardSql(NAME)
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    expect(code).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE|DROP FUNCTION)\b/i)
    expect(code).not.toMatch(/dpdp/i)
    expect(code.match(/\bINSERT INTO\b/g)).toHaveLength(1)
    expect(code).toMatch(/INSERT INTO compliance\.projects \(org_id, product_id, name, description, lead_user_id\)/)
    expect(code).not.toMatch(/\b(UPDATE|DELETE FROM)\b/)
  })

  test("grants: service_role runs all five; anon, authenticated, app_runtime and PUBLIC run none", async () => {
    const r = await db.query<{ n: string; anon: boolean; auth: boolean; app: boolean; svc: boolean; pub: boolean }>(
      `select p.proname n,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('app_runtime', p.oid, 'EXECUTE') app,
              has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), true) pub
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = any ($1) order by 1`,
      [NEW],
    )
    expect(r.rows.map((x) => x.n)).toEqual(NEW)
    for (const x of r.rows) expect(x).toMatchObject({ anon: false, auth: false, app: false, svc: true, pub: false })
  })

  test("each function is SECURITY DEFINER with search_path pinned to pg_catalog, pg_temp", async () => {
    const r = await db.query<{ n: string; definer: boolean; cfg: string[] | null }>(
      "select p.proname n, p.prosecdef definer, p.proconfig cfg from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = any ($1) order by 1",
      [NEW],
    )
    expect(r.rows).toHaveLength(5)
    for (const x of r.rows) {
      expect(x.definer).toBe(true)
      expect(x.cfg).toContain("search_path=pg_catalog, pg_temp")
    }
  })

  test("the journal has the entry for 0631 after every other link migration, and the down file exists", () => {
    const journal = JSON.parse(readFileSync(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ idx: number; when: number; tag: string }> }
    const mine = journal.entries.find((e) => e.tag === NAME)
    expect(mine).toBeDefined()
    const links = journal.entries.filter((e) => /^\d{4}_build001_awl_/.test(e.tag) && e.tag !== NAME)
    expect(links.length).toBe(8)
    for (const e of links) expect(mine!.when).toBeGreaterThan(e.when)
    expect(mine!.when).toBe(1790100000000 + 500000 * 1)
    expect(journal.entries.filter((e) => e.idx === mine!.idx)).toHaveLength(1)
    expect(downSql(NAME)).toContain("DROP FUNCTION IF EXISTS public.ai_work_link_new_project_for(text, text, integer)")
  })
})

describe("down", () => {
  test("drops exactly the five, leaves the 33 of 0624 to 0628 working, is safe twice, and the forward file applies again", async () => {
    await db.exec(downSql(NAME))
    expect(await functionNames()).toEqual(before)
    await db.exec(downSql(NAME))
    expect(await functionNames()).toEqual(before)
    // a function of 0624 that the new ones call still works
    const r = await one<{ v: number }>(db, "select public.ai_work_link__role_rank('member') v")
    expect(r.v).toBe(2)
    await db.exec(forwardSql(NAME))
    expect(await functionNames()).toEqual([...before, ...NEW].sort())
  })
})
