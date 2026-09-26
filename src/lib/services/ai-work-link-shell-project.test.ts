/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (register row AW-406; GAP D section 6, option B): POST /new-project of the Edge function ai-work-link, "New project
// with my AI": one action that creates a SHELL project and a level 0 link for the same person, through the REAL handler over the REAL SQL
// (drizzle/0618, 0621 to 0628, 0631 on PGlite).
//
// WHAT IS PROVEN
//   the shell   a project named "New project (AI setup)" in the person's own organisation, in the organisation's oldest active product (or
//               the one asked for), with the person as its lead, active and public: the row createProject would write
//   the link    level 0, 7 days by default (1 or 30 on request), for the SAME person and the NEW project, shown once, stored only as a hash,
//               and it works (context 200 on the shell); nothing the caller sends (a level, a project, an organisation) changes that
//   who         rank 2 and above only (the rule of POST /api/v1/projexa/projects); a viewer, an inactive person and an unmapped sub are 403
//   one action  when the link cannot be made (the hourly cap) no project is left behind
//   refused     a product of another organisation or that does not exist, an organisation with no product (404, no project); a stale session
//   parity      the insert follows createProject in src/lib/services/construction-dashboard-service.ts (read from its source)
//
// Run: bun test --isolate src/lib/services/ai-work-link-shell-project.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
import { AUTH, linkRows, makeHarness, one, openMintDb, type Harness, type J } from "./__test-helpers__/awl-mint-harness"
import { sha256Hex } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

let h: Harness
const C_AUTH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const SHELL = "New project (AI setup)"

beforeAll(async () => {
  h = await makeHarness(await openMintDb())
  // a manager of an organisation that has no product at all
  await h.db.exec(`insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id)
                   values ('u-c', 'Cy Manager', 'cy@c.example.test', 'x', 'manager', true, 'org-c', '${C_AUTH}')`)
}, 120_000)
afterAll(async () => {
  await h.db.close()
})
beforeEach(async () => {
  h.reset()
  await h.db.exec(`truncate platform.ai_work_link_call; delete from platform.user_ai_links; delete from compliance.projects where name = '${SHELL}'`)
})

const shellRows = () => h.db.query<J>(`select id, org_id, product_id, name, description, lead_user_id, is_active, access_level, status from compliance.projects where name = '${SHELL}' order by created_at, id`).then((r) => r.rows)
const create = async (o: { sub?: string; body?: unknown; iatAgoSeconds?: number } = {}) =>
  h.call("POST", "/new-project", { token: await h.sign({ sub: o.sub, iatAgoSeconds: o.iatAgoSeconds }), body: o.body ?? {} })

describe("the shell and its link, in one action", () => {
  test("the manager: a shell project of their organisation and product, they are its lead, and a level 0 link for the same person on it", async () => {
    const r = await create()
    expect(r.res.status).toBe(201)
    expect(r.json).toMatchObject({ shell: true, product_id: "prod", level: 0, hide_personal: true, label: "AI setup", project: { name: SHELL } })
    const token: string = r.json.token
    expect(token).toMatch(/^pxa_[0-9a-f]{64}$/)
    expect(r.json.links.link).toBe(`https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/${token}`)
    expect(r.res.headers.get("cache-control")).toBe("no-store")
    expect(Date.parse(r.json.expires_at) - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
    // no organisation, user or product internals beyond the product id the caller may choose
    expect(r.text).not.toContain("org-a")
    expect(r.text).not.toContain("u-mgr")

    // re-read from the database
    const shells = await shellRows()
    expect(shells).toHaveLength(1)
    expect(shells[0]).toMatchObject({ id: r.json.project.id, org_id: "org-a", product_id: "prod", name: SHELL, lead_user_id: "u-mgr", is_active: true, access_level: "public", status: "active" })
    expect(shells[0].description).toContain("New project with my AI")
    const links = await linkRows(h.db, "u-mgr")
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ project_id: shells[0].id, user_id: "u-mgr", status: "active", authority_level: 0, label: "AI setup", token: null, token_hash: sha256Hex(token) })
    expect(JSON.stringify(links)).not.toContain(token)
    // the link works, and it acts as the same person on the shell
    const ctx = await h.call("GET", `/${token}/context`, { session: "none", headers: { accept: "application/json" } })
    expect(ctx.res.status).toBe(200)
    expect(ctx.json.project).toMatchObject({ id: shells[0].id, name: SHELL })
    expect(ctx.json.acting_for).toMatchObject({ name: "Mira Manager" })
    // and it is in the person's own list
    const list = await h.call("GET", "/links", { token: await h.sign() })
    expect(list.json.links[0]).toMatchObject({ project_id: shells[0].id, project_name: SHELL, level: 0, label: "AI setup", active: true })
    // the token is in no log line
    expect(h.logs().join("\n")).not.toContain(token)
  })

  test("nothing the caller sends changes what is made: a level, a project and an organisation in the body are ignored", async () => {
    const r = await create({ body: { level: 1, projectId: "proj-b", orgId: "org-b", userId: "u-adm", label: "mine" } })
    expect(r.res.status).toBe(201)
    expect(r.json.level).toBe(0)
    expect(r.json.project.id).not.toBe("proj-b")
    expect(r.json.label).toBe("AI setup")
    expect((await shellRows())[0]).toMatchObject({ org_id: "org-a", lead_user_id: "u-mgr" })
    expect((await linkRows(h.db, "u-adm")).length).toBe(0)
  })

  test("the member (rank 2) may; the days can be 1, 7 or 30, and the product can be chosen among the organisation's own", async () => {
    const member = await create({ sub: AUTH.mem, body: { days: 30, productId: "prod-2" } })
    expect(member.res.status).toBe(201)
    expect(member.json.product_id).toBe("prod-2")
    expect(Math.abs(Date.parse(member.json.expires_at) - Date.now() - 30 * 86_400_000)).toBeLessThan(3_600_000)
    expect((await shellRows())[0]).toMatchObject({ product_id: "prod-2", lead_user_id: "u-mem" })
    const day = await create({ body: { days: 1 } })
    expect(Math.abs(Date.parse(day.json.expires_at) - Date.now() - 86_400_000)).toBeLessThan(3_600_000)
  })

  test("a second shell is a separate project and a separate link: the first link stays live (a different project)", async () => {
    const a = await create()
    const b = await create()
    expect(a.json.project.id).not.toBe(b.json.project.id)
    expect((await linkRows(h.db, "u-mgr")).map((l) => l.status)).toEqual(["active", "active"])
    expect((await shellRows()).length).toBe(2)
  })
})

describe("who may, and what is refused", () => {
  test("a viewer (rank 1), an inactive person and an unmapped sub are 403 and no project or link is made; no session is 401", async () => {
    const viewer = await create({ sub: AUTH.view })
    expect(viewer.res.status).toBe(403)
    expect(viewer.json).toMatchObject({ status: 403, code: "ROLE_TOO_LOW" })
    for (const sub of [AUTH.off, AUTH.nobody]) {
      const r = await create({ sub })
      expect(`${sub} ${r.res.status} ${r.json.code}`).toBe(`${sub} 403 USER_NOT_LINKED`)
    }
    expect(await shellRows()).toEqual([])
    expect((await one<{ n: number }>(h.db, "select count(*)::int n from platform.user_ai_links")).n).toBe(0)
    h.reset()
    const none = await h.call("POST", "/new-project", { body: {} })
    expect(none.res.status).toBe(401)
    expect(none.res.headers.get("www-authenticate")).toBeNull()
    expect(h.sqlCalls()).toEqual([])
  })

  test("a session older than 15 minutes is 401 SESSION_STALE, like a mint, and reaches no SQL", async () => {
    const r = await create({ iatAgoSeconds: 20 * 60 })
    expect(r.res.status).toBe(401)
    expect(r.json.code).toBe("SESSION_STALE")
    expect(h.sqlCalls()).toEqual([])
    expect(await shellRows()).toEqual([])
  })

  test("a product of another organisation, an unknown product, and an organisation with no product are 404 PRODUCT_NOT_FOUND and no project is made", async () => {
    for (const [sub, productId] of [[AUTH.mgr, "prod-b"], [AUTH.mgr, "no-such-product"]] as Array<[string, string]>) {
      const r = await create({ sub, body: { productId } })
      expect(`${productId}: ${r.res.status} ${r.json.code}`).toBe(`${productId}: 404 PRODUCT_NOT_FOUND`)
    }
    const none = await create({ sub: C_AUTH })
    expect(none.res.status).toBe(404)
    expect(none.json.code).toBe("PRODUCT_NOT_FOUND")
    // an inactive product is skipped for the default: only the active one is chosen
    await h.db.exec("update compliance.products set is_active = false where id = 'prod'")
    try {
      const r = await create()
      expect(r.res.status).toBe(201)
      expect(r.json.product_id).toBe("prod-2")
    } finally {
      await h.db.exec("update compliance.products set is_active = true where id = 'prod'")
    }
    expect((await shellRows()).length).toBe(1)
  })

  test("a bad days value or product id is 400 before any SQL; the SQL function refuses a bad days itself", async () => {
    h.reset()
    const days = await create({ body: { days: 3 } })
    expect(days.json.code).toBe("BAD_DAYS")
    const product = await create({ body: { productId: "a/b" } })
    expect(product.json.code).toBe("BAD_PRODUCT")
    expect(h.sqlCalls()).toEqual([])
    let failed = ""
    try {
      await h.db.query("select public.ai_work_link_new_project_for('u-mgr', null, 3)")
    } catch (e) {
      failed = String((e as { message?: string }).message)
    }
    expect(failed).toBe("BAD_DAYS")
    expect(await shellRows()).toEqual([])
  })
})

describe("one action: no project is left behind when the link cannot be made", () => {
  test("at the hourly cap the answer is 429 MINT_CAP_HOUR and the shell project rolled back with it", async () => {
    for (let i = 0; i < 10; i++) await h.db.query("select public.ai_work_link_create_for('u-mgr', 'proj-a', 0, null, 7, true, 'seed', 'u-mgr')")
    const before = (await one<{ n: number }>(h.db, "select count(*)::int n from compliance.projects")).n
    const r = await create()
    expect(r.res.status).toBe(429)
    expect(r.json.code).toBe("MINT_CAP_HOUR")
    expect((await one<{ n: number }>(h.db, "select count(*)::int n from compliance.projects")).n).toBe(before)
    expect(await shellRows()).toEqual([])
  })

  test("fail closed: an identity error, a function error, a throw and an answer without a well-formed link are 503 and no token is in the body", async () => {
    const bad: Record<string, (a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = {
      "uncoded error": async () => ({ data: null, error: { message: "relation compliance.projects does not exist", code: "42P01" } }),
      throw: async () => { throw new Error("connection reset") },
      "no link": async () => ({ data: { project: { id: "p", name: SHELL } }, error: null }),
      "a bad token": async () => ({ data: { project: { id: "p" }, link: { link_id: "l", token: "nope" } }, error: null }),
      null: async () => ({ data: null, error: null }),
    }
    for (const [name, f] of Object.entries(bad)) {
      const r = await h.call("POST", "/new-project", { token: await h.sign(), body: {}, over: { ai_work_link_new_project_for: f } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 MINT_UNAVAILABLE`)
      expect(r.text).not.toMatch(/pxa_/)
      expect(r.text).not.toContain("does not exist")
    }
    h.reset() // the brake (5 calls a minute) counted the five calls above
    const identity = await h.call("POST", "/new-project", { token: await h.sign(), body: {}, over: { projexa_read_resolve_user: async () => ({ data: null, error: { message: "boom" } }) } })
    expect(identity.json.code).toBe("MINT_UNAVAILABLE")
    expect(await shellRows()).toEqual([])
  })
})

describe("parity with the service behind POST /api/v1/projexa/projects", () => {
  const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

  test("createProject writes the org, the product (which must be the organisation's own), the name, and the person as lead; the SQL does the same", () => {
    const service = read("src/lib/services/construction-dashboard-service.ts")
    const at = service.indexOf("export async function createProject")
    const body = service.slice(at, service.indexOf("\n}\n", at))
    expect(body).toContain("eq(products.orgId, ctx.orgId)")
    expect(body).toMatch(/orgId: ctx\.orgId, productId: input\.productId, name: input\.name\.trim\(\)/)
    expect(body).toContain("leadUserId: ctx.isRealUser ? ctx.userId : null")
    const sql = read("drizzle/0631_build001_awl_mint_for.sql")
    expect(sql).toContain("pr.org_id = v_u.org_id")
    expect(sql).toContain("INSERT INTO compliance.projects (org_id, product_id, name, description, lead_user_id)")
    expect(sql).toMatch(/VALUES \(v_u\.org_id, v_product, 'New project \(AI setup\)',[\s\S]*p_user_id\)/)
  })

  test("the route needs the member role, and the SQL rank of member is 2, the same threshold", async () => {
    expect(read("src/app/api/v1/projexa/projects/route.ts")).toContain('requireRoleOrScope(ctx, "member", "write")')
    expect((await one<{ r: number }>(h.db, "select public.ai_work_link__role_rank('member') r")).r).toBe(2)
    expect((await one<{ r: number }>(h.db, "select public.ai_work_link__role_rank('viewer') r")).r).toBe(1)
  })
})
