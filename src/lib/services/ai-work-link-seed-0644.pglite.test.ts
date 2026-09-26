/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-03, WP-04, WP-07: offline proof of migration drizzle/0644_build002_awl_seed_project_boq.sql (the second seed of the
// Universal AI Work Link's function allow-list) and of its down file, on PGlite over the same live-shaped base as the 0621 to 0628 tests.
// No live database is touched and nothing is applied anywhere.
//
// WHAT IS PROVEN
//   - after 0628 the table holds 27 functions and the 0628 registry version; after 0644 it holds 33: the six BUILD-002 rows at exactly the
//     levels, ranks, money flags and text parameters written below (an independent copy, so a typo in the data file or the migration is caught),
//     the 27 older rows unchanged, 15 on links, and the 13 record kinds untouched;
//   - the registry version function reads the hash written in the migration's own header, and stays executable by service_role alone;
//   - applying 0644 twice changes nothing, and never resets the writes_enabled switch;
//   - the down file removes exactly the six rows and puts the 0628 hash back; twice over; and 0644 applies again afterwards.
//
// Run: bun test --isolate src/lib/services/ai-work-link-seed-0644.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createAwlDb, downSql, failure, forwardSql, one, read } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(60_000)

const SEED = "0644_build002_awl_seed_project_boq"
const HASH_0628 = "85752edfdebd5f46329b0cb60f14e5a96a98ec0e3aa454db2412a1462c58c696"

// function_id -> [link_level, money_sensitive, min_role_rank, text_params]; null level = on no link
const NEW_ROWS: Record<string, [number | null, boolean, number, string[]]> = {
  add_boq_lines: [2, true, 2, []],
  seal_boq: [2, true, 3, []],
  update_project: [2, true, 2, ["name", "description"]],
  create_activity: [1, false, 2, ["name", "unit"]],
  create_boq: [2, true, 2, ["title"]],
  create_project: [null, false, 0, []],
}

type FnRow = { function_id: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; text_params: string[]; excluded_reason: string | null }
const functions = async (db: PGlite) =>
  (await db.query<FnRow>("select function_id, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, text_params, excluded_reason from platform.ai_work_link_functions order by function_id")).rows
const version = async (db: PGlite) => (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v

describe("drizzle/0644 on PGlite over 0621 to 0628", () => {
  let db: PGlite
  let before: FnRow[]
  let after: FnRow[]
  let kindsBefore: unknown[]

  beforeAll(async () => {
    db = await createAwlDb("0628")
    before = await functions(db)
    kindsBefore = (await db.query("select kind, money_columns, filters from platform.ai_work_link_record_kinds order by kind")).rows
    await db.exec(forwardSql(SEED))
    after = await functions(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("0628 alone holds 27 functions and its own version; 0644 makes it 33 with 15 on links", async () => {
    expect(before).toHaveLength(27)
    expect(after).toHaveLength(33)
    expect(after.filter((f) => f.link_level !== null)).toHaveLength(15)
    expect(before.filter((f) => f.link_level !== null)).toHaveLength(10)
  })

  test("the six BUILD-002 rows are exactly as written here, and create_project is on no link with a reason", () => {
    for (const [id, [level, money, rank, text]] of Object.entries(NEW_ROWS)) {
      const row = after.find((f) => f.function_id === id)
      expect({ id, found: !!row }).toEqual({ id, found: true })
      expect({ id, level: row!.link_level, money: row!.money_sensitive, rank: row!.min_role_rank, text: row!.text_params }).toEqual({ id, level, money, rank, text })
    }
    expect(after.find((f) => f.function_id === "create_project")!.excluded_reason).toMatch(/one project/)
    for (const id of ["add_boq_lines", "seal_boq", "update_project", "create_activity", "create_boq"]) expect(after.find((f) => f.function_id === id)!.excluded_reason).toBeNull()
  })

  test("the 27 older rows are the same before and after, and the record kinds are untouched", async () => {
    expect(after.filter((f) => !(f.function_id in NEW_ROWS))).toEqual(before)
    expect((await db.query("select kind, money_columns, filters from platform.ai_work_link_record_kinds order by kind")).rows).toEqual(kindsBefore)
  })

  test("the version function reads the hash in the migration's header and is executable by service_role alone", async () => {
    const v = await version(db)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    expect(v).not.toBe(HASH_0628)
    expect(read(`drizzle/${SEED}.sql`)).toContain(`-- registry version ${v}`)
    const grants = await db.query<{ role: string; ok: boolean }>(
      "select r role, has_function_privilege(r, 'public.ai_work_link__registry_version()', 'execute') ok from unnest(array['anon', 'authenticated', 'app_runtime', 'service_role']) r"
    )
    expect(Object.fromEntries(grants.rows.map((g) => [g.role, g.ok]))).toEqual({ anon: false, authenticated: false, app_runtime: false, service_role: true })
  })

  test("a second run changes nothing and never resets the writes_enabled switch", async () => {
    await db.exec("update platform.ai_work_link_settings set writes_enabled = true")
    const rows = await functions(db)
    await db.exec(forwardSql(SEED))
    expect(await functions(db)).toEqual(rows)
    expect((await one<{ w: boolean }>(db, "select bool_or(writes_enabled) w from platform.ai_work_link_settings")).w).toBe(true)
    await db.exec("update platform.ai_work_link_settings set writes_enabled = false")
  })

  test("the down file removes exactly the six rows and puts the 0628 hash back, twice over, and 0644 applies again", async () => {
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0628)
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0628)
    await db.exec(forwardSql(SEED))
    expect(await functions(db)).toEqual(after)
    expect((await failure(db, "select public.ai_work_link__registry_version()")).message).toBe("")
  })
})
