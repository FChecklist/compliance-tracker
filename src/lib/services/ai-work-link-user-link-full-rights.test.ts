/// <reference types="bun-types" />
// AI FULL RIGHTS (owner decision 2026-10-04, drizzle/0693): POST /user-link of the Edge function ai-work-link mints at the HIGHEST level the person's ROLE
// allows when the body names no level (a member and above: level 1, direct add / edit / delete; a viewer: level 0, read), and accepts an optional `level`
// that can only ask for LESS. Everything that decides an answer is REAL, as in ai-work-link-user-link-mint.test.ts: the handler, the token verifier and the
// SQL of 0618, 0621 to 0631, 0651, 0668, 0669 and 0693 on PGlite. Only the failure cases are faked, by wrapping the same rpc.
//   * default level by role: admin, manager, senior and member get 1; a viewer gets 0; the row says so
//   * an explicit level can only be lower: {level: 0} gives an admin a read-only link; a viewer asking for 1 is 403 LEVEL_NOT_ALLOWED; 2, "x" are 400 BAD_LEVEL, before SQL
//   * the level reaches SQL only when the body named it (no p_level otherwise), the answer carries it, nothing is made on a refusal
//   * a level-1 user link resolves to effective level 1 once writes are on, and still lists only the person's own organisation's readable projects
// Run: bun test --isolate src/lib/services/ai-work-link-user-link-full-rights.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { AUTH, makeHarness, one, openMintDb, type Harness, type J } from "./__test-helpers__/awl-mint-harness"
import { forwardSql } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(120_000)

let db: PGlite
let h: Harness
const config = { ...configFromEnv(() => undefined), confirmHost: "inbox-test.pages.dev", execPresent: false }

beforeAll(async () => {
  db = await openMintDb()
  for (const name of ["0629_build001_awl_execution_sql", "0630_build001_awl_submissions_via", "0651_build002_awl_seed_submit_timesheet", "0668_awl_user_wide_link", "0669_awl_seed_user_link_create_project", "0693_awl_full_rights"]) await db.exec(forwardSql(name))
  h = await makeHarness(db)
}, 240_000)
afterAll(async () => {
  await db.close()
})
// every test starts with no live links and no mint count in the caps' window (the caps are not what this file is about)
beforeEach(async () => {
  h.reset()
  await db.exec("update platform.user_ai_links set status = 'revoked', created_at = created_at - interval '3 days'")
})

const mint = async (sub: string, body: unknown = {}, now?: () => number) => h.call("POST", "/user-link", { token: await h.sign({ sub }), body, config, now })
const levelOf = async (linkId: string) => (await one<{ authority_level: number }>(db, "select authority_level from platform.user_ai_links where id = $1", [linkId])).authority_level

describe("with no level in the body, the link is minted at the highest level the person's role allows", () => {
  test("admin, manager, senior and member get level 1 (direct add / edit / delete): in the answer and in the row", async () => {
    for (const sub of [AUTH.adm, AUTH.mgr, AUTH.sen, AUTH.mem]) {
      h.reset()
      const r = await mint(sub)
      expect({ sub, status: r.res.status, level: r.json.level }).toEqual({ sub, status: 201, level: 1 })
      expect(r.json).toMatchObject({ scope: "user", project: null })
      expect(await levelOf(r.json.link_id)).toBe(1)
      // a call with no level names none to SQL: the default is decided by the database, from the live role
      expect(h.sqlCalls()).toContain("ai_work_link_mint_user_for")
    }
  })

  test("a viewer (read-only role) still gets a link, at level 0 (read)", async () => {
    const r = await mint(AUTH.view)
    expect(r.res.status).toBe(201)
    expect(r.json.level).toBe(0)
    expect(await levelOf(r.json.link_id)).toBe(0)
  })

  test("the level is the LIVE role's: the same person demoted to viewer is minted at level 0, promoted back at level 1", async () => {
    await db.exec("update compliance.users set role = 'viewer' where id = 'u-mem'")
    try {
      expect((await mint(AUTH.mem)).json.level).toBe(0)
    } finally {
      await db.exec("update compliance.users set role = 'member' where id = 'u-mem'")
    }
    h.reset()
    await db.exec("update platform.user_ai_links set created_at = created_at - interval '3 days'")
    expect((await mint(AUTH.mem)).json.level).toBe(1)
  })
})

describe("an explicit level can only ask for LESS than the role allows", () => {
  test("{level: 0} gives an admin a read-only link; {level: 1} gives a member exactly the default; the string \"1\" is accepted like the number", async () => {
    expect((await mint(AUTH.adm, { level: 0 })).json.level).toBe(0)
    expect((await mint(AUTH.mem, { level: 1 })).json.level).toBe(1)
    expect((await mint(AUTH.mgr, { level: "1" })).json.level).toBe(1)
  })

  test("a viewer asking for level 1 is 403 LEVEL_NOT_ALLOWED and nothing is made (the role is the ceiling, in SQL)", async () => {
    const before = (await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where user_id = 'u-view' and status = 'active'")).n
    const r = await mint(AUTH.view, { level: 1 })
    expect(r.res.status).toBe(403)
    expect(r.json.code).toBe("LEVEL_NOT_ALLOWED")
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where user_id = 'u-view' and status = 'active'")).n).toBe(before)
    expect(r.text).not.toContain("pxa_")
  })

  test("a level that is not 0 or 1 is 400 BAD_LEVEL and reaches no SQL", async () => {
    let t = Date.now()
    for (const level of [2, -1, "x", 1.5, true]) {
      h.reset()
      t += 61_000 // a new minute each time: the per-person brake is not what this is about
      const r = await mint(AUTH.mgr, { level }, () => t)
      expect({ level, status: r.res.status, code: r.json.code }).toEqual({ level, status: 400, code: "BAD_LEVEL" })
      expect(h.sqlCalls()).not.toContain("ai_work_link_mint_user_for")
    }
  })

  test("a projectId, a function list or an organisation in the body is still refused (USER_LINK_PARAMS): the level is the only new input", async () => {
    for (const body of [{ projectId: "proj-a" }, { functions: ["create_project"] }, { orgId: "org-b" }, { level: 1, projectId: "proj-a" }]) {
      h.reset()
      const r = await mint(AUTH.mgr, body)
      expect({ body, status: r.res.status, code: r.json.code }).toEqual({ body, status: 400, code: "USER_LINK_PARAMS" })
    }
  })
})

describe("the level-1 user link is a real direct-level link inside the person's own limits", () => {
  test("with writes on, it resolves to effective level 1 and the member's functions; the project list is still the person's own organisation's readable projects", async () => {
    await db.exec("update platform.ai_work_link_settings set writes_enabled = true")
    try {
      const r = await mint(AUTH.mem)
      const ctx = await one<J>(db, "select public.ai_work_link__resolve($1) r", [r.json.token]).then((x) => x.r)
      expect(ctx).toMatchObject({ status: "ok", scope: "user", authority_level: 1, effective_level: 1, live_role: "member" })
      const list = await h.call("GET", `/${r.json.token}/projects`, { headers: { accept: "application/json" } })
      expect(list.res.status).toBe(200)
      expect(list.json.projects.map((p: J) => p.name).sort()).toEqual(["Villa A", "Villa A2"])
      expect(list.text).not.toContain("Tower B")
      expect(list.text).not.toContain("Secret A")
    } finally {
      await db.exec("update platform.ai_work_link_settings set writes_enabled = false")
    }
  })

  test("fail closed: a database error or an answer with no well-formed link is still 503 with no token", async () => {
    const shapes: Array<(a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = [
      async () => ({ data: null, error: { message: "boom", code: "XX000" } }),
      async () => ({ data: { hello: "world" }, error: null }),
    ]
    for (const f of shapes) {
      const r = await h.call("POST", "/user-link", { token: await h.sign({ sub: AUTH.mgr }), body: { level: 1 }, config, over: { ai_work_link_mint_user_for: f } })
      expect(r.res.status).toBe(503)
      expect(r.text).not.toContain("pxa_")
    }
  })
})
