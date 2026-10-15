/// <reference types="bun-types" />
// lf-b2-ai-crud GROUP 2 (owner order 2026-10-02) and AI FULL RIGHTS (owner decision 2026-10-04, drizzle/0693): "let my AI act without asking" is a switch that
// belongs to ONE PERSON (drizzle/0685, its GROUP 2 section), on PGlite (real Postgres as WASM) over 0621 to 0669, 0685 and 0693 as the live database has them.
// Since 0693 the switch is KEPT (readable, settable) but BLOCKS NOTHING. It holds the SQL rules:
//   * switch off (the default): a level-2 function (a delete) is recorded as a direct action and claimed at once, exactly as a level-1 function; a draft is still possible
//   * switch on: the same; switching it off between the record and the claim changes nothing (the claim runs)
//   * the kill switch stays in force: with writes off nothing runs directly and the claim answers not_enabled, whatever the person's switch says
//   * the real limits stay: a level-0 link stays drafts-only; a member's link has no manager-rank function (FUNCTION_NOT_ON_LINK)
//   * the setter: an inactive person is refused, a null value is refused, the default is off; only service_role may call it; the table has RLS forced and no grant
//   * the down file of 0685 turns every switch off and removes the setter
// Run: bun test --isolate src/lib/services/ai-work-link-person-switch.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { downSql, forwardSql, one } from "./__test-helpers__/awl-pglite"
import { call, createUserLinkDb, mintProject, refused, setWrites, type J } from "./__test-helpers__/awl-user-link-db"

setDefaultTimeout(120_000)

let db: PGlite
let mgrLink: J // u-mgr, proj-a, level 1
let memLink: J // u-mem, proj-a, level 1
let mgrLevel0: J // u-mgr, proj-a2, level 0

const LEVEL_2 = "delete_progress_entry" // lf-b2-ai-crud: a delete, level 2, member rank
const LEVEL_1 = "update_meeting" // lf-b2-ai-crud: level 1, member rank
let n = 0
const params = () => ({ entryId: `e${++n}` })

const action = (token: string, fn: string, p: object) => call(db, "ai_work_link_record_intent", [token, "action", fn, p, null, null])
const refusedAction = (token: string, fn: string, p: object) =>
  refused(db, "select public.ai_work_link_record_intent($1, 'action', $2, $3::jsonb, null, null)", [token, fn, JSON.stringify(p)])
const draft = (token: string, fn: string, p: object) => call(db, "ai_work_link_record_intent", [token, "draft", fn, p, null, null])
const claim = (id: string) => call(db, "ai_work_link_intent_claim", [id])
const setSwitch = (user: string, on: boolean) => call(db, "ai_work_link_person_setting_set", [user, on])
const ctxOf = (token: string) => call(db, "ai_work_link__resolve", [token])

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0685_awl_ai_crud"))
  await db.exec(forwardSql("0693_awl_full_rights"))
  await setWrites(db, true)
  mgrLink = await mintProject(db, "u-mgr", "proj-a", { level: 1 })
  memLink = await mintProject(db, "u-mem", "proj-a", { level: 1 })
  // on another project: a new link of the same person for the same project revokes the earlier one
  mgrLevel0 = await mintProject(db, "u-mgr", "proj-a2", { level: 0 })
}, 240_000)
afterAll(async () => {
  await db.close()
})

describe("the new functions are on a freshly minted link", () => {
  test("a manager's and a member's level-1 link carry the 24 new functions their rank allows; delete_progress_entry is level 2, update_meeting level 1", async () => {
    const levels = await db.query<{ function_id: string; link_level: number }>("select function_id, link_level::int link_level from platform.ai_work_link_functions where function_id = any($1)", [[LEVEL_2, LEVEL_1]])
    expect(Object.fromEntries(levels.rows.map((r) => [r.function_id, r.link_level]))).toEqual({ [LEVEL_2]: 2, [LEVEL_1]: 1 })
    expect((await ctxOf(mgrLink.token)).effective_functions).toEqual(expect.arrayContaining([LEVEL_2, LEVEL_1, "delete_boq", "dispose_document"]))
    expect((await ctxOf(memLink.token)).effective_functions).toEqual(expect.arrayContaining([LEVEL_2, LEVEL_1]))
    expect((await ctxOf(memLink.token)).effective_functions).not.toContain("delete_boq") // manager rank
  })
})

describe("switch off (the default): NO confirmation gate (0693)", () => {
  test("the context says act_without_asking false, and a level-2 function (a delete) is STILL recorded as a direct action and claimed at once; a draft is still possible; a level-1 one runs as before", async () => {
    expect(await call(db, "ai_work_link_person_setting", ["u-mgr"])).toEqual({ act_without_asking: false, updated_at: null })
    expect((await ctxOf(mgrLink.token)).act_without_asking).toBe(false)
    const rec = await action(mgrLink.token, LEVEL_2, params())
    expect(rec).toMatchObject({ status: "recorded", kind: "action", function_id: LEVEL_2 })
    expect(await claim(rec.intent_id)).toMatchObject({ status: "ok", intent: { kind: "action", function_id: LEVEL_2 } })
    expect(await draft(mgrLink.token, LEVEL_2, params())).toMatchObject({ status: "awaiting_confirmation", kind: "draft" })
    expect(await action(mgrLink.token, LEVEL_1, { meetingId: `m${++n}`, title: "x" })).toMatchObject({ status: "recorded", kind: "action" })
  })

  test("every level-2 function the manager's rank allows is a direct action with the switch off (deletes, removals, archives)", async () => {
    const fns = (await one<{ f: string[] }>(db, "select array_agg(function_id order by function_id) f from platform.ai_work_link_functions where link_level = 2 and kind = 'write' and function_id <> 'create_project' and min_role_rank <= 3")).f
    // an admin's own link, so the 30-an-hour write cap of the managers' link used by the other tests is not what this test meets
    const adm = await mintProject(db, "u-adm", "proj-a", { level: 1 })
    const eff: string[] = (await ctxOf(adm.token)).effective_functions
    const mine = fns.filter((f) => eff.includes(f)).slice(0, 25) // 25 of them: the write cap is 30 an hour per link
    expect(mine.length).toBeGreaterThan(10)
    for (const fn of mine) {
      expect({ fn, kind: (await action(adm.token, fn, { entryId: `x${++n}` })).kind }).toEqual({ fn, kind: "action" })
    }
  })
})

describe("switch on", () => {
  test("the person's level-2 function is recorded as a direct action and the claim runs it (status ok, executing)", async () => {
    expect(await setSwitch("u-mgr", true)).toMatchObject({ act_without_asking: true })
    expect((await ctxOf(mgrLink.token)).act_without_asking).toBe(true)
    const rec = await action(mgrLink.token, LEVEL_2, params())
    expect(rec).toMatchObject({ status: "recorded", kind: "action", function_id: LEVEL_2 })
    expect(await claim(rec.intent_id)).toMatchObject({ status: "ok", intent: { kind: "action", function_id: LEVEL_2 } })
  })

  test("switching it off between the record and the claim changes nothing: the claim runs (the switch no longer gates)", async () => {
    await setSwitch("u-mgr", true)
    const rec = await action(mgrLink.token, LEVEL_2, params())
    await setSwitch("u-mgr", false)
    expect(await claim(rec.intent_id)).toMatchObject({ status: "ok", intent: { kind: "action", function_id: LEVEL_2 } })
  })

  test("a level-0 link stays drafts-only with the switch on (the link's own ceiling)", async () => {
    await setSwitch("u-mgr", true)
    expect((await refusedAction(mgrLevel0.token, LEVEL_2, params()))?.message).toContain("LEVEL_NOT_ALLOWED")
    expect((await refusedAction(mgrLevel0.token, LEVEL_1, { meetingId: `m${++n}` }))?.message).toContain("LEVEL_NOT_ALLOWED")
    await setSwitch("u-mgr", false)
  })
})

describe("the kill switch stays in force", () => {
  test("writes off: with the person's switch on nothing runs directly, and an action recorded before is not claimed (not_enabled)", async () => {
    await setSwitch("u-mgr", true)
    const before = await action(mgrLink.token, LEVEL_2, params())
    await setWrites(db, false)
    try {
      expect((await refusedAction(mgrLink.token, LEVEL_2, params()))?.message).toContain("LEVEL_NOT_ALLOWED")
      expect((await refusedAction(mgrLink.token, LEVEL_1, { meetingId: `m${++n}` }))?.message).toContain("LEVEL_NOT_ALLOWED")
      expect(await claim(before.intent_id)).toEqual({ status: "not_enabled" })
      expect((await one<J>(db, "select status from platform.ai_work_link_intent where id = $1", [before.intent_id])).status).toBe("recorded")
    } finally {
      await setWrites(db, true)
      await setSwitch("u-mgr", false)
    }
  })
})

describe("the ROLE is the limit, not the switch", () => {
  test("the member's link deletes what a member may with the switch off, and a manager-rank function (delete_boq) is not on it at all: FUNCTION_NOT_ON_LINK, switch on or off", async () => {
    for (const on of [false, true]) {
      await setSwitch("u-mem", on)
      expect(await action(memLink.token, LEVEL_2, params())).toMatchObject({ status: "recorded" })
      const why = (await refusedAction(memLink.token, "delete_boq", { boqId: "b1" }))?.message
      expect({ on, why }).toEqual({ on, why: expect.stringContaining("FUNCTION_NOT_ON_LINK") })
    }
    await setSwitch("u-mem", false)
  })

  test("a switch kept under another organisation has no effect on the context (it reads false) and none on what the link may do", async () => {
    await setSwitch("u-mgr", true)
    await db.exec("update platform.ai_work_link_person_settings set org_id = 'org-b' where user_id = 'u-mgr'")
    expect((await ctxOf(mgrLink.token)).act_without_asking).toBe(false)
    expect(await action(mgrLink.token, LEVEL_2, params())).toMatchObject({ status: "recorded" })
    expect(await call(db, "ai_work_link_person_setting", ["u-mgr"])).toMatchObject({ act_without_asking: false })
    // setting it again writes the person's organisation now
    expect(await setSwitch("u-mgr", false)).toMatchObject({ act_without_asking: false })
    expect((await one<J>(db, "select org_id from platform.ai_work_link_person_settings where user_id = 'u-mgr'")).org_id).toBe("org-a")
  })
})

describe("the setter and the table", () => {
  test("an inactive or unknown person is USER_NOT_ACTIVE; a null value is BAD_VALUE", async () => {
    expect((await refused(db, "select public.ai_work_link_person_setting_set('u-off', true)"))?.message).toContain("USER_NOT_ACTIVE")
    expect((await refused(db, "select public.ai_work_link_person_setting_set('nobody', true)"))?.message).toContain("USER_NOT_ACTIVE")
    expect((await refused(db, "select public.ai_work_link_person_setting('u-off')"))?.message).toContain("USER_NOT_ACTIVE")
    expect((await refused(db, "select public.ai_work_link_person_setting_set('u-mgr', null)"))?.message).toContain("BAD_VALUE")
  })

  test("only service_role may call the two setting functions; the helpers are owner-only; the table has RLS forced and no grant", async () => {
    const fnPriv = (fn: string, role: string) => one<{ ok: boolean }>(db, "select has_function_privilege($1, $2, 'execute') ok", [role, fn])
    for (const fn of ["public.ai_work_link_person_setting(text)", "public.ai_work_link_person_setting_set(text, boolean)"]) {
      expect((await fnPriv(fn, "service_role")).ok).toBe(true)
      for (const role of ["anon", "authenticated", "app_runtime"]) expect({ fn, role, ok: (await fnPriv(fn, role)).ok }).toEqual({ fn, role, ok: false })
    }
    for (const fn of ["public.ai_work_link__acts_without_asking(text, text)", "public.ai_work_link__direct_ok(jsonb, integer)"]) {
      for (const role of ["anon", "authenticated", "app_runtime", "service_role"]) expect({ fn, role, ok: (await fnPriv(fn, role)).ok }).toEqual({ fn, role, ok: false })
    }
    const rls = await one<{ rls_on: boolean; forced: boolean }>(db, "select relrowsecurity rls_on, relforcerowsecurity forced from pg_class where oid = 'platform.ai_work_link_person_settings'::regclass")
    expect(rls).toEqual({ rls_on: true, forced: true })
    for (const role of ["anon", "authenticated", "app_runtime", "service_role"]) {
      const t = await one<{ ok: boolean }>(db, "select has_table_privilege($1, 'platform.ai_work_link_person_settings', 'select') or has_table_privilege($1, 'platform.ai_work_link_person_settings', 'update') ok", [role])
      expect({ role, ok: t.ok }).toEqual({ role, ok: false })
    }
  })

  test("__resolve and __live answer the same act_without_asking (the parity the two functions keep)", async () => {
    await setSwitch("u-mgr", true)
    const live = await call(db, "ai_work_link__live", [mgrLink.link_id])
    expect(live.act_without_asking).toBe(true)
    expect((await ctxOf(mgrLink.token)).act_without_asking).toBe(true)
    await setSwitch("u-mgr", false)
  })
})

describe("the down file", () => {
  test("0685's down file turns every switch off and removes the setter; applying 0685 and 0693 again brings the setter and the open path back", async () => {
    await setSwitch("u-mgr", true)
    await db.exec(downSql("0685_awl_ai_crud"))
    expect((await one<J>(db, "select act_without_asking from platform.ai_work_link_person_settings where user_id = 'u-mgr'")).act_without_asking).toBe(false)
    expect((await refused(db, "select public.ai_work_link_person_setting_set('u-mgr', true)"))?.message).toContain("does not exist")
    // the 24 functions are off the registry, so the link no longer carries delete_progress_entry at all
    expect((await refusedAction(mgrLink.token, LEVEL_2, params()))?.message).toMatch(/FUNCTION_NOT_ON_LINK|LEVEL_NOT_ALLOWED/)
    await db.exec(forwardSql("0685_awl_ai_crud"))
    await db.exec(forwardSql("0693_awl_full_rights"))
    expect(await setSwitch("u-mgr", false)).toMatchObject({ act_without_asking: false })
  })
})
