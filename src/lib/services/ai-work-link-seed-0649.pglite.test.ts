/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-05g and WP-05h: offline proof of migration drizzle/0649_build002_awl_seed_waves_7_9.sql (the sixth seed of the
// Universal AI Work Link's function allow-list) and of its down file, on PGlite over the same live-shaped base as the 0621 to 0628 tests.
// No live database is touched and nothing is applied anywhere.
//
// WHAT IS PROVEN
//   - after 0628, 0644, 0643, 0650, 0647 and 0648 the table holds 92 functions and the 0648 registry version; after 0649 it holds 112: the 20 rows
//     of waves 7, 8 and 9 at exactly the levels, ranks, money flags and text parameters written below (an independent copy, so a typo in the
//     data file or the migration is caught), the 92 older rows unchanged, 93 on links, and the 33 record kinds of 0643 untouched;
//   - wave 7 is level 2 in every row (PMD-41: a draft the person confirms), and no function approves a claim or invoices one;
//   - 0649 is a whole seed: applied straight over 0628 it gives the same 112 rows;
//   - the registry version function reads the hash written in the migration's own header, and stays executable by service_role alone;
//   - applying 0649 twice changes nothing, and never resets the writes_enabled switch;
//   - the down file removes exactly the 20 rows and puts the 0648 hash back; twice over; and 0649 applies again afterwards.
//
// Run: bun test --isolate src/lib/services/ai-work-link-seed-0649.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createAwlDb, downSql, failure, forwardSql, one, read } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(60_000)

const SEED_0644 = "0644_build002_awl_seed_project_boq"
const SEED_0643 = "0643_build002_record_kinds"
const SEED_0650 = "0650_build002_awl_seed_coverage_waves_1_2"
const SEED_0647 = "0647_build002_awl_seed_waves_3_4"
const SEED_0648 = "0648_build002_awl_seed_waves_5_6"
const SEED = "0649_build002_awl_seed_waves_7_9"
const HASH_0648 = "9a7682c82eb3dfaa65e6836871fdab63d5efe3c6a1e8b267835a7fe3d25bbff4"

// function_id -> [link_level, money_sensitive, min_role_rank, text_params]
const NEW_ROWS: Record<string, [number | null, boolean, number, string[]]> = {
  // wave 7: drafts only
  create_progress_claim: [2, true, 3, ["milestoneDescription"]],
  draft_progress_claim: [2, true, 3, []],
  submit_progress_claim: [2, true, 3, []],
  reject_progress_claim: [2, true, 3, ["rejectionReason"]],
  submit_change_order_for_approval: [2, true, 3, []],
  submit_boq_for_approval: [2, true, 3, []],
  submit_kpi_entry: [2, true, 2, ["period"]],
  approve_kpi_entry: [2, true, 3, []],
  // wave 8
  create_permit: [1, false, 2, ["name", "externalUrl", "permitNumber", "permitAuthority"]],
  update_document_metadata: [1, false, 2, ["name", "category"]],
  create_wiki_page: [1, false, 2, ["title", "content"]],
  update_wiki_page: [1, false, 2, ["title", "content"]],
  create_mood_board: [1, false, 2, ["title", "roomOrArea", "description"]],
  add_mood_board_item: [1, false, 2, ["label", "notes"]],
  create_ffe_item: [2, true, 2, ["itemName", "roomOrArea", "description", "sku"]],
  update_ffe_status: [2, true, 3, []],
  get_ffe_margin_summary: [0, true, 3, []],
  // wave 9
  create_floor_plan: [1, false, 2, ["name", "floorLevel"]],
  add_room: [1, false, 2, ["name"]],
  place_furniture: [1, false, 2, []],
}

type FnRow = { function_id: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; text_params: string[]; excluded_reason: string | null }
const functions = async (db: PGlite) =>
  (await db.query<FnRow>("select function_id, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, text_params, excluded_reason from platform.ai_work_link_functions order by function_id")).rows
const kinds = async (db: PGlite) => (await db.query("select kind, money_columns, filters from platform.ai_work_link_record_kinds order by kind")).rows
const version = async (db: PGlite) => (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v

describe("drizzle/0649 on PGlite over 0621 to 0628, 0644, 0643, 0650, 0647 and 0648", () => {
  let db: PGlite
  let before: FnRow[]
  let after: FnRow[]
  let kindsBefore: unknown[]

  beforeAll(async () => {
    db = await createAwlDb("0628")
    for (const seed of [SEED_0644, SEED_0643, SEED_0650, SEED_0647, SEED_0648]) await db.exec(forwardSql(seed))
    before = await functions(db)
    kindsBefore = await kinds(db)
    await db.exec(forwardSql(SEED))
    after = await functions(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("0648 holds 92 functions and its own version; 0649 makes it 112 with 93 on links", async () => {
    expect(before).toHaveLength(92)
    expect(after).toHaveLength(112)
    expect(before.filter((f) => f.link_level !== null)).toHaveLength(73)
    expect(after.filter((f) => f.link_level !== null)).toHaveLength(93)
    expect(HASH_0648).toMatch(/^[0-9a-f]{64}$/)
    expect(read(`drizzle/${SEED_0648}.sql`)).toContain(`-- registry version ${HASH_0648}`)
    expect(Object.keys(NEW_ROWS)).toHaveLength(20)
  })

  test("the 20 new rows are exactly as written here, all on links, none excluded", () => {
    for (const [id, [level, money, rank, text]] of Object.entries(NEW_ROWS)) {
      expect({ id, before: before.some((f) => f.function_id === id) }).toEqual({ id, before: false })
      const row = after.find((f) => f.function_id === id)
      expect({ id, found: !!row }).toEqual({ id, found: true })
      expect({ id, level: row!.link_level, money: row!.money_sensitive, rank: row!.min_role_rank, text: row!.text_params }).toEqual({ id, level, money, rank, text })
      expect({ id, excluded: row!.excluded_reason }).toEqual({ id, excluded: null })
    }
  })

  test("wave 7 is drafts only: every claim, submit and KPI row is level 2, and no row approves a claim or invoices one", () => {
    const wave7 = ["create_progress_claim", "draft_progress_claim", "submit_progress_claim", "reject_progress_claim", "submit_change_order_for_approval", "submit_boq_for_approval", "submit_kpi_entry", "approve_kpi_entry"]
    for (const id of wave7) expect({ id, level: after.find((f) => f.function_id === id)!.link_level }).toEqual({ id, level: 2 })
    const ids = after.map((f) => f.function_id)
    for (const forbidden of ["approve_progress_claim", "approve_billing_claim", "invoice_approved_claim", "approve_boq", "approve_change_order", "mark_change_order_approved"]) {
      expect({ forbidden, present: ids.includes(forbidden) }).toEqual({ forbidden, present: false })
    }
  })

  test("the 92 older rows are the same before and after, and the 33 record kinds are untouched", async () => {
    expect(after.filter((f) => !(f.function_id in NEW_ROWS))).toEqual(before)
    expect(await kinds(db)).toEqual(kindsBefore)
    expect(kindsBefore).toHaveLength(33)
  })

  test("the seeded rows are exactly the generated JSON, row by row (the seed and the Edge Function's registry cannot differ)", async () => {
    type FnJson = { function_id: string; kind: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; excluded_reason: string | null; text_params: string[] }
    const json = (JSON.parse(read("supabase/functions/ai-work-link/function-registry.generated.json")) as FnJson[]).map((f) => ({
      function_id: f.function_id, link_level: f.link_level, money_sensitive: f.money_sensitive, min_role_rank: f.min_role_rank, text_params: f.text_params, excluded_reason: f.excluded_reason,
    }))
    expect(after).toEqual(json)
  })

  test("the version function reads the hash in the migration's header and is executable by service_role alone", async () => {
    const v = await version(db)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    expect(v).not.toBe(HASH_0648)
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

  test("the down file removes exactly the 20 rows and puts the 0648 hash back, twice over, and 0649 applies again", async () => {
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0648)
    await db.exec(downSql(SEED))
    expect(await functions(db)).toEqual(before)
    expect(await version(db)).toBe(HASH_0648)
    await db.exec(forwardSql(SEED))
    expect(await functions(db)).toEqual(after)
    expect((await failure(db, "select public.ai_work_link__registry_version()")).message).toBe("")
  })

  test("0649 also applies straight onto 0628 (the block is the whole registry), with the same rows, kinds and version as the whole chain", async () => {
    const withAll = await createAwlDb("0628")
    const direct = await createAwlDb("0628")
    try {
      for (const seed of [SEED_0644, SEED_0643, SEED_0650, SEED_0647, SEED_0648, SEED]) await withAll.exec(forwardSql(seed))
      await direct.exec(forwardSql(SEED))
      const rows = await functions(direct)
      expect(rows).toHaveLength(112)
      expect(rows.filter((f) => f.link_level !== null)).toHaveLength(93)
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
