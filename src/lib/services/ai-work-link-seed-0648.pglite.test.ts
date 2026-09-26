/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05e, WP-05f and AW-312: offline proof of migration drizzle/0648_build002_awl_seed_waves_5_6.sql (the fifth seed of the
// Universal AI Work Link's function allow-list) and of its down file, on PGlite over the same live-shaped base as the 0621 to 0628 tests.
// No live database is touched and nothing is applied anywhere.
//
// WHAT IS PROVEN
//   - after 0628, 0644, 0643, 0650 and 0647 the table holds 70 functions and the 0647 registry version; after 0648 it holds 92: the 22 rows of
//     waves 5 and 6 and the exception-capture functions at exactly the levels, ranks, money flags and text parameters written below (an
//     independent copy, so a typo in the data file or the migration is caught), the 70 older rows unchanged, 73 on links, and the 33 record
//     kinds of 0643 untouched;
//   - 0648 is a whole seed: applied straight over 0628 it gives the same 92 rows;
//   - the registry version function reads the hash written in the migration's own header, and stays executable by service_role alone;
//   - applying 0648 twice changes nothing, and never resets the writes_enabled switch;
//   - the down file removes exactly the 22 rows and puts the 0647 hash back; twice over; and 0648 applies again afterwards.
//
// Run: bun test --isolate src/lib/services/ai-work-link-seed-0648.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createAwlDb, downSql, failure, forwardSql, one, read } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(60_000)

const SEED_0644 = "0644_build002_awl_seed_project_boq"
const SEED_0643 = "0643_build002_record_kinds"
const SEED_0650 = "0650_build002_awl_seed_coverage_waves_1_2"
const SEED_0647 = "0647_build002_awl_seed_waves_3_4"
const SEED = "0648_build002_awl_seed_waves_5_6"
const HASH_0647 = "1b5f621a65fe1a636ae74a628ee0b55ad027f1413b21bfb61e7d27395c8711a6"

// function_id -> [link_level, money_sensitive, min_role_rank, text_params]; null level = on no link
const NEW_ROWS: Record<string, [number | null, boolean, number, string[]]> = {
  // wave 5
  create_mom: [1, false, 2, ["title", "minutes", "meetingType", "attendees", "agenda"]],
  update_mom_minutes: [1, false, 2, ["minutes"]],
  add_meeting_action_item: [1, false, 2, ["title"]],
  add_meeting_outcome: [1, false, 2, ["notes"]],
  publish_mom: [2, false, 3, []],
  create_drawing: [2, false, 2, ["name", "externalUrl", "drawingNo", "rev", "discipline", "kind"]],
  capture_artifact: [1, false, 2, ["title", "text"]],
  record_material_receipt: [2, true, 2, ["materialName", "reference", "notes", "spec", "unit"]],
  approve_timesheet: [2, false, 3, []],
  reject_timesheet: [2, false, 3, ["rejectionReason"]],
  // wave 6
  get_project_exceptions: [0, true, 3, []],
  compare_boq_revisions: [0, true, 3, []],
  get_project_budget_variance: [0, true, 3, []],
  get_gantt_schedule: [0, false, 2, []],
  compare_schedule_baseline: [0, false, 2, []],
  capture_schedule_baseline: [2, false, 3, ["name"]],
  update_task: [1, false, 2, ["title", "description"]],
  // AW-312
  set_progress_drawing: [2, false, 2, []],
  record_vendor_dispute: [2, true, 2, ["description"]],
  record_customer_complaint: [2, false, 2, ["description", "category"]],
  record_customer_approval: [2, false, 3, []],
  link_roster_employee: [null, false, 0, []],
}

type FnRow = { function_id: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; text_params: string[]; excluded_reason: string | null }
const functions = async (db: PGlite) =>
  (await db.query<FnRow>("select function_id, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, text_params, excluded_reason from platform.ai_work_link_functions order by function_id")).rows
const kinds = async (db: PGlite) => (await db.query("select kind, money_columns, filters from platform.ai_work_link_record_kinds order by kind")).rows
const version = async (db: PGlite) => (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v

describe("drizzle/0648 on PGlite over 0621 to 0628, 0644, 0643, 0650 and 0647", () => {
  let db: PGlite
  let before: FnRow[]
  let after: FnRow[]
  let kindsBefore: unknown[]

  beforeAll(async () => {
    db = await createAwlDb("0628")
    for (const seed of [SEED_0644, SEED_0643, SEED_0650, SEED_0647]) await db.exec(forwardSql(seed))
    before = await functions(db)
    kindsBefore = await kinds(db)
    await db.exec(forwardSql(SEED))
    after = await functions(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("0647 holds 70 functions and its own version; 0648 makes it 92 with 73 on links", async () => {
    expect(before).toHaveLength(70)
    expect(after).toHaveLength(92)
    expect(before.filter((f) => f.link_level !== null)).toHaveLength(52)
    expect(after.filter((f) => f.link_level !== null)).toHaveLength(73)
    expect(HASH_0647).toMatch(/^[0-9a-f]{64}$/)
    expect(read(`drizzle/${SEED_0647}.sql`)).toContain(`-- registry version ${HASH_0647}`)
    expect(Object.keys(NEW_ROWS)).toHaveLength(22)
  })

  test("the 22 new rows are exactly as written here, and link_roster_employee is on no link with a reason", () => {
    for (const [id, [level, money, rank, text]] of Object.entries(NEW_ROWS)) {
      expect({ id, before: before.some((f) => f.function_id === id) }).toEqual({ id, before: false })
      const row = after.find((f) => f.function_id === id)
      expect({ id, found: !!row }).toEqual({ id, found: true })
      expect({ id, level: row!.link_level, money: row!.money_sensitive, rank: row!.min_role_rank, text: row!.text_params }).toEqual({ id, level, money, rank, text })
    }
    expect(after.find((f) => f.function_id === "link_roster_employee")!.excluded_reason).toMatch(/HR record/)
    for (const id of Object.keys(NEW_ROWS).filter((n) => n !== "link_roster_employee")) expect(after.find((f) => f.function_id === id)!.excluded_reason).toBeNull()
  })

  test("the 70 older rows are the same before and after, and the 33 record kinds are untouched", async () => {
    expect(after.filter((f) => !(f.function_id in NEW_ROWS))).toEqual(before)
    expect(await kinds(db)).toEqual(kindsBefore)
    expect(kindsBefore).toHaveLength(33)
  })

  test("the version function reads the hash in the migration's header and is executable by service_role alone", async () => {
    const v = await version(db)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    expect(v).not.toBe(HASH_0647)
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

  test("the down file removes exactly the 22 rows and puts the 0647 hash back, twice over, and 0648 applies again", async () => {
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0647)
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0647)
    await db.exec(forwardSql(SEED))
    expect(await functions(db)).toEqual(after)
    expect((await failure(db, "select public.ai_work_link__registry_version()")).message).toBe("")
  })

  test("0648 also applies straight onto 0628 (the block is the whole registry), with the same rows, kinds and version as the whole chain", async () => {
    const withAll = await createAwlDb("0628")
    const direct = await createAwlDb("0628")
    try {
      for (const seed of [SEED_0644, SEED_0643, SEED_0650, SEED_0647, SEED]) await withAll.exec(forwardSql(seed))
      await direct.exec(forwardSql(SEED))
      const rows = await functions(direct)
      expect(rows).toHaveLength(92)
      expect(rows.filter((f) => f.link_level !== null)).toHaveLength(73)
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
