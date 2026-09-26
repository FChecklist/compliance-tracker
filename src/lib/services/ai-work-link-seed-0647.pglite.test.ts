/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05c and WP-05d (register rows AW-303, AW-304): offline proof of migration drizzle/0647_build002_awl_seed_waves_3_4.sql (the
// fourth seed of the Universal AI Work Link's function allow-list, for coverage waves 3 and 4) and of its down file, on PGlite over the same
// live-shaped base as the 0621 to 0628 tests. No live database is touched and nothing is applied anywhere.
//
// WHAT IS PROVEN
//   - after 0628, 0644, 0643 and 0650 the table holds 52 functions and the 0650 registry version; after 0647 it holds 70: the eighteen rows of the two
//     coverage waves at exactly the levels, ranks, money flags and text parameters written below (an independent copy, so a typo in the data
//     file or in the migration is caught), the 52 older rows unchanged, 52 on links, and the 33 record kinds of 0643 untouched;
//   - 0647 is a whole seed: applied straight over 0628 it gives the same 70 rows;
//   - the registry version function reads the hash written in the migration's own header, and stays executable by service_role alone;
//   - applying 0647 twice changes nothing, and never resets the writes_enabled switch;
//   - the down file removes exactly the eighteen rows and puts the 0650 hash back; twice over; and 0647 applies again afterwards.
//
// Run: bun test --isolate src/lib/services/ai-work-link-seed-0647.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createAwlDb, downSql, failure, forwardSql, one, read } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(60_000)

const SEED_0644 = "0644_build002_awl_seed_project_boq"
const SEED_0643 = "0643_build002_record_kinds"
const SEED_0650 = "0650_build002_awl_seed_coverage_waves_1_2"
const SEED = "0647_build002_awl_seed_waves_3_4"
const HASH_0650 = "19fafe5f95e7c0eef28ad40cfac925cfe09e5b102ef54aa2422496ef78f862e4"

// function_id -> [link_level, money_sensitive, min_role_rank, text_params]
const NEW_ROWS: Record<string, [number, boolean, number, string[]]> = {
  create_rfi: [1, false, 2, ["subject", "question"]],
  answer_rfi: [2, false, 2, ["answer"]],
  close_rfi: [1, false, 2, []],
  create_submittal: [1, false, 2, ["title", "specSection"]],
  review_submittal: [2, false, 3, ["comments"]],
  create_punch_list_item: [1, false, 2, ["description", "location", "trade"]],
  mark_punch_item_ready: [1, false, 2, []],
  verify_punch_item_closed: [2, false, 3, []],
  create_site_diary: [1, false, 2, ["weather", "workDone", "visitors", "issues", "instructions", "materialReceived", "remarks"]],
  create_progress_category: [1, false, 2, ["name"]],
  update_progress_entry: [1, true, 2, ["remarks"]],
  get_daily_progress_report: [0, false, 2, []],
  record_attendance_batch: [1, true, 2, []],
  update_roster_entry: [2, true, 2, ["name", "trade", "skillLevel"]],
  record_material_issue: [1, false, 2, ["issuedTo", "note"]],
  create_material: [2, true, 2, ["name", "unit", "spec"]],
  void_material_receipt: [2, true, 3, ["reason"]],
  get_material_cost_report: [0, true, 3, []],
}

type FnRow = { function_id: string; kind: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; text_params: string[]; excluded_reason: string | null }
const functions = async (db: PGlite) =>
  (await db.query<FnRow>("select function_id, kind, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, text_params, excluded_reason from platform.ai_work_link_functions order by function_id")).rows
const kinds = async (db: PGlite) => (await db.query("select kind, money_columns, filters from platform.ai_work_link_record_kinds order by kind")).rows
const version = async (db: PGlite) => (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v

describe("drizzle/0647 on PGlite over 0621 to 0628, 0644, 0643 and 0650", () => {
  let db: PGlite
  let before: FnRow[]
  let after: FnRow[]
  let kindsBefore: unknown[]

  beforeAll(async () => {
    db = await createAwlDb("0628")
    await db.exec(forwardSql(SEED_0644))
    await db.exec(forwardSql(SEED_0643))
    await db.exec(forwardSql(SEED_0650))
    before = await functions(db)
    kindsBefore = await kinds(db)
    await db.exec(forwardSql(SEED))
    after = await functions(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("0650 holds 52 functions and its own version; 0647 makes it 70 with 52 on links", async () => {
    expect(before).toHaveLength(52)
    expect(before.filter((f) => f.link_level !== null)).toHaveLength(34)
    expect(HASH_0650).toMatch(/^[0-9a-f]{64}$/)
    expect(read(`drizzle/${SEED_0650}.sql`)).toContain(`-- registry version ${HASH_0650}`)
    expect(after).toHaveLength(70)
    expect(after.filter((f) => f.link_level !== null)).toHaveLength(52)
  })

  test("the eighteen rows are exactly as written here: level, money flag, rank, text parameters, and a kind that agrees with the level", () => {
    expect(Object.keys(NEW_ROWS)).toHaveLength(18)
    for (const [id, [level, money, rank, text]] of Object.entries(NEW_ROWS)) {
      expect({ id, before: before.some((f) => f.function_id === id) }).toEqual({ id, before: false })
      const row = after.find((f) => f.function_id === id)
      expect({ id, found: !!row }).toEqual({ id, found: true })
      expect({ id, level: row!.link_level, money: row!.money_sensitive, rank: row!.min_role_rank, text: row!.text_params, kind: row!.kind, reason: row!.excluded_reason }).toEqual({
        id, level, money, rank, text, kind: level === 0 ? "read" : "write", reason: null,
      })
    }
  })

  test("the 52 older rows are the same before and after, and the 33 record kinds are untouched", async () => {
    expect(after.filter((f) => !(f.function_id in NEW_ROWS))).toEqual(before)
    expect(await kinds(db)).toEqual(kindsBefore)
    expect(kindsBefore).toHaveLength(33)
  })

  test("the version function reads the hash in the migration's header and is executable by service_role alone", async () => {
    const v = await version(db)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    expect(v).not.toBe(HASH_0650)
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

  test("the down file removes exactly the eighteen rows and puts the 0650 hash back, twice over, and 0647 applies again", async () => {
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0650)
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0650)
    await db.exec(forwardSql(SEED))
    expect(await functions(db)).toEqual(after)
    expect((await failure(db, "select public.ai_work_link__registry_version()")).message).toBe("")
  })
})

describe("drizzle/0647 straight over 0628 (it is a whole seed, so 0644, 0643 and 0650 are not needed before it)", () => {
  test("70 rows, 52 on links, the same rows and kinds as after 0644, 0643, 0650 then 0647", async () => {
    const withAll = await createAwlDb("0628")
    const direct = await createAwlDb("0628")
    try {
      for (const seed of [SEED_0644, SEED_0643, SEED_0650, SEED]) await withAll.exec(forwardSql(seed))
      await direct.exec(forwardSql(SEED))
      const rows = await functions(direct)
      expect(rows).toHaveLength(70)
      expect(rows.filter((f) => f.link_level !== null)).toHaveLength(52)
      expect(rows).toEqual(await functions(withAll))
      expect(await kinds(direct)).toEqual(await kinds(withAll))
      expect(await version(direct)).toBe(await version(withAll))
    } finally {
      await withAll.close()
      await direct.close()
    }
  })
})
