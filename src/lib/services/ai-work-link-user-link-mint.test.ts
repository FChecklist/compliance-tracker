/// <reference types="bun-types" />
// PROJEXA USER-WIDE AI WORK LINK (drizzle/0668): POST /user-link of the Edge function ai-work-link, the signed-in route that makes a link for ALL a person's
// projects. Everything that decides an answer is REAL, as in the other mint tests: the handler (handler.ts and mint.ts), the token verifier with the real jose
// package and real ES256 keys, and the SQL of 0618, 0621 to 0631, 0651, 0668 and 0669 on PGlite. Only the failure cases are faked, by wrapping the same rpc.
//   * the contract: 201 with the SAME shape as POST /mint, plus scope "user" and project null, level 0 for ever, no inbox address, shell false
//   * only the session decides who: a stale, absent, link-token or foreign session is refused before any SQL; the per-minute brake; days and label only
//   * what is refused: a projectId, a level, a function list or a person's organisation in the body is 400 USER_LINK_PARAMS and reaches no SQL
//   * the token works (GET /projects), only its hash is stored, the previous link of the person stops, the person's list shows the scope
// Run: bun test --isolate src/lib/services/ai-work-link-user-link-mint.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { AUTH, F, makeHarness, one, openMintDb, type Harness, type J } from "./__test-helpers__/awl-mint-harness"
import { forwardSql, sha256Hex } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(120_000)

let db: PGlite
let h: Harness
const config = { ...configFromEnv(() => undefined), confirmHost: "inbox-test.pages.dev", execPresent: false }

beforeAll(async () => {
  db = await openMintDb()
  for (const name of ["0629_build001_awl_execution_sql", "0630_build001_awl_submissions_via", "0651_build002_awl_seed_submit_timesheet", "0668_awl_user_wide_link", "0669_awl_seed_user_link_create_project"]) await db.exec(forwardSql(name))
  h = await makeHarness(db)
  // a person of their own for the test that reads the person's whole list, so no other test's links are in it
  await db.exec("insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values ('u-list', 'List Person', 'list@a.example.test', 'x', 'member', true, 'org-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')")
}, 240_000)
afterAll(async () => {
  await db.close()
})
// The call log is append-only and every link has call rows, so nothing is deleted between tests: the links of the last test are revoked and moved three days back,
// which also frees the mint caps (they count the last hour and day), and a test reads only the links made after that (`fresh`).
beforeEach(async () => {
  h.reset()
  await db.exec("update platform.user_ai_links set status = 'revoked', created_at = created_at - interval '3 days'")
})

const fresh = (userId: string) =>
  db.query<J>("select id, user_id, project_id, status, token, token_hash, authority_level from platform.user_ai_links where user_id = $1 and created_at > now() - interval '1 day' order by created_at, id", [userId]).then((r) => r.rows)
const freshCount = async () => (await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where created_at > now() - interval '1 day'")).n

const mint = async (o: { sub?: string; iatAgoSeconds?: number; body?: unknown; token?: string | null; now?: () => number } = {}) =>
  h.call("POST", "/user-link", { token: o.token === undefined ? await h.sign({ sub: o.sub, iatAgoSeconds: o.iatAgoSeconds }) : o.token, body: o.body ?? {}, config, now: o.now })

describe("the contract", () => {
  test("201 with the mint shape plus scope user and project null: level 0, the member's functions, a link address, no inbox, shell false", async () => {
    const r = await mint({ sub: AUTH.mem })
    expect(r.res.status).toBe(201)
    expect(r.json).toMatchObject({ shell: false, scope: "user", level: 0, project: null, hide_personal: true, label: "All my projects" })
    expect(r.json.token).toMatch(/^pxa_[0-9a-f]{64}$/)
    expect(r.json.links).toEqual({ link: `${F}/${r.json.token}`, header_base: `${F}/header`, inbox: null })
    expect(r.json.notice).toContain("only time")
    expect(r.json.allowed_functions).toContain("create_project")
    expect(r.json.allowed_functions).toContain("record_work_progress")
    expect(Object.keys(r.json).sort()).toEqual(["allowed_functions", "expires_at", "hide_personal", "label", "level", "link_id", "links", "notice", "project", "scope", "shell", "token"].sort())
    expect(new Date(r.json.expires_at).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
    expect(r.res.headers.get("cache-control")).toBe("no-store")
    expect(r.res.headers.get("access-control-allow-origin")).toBe("https://projexa-ai.com")
  })

  test("days 1, 7 or 30 and a label are the only inputs; the label is trimmed; the expiry follows the days", async () => {
    const r = await mint({ sub: AUTH.mgr, body: { days: 30, label: "  My AI  " } })
    expect(r.res.status).toBe(201)
    expect(r.json).toMatchObject({ label: "My AI", scope: "user" })
    expect(new Date(r.json.expires_at).getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000)
    expect((await mint({ sub: AUTH.mgr, body: { days: 1 } })).res.status).toBe(201)
    expect((await mint({ sub: AUTH.mgr, body: { days: null, label: null } })).res.status).toBe(201)
  })

  test("the row: scope user, no project, level 0, the person's own organisation and id, no plaintext token, only the sha256", async () => {
    const r = await mint({ sub: AUTH.mem })
    const rows = await fresh("u-mem")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: r.json.link_id, project_id: null, status: "active", token: null, authority_level: 0, token_hash: sha256Hex(r.json.token) })
    const full = await one<J>(db, "select scope, org_id, created_by_user_id, product from platform.user_ai_links where id = $1", [r.json.link_id])
    expect(full).toEqual({ scope: "user", org_id: "org-a", created_by_user_id: "u-mem", product: "projexa" })
    expect(h.bodies().filter((b) => b.includes(r.json.token))).toHaveLength(1)
    expect(h.logs().join("\n")).not.toContain(r.json.token)
  })

  test("the new link works: GET /projects lists the person's projects (their own organisation's only) and a record read says to choose a project", async () => {
    const r = await mint({ sub: AUTH.mem })
    const list = await h.call("GET", `/${r.json.token}/projects`, { headers: { accept: "application/json" } })
    expect(list.res.status).toBe(200)
    expect(list.json.projects.map((p: J) => p.name).sort()).toEqual(["Villa A", "Villa A2"])
    expect(list.json.extra_options.map((o: J) => o.label)).toEqual(["Report on all above", "Create New Project"])
    expect(list.text).not.toContain("Tower B")
    expect(list.text).not.toContain("Secret A")
    const noProject = await h.call("GET", `/${r.json.token}/records/tasks`, { headers: { accept: "application/json" } })
    expect(noProject.res.status).toBe(400)
    expect(noProject.json.code).toBe("PROJECT_REQUIRED")
    const inside = await h.call("GET", `/${r.json.token}/projects/proj-a/records/tasks`, { headers: { accept: "application/json" } })
    expect(inside.res.status).toBe(200)
    expect(inside.json.items.map((i: J) => i.id).sort()).toEqual(["is-1", "is-2", "is-3"])
    const foreign = await h.call("GET", `/${r.json.token}/projects/proj-b/records/tasks`, { headers: { accept: "application/json" } })
    const priv = await h.call("GET", `/${r.json.token}/projects/proj-priv/records/tasks`, { headers: { accept: "application/json" } })
    expect([foreign.res.status, priv.res.status]).toEqual([404, 404])
    expect(priv.text.split(r.json.token).join("T")).toBe(foreign.text.split(r.json.token).join("T"))
  })

  test("a second mint stops the first link (410) and the new one works; the person's list shows both, with scope user and no project", async () => {
    const sub = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    const a = await mint({ sub })
    const b = await mint({ sub })
    expect((await h.call("GET", `/${a.json.token}/projects`)).res.status).toBe(410)
    expect((await h.call("GET", `/${b.json.token}/projects`)).res.status).toBe(200)
    const links = await h.call("GET", "/links", { token: await h.sign({ sub }) })
    expect(links.res.status).toBe(200)
    expect(links.json.links.map((l: J) => [l.scope, l.project_id, l.project_name, l.level, l.active])).toEqual([["user", null, null, 0, true], ["user", null, null, 0, false]])
    expect(JSON.stringify(links.json)).not.toContain(b.json.token)
    // a project link of the same person is not stopped by a user link
    const proj = await h.call("POST", "/mint", { token: await h.sign({ sub }), body: { projectId: "proj-a" }, config })
    expect(proj.res.status).toBe(201)
    await mint({ sub })
    expect((await h.call("GET", `/${proj.json.token}/context`)).res.status).toBe(200)
  })
})

describe("who may, and what is refused", () => {
  test("no session, a link token as the session, a foreign key and a stale session are 401 and reach no SQL", async () => {
    expect((await mint({ token: null })).res.status).toBe(401)
    const linkToken = "pxa_" + "a".repeat(64)
    expect((await mint({ token: linkToken })).json.code).toBe("SESSION_REQUIRED")
    expect((await mint({ token: await h.sign({ key: "stranger" }) })).json.code).toBe("SESSION_INVALID")
    const stale = await mint({ iatAgoSeconds: 16 * 60 })
    expect(stale.res.status).toBe(401)
    expect(stale.json.code).toBe("SESSION_STALE")
    expect(h.sqlCalls().filter((f) => f === "ai_work_link_mint_user_for")).toEqual([])
    expect(await fresh("u-mgr")).toEqual([])
  })

  test("a person who is not one active user is 403 USER_NOT_LINKED and nothing is made", async () => {
    for (const sub of [AUTH.nobody, AUTH.off]) {
      const r = await mint({ sub })
      expect({ sub, status: r.res.status, code: r.json.code }).toEqual({ sub, status: 403, code: "USER_NOT_LINKED" })
    }
    expect(await freshCount()).toBe(0)
  })

  test("the body takes days and label ONLY: a projectId, a level, a function list, hidePersonal or an organisation is 400 USER_LINK_PARAMS, before any SQL", async () => {
    for (const body of [{ projectId: "proj-a" }, { project: "proj-a" }, { level: 1 }, { functions: ["create_project"] }, { hidePersonal: false }, { orgId: "org-b" }, { days: 7, userId: "u-adm" }]) {
      h.reset()
      const r = await mint({ sub: AUTH.mgr, body })
      expect({ body, status: r.res.status, code: r.json.code }).toEqual({ body, status: 400, code: "USER_LINK_PARAMS" })
      expect(h.sqlCalls()).not.toContain("ai_work_link_mint_user_for")
    }
    expect(await freshCount()).toBe(0)
  })

  test("a bad days value, a bad label and a body that is not a JSON object are 400 before SQL", async () => {
    // the per-person brake (5 a minute) is not what this is about: each call is a minute later than the last
    let t = Date.now()
    for (const [body, code] of [[{ days: 3 }, "BAD_DAYS"], [{ days: "x" }, "BAD_DAYS"], [{ label: "a".repeat(81) }, "BAD_LABEL"], [{ label: 5 }, "BAD_LABEL"], [{ label: "bad\u0007label" }, "BAD_LABEL"], [[1], "BODY_NOT_OBJECT"]] as const) {
      t += 61_000
      const r = await mint({ sub: AUTH.mgr, body, now: () => t })
      expect({ status: r.res.status, code: r.json.code }).toEqual({ status: 400, code })
    }
    t += 61_000
    const notJson = await h.call("POST", "/user-link", { token: await h.sign({ sub: AUTH.mgr }), rawBody: "{nope", config, now: () => t })
    expect(notJson.json.code).toBe("BODY_NOT_JSON")
    expect(h.sqlCalls()).not.toContain("ai_work_link_mint_user_for")
  })

  test("only POST: a GET is 405 with Allow: POST", async () => {
    const r = await h.call("GET", "/user-link", { token: await h.sign({ sub: AUTH.mgr }) })
    expect(r.res.status).toBe(405)
    expect(r.res.headers.get("allow")).toBe("POST")
  })

  test("the per-person brake is the mint's: the 6th call in a minute is 429, and a mint and a user link share it", async () => {
    const t = Date.now()
    const call = async () => h.call("POST", "/user-link", { token: await h.sign({ sub: AUTH.view }), body: {}, config, now: () => t })
    for (let i = 0; i < 5; i++) expect((await call()).res.status).toBe(201)
    const sixth = await call()
    expect(sixth.res.status).toBe(429)
    expect(sixth.json.code).toBe("RATE_LIMITED")
  })

  test("a viewer (rank 1) may have the link: it lists projects, offers no Create New Project and holds no function outside a project", async () => {
    const r = await mint({ sub: AUTH.view })
    expect(r.res.status).toBe(201)
    expect(r.json.allowed_functions).not.toContain("create_project")
    const list = await h.call("GET", `/${r.json.token}/projects`, { headers: { accept: "application/json" } })
    expect(list.json.extra_options.map((o: J) => o.label)).toEqual(["Report on all above"])
  })

  test("fail closed: a database error, a throw and an answer with no well-formed link are 503 and no token is in the body", async () => {
    const shapes: Array<(a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = [
      async () => ({ data: null, error: { message: "boom", code: "XX000" } }),
      async () => { throw new Error("connection reset") },
      async () => ({ data: { hello: "world" }, error: null }),
      async () => ({ data: { link_id: "x", token: "pxa_" + "a".repeat(64), scope: "project", project: { id: "p" } }, error: null }),
    ]
    for (const f of shapes) {
      const r = await h.call("POST", "/user-link", { token: await h.sign({ sub: AUTH.mgr }), body: {}, config, over: { ai_work_link_mint_user_for: f } })
      expect(r.res.status).toBe(503)
      expect(r.json.code).toBe("MINT_UNAVAILABLE")
      expect(r.text).not.toContain("pxa_")
    }
  })

  test("the caps are the mint's, through SQL: the 11th link in an hour is 429 MINT_CAP_HOUR (a user link and a project link count together)", async () => {
    await db.exec("insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values ('u-cap', 'Cap', 'cap@a.example.test', 'x', 'member', true, 'org-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')")
    let t = Date.now()
    let last: Awaited<ReturnType<typeof mint>> | null = null
    for (let i = 0; i < 11; i++) {
      t += 61_000 // a new minute each time: the brake is not what this is about
      last = await h.call("POST", "/user-link", { token: await h.sign({ sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), body: {}, config, now: () => t })
      if (i < 10) expect(last.res.status).toBe(201)
    }
    expect(last!.res.status).toBe(429)
    expect(last!.json.code).toBe("MINT_CAP_HOUR")
  })
})
