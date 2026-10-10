/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (register row AW-402; spec section 10.3): GET /links and POST /links/{id}/revoke of the Edge function
// ai-work-link, the REAL handler over the REAL SQL (drizzle/0618, 0621 to 0628, 0631 on PGlite), with real ES256 session tokens.
//
// WHAT IS PROVEN
//   list    a person sees only their own project links, newest first, optionally for one project; an active, a revoked and an expired link
//           each say what they are; the answer holds no token, no hash and nothing token-shaped; another person's links never appear
//   revoke  the link's own person revokes it and the DATABASE says revoked; the link answers 410 on its next call; a second revoke says
//           `already`; an unknown link is 404; another person's link is 403 and stays active; an admin of the link's organisation may;
//           an admin of another organisation may not
//   fail closed  a database error, a throw or an unknown shape is 503 and nothing is reported as revoked
//   the brake  the 61st read call of one person in a minute is 429 with Retry-After
//
// Run: bun test --isolate src/lib/services/ai-work-link-links.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { READ_LIMIT_PER_MINUTE } from "../../../supabase/functions/ai-work-link/mint"
import { AUTH, linkRows, makeHarness, one, openMintDb, type Harness, type J } from "./__test-helpers__/awl-mint-harness"
import { sha256Hex } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

let h: Harness

beforeAll(async () => {
  h = await makeHarness(await openMintDb())
  // a second admin, of organisation B, and a manager of A who is not an admin
  await h.db.exec(`insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id)
                   values ('u-b-adm', 'Bea Admin', 'bea@b.example.test', 'x', 'admin', true, 'org-b', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`)
}, 120_000)
afterAll(async () => {
  await h.db.close()
})
beforeEach(async () => {
  h.reset()
  await h.db.exec("truncate platform.ai_work_link_call; delete from platform.user_ai_links")
})

const B_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

async function mintFor(sub: string, projectId: string, extra: J = {}): Promise<J> {
  const r = await h.call("POST", "/mint", { token: await h.sign({ sub }), body: { projectId, ...extra } })
  expect(r.res.status).toBe(201)
  return r.json
}
const list = async (sub: string, query = "", iatAgoSeconds = 60) => h.call("GET", `/links${query}`, { token: await h.sign({ sub, iatAgoSeconds }) })
const revoke = async (sub: string, id: string) => h.call("POST", `/links/${id}/revoke`, { token: await h.sign({ sub }) })

// ---------------------------------------------------------------------------------------------------------------------------------- list
describe("GET /links", () => {
  test("no session is 401 and reaches no SQL; the list needs a valid session but not a fresh one", async () => {
    const none = await h.call("GET", "/links")
    expect(none.res.status).toBe(401)
    expect(none.res.headers.get("www-authenticate")).toBeNull()
    expect(h.sqlCalls()).toEqual([])
    await mintFor(AUTH.mgr, "proj-a")
    // a session issued two hours ago is still listed: only a mint needs a fresh one
    const old = await list(AUTH.mgr, "", 2 * 3600)
    expect(old.res.status).toBe(200)
    expect(old.json.links).toHaveLength(1)
  })

  test("the person's own links, newest first, each with its state, and no token, no hash, nothing token-shaped", async () => {
    const first = await mintFor(AUTH.mgr, "proj-a", { label: "first" })
    const second = await mintFor(AUTH.mgr, "proj-a2", { label: "second", days: 30 })
    const third = await mintFor(AUTH.mgr, "proj-a", { label: "third", level: 1 }) // rotates the first
    const r = await list(AUTH.mgr)
    expect(r.res.status).toBe(200)
    const links: J[] = r.json.links
    expect(links.map((l) => l.label)).toEqual(["third", "second", "first"])
    expect(links[0]).toMatchObject({ id: third.link_id, project_id: "proj-a", project_name: "Villa A", level: 1, hide_personal: true, active: true, revoked_at: null, call_count: 0, write_count: 0 })
    expect(links[1]).toMatchObject({ id: second.link_id, project_id: "proj-a2", project_name: "Villa A2", active: true })
    expect(links[2]).toMatchObject({ id: first.link_id, active: false }) // replaced by the third
    expect(links[2].revoked_at).not.toBeNull()
    expect(Array.isArray(links[0].allowed_functions)).toBe(true)
    expect(Date.parse(links[1].expires_at) - Date.parse(links[1].created_at)).toBeGreaterThan(29.9 * 86_400_000)
    for (const l of links) expect(Object.keys(l).sort()).toEqual(["active", "allowed_functions", "call_count", "created_at", "expires_at", "hide_personal", "id", "label", "last_used_at", "level", "project_id", "project_name", "revoked_at", "write_count"])
    for (const secret of [first.token, second.token, third.token, sha256Hex(first.token), sha256Hex(second.token), sha256Hex(third.token)]) expect(r.text).not.toContain(secret)
    expect(r.text).not.toMatch(/pxa_/)
    expect(r.text).not.toMatch(/token/)
  })

  test("the project filter, and the last-used counters that the link's own calls move", async () => {
    const a = await mintFor(AUTH.mgr, "proj-a")
    await mintFor(AUTH.mgr, "proj-a2")
    const only = await list(AUTH.mgr, "?project=proj-a")
    expect(only.json.links.map((l: J) => l.project_id)).toEqual(["proj-a"])
    expect((await list(AUTH.mgr, "?projectId=proj-a2")).json.links.map((l: J) => l.project_id)).toEqual(["proj-a2"])
    expect((await list(AUTH.mgr, "?project=proj-priv")).json.links).toEqual([])
    await h.call("GET", `/${a.token}/context`, { session: "none" })
    await h.call("GET", `/${a.token}/context`, { session: "none" })
    const used = (await list(AUTH.mgr, "?project=proj-a")).json.links[0]
    expect(used.call_count).toBe(2)
    expect(used.last_used_at).not.toBeNull()
    expect((await list(AUTH.mgr, "?project=a%2Fb")).res.status).toBe(400)
  })

  test("an expired link says active false; another person's links never appear, an admin's list holds only their own", async () => {
    const mgr = await mintFor(AUTH.mgr, "proj-a")
    await mintFor(AUTH.mem, "proj-a")
    await h.db.exec(`update platform.user_ai_links set expires_at = now() - interval '1 hour' where id = '${mgr.link_id}'`)
    const mine = (await list(AUTH.mgr)).json.links
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ id: mgr.link_id, active: false, revoked_at: null })
    const theirs = (await list(AUTH.mem)).json.links
    expect(theirs).toHaveLength(1)
    expect(theirs[0].id).not.toBe(mgr.link_id)
    expect((await list(AUTH.adm)).json.links).toEqual([])
    expect((await list(AUTH.b)).json.links).toEqual([])
  })

  test("a person who is not linked is 403 USER_NOT_LINKED and the list is never guessed", async () => {
    await mintFor(AUTH.mgr, "proj-a")
    const r = await list(AUTH.nobody)
    expect(r.res.status).toBe(403)
    expect(r.json.code).toBe("USER_NOT_LINKED")
  })

  test("fail closed: a database error, a throw and an unknown shape are 503 with no links in the body", async () => {
    await mintFor(AUTH.mgr, "proj-a")
    const cases: Record<string, (a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = {
      error: async () => ({ data: null, error: { message: "boom", code: "XX000" } }),
      throw: async () => { throw new Error("connection reset") },
      "an object": async () => ({ data: { links: [] }, error: null }),
      null: async () => ({ data: null, error: null }),
    }
    for (const [name, f] of Object.entries(cases)) {
      const r = await h.call("GET", "/links", { token: await h.sign(), over: { ai_work_link_list_for: f } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 MINT_UNAVAILABLE`)
      expect(r.json.links).toBeUndefined()
    }
  })

  test("the 61st read call of one person in a minute is 429 with Retry-After; another person is unaffected", async () => {
    const t = 1_900_000_000_000
    const token = await h.sign()
    for (let i = 0; i < READ_LIMIT_PER_MINUTE; i++) {
      const r = await h.call("GET", "/links", { token, now: () => t + i })
      expect(r.res.status).toBe(200)
    }
    const over = await h.call("GET", "/links", { token, now: () => t + 100 })
    expect(over.res.status).toBe(429)
    expect(over.res.headers.get("retry-after")).toBe("60")
    expect(over.json.code).toBe("RATE_LIMITED")
    expect((await h.call("GET", "/links", { token: await h.sign({ sub: AUTH.mem }), now: () => t + 100 })).res.status).toBe(200)
    // a minute later the count is forgotten
    expect((await h.call("GET", "/links", { token, now: () => t + 61_000 })).res.status).toBe(200)
  })

  test("methods: POST /links is 405 with Allow: GET", async () => {
    const r = await h.call("POST", "/links", { token: await h.sign(), body: {} })
    expect(r.res.status).toBe(405)
    expect(r.res.headers.get("allow")).toBe("GET")
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- revoke
describe("POST /links/{id}/revoke", () => {
  test("the person revokes their own link: the database says revoked, the link answers 410 on its next call, a second revoke says already", async () => {
    const m = await mintFor(AUTH.mgr, "proj-a")
    expect((await h.call("GET", `/${m.token}/context`, { session: "none" })).res.status).toBe(200)
    const r = await revoke(AUTH.mgr, m.link_id)
    expect(r.res.status).toBe(200)
    expect(r.json).toEqual({ link_id: m.link_id, revoked: true, already: false })
    const row = await one<J>(h.db, "select status, revoked_at from platform.user_ai_links where id = $1", [m.link_id])
    expect(row.status).toBe("revoked")
    expect(row.revoked_at).not.toBeNull()
    expect((await h.call("GET", `/${m.token}/context`, { session: "none" })).res.status).toBe(410)
    const again = await revoke(AUTH.mgr, m.link_id)
    expect(again.res.status).toBe(200)
    expect(again.json).toEqual({ link_id: m.link_id, revoked: false, already: true })
    const after = (await list(AUTH.mgr)).json.links[0]
    expect(after).toMatchObject({ id: m.link_id, active: false })
  })

  test("an unknown link is 404 LINK_NOT_FOUND, and an id with odd characters is 404 without SQL", async () => {
    const r = await revoke(AUTH.mgr, "no-such-link")
    expect(r.res.status).toBe(404)
    expect(r.json.code).toBe("LINK_NOT_FOUND")
    h.reset()
    const odd = await h.call("POST", "/links/a%20b/revoke", { token: await h.sign() })
    expect(odd.res.status).toBe(404)
    expect(h.sqlCalls()).toEqual([])
  })

  test("another person's link is 403 NOT_YOUR_LINK and stays active; an admin of the same organisation may revoke it; an admin of another may not", async () => {
    const m = await mintFor(AUTH.mgr, "proj-a")
    const member = await revoke(AUTH.mem, m.link_id)
    expect(member.res.status).toBe(403)
    expect(member.json.code).toBe("NOT_YOUR_LINK")
    const otherOrgAdmin = await revoke(B_ADMIN, m.link_id)
    expect(otherOrgAdmin.res.status).toBe(403)
    const otherOrgManager = await revoke(AUTH.b, m.link_id)
    expect(otherOrgManager.res.status).toBe(403)
    expect((await linkRows(h.db, "u-mgr"))[0].status).toBe("active")
    expect((await h.call("GET", `/${m.token}/context`, { session: "none" })).res.status).toBe(200)
    const admin = await revoke(AUTH.adm, m.link_id)
    expect(admin.res.status).toBe(200)
    expect(admin.json.revoked).toBe(true)
    expect((await linkRows(h.db, "u-mgr"))[0].status).toBe("revoked")
  })

  test("an inactive person and an unlinked sub are 403 USER_NOT_LINKED and the link stays active", async () => {
    const m = await mintFor(AUTH.mgr, "proj-a")
    for (const sub of [AUTH.off, AUTH.nobody]) {
      const r = await revoke(sub, m.link_id)
      expect(`${sub} ${r.res.status} ${r.json.code}`).toBe(`${sub} 403 USER_NOT_LINKED`)
    }
    expect((await linkRows(h.db, "u-mgr"))[0].status).toBe("active")
  })

  test("fail closed: an error, a throw and an unknown shape are 503 and nothing is reported as revoked", async () => {
    const m = await mintFor(AUTH.mgr, "proj-a")
    const cases: Record<string, (a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = {
      error: async () => ({ data: null, error: { message: "boom", code: "XX000" } }),
      throw: async () => { throw new Error("connection reset") },
      "unknown shape": async () => ({ data: { ok: true }, error: null }),
    }
    for (const [name, f] of Object.entries(cases)) {
      const r = await h.call("POST", `/links/${m.link_id}/revoke`, { token: await h.sign(), over: { ai_work_link_revoke_for: f } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 MINT_UNAVAILABLE`)
      expect(r.json.revoked).toBeUndefined()
    }
    expect((await linkRows(h.db, "u-mgr"))[0].status).toBe("active")
  })

  test("methods: GET on the revoke path is 405 with Allow: POST", async () => {
    const r = await h.call("GET", "/links/x/revoke", { token: await h.sign() })
    expect(r.res.status).toBe(405)
    expect(r.res.headers.get("allow")).toBe("POST")
  })
})
