/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05a waves 1 and 2 (register rows AW-301, AW-302): offline proof of migration
// drizzle/0650_build002_awl_seed_coverage_waves_1_2.sql (the third seed of the Universal AI Work Link's function allow-list) and of its down
// file, on PGlite over the same live-shaped base as the 0621 to 0628 tests. No live database is touched and nothing is applied anywhere.
//
// WHAT IS PROVEN
//   - after 0628, 0644 and 0643 the table holds 33 functions and the 0643 registry version; after 0650 it holds 52: the 19 wave rows at exactly the
//     levels, ranks, money flags and text parameters written below (an independent copy, so a typo in the data file or the migration is caught),
//     the 33 older rows unchanged, 34 on links, and the 33 record kinds of 0643 untouched;
//   - 0650 is a whole seed: applied straight over 0628 it gives the same 52 rows;
//   - the registry version function reads the hash written in the migration's own header, and stays executable by service_role alone;
//   - applying 0650 twice changes nothing, and never resets the writes_enabled switch;
//   - the down file removes exactly the 19 rows and puts the 0643 hash back; twice over; and 0650 applies again afterwards.
//
// Run: bun test --isolate src/lib/services/ai-work-link-seed-0650.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createAwlDb, downSql, failure, forwardSql, one, read } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(60_000)

const SEED_0644 = "0644_build002_awl_seed_project_boq"
const SEED_0643 = "0643_build002_record_kinds"
const SEED = "0650_build002_awl_seed_coverage_waves_1_2"
const HASH_0643 = "de06635d6880e20033899f2b45d50773186f2630a31628abbf43c28df949d446"

// function_id -> [link_level, money_sensitive, min_role_rank, text_params]
const NEW_ROWS: Record<string, [number, boolean, number, string[]]> = {
  // wave 1
  get_boq_line_items: [0, true, 3, []],
  run_named_report: [0, true, 2, []],
  get_project_schedule: [0, false, 2, []],
  list_milestones: [0, false, 2, []],
  create_milestone: [1, false, 2, ["title", "description"]],
  update_milestone: [1, false, 2, ["title", "description"]],
  create_schedule_task: [1, false, 2, ["title", "description"]],
  get_manpower_cost_report: [0, true, 2, []],
  get_designer_timesheet_report: [0, true, 2, []],
  get_project_analysis: [0, true, 3, []],
  // wave 2
  apply_boq_import: [2, true, 2, ["title"]],
  preview_boq_import: [0, true, 3, []],
  create_change_order: [2, true, 2, ["title", "description", "reason", "trade"]],
  list_change_orders: [0, true, 2, []],
  get_change_order: [0, true, 2, []],
  create_site_instruction: [2, false, 2, ["toContractor", "description", "drawingRef"]],
  update_line_item_budget: [2, true, 3, ["category"]],
  list_billing_claims: [0, true, 3, []],
  get_billing_due_queue: [0, true, 3, []],
}

type FnRow = { function_id: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; text_params: string[]; excluded_reason: string | null }
const functions = async (db: PGlite) =>
  (await db.query<FnRow>("select function_id, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, text_params, excluded_reason from platform.ai_work_link_functions order by function_id")).rows
const kinds = async (db: PGlite) => (await db.query("select kind, money_columns, filters from platform.ai_work_link_record_kinds order by kind")).rows
const version = async (db: PGlite) => (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v

describe("drizzle/0650 on PGlite over 0621 to 0628, 0644 and 0643", () => {
  let db: PGlite
  let before: FnRow[]
  let after: FnRow[]
  let kindsBefore: unknown[]

  beforeAll(async () => {
    db = await createAwlDb("0628")
    await db.exec(forwardSql(SEED_0644))
    await db.exec(forwardSql(SEED_0643))
    before = await functions(db)
    kindsBefore = await kinds(db)
    await db.exec(forwardSql(SEED))
    after = await functions(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("0643 (applied after 0644) holds 33 functions and its own version; 0650 makes it 52 with 34 on links", async () => {
    expect(before).toHaveLength(33)
    expect(before.filter((f) => f.link_level !== null)).toHaveLength(15)
    expect(HASH_0643).toMatch(/^[0-9a-f]{64}$/)
    expect(read(`drizzle/${SEED_0643}.sql`)).toContain(`-- registry version ${HASH_0643}`)
    expect(after).toHaveLength(52)
    expect(after.filter((f) => f.link_level !== null)).toHaveLength(34)
    expect(Object.keys(NEW_ROWS)).toHaveLength(19)
  })

  test("the 19 wave rows are exactly as written here, none is excluded, and they were not there before", () => {
    for (const [id, [level, money, rank, text]] of Object.entries(NEW_ROWS)) {
      expect({ id, before: before.some((f) => f.function_id === id) }).toEqual({ id, before: false })
      const row = after.find((f) => f.function_id === id)
      expect({ id, found: !!row }).toEqual({ id, found: true })
      expect({ id, level: row!.link_level, money: row!.money_sensitive, rank: row!.min_role_rank, text: row!.text_params, reason: row!.excluded_reason }).toEqual({ id, level, money, rank, text, reason: null })
    }
  })

  test("the 33 older rows are the same before and after, and the record kinds are untouched", async () => {
    expect(after.filter((f) => !(f.function_id in NEW_ROWS))).toEqual(before)
    expect(await kinds(db)).toEqual(kindsBefore)
  })

  test("every level-2 row is money sensitive except the site instruction, and every read is level 0", () => {
    expect(after.filter((f) => f.link_level === 2 && f.function_id in NEW_ROWS).map((f) => f.function_id).sort()).toEqual([
      "apply_boq_import", "create_change_order", "create_site_instruction", "update_line_item_budget",
    ])
    expect(after.filter((f) => f.function_id in NEW_ROWS && f.link_level === 2 && !f.money_sensitive).map((f) => f.function_id)).toEqual(["create_site_instruction"])
  })

  test("the version function reads the hash in the migration's header and is executable by service_role alone", async () => {
    const v = await version(db)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    expect(v).not.toBe(HASH_0643)
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

  test("the down file removes exactly the 19 rows and puts the 0643 hash back, twice over, and 0650 applies again", async () => {
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0643)
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0643)
    await db.exec(forwardSql(SEED))
    expect(await functions(db)).toEqual(after)
    expect((await failure(db, "select public.ai_work_link__registry_version()")).message).toBe("")
  })
})

describe("drizzle/0650 straight over 0628 (it is a whole seed, so 0644 is not needed before it)", () => {
  test("52 rows, 34 on links, the same rows and kinds as after 0644, 0643 then 0650", async () => {
    const withBoth = await createAwlDb("0628")
    const direct = await createAwlDb("0628")
    try {
      await withBoth.exec(forwardSql(SEED_0644))
      await withBoth.exec(forwardSql(SEED_0643))
      await withBoth.exec(forwardSql(SEED))
      await direct.exec(forwardSql(SEED))
      const rows = await functions(direct)
      expect(rows).toHaveLength(52)
      expect(rows.filter((f) => f.link_level !== null)).toHaveLength(34)
      expect(rows).toEqual(await functions(withBoth))
      expect(await kinds(direct)).toEqual(await kinds(withBoth))
      expect(await version(direct)).toBe(await version(withBoth))
    } finally {
      await withBoth.close()
      await direct.close()
    }
  })
})
