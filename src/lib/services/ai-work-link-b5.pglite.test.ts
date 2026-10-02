/// <reference types="bun-types" />
// lf-b5-ai-crud (owner order 2026-10-02, R7): drizzle/0687_awl_ai_crud_b5.sql and its down file on PGlite (real Postgres as WASM), over 0621 to 0669,
// the sync's 0677 to 0683 and 0685, as the live database has them. No live database is touched.
//   * the seed: the 19 new functions are rows at the level, rank and money flag of the generated registry; a freshly minted link carries them by rank
//     (a member's link has create_boq_category but not rename_boq_category); the registry version is the file's own hash
//   * the person's switch (0685) holds for them: off, a level-2 B5 function is refused as a direct action and recorded as a draft; on, it is recorded as
//     an action; a retry with the same idempotency key is the same intent, replayed, not a second one
//   * the meeting soft delete: the column is there (timestamptz, null by default); setting it records a TOMBSTONE (op 'D', head deleted) right after the
//     ordinary update, an edit that is not a delete records none, and a meeting of another project or organisation is untouched
//   * 'cancelled' is a value of the change order status
//   * the blast radius: ai_work_link_draft_impact counts the lines and projects of THIS organisation that carry the draft's category (case-insensitively;
//     another organisation's lines never), refuses another person and a wrong code exactly like the draft state, answers no impact for another function;
//     only service_role may call it
//   * applying 0687 twice changes nothing; the down file removes the 19 rows, puts 0685's hash back, drops the impact function and the trigger, KEEPS the
//     column while a meeting is soft-deleted and drops it once none is, keeps the enum value; and the forward file applies again
// Run: bun test --isolate src/lib/services/ai-work-link-b5.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { downSql, forwardSql, one, read } from "./__test-helpers__/awl-pglite"
import { call, createUserLinkDb, mintProject, refused, setWrites, type J } from "./__test-helpers__/awl-user-link-db"
import { insert, S, A2, B } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(240_000)

const B5 = [
  "update_activity", "update_progress_category", "update_attendance", "delete_attendance", "update_change_order", "cancel_change_order", "update_boq_line", "delete_meeting",
  "create_boq_category", "rename_boq_category", "delete_boq_category", "create_vendor", "update_vendor", "create_customer", "update_customer", "create_company",
  "create_currency", "create_exchange_rate", "list_organisation_records",
]
type FnRow = { function_id: string; link_level: number | null; min_role_rank: number; money_sensitive: boolean }
const REGISTRY = JSON.parse(read("supabase/functions/ai-work-link/function-registry.generated.json")) as FnRow[]

// construction_boq_categories is not in the committed base snapshot: its live shape, from schema.ts (drizzle/0532)
const CATEGORIES_TABLE = `CREATE TABLE IF NOT EXISTS compliance.construction_boq_categories (
  id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`

let db: PGlite
let mgr: J
let mem: J

beforeAll(async () => {
  db = await createUserLinkDb()
  for (const m of ["0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0683_projexa_sync_more_kinds", "0685_awl_ai_crud"]) {
    await db.exec(forwardSql(m))
  }
  await db.exec(CATEGORIES_TABLE)
  await db.exec(forwardSql("0687_awl_ai_crud_b5"))
  await setWrites(db, true)
  mgr = await mintProject(db, "u-mgr", "proj-a", { level: 1 })
  mem = await mintProject(db, "u-mem", "proj-a", { level: 1 })
  await db.exec([
    insert("construction_boq_categories", [
      { id: "bcat_civil", org_id: "org-a", name: "Civil", sort_order: 1 },
      { id: "bcat_misc", org_id: "org-a", name: "Misc", sort_order: 2 },
      { id: "bcat_b", org_id: "org-b", name: "Civil", sort_order: 1 },
    ]),
    insert("construction_boqs", [
      { id: "boq-a", ...S(), version: 1, title: "A", created_by_id: "u-mgr" },
      { id: "boq-a2", ...A2(), version: 1, title: "A2", created_by_id: "u-mgr" },
      { id: "boq-b", ...B(), version: 1, title: "B", created_by_id: "u-b" },
    ]),
    insert("construction_boq_line_items", [
      { id: "l1", org_id: "org-a", boq_id: "boq-a", item_code: "1", description: "x", unit: "sqm", quantity: 1, category: "Civil" },
      { id: "l2", org_id: "org-a", boq_id: "boq-a", item_code: "2", description: "x", unit: "sqm", quantity: 1, category: "civil" },
      { id: "l3", org_id: "org-a", boq_id: "boq-a2", item_code: "1", description: "x", unit: "sqm", quantity: 1, category: "Civil" },
      { id: "l4", org_id: "org-a", boq_id: "boq-a2", item_code: "2", description: "x", unit: "sqm", quantity: 1, category: "Paint" },
      { id: "lb", org_id: "org-b", boq_id: "boq-b", item_code: "1", description: "x", unit: "sqm", quantity: 1, category: "Civil" },
    ]),
  ].join("\n"))
}, 300_000)
afterAll(async () => {
  await db.close()
})

const record = (token: string, kind: "draft" | "action", fn: string, params: object, key: string | null = null) => call(db, "ai_work_link_record_intent", [token, kind, fn, params, key, null])

describe("the seed", () => {
  test("the 19 functions are rows exactly as the generated registry says; the version is the file's hash", async () => {
    const rows = (await db.query<FnRow>("select function_id, link_level::int link_level, min_role_rank::int min_role_rank, money_sensitive from platform.ai_work_link_functions where function_id = any($1) order by function_id", [B5])).rows
    expect(rows).toEqual(REGISTRY.filter((f) => B5.includes(f.function_id)).map((f) => ({ function_id: f.function_id, link_level: f.link_level, min_role_rank: f.min_role_rank, money_sensitive: f.money_sensitive })).sort((a, b) => (a.function_id < b.function_id ? -1 : 1)))
    expect(rows).toHaveLength(19)
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_functions")).n).toBe(159)
    const v = (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v
    expect(read("drizzle/0687_awl_ai_crud_b5.sql")).toContain(`-- registry version ${v}`)
  })

  test("a fresh link carries them by rank: the manager's has the organisation-wide ones, the member's only those at member rank", async () => {
    const m = (await call(db, "ai_work_link__resolve", [mgr.token])).effective_functions as string[]
    const e = (await call(db, "ai_work_link__resolve", [mem.token])).effective_functions as string[]
    expect(m).toEqual(expect.arrayContaining(["rename_boq_category", "delete_attendance", "create_exchange_rate", "create_boq_category", "delete_meeting"]))
    expect(e).toEqual(expect.arrayContaining(["create_boq_category", "delete_meeting", "update_vendor", "list_organisation_records"]))
    for (const fn of ["rename_boq_category", "delete_boq_category", "update_attendance", "delete_attendance", "create_company", "create_currency", "create_exchange_rate"]) expect(e).not.toContain(fn)
  })
})

describe("the person's switch holds for the new functions, and a retry is the same intent", () => {
  test("off: a level-2 B5 function is LEVEL_NOT_ALLOWED as an action and a draft as a draft; on: recorded as an action", async () => {
    const r = await refused(db, "select public.ai_work_link_record_intent($1, 'action', 'delete_meeting', $2::jsonb, null, null)", [mgr.token, JSON.stringify({ meetingId: "m-off" })])
    expect(r?.message).toContain("LEVEL_NOT_ALLOWED")
    expect(await record(mgr.token, "draft", "delete_meeting", { meetingId: "m-draft" })).toMatchObject({ status: "awaiting_confirmation", kind: "draft" })
    await call(db, "ai_work_link_person_setting_set", ["u-mgr", true])
    expect(await record(mgr.token, "action", "delete_meeting", { meetingId: "m-on" })).toMatchObject({ status: "recorded", kind: "action" })
    await call(db, "ai_work_link_person_setting_set", ["u-mgr", false])
  })

  test("the same change sent twice with one idempotency key is one intent, the second replayed", async () => {
    const first = await record(mgr.token, "draft", "rename_boq_category", { categoryId: "bcat_misc", name: "Sundries" }, "op-1")
    const second = await record(mgr.token, "draft", "rename_boq_category", { categoryId: "bcat_misc", name: "Sundries" }, "op-1")
    expect(second.intent_id).toBe(first.intent_id)
    expect(second.replayed).toBe(true)
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_intent where function_id = 'rename_boq_category' and params ->> 'name' = 'Sundries'")).n).toBe(1)
  })
})

describe("the meeting soft delete and its tombstone", () => {
  const changes = async (id: string) => (await db.query<{ op: string; version: number }>("select op, version::int version from platform.projexa_change_log where kind = 'meetings' and record_id = $1 order by version", [id])).rows

  test("deleted_at is a nullable timestamptz; setting it records a tombstone after the update; an edit records none", async () => {
    const col = await one<{ data_type: string; is_nullable: string; column_default: string | null }>(db, "select data_type, is_nullable, column_default from information_schema.columns where table_schema = 'compliance' and table_name = 'pms_meetings' and column_name = 'deleted_at'")
    expect(col).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null })
    await db.exec(insert("pms_meetings", [
      { id: "pm-1", ...S(), title: "Weekly", scheduled_at: "2026-09-10T09:00:00Z", duration_minutes: 60 },
      { id: "pm-2", ...A2(), title: "Other project", scheduled_at: "2026-09-10T09:00:00Z" },
    ]))
    await db.exec("update compliance.pms_meetings set title = 'Weekly site' where id = 'pm-1'")
    expect(await changes("pm-1")).toEqual([{ op: "I", version: 1 }, { op: "U", version: 2 }])
    await db.exec("update compliance.pms_meetings set deleted_at = now() where id = 'pm-1'")
    expect(await changes("pm-1")).toEqual([{ op: "I", version: 1 }, { op: "U", version: 2 }, { op: "U", version: 3 }, { op: "D", version: 4 }])
    expect(await one(db, "select deleted, version::int version from platform.projexa_record_head where kind = 'meetings' and record_id = 'pm-1'")).toEqual({ deleted: true, version: 4 })
    // the row itself stays (a soft delete) and the other project's meeting is untouched
    expect((await one<{ n: number }>(db, "select count(*)::int n from compliance.pms_meetings where id = 'pm-1'")).n).toBe(1)
    expect(await changes("pm-2")).toEqual([{ op: "I", version: 1 }])
    // a second write of deleted_at on an already-deleted row is not a second tombstone
    await db.exec("update compliance.pms_meetings set deleted_at = now() where id = 'pm-1'")
    expect((await changes("pm-1")).filter((c) => c.op === "D")).toHaveLength(1)
  })

  test("'cancelled' is a change order status", async () => {
    const labels = (await db.query<{ l: string }>("select enumlabel l from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'construction_change_order_status' order by enumsortorder")).rows.map((r) => r.l)
    expect(labels).toEqual(["draft", "pending_approval", "approved", "rejected", "cancelled"])
  })
})

describe("the blast radius the person sees before confirming", () => {
  test("a rename draft: the lines and projects of THIS organisation with the category, case-insensitively; another organisation's never", async () => {
    const d = await record(mgr.token, "draft", "rename_boq_category", { categoryId: "bcat_civil", name: "Civil works" })
    const out = await call(db, "ai_work_link_draft_impact", [d.intent_id, "u-mgr", d.confirm_token])
    expect(out).toEqual({ status: "ok", impact: { kind: "boq_category", function_id: "rename_boq_category", category: "Civil", new_name: "Civil works", lines: 3, projects: 2 } })
  })

  test("another person and a wrong code are refused like the draft state; another function, or another organisation's category id, has no impact", async () => {
    const d = await record(mgr.token, "draft", "delete_boq_category", { categoryId: "bcat_civil" })
    expect(await call(db, "ai_work_link_draft_impact", [d.intent_id, "u-mem", d.confirm_token])).toEqual({ status: "refused", reason: "not_owner" })
    expect(await call(db, "ai_work_link_draft_impact", [d.intent_id, "u-mgr", "wrong"])).toEqual({ status: "refused", reason: "not_found" })
    expect(await call(db, "ai_work_link_draft_impact", ["no-such-draft", "u-mgr", "x"])).toEqual({ status: "refused", reason: "not_found" })
    const del = await call(db, "ai_work_link_draft_impact", [d.intent_id, "u-mgr", d.confirm_token])
    expect(del).toMatchObject({ status: "ok", impact: { function_id: "delete_boq_category", category: "Civil", new_name: null, lines: 3, projects: 2 } })
    const other = await record(mgr.token, "draft", "update_vendor", { vendorId: "v1", isActive: false })
    expect(await call(db, "ai_work_link_draft_impact", [other.intent_id, "u-mgr", other.confirm_token])).toEqual({ status: "ok", impact: null })
    const foreign = await record(mgr.token, "draft", "rename_boq_category", { categoryId: "bcat_b", name: "Hijack" })
    expect(await call(db, "ai_work_link_draft_impact", [foreign.intent_id, "u-mgr", foreign.confirm_token])).toEqual({ status: "ok", impact: null })
  })

  test("only service_role may call it", async () => {
    const acl = await one<{ anon: boolean; auth: boolean; service: boolean }>(db,
      "select has_function_privilege('anon', 'public.ai_work_link_draft_impact(text,text,text)', 'EXECUTE') anon, has_function_privilege('authenticated', 'public.ai_work_link_draft_impact(text,text,text)', 'EXECUTE') auth, has_function_privilege('service_role', 'public.ai_work_link_draft_impact(text,text,text)', 'EXECUTE') service")
    expect(acl).toEqual({ anon: false, auth: false, service: true })
  })
})

describe("idempotent, and reversible without losing data", () => {
  test("applying 0687 again changes nothing", async () => {
    const snap = async () => JSON.stringify((await db.query("select function_id, link_level, min_role_rank from platform.ai_work_link_functions order by function_id")).rows)
    const before = await snap()
    await db.exec(forwardSql("0687_awl_ai_crud_b5"))
    expect(await snap()).toBe(before)
    expect((await db.query("select 1 from pg_trigger where tgname = 'projexa_track_meeting_tombstone'")).rows).toHaveLength(1)
  })

  test("the down file: 19 rows gone, 0685's hash back, the impact function and trigger gone, the column KEPT while a meeting is soft-deleted, the enum value kept", async () => {
    await db.exec(downSql("0687_awl_ai_crud_b5"))
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_functions where function_id = any($1)", [B5])).n).toBe(0)
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_functions")).n).toBe(140)
    expect((await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v).toBe("1ebba97f7025068298c0f1a5b466e35c30f35ef8b1350ff3b174ad71d1f54763")
    expect((await one<{ f: string | null }>(db, "select to_regprocedure('public.ai_work_link_draft_impact(text,text,text)')::text f")).f).toBeNull()
    expect((await db.query("select 1 from pg_trigger where tgname = 'projexa_track_meeting_tombstone'")).rows).toHaveLength(0)
    const col = () => db.query("select 1 from information_schema.columns where table_schema = 'compliance' and table_name = 'pms_meetings' and column_name = 'deleted_at'")
    expect((await col()).rows).toHaveLength(1) // pm-1 is soft-deleted: dropping the column would bring it back
    expect((await db.query("select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'construction_change_order_status' and e.enumlabel = 'cancelled'")).rows).toHaveLength(1)
    // once no meeting is soft-deleted, the column goes; a second run is harmless
    await db.exec("update compliance.pms_meetings set deleted_at = null")
    await db.exec(downSql("0687_awl_ai_crud_b5"))
    expect((await col()).rows).toHaveLength(0)
    // and forward again
    await db.exec(forwardSql("0687_awl_ai_crud_b5"))
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_functions")).n).toBe(159)
    expect((await col()).rows).toHaveLength(1)
  })
})
