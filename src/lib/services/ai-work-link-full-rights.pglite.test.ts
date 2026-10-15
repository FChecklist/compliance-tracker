/// <reference types="bun-types" />
// AI FULL RIGHTS (owner decision 2026-10-04, drizzle/0693) on PGlite (real Postgres as WASM) over 0621 to 0669, 0685 and 0693 as the live database has them.
// "The external AI can do ANYTHING the user can do in PROJEXA, limited ONLY by the user's ROLE, the PROJECTS the user can access and the user's ORGANISATION."
//   * (A) the mint: a user-scope link is minted at the highest level the role allows (member and above 1, viewer 0); an explicit level can only be lower; the
//     table CHECK now allows level 1 for a user link and still refuses level 2, a project, or a non-projexa product
//   * (B) no confirmation gate: with the person's "act without asking" switch OFF (the default) a delete (level-2 function) on a level-1 user link is recorded
//     as a direct action and claimed at once, in a project the person may read; the switch can be on or off and nothing changes
//   * (C) the limits stay, for the same link: a project of ANOTHER ORGANISATION, a PRIVATE project the person may not read, and a project that does not exist are
//     one and the same AW404 PROJECT_NOT_FOUND; naming another project in the params is WRONG_PROJECT; a member's link has no manager-rank function
//     (FUNCTION_NOT_ON_LINK); a role demoted between the record and the claim refuses the claim (ROLE_CHANGED); a level-0 link and the kill switch stay drafts-only / off
//   * the down file puts the old rules back (level 0, a delete is a draft again unless the switch is on)
// Run: bun test --isolate src/lib/services/ai-work-link-full-rights.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { downSql, forwardSql, one } from "./__test-helpers__/awl-pglite"
import { call, createUserLinkDb, refused, setWrites, type J } from "./__test-helpers__/awl-user-link-db"

setDefaultTimeout(120_000)

let db: PGlite
const DELETE_FN = "delete_progress_entry" // level 2, member rank: a delete
const MANAGER_FN = "delete_boq" // level 2, manager rank (3)
let n = 0
const eid = () => ({ entryId: `e${++n}` })

/** The person's links made so far are moved into the past first, so many mints of one person do not meet the caps (not what this file is about). */
async function mint(user: string, level: number | null = null): Promise<J> {
  await db.query("update platform.user_ai_links set created_at = created_at - interval '2 days' where user_id = $1 and created_at > now() - interval '1 day'", [user])
  // no level: the 3-argument call (the live one before and after 0693); a level: the 4-argument call
  if (level === null) return (await one<{ r: J }>(db, "select public.ai_work_link_mint_user_for($1, 7, null) r", [user])).r
  return (await one<{ r: J }>(db, "select public.ai_work_link_mint_user_for($1, 7, null, $2) r", [user, level])).r
}
const refusedMint = async (user: string, level: number | null) => {
  await db.query("update platform.user_ai_links set created_at = created_at - interval '2 days' where user_id = $1 and created_at > now() - interval '1 day'", [user])
  return refused(db, "select public.ai_work_link_mint_user_for($1, 7, null, $2)", [user, level])
}
const action = (token: string, fn: string, p: object, project: string | null) => call(db, "ai_work_link_record_intent", [token, "action", fn, p, null, project])
const refusedAction = (token: string, fn: string, p: object, project: string | null) =>
  refused(db, "select public.ai_work_link_record_intent($1, 'action', $2, $3::jsonb, null, $4)", [token, fn, JSON.stringify(p), project])
const claim = (id: string) => call(db, "ai_work_link_intent_claim", [id])
const ctxOf = (token: string) => call(db, "ai_work_link__resolve", [token])
const setSwitch = (user: string, on: boolean) => call(db, "ai_work_link_person_setting_set", [user, on])
const setRole = (user: string, role: string) => db.query("update compliance.users set role = $2::compliance.user_role where id = $1", [user, role])

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0685_awl_ai_crud"))
  await db.exec(forwardSql("0693_awl_full_rights"))
  await setWrites(db, true)
}, 240_000)
afterAll(async () => {
  await db.close()
})

describe("(A) a user-scope link is minted at the highest level the role allows", () => {
  test("admin, manager, senior and member: level 1; viewer: level 0; the row, the answer and the resolved context agree", async () => {
    const got: Record<string, number> = {}
    for (const u of ["u-adm", "u-mgr", "u-sen", "u-mem", "u-view"]) {
      const m = await mint(u)
      got[u] = m.level
      expect(m).toMatchObject({ scope: "user", project: null })
      expect((await one<J>(db, "select authority_level, scope, project_id from platform.user_ai_links where id = $1", [m.link_id]))).toEqual({ authority_level: m.level, scope: "user", project_id: null })
      const ctx = await ctxOf(m.token)
      expect({ u, authority: ctx.authority_level, effective: ctx.effective_level }).toEqual({ u, authority: m.level, effective: m.level })
    }
    expect(got).toEqual({ "u-adm": 1, "u-mgr": 1, "u-sen": 1, "u-mem": 1, "u-view": 0 })
  })

  test("an explicit level can only ask for less: 0 for an admin is read-only; 1 for a viewer is LEVEL_NOT_ALLOWED; 2 and -1 are BAD_LEVEL; nothing is made on a refusal", async () => {
    expect((await mint("u-adm", 0)).level).toBe(0)
    expect((await mint("u-mem", 1)).level).toBe(1)
    const before = (await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where user_id = 'u-view'")).n
    expect((await refusedMint("u-view", 1))?.message).toContain("LEVEL_NOT_ALLOWED")
    expect((await refusedMint("u-adm", 2))?.message).toContain("BAD_LEVEL")
    expect((await refusedMint("u-adm", -1))?.message).toContain("BAD_LEVEL")
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where user_id = 'u-view'")).n).toBe(before)
  })

  test("the table still refuses a user link at level 2, with a project, or for another product (the CHECK is wider, not open)", async () => {
    const base = (vals: string) =>
      `insert into platform.user_ai_links (id, org_id, user_id, token, status, created_at, product, project_id, token_hash, authority_level, allowed_functions, hide_personal, label, expires_at, created_by_user_id, call_count, write_count, scope) values ${vals}`
    const row = (id: string, project: string, level: number) => `('${id}', 'org-a', 'u-mem', null, 'revoked', now(), 'projexa', ${project}, '${"a".repeat(60)}${id.padEnd(4, "0")}', ${level}, '{}', true, null, now() + interval '1 day', 'u-mem', 0, 0, 'user')`
    expect((await refused(db, base(row("y2", "null", 2))))?.message).toMatch(/user_ai_links_user_scope_shape|user_ai_links_authority_level_check/)
    expect((await refused(db, base(row("y3", "'proj-a'", 1))))?.message).toMatch(/user_scope_shape|projexa_shape/)
    expect(await refused(db, base(row("y4", "null", 1)))).toBeNull()
  })

  test("the mint is service_role only and the old 3-argument function is gone (a 3-argument call resolves to the new one)", async () => {
    const priv = (role: string) => one<{ ok: boolean }>(db, "select has_function_privilege($1, 'public.ai_work_link_mint_user_for(text, integer, text, integer)', 'execute') ok", [role])
    expect((await priv("service_role")).ok).toBe(true)
    for (const role of ["anon", "authenticated", "app_runtime"]) expect({ role, ok: (await priv(role)).ok }).toEqual({ role, ok: false })
    expect((await one<{ n: number }>(db, "select count(*)::int n from pg_proc where proname = 'ai_work_link_mint_user_for' and pronamespace = 'public'::regnamespace")).n).toBe(1)
    await db.query("update platform.user_ai_links set created_at = created_at - interval '2 days' where user_id = 'u-mem'")
    expect((await one<{ r: J }>(db, "select public.ai_work_link_mint_user_for('u-mem', 7, null) r")).r.level).toBe(1)
  })
})

describe("(B) no confirmation gate: a delete executes at once at direct level, with the switch OFF", () => {
  test("the person's switch is off (default); the link is level 1; a delete in a project the person may read is recorded as an action and the claim runs it", async () => {
    const link = await mint("u-mem")
    expect(await call(db, "ai_work_link_person_setting", ["u-mem"])).toMatchObject({ act_without_asking: false })
    expect((await ctxOf(link.token)).act_without_asking).toBe(false)
    const rec = await action(link.token, DELETE_FN, eid(), "proj-a")
    expect(rec).toMatchObject({ status: "recorded", kind: "action", function_id: DELETE_FN, replayed: false, confirm_token: null })
    expect(await claim(rec.intent_id)).toMatchObject({ status: "ok", intent: { kind: "action", function_id: DELETE_FN }, ctx: { project_id: "proj-a", user_id: "u-mem", effective_level: 1 } })
    expect((await one<J>(db, "select status, kind, user_id, org_id, project_id from platform.ai_work_link_intent where id = $1", [rec.intent_id]))).toMatchObject({ status: "executing", kind: "action", user_id: "u-mem", org_id: "org-a", project_id: "proj-a" })
  })

  test("it is the same with the switch on, and flipping it off between the record and the claim changes nothing", async () => {
    const link = await mint("u-mgr")
    await setSwitch("u-mgr", true)
    const a = await action(link.token, DELETE_FN, eid(), "proj-a")
    await setSwitch("u-mgr", false)
    expect(await claim(a.intent_id)).toMatchObject({ status: "ok" })
    expect(await claim((await action(link.token, "archive_task", { taskId: "t1" }, "proj-a")).intent_id)).toMatchObject({ status: "ok", intent: { function_id: "archive_task" } })
  })

  test("a manager's link runs a manager-rank delete too (delete_boq), directly, with the switch off", async () => {
    const link = await mint("u-mgr")
    expect((await call(db, "ai_work_link__resolve_in", [link.token, "proj-a"])).effective_functions).toContain(MANAGER_FN)
    expect(await claim((await action(link.token, MANAGER_FN, { boqId: "b1" }, "proj-a")).intent_id)).toMatchObject({ status: "ok", intent: { function_id: MANAGER_FN } })
  })

  test("a draft is still possible (it is just not required)", async () => {
    const link = await mint("u-mem")
    expect(await call(db, "ai_work_link_record_intent", [link.token, "draft", DELETE_FN, eid(), null, "proj-a"])).toMatchObject({ status: "awaiting_confirmation", kind: "draft" })
  })
})

describe("(C) the limits that remain: ROLE, PROJECTS, ORGANISATION", () => {
  test("ORGANISATION: a project of another organisation is PROJECT_NOT_FOUND for a delete, a read of the project, and the claim of nothing; a project that does not exist is the same answer", async () => {
    const link = await mint("u-mgr")
    const foreign = await refusedAction(link.token, DELETE_FN, eid(), "proj-b")
    const foreignPriv = await refusedAction(link.token, DELETE_FN, eid(), "proj-b-priv")
    const missing = await refusedAction(link.token, DELETE_FN, eid(), "proj-nope")
    for (const r of [foreign, foreignPriv, missing]) expect(r?.message).toContain("PROJECT_NOT_FOUND")
    expect(foreign?.message).toBe(missing?.message) // no oracle for what exists in another organisation
    expect((await refused(db, "select public.ai_work_link_records($1, 'tasks', null, 10, '{}'::jsonb, 'proj-b')", [link.token]))?.message).toContain("PROJECT_NOT_FOUND")
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_intent where project_id in ('proj-b', 'proj-b-priv', 'proj-nope')")).n).toBe(0)
  })

  test("the other organisation's own person cannot reach organisation A either (the same limit, from the other side)", async () => {
    const link = await mint("u-b")
    expect((await refusedAction(link.token, DELETE_FN, eid(), "proj-a"))?.message).toContain("PROJECT_NOT_FOUND")
    expect(await action(link.token, DELETE_FN, eid(), "proj-b")).toMatchObject({ status: "recorded" })
  })

  test("PROJECTS: a private project the member may not read is PROJECT_NOT_FOUND (the same answer as another organisation's); the senior who leads it may; naming another project in the params is WRONG_PROJECT", async () => {
    const mem = await mint("u-mem")
    const priv = await refusedAction(mem.token, DELETE_FN, eid(), "proj-priv")
    expect(priv?.message).toContain("PROJECT_NOT_FOUND")
    expect(priv?.message).toBe((await refusedAction(mem.token, DELETE_FN, eid(), "proj-b"))?.message)
    const sen = await mint("u-sen")
    expect(await action(sen.token, DELETE_FN, eid(), "proj-priv")).toMatchObject({ status: "recorded" })
    expect((await refusedAction(mem.token, DELETE_FN, { entryId: "e", projectId: "proj-a2" }, "proj-a"))?.message).toContain("WRONG_PROJECT")
  })

  test("ROLE: a member's link has no manager-rank function (delete_boq): FUNCTION_NOT_ON_LINK, even at level 1 with the switch on; a viewer's link has no change function at all", async () => {
    const mem = await mint("u-mem")
    await setSwitch("u-mem", true)
    try {
      expect((await call(db, "ai_work_link__resolve_in", [mem.token, "proj-a"])).effective_functions).not.toContain(MANAGER_FN)
      expect((await refusedAction(mem.token, MANAGER_FN, { boqId: "b1" }, "proj-a"))?.message).toContain("FUNCTION_NOT_ON_LINK")
    } finally {
      await setSwitch("u-mem", false)
    }
    const view = await mint("u-view")
    expect((await refusedAction(view.token, DELETE_FN, eid(), "proj-a"))?.message).toMatch(/FUNCTION_NOT_ON_LINK|LEVEL_NOT_ALLOWED/)
    expect((await refusedAction(view.token, "update_meeting", { meetingId: "m1", title: "x" }, "proj-a"))?.message).toMatch(/FUNCTION_NOT_ON_LINK|LEVEL_NOT_ALLOWED/)
  })

  test("ROLE, read now: a role demoted between the record and the claim refuses the claim (ROLE_CHANGED) and the delete does not run", async () => {
    const link = await mint("u-mem")
    const rec = await action(link.token, DELETE_FN, eid(), "proj-a")
    await setRole("u-mem", "viewer")
    try {
      expect(await claim(rec.intent_id)).toEqual({ status: "refused", reason: "ROLE_CHANGED" })
    } finally {
      await setRole("u-mem", "member")
    }
    expect((await one<J>(db, "select status from platform.ai_work_link_intent where id = $1", [rec.intent_id])).status).toBe("refused")
  })

  test("a link minted read-only (level 0) stays drafts-only whatever the switch says, and the kill switch stops every direct action", async () => {
    const ro = await mint("u-adm", 0)
    await setSwitch("u-adm", true)
    expect((await refusedAction(ro.token, DELETE_FN, eid(), "proj-a"))?.message).toContain("LEVEL_NOT_ALLOWED")
    await setSwitch("u-adm", false)
    const rw = await mint("u-mem")
    const before = await action(rw.token, DELETE_FN, eid(), "proj-a")
    await setWrites(db, false)
    try {
      expect((await refusedAction(rw.token, DELETE_FN, eid(), "proj-a"))?.message).toContain("LEVEL_NOT_ALLOWED")
      expect(await claim(before.intent_id)).toEqual({ status: "not_enabled" })
    } finally {
      await setWrites(db, true)
    }
  })

  test("the audit trail is kept: every direct delete is an intent row with the person, the organisation, the link and the project", async () => {
    const link = await mint("u-mem")
    const rec = await action(link.token, DELETE_FN, eid(), "proj-a")
    expect(await one<J>(db, "select link_id, user_id, org_id, project_id, function_id, kind from platform.ai_work_link_intent where id = $1", [rec.intent_id])).toEqual({
      link_id: link.link_id, user_id: "u-mem", org_id: "org-a", project_id: "proj-a", function_id: DELETE_FN, kind: "action",
    })
  })
})

describe("the down file", () => {
  test("puts back level 0 for user links and the confirmation gate (a delete is a draft again unless the switch is on); applying 0693 again opens it again", async () => {
    const link = await mint("u-mem")
    expect(link.level).toBe(1)
    await db.exec(downSql("0693_awl_full_rights"))
    expect((await one<J>(db, "select authority_level from platform.user_ai_links where id = $1", [link.link_id])).authority_level).toBe(0)
    const old = await mint("u-mgr")
    expect(old.level).toBe(0)
    await setSwitch("u-mgr", false)
    expect((await refusedAction(old.token, DELETE_FN, eid(), "proj-a"))?.message).toContain("LEVEL_NOT_ALLOWED")
    await db.exec(forwardSql("0693_awl_full_rights"))
    expect((await mint("u-mgr")).level).toBe(1)
  })
})
