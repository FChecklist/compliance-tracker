/// <reference types="bun-types" />
// PROJEXA-BUILD-002 persona-run finding 3: offline proof of migration drizzle/0651_build002_awl_seed_submit_timesheet.sql (the seventh seed of the
// Universal AI Work Link's function allow-list) and of its down file, on PGlite over the same live-shaped base as the 0621 to 0628 tests. No live
// database is touched and nothing is applied anywhere.
//
// WHAT IS PROVEN
//   - after 0628, 0644, 0643, 0650, 0647, 0648 and 0649 the table holds 112 functions and the 0649 registry version; after 0651 it holds 113: the one
//     new row, submit_timesheet, at level 2 (a draft the person confirms), no money, rank 2 (written below, an independent copy), the 112 older rows
//     unchanged, 94 on links, and the 33 record kinds of 0643 untouched;
//   - the seeded rows are exactly the generated JSON, row by row (the seed and the Edge Function's registry cannot differ);
//   - 0651 is a whole seed: applied straight over 0628 it gives the same 113 rows;
//   - the registry version function reads the hash written in the migration's own header, and stays executable by service_role alone;
//   - applying 0651 twice changes nothing, and never resets the writes_enabled switch;
//   - the down file removes exactly the one row and puts the 0649 hash back; twice over; and 0651 applies again afterwards.
//
// Run: bun test --isolate src/lib/services/ai-work-link-seed-0651.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createAwlDb, downSql, forwardSql, one, read } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(60_000)

const CHAIN = [
  "0644_build002_awl_seed_project_boq",
  "0643_build002_record_kinds",
  "0650_build002_awl_seed_coverage_waves_1_2",
  "0647_build002_awl_seed_waves_3_4",
  "0648_build002_awl_seed_waves_5_6",
  "0649_build002_awl_seed_waves_7_9",
]
const SEED_0649 = "0649_build002_awl_seed_waves_7_9"
const SEED = "0651_build002_awl_seed_submit_timesheet"
const HASH_0649 = "36301f55c9329c2e2484ec1d90aa4ba34cd9a089bde6b5dd0c255d2b4d2ec554"

type FnRow = { function_id: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; text_params: string[]; excluded_reason: string | null }
const functions = async (db: PGlite) =>
  (await db.query<FnRow>("select function_id, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, text_params, excluded_reason from platform.ai_work_link_functions order by function_id")).rows
const kinds = async (db: PGlite) => (await db.query("select kind, money_columns, filters from platform.ai_work_link_record_kinds order by kind")).rows
const version = async (db: PGlite) => (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v

describe("drizzle/0651 on PGlite over 0621 to 0628, 0644, 0643, 0650, 0647, 0648 and 0649", () => {
  let db: PGlite
  let before: FnRow[]
  let after: FnRow[]
  let kindsBefore: unknown[]

  beforeAll(async () => {
    db = await createAwlDb("0628")
    for (const seed of CHAIN) await db.exec(forwardSql(seed))
    before = await functions(db)
    kindsBefore = await kinds(db)
    await db.exec(forwardSql(SEED))
    after = await functions(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("0649 holds 112 functions and its own version; 0651 makes it 113 with 94 on links", () => {
    expect(before).toHaveLength(112)
    expect(after).toHaveLength(113)
    expect(before.filter((f) => f.link_level !== null)).toHaveLength(93)
    expect(after.filter((f) => f.link_level !== null)).toHaveLength(94)
    expect(read(`drizzle/${SEED_0649}.sql`)).toContain(`-- registry version ${HASH_0649}`)
  })

  test("submit_timesheet is one new row: level 2 (a draft the person confirms), no money, rank 2, on a link, not excluded", () => {
    expect(before.some((f) => f.function_id === "submit_timesheet")).toBe(false)
    expect(after.find((f) => f.function_id === "submit_timesheet")).toEqual({ function_id: "submit_timesheet", link_level: 2, money_sensitive: false, min_role_rank: 2, text_params: [], excluded_reason: null })
    // approving stays a manager's own draft, and recording stays the member's direct entry
    expect(after.find((f) => f.function_id === "approve_timesheet")).toMatchObject({ link_level: 2, min_role_rank: 3 })
    expect(after.find((f) => f.function_id === "record_timesheet")).toMatchObject({ link_level: 1, min_role_rank: 2 })
  })

  test("the 112 older rows are the same before and after, and the 33 record kinds are untouched", async () => {
    expect(after.filter((f) => f.function_id !== "submit_timesheet")).toEqual(before)
    expect(await kinds(db)).toEqual(kindsBefore)
    expect(kindsBefore).toHaveLength(33)
  })

  // 0651 is no longer the current seed: 0669 moved create_project to level 2, so the generated JSON differs from 0651 in that one row (0669's own test and the
  // seed test of migrations.pglite compare the CURRENT seed with the JSON, row by row)
  test("the seeded rows are the generated JSON, row by row, except create_project (which 0669 moved to level 2)", () => {
    type FnJson = { function_id: string; kind: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; excluded_reason: string | null; text_params: string[] }
    const json = (JSON.parse(read("supabase/functions/ai-work-link/function-registry.generated.json")) as FnJson[]).map((f) => ({
      function_id: f.function_id, link_level: f.link_level, money_sensitive: f.money_sensitive, min_role_rank: f.min_role_rank, text_params: f.text_params, excluded_reason: f.excluded_reason,
    }))
    // lf-b2-ai-crud: 0685 added 24 functions 0651 never had; they are compared by the current seed's own test (ai-work-link-migrations.pglite)
    const added0685 = new Set([
      "update_boq", "delete_boq", "update_boq_line_amounts", "delete_progress_entry", "archive_task", "create_sprint", "update_sprint", "close_sprint",
      "add_sprint_task", "remove_sprint_task", "update_time_entry", "delete_time_entry", "dispose_document", "update_mom_details", "delete_mom", "update_meeting",
      "update_material", "update_room", "remove_room", "update_placement", "remove_placement", "update_floor_plan_status", "update_mood_board", "remove_mood_board_item",
      "update_permit", "delete_permit", "archive_project",
    ])
    const but = (rows: Array<{ function_id: string }>) => rows.filter((r) => r.function_id !== "create_project" && !added0685.has(r.function_id))
    expect(but(after)).toEqual(but(json))
    expect(after.find((f) => f.function_id === "create_project")).toMatchObject({ link_level: null, min_role_rank: 0 })
    expect(json.find((f) => f.function_id === "create_project")).toMatchObject({ link_level: 2, min_role_rank: 2 })
  })

  test("the version function reads the hash in the migration's header and is executable by service_role alone", async () => {
    const v = await version(db)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    expect(v).not.toBe(HASH_0649)
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

  test("the down file removes exactly the one row and puts the 0649 hash back, twice over, and 0651 applies again", async () => {
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0649)
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0649)
    await db.exec(forwardSql(SEED))
    expect(await functions(db)).toEqual(after)
  })

  test("0651 also applies straight onto 0628 (the block is the whole registry), with the same rows, kinds and version as the whole chain", async () => {
    const withAll = await createAwlDb("0628")
    const direct = await createAwlDb("0628")
    try {
      for (const seed of [...CHAIN, SEED]) await withAll.exec(forwardSql(seed))
      await direct.exec(forwardSql(SEED))
      const rows = await functions(direct)
      expect(rows).toHaveLength(113)
      expect(rows.filter((f) => f.link_level !== null)).toHaveLength(94)
      expect(rows).toEqual(await functions(withAll))
      expect(rows).toEqual(after)
      expect(await kinds(direct)).toEqual(await kinds(withAll))
      expect(await version(direct)).toBe(await version(withAll))
    } finally {
      await withAll.close()
      await direct.close()
    }
  })
})
