/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (register row AW-401; spec sections 3.4, 10.1 to 10.4; BR-484, BR-489): POST /mint of the Edge function
// ai-work-link, run as the REAL handler (handler.ts, mint.ts, session.ts with the real jose package and real ES256 key pairs) over the REAL
// SQL (drizzle/0618, 0621 to 0628 and 0631 on PGlite). Only failure cases are faked, by wrapping the same rpc.
//
// WHAT IS PROVEN
//   401  no session, a link token as the session, a forged or foreign-signed token: one answer, no WWW-Authenticate, no database call
//   201  the manager's own link: the token is pxa_ + 64 hex, shown once in the body; the table holds only its sha256 (the plaintext column
//        is NULL); the link then works (context 200); a second mint revokes the first (one live link per person and project)
//   the token is never logged: no log line, no error body and no call-log row holds it
//   refused  a project of another organisation and a private project the person may not read (both 404, no row), a level above the rank,
//        a function above the rank, an inactive person, a person the gateway cannot map; an admin and the lead may mint a private project
//   FRESH SESSION  a token issued more than 15 minutes ago, one with no iat and one from the future are 401 SESSION_STALE and reach no SQL
//   the e-mail fallback: a person with no auth_user_id is found only when the gateway switch is on, and the link is then theirs
//   fail closed  an identity error, a mint error, a throw and an unknown shape are 503 and no token reaches the body
//   validation  bad JSON, a level or day count outside the allowed ones, an empty or unknown function list, a body over 8 KB
//   CORS  a PROJEXA origin is echoed, any other origin is answered with the production origin, and the list equals projexa-read's
//
// Run: bun test --isolate src/lib/services/ai-work-link-mint.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { PROJEXA_ISSUER, VERIDIAN_ISSUER } from "../../../supabase/functions/ai-work-link/jwt"
import { ALLOWED_ORIGINS } from "../../../supabase/functions/projexa-read/handler"
import { PROJEXA_ORIGINS } from "../../../supabase/functions/ai-work-link/mint"
import { AUTH, linkRows, makeHarness, one, openMintDb, type Harness, type J } from "./__test-helpers__/awl-mint-harness"
import { sha256Hex } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

let h: Harness
const TOKEN_RE = /^pxa_[0-9a-f]{64}$/

async function ranked(minRank: "low" | "high"): Promise<string> {
  const sql = minRank === "low"
    ? "select function_id from platform.ai_work_link_functions where product = 'projexa' and link_level is not null and min_role_rank <= 2 order by function_id limit 1"
    : "select function_id from platform.ai_work_link_functions where product = 'projexa' and link_level is not null and min_role_rank >= 3 order by function_id limit 1"
  return (await one<{ function_id: string }>(h.db, sql)).function_id
}

beforeAll(async () => {
  h = await makeHarness(await openMintDb())
}, 120_000)
afterAll(async () => {
  await h.db.close()
})
beforeEach(async () => {
  h.reset()
  await h.db.exec("truncate platform.ai_work_link_call; delete from platform.user_ai_links")
  await h.db.exec("update platform.projexa_gateway_settings set email_fallback = false")
  await h.setWrites(false)
})

const mint = async (o: { sub?: string; body?: unknown; iss?: string; key?: "projexa" | "veridian" | "stranger"; iatAgoSeconds?: number; noIat?: boolean; email?: string | null; headers?: Record<string, string> } = {}) =>
  h.call("POST", "/mint", {
    token: await h.sign({ sub: o.sub, iss: o.iss, key: o.key, iatAgoSeconds: o.iatAgoSeconds, noIat: o.noIat, email: o.email }),
    body: o.body ?? { projectId: "proj-a" },
    headers: o.headers,
  })

// ---------------------------------------------------------------------------------------------------------------------------------- 401
describe("401: no valid session, and nothing is read or written", () => {
  test("no Authorization header, or a link token in it: 401, no WWW-Authenticate, not one database call, no row", async () => {
    const none = await h.call("POST", "/mint", { body: { projectId: "proj-a" } })
    expect(none.res.status).toBe(401)
    expect(none.res.headers.get("www-authenticate")).toBeNull()
    expect(none.json).toMatchObject({ status: 401, code: "SESSION_REQUIRED" })
    const asLink = await h.call("POST", "/mint", { token: `pxa_${"a".repeat(64)}`, body: { projectId: "proj-a" } })
    expect(asLink.res.status).toBe(401)
    expect(asLink.json.code).toBe("SESSION_REQUIRED")
    expect(h.sqlCalls()).toEqual([])
    expect((await one<{ n: number }>(h.db, "select count(*)::int n from platform.user_ai_links")).n).toBe(0)
  })

  test("garbage, a token signed by another key and an unknown issuer are 401 SESSION_INVALID with one code and no database call", async () => {
    const cases: Record<string, string> = {
      "not a JWT": "garbage",
      "signed by another key": await h.sign({ key: "stranger" }),
      "an unknown issuer": await h.sign({ iss: "https://evil.example/auth/v1" }),
      "verdian-ai issuer signed with PROJEXA's key": await h.sign({ iss: VERIDIAN_ISSUER }),
    }
    for (const [name, token] of Object.entries(cases)) {
      const r = await h.call("POST", "/mint", { token, body: { projectId: "proj-a" } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 401 SESSION_INVALID`)
      expect(r.res.headers.get("www-authenticate")).toBeNull()
      expect(r.text).not.toContain(token)
    }
    expect(h.sqlCalls()).toEqual([])
  })

  test("a key set that cannot be read is 503, not a 401 that blames the person's session", async () => {
    const r = await h.call("POST", "/mint", { token: await h.sign(), body: { projectId: "proj-a" }, brokenKeyset: true })
    expect(r.res.status).toBe(503)
    expect(r.json.code).toBe("SESSION_CHECK_UNAVAILABLE")
    expect(h.sqlCalls()).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- 201
describe("201: the link is made, shown once, and stored only as a hash", () => {
  test("the manager mints for their project: the answer, the row and the link that works", async () => {
    const r = await mint({ body: { projectId: "proj-a", level: 0, days: 7, label: "Villa A with Claude" } })
    expect(r.res.status).toBe(201)
    const token: string = r.json.token
    expect(token).toMatch(TOKEN_RE)
    expect(r.json.links.link).toBe(`https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/${token}`)
    expect(r.json.links.header_base).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/header")
    expect(r.json.links.inbox).toBeNull() // the confirm host is not set: never print a name that cannot resolve
    expect(r.json).toMatchObject({ level: 0, hide_personal: true, label: "Villa A with Claude", project: { id: "proj-a", name: "Villa A" } })
    expect(Date.parse(r.json.expires_at) - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
    expect(Date.parse(r.json.expires_at) - Date.now()).toBeLessThan(7.1 * 86_400_000)
    expect(r.res.headers.get("cache-control")).toBe("no-store")

    // re-read from the database: one active row for this person and project, only the hash stored
    const rows = await linkRows(h.db, "u-mgr")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ project_id: "proj-a", status: "active", token: null, token_hash: sha256Hex(token), authority_level: 0 })
    expect(JSON.stringify(rows)).not.toContain(token)

    // and the link answers as that person, through the router
    const ctx = await h.call("GET", `/${token}/context`, { session: "none", headers: { accept: "application/json" } })
    expect(ctx.res.status).toBe(200)
    expect(ctx.json.project).toMatchObject({ id: "proj-a", name: "Villa A" })
    expect(ctx.json.acting_for).toMatchObject({ name: "Mira Manager" })
  })

  test("with a confirm host set, the answer carries the inbox link with the token in the fragment", async () => {
    const config = configFromEnv((n) => (n === "AWL_CONFIRM_HOST" ? "inbox.example.pages.dev" : undefined))
    const r = await h.call("POST", "/mint", { token: await h.sign(), body: { projectId: "proj-a" }, config })
    expect(r.res.status).toBe(201)
    expect(r.json.links.inbox).toBe(`https://inbox.example.pages.dev/ai-inbox.html#t=${r.json.token}`)
  })

  test("a level 1 ceiling is stored, but while writes are off the link acts at level 0 (spec 10.9)", async () => {
    const r = await mint({ body: { projectId: "proj-a", level: 1 } })
    expect(r.res.status).toBe(201)
    expect(r.json.level).toBe(1)
    const res = (await one<{ r: J }>(h.db, "select public.ai_work_link__resolve($1) r", [r.json.token])).r
    expect(res).toMatchObject({ authority_level: 1, effective_level: 0, writes_enabled: false })
  })

  test("a second mint for the same project revokes the first: one live link per person and project", async () => {
    const first = await mint()
    const second = await mint()
    expect(first.res.status).toBe(201)
    expect(second.res.status).toBe(201)
    expect(second.json.token).not.toBe(first.json.token)
    expect((await linkRows(h.db, "u-mgr")).map((x) => x.status)).toEqual(["revoked", "active"])
    const old = await h.call("GET", `/${first.json.token}/context`, { session: "none" })
    expect(old.res.status).toBe(410)
    const now = await h.call("GET", `/${second.json.token}/context`, { session: "none" })
    expect(now.res.status).toBe(200)
  })

  test("a person signed in on the verdian-ai Auth project mints the same way", async () => {
    const r = await mint({ iss: VERIDIAN_ISSUER, key: "veridian", sub: AUTH.adm })
    expect(r.res.status).toBe(201)
    expect((await linkRows(h.db, "u-adm"))[0]).toMatchObject({ project_id: "proj-a", status: "active" })
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- token never logged
describe("the token is never logged", () => {
  test("no log line, no other answer and no call-log row holds it, and a later call of the link logs only a cleaned path", async () => {
    const r = await mint({ body: { projectId: "proj-a", label: "log check" } })
    const token: string = r.json.token
    expect(r.text).toContain(token) // shown once, here
    await h.call("GET", `/${token}/context`, { session: "none" })
    const list = await h.call("GET", "/links", { token: await h.sign() })
    await h.call("GET", `/${token}/records/boq_lines?limit=1`, { session: "none" })
    expect(h.logs().length).toBeGreaterThan(0)
    expect(h.logs().join("\n")).not.toContain(token)
    expect(h.logs().join("\n")).not.toContain(sha256Hex(token))
    // the list of the person's links, and the answers of the app routes but the mint's own, carry no token (a link's own pages print its address)
    expect(list.text).not.toContain(token)
    expect(list.text).not.toContain(sha256Hex(token))
    // the call log holds a path and never the token or its hash
    const calls = (await h.db.query<J>("select path, method from platform.ai_work_link_call")).rows
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(calls)).not.toContain(token)
    expect(JSON.stringify(calls)).not.toContain(token.slice(4, 24))
    expect(calls.map((c) => c.path)).toContain("/context")
    // an error answer names no token either
    const bad = await mint({ body: { projectId: `pxa_${"b".repeat(64)}` } })
    expect(bad.text).not.toMatch(/pxa_[0-9a-f]{64}/)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- refusals
describe("refused, and nothing is written", () => {
  const rowCount = async () => (await one<{ n: number }>(h.db, "select count(*)::int n from platform.user_ai_links")).n

  test("a project of another organisation and a private project the person may not read: 404 for both, no row (BR-489)", async () => {
    const other = await mint({ sub: AUTH.mgr, body: { projectId: "proj-b" } })
    expect(other.res.status).toBe(404)
    expect(other.json).toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" })
    const priv = await mint({ sub: AUTH.mem, body: { projectId: "proj-priv" } })
    expect(priv.res.status).toBe(404)
    expect(priv.json.code).toBe("PROJECT_NOT_FOUND")
    const nothing = await mint({ sub: AUTH.mgr, body: { projectId: "no-such-project" } })
    expect(nothing.res.status).toBe(404)
    expect(await rowCount()).toBe(0)
    // the two answers do not tell a private project from a missing one
    expect({ ...priv.json }).toEqual({ ...nothing.json })
  })

  test("an admin and the project's own lead may mint a private project", async () => {
    expect((await mint({ sub: AUTH.adm, body: { projectId: "proj-priv" } })).res.status).toBe(201)
    expect((await mint({ sub: AUTH.sen, body: { projectId: "proj-priv" } })).res.status).toBe(201)
  })

  test("a level above the person's rank: 403 LEVEL_NOT_ALLOWED and no row", async () => {
    const r = await mint({ sub: AUTH.view, body: { projectId: "proj-a", level: 1 } })
    expect(r.res.status).toBe(403)
    expect(r.json).toMatchObject({ status: 403, code: "LEVEL_NOT_ALLOWED" })
    expect(await rowCount()).toBe(0)
    // the same person may have a level 0 link
    expect((await mint({ sub: AUTH.view, body: { projectId: "proj-a", level: 0 } })).res.status).toBe(201)
  })

  test("a function above the person's rank, and a function that does not exist: 403 FUNCTION_NOT_ALLOWED and no row", async () => {
    const high = await ranked("high")
    const low = await ranked("low")
    const member = await mint({ sub: AUTH.mem, body: { projectId: "proj-a", functions: [high] } })
    expect(member.res.status).toBe(403)
    expect(member.json.code).toBe("FUNCTION_NOT_ALLOWED")
    const ghost = await mint({ sub: AUTH.mgr, body: { projectId: "proj-a", functions: ["no_such_function"] } })
    expect(ghost.res.status).toBe(403)
    expect(await rowCount()).toBe(0)
    // the member may take the lower one; the manager may take the higher one
    const ok = await mint({ sub: AUTH.mem, body: { projectId: "proj-a", functions: [low] } })
    expect(ok.res.status).toBe(201)
    expect(ok.json.allowed_functions).toEqual([low])
    const mgr = await mint({ sub: AUTH.mgr, body: { projectId: "proj-a", functions: [high] } })
    expect(mgr.res.status).toBe(201)
    // with no list, a member gets only what the rank allows
    const all = await mint({ sub: AUTH.mem, body: { projectId: "proj-a" } })
    const allowed: string[] = all.json.allowed_functions
    expect(allowed).not.toContain(high)
    expect(allowed).toContain(low)
  })

  test("an inactive person, a sub no user has, and an unlinked sub are 403 USER_NOT_LINKED with the app's own sentence, and no row", async () => {
    for (const sub of [AUTH.off, AUTH.nobody, AUTH.email]) {
      const r = await mint({ sub })
      expect(`${sub} ${r.res.status} ${r.json.code}`).toBe(`${sub} 403 USER_NOT_LINKED`)
      expect(r.json.error).toBe("Your PROJEXA account is not linked to a VERIDIAN user - ask your admin")
    }
    expect(await rowCount()).toBe(0)
  })

  test("the e-mail fallback: a person with no auth_user_id is found only while the gateway switch is on, and the link is theirs", async () => {
    expect((await mint({ sub: AUTH.email, email: "eli@a.example.test" })).res.status).toBe(403)
    await h.db.exec("update platform.projexa_gateway_settings set email_fallback = true")
    const r = await mint({ sub: AUTH.email, email: "eli@a.example.test" })
    expect(r.res.status).toBe(201)
    expect((await linkRows(h.db, "u-email"))[0]).toMatchObject({ project_id: "proj-a", status: "active" })
    // and it shows in their own list (the reason the SQL takes a user id and not an Auth id)
    const list = await h.call("GET", "/links", { token: await h.sign({ sub: AUTH.email, email: "eli@a.example.test" }) })
    expect(list.res.status).toBe(200)
    expect(list.json.links).toHaveLength(1)
  })

  test("a caller cannot name an organisation, a user or a role in the body: those keys change nothing", async () => {
    const r = await mint({ sub: AUTH.mem, body: { projectId: "proj-a", userId: "u-adm", orgId: "org-b", role: "admin", p_user_id: "u-adm" } })
    expect(r.res.status).toBe(201)
    expect((await linkRows(h.db, "u-mem")).length).toBe(1)
    expect((await linkRows(h.db, "u-adm")).length).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- fresh session
describe("FRESH SESSION: a token older than 15 minutes cannot mint", () => {
  const rowCount = async () => (await one<{ n: number }>(h.db, "select count(*)::int n from platform.user_ai_links")).n

  test("issued 20 minutes ago, with no iat, or from the future: 401 SESSION_STALE, no SQL call, no row", async () => {
    for (const [name, o] of Object.entries({ "20 minutes old": { iatAgoSeconds: 20 * 60 }, "no iat": { noIat: true }, "from the future": { iatAgoSeconds: -600 } })) {
      h.reset()
      const r = await mint(o)
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 401 SESSION_STALE`)
      expect(r.res.headers.get("www-authenticate")).toBeNull()
      expect(`${name}: ${h.sqlCalls().join(",")}`).toBe(`${name}: `)
    }
    expect(await rowCount()).toBe(0)
  })

  test("issued 14 minutes ago mints; issued 16 minutes ago does not (the edge is 15)", async () => {
    expect((await mint({ iatAgoSeconds: 14 * 60 })).res.status).toBe(201)
    expect((await mint({ iatAgoSeconds: 16 * 60 })).json.code).toBe("SESSION_STALE")
  })

  test("the clock is the handler's: with a later clock a fresh token turns stale", async () => {
    const token = await h.sign({ iatAgoSeconds: 60 })
    const later = await h.call("POST", "/mint", { token, body: { projectId: "proj-a" }, now: () => Date.now() + 20 * 60_000 })
    expect(later.json.code).toBe("SESSION_STALE")
    const soon = await h.call("POST", "/mint", { token, body: { projectId: "proj-a" }, now: () => Date.now() + 5 * 60_000 })
    expect(soon.res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- fail closed
describe("fail closed: an error, a throw or an unknown shape is 503 and no token reaches the body", () => {
  const rowCount = async () => (await one<{ n: number }>(h.db, "select count(*)::int n from platform.user_ai_links")).n

  test("the identity lookup errors, throws, or answers an unknown shape", async () => {
    const cases: Record<string, (a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>> = {
      error: async () => ({ data: null, error: { message: "boom" } }),
      throw: async () => { throw new Error("connection reset") },
      "unknown shape": async () => ({ data: [{ surprise: true }], error: null }),
      empty: async () => ({ data: [], error: null }),
    }
    for (const [name, f] of Object.entries(cases)) {
      const r = await h.call("POST", "/mint", { token: await h.sign(), body: { projectId: "proj-a" }, over: { projexa_read_resolve_user: f } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 MINT_UNAVAILABLE`)
    }
    expect(await rowCount()).toBe(0)
  })

  test("the mint function errors, throws, or answers a shape without a well-formed token", async () => {
    const cases: Record<string, (a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = {
      "uncoded error": async () => ({ data: null, error: { message: "relation platform.user_ai_links does not exist", code: "42P01" } }),
      throw: async () => { throw new Error("connection reset") },
      "empty object": async () => ({ data: {}, error: null }),
      "a token of the wrong shape": async () => ({ data: { link_id: "x", token: "not-a-token" }, error: null }),
      null: async () => ({ data: null, error: null }),
    }
    for (const [name, f] of Object.entries(cases)) {
      const r = await h.call("POST", "/mint", { token: await h.sign(), body: { projectId: "proj-a" }, over: { ai_work_link_mint_for: f } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 MINT_UNAVAILABLE`)
      expect(r.text).not.toContain("does not exist") // a database error text is never echoed
      expect(r.text).not.toMatch(/pxa_/)
    }
    expect(h.logs().join("\n")).not.toContain("does not exist")
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- validation
describe("the body is checked before anything is read", () => {
  test("bad JSON, a body that is not an object, a level or day count outside the allowed ones, and a bad function list are 400 and reach no SQL", async () => {
    const token = await h.sign()
    const cases: Array<[string, { body?: unknown; rawBody?: string }, number, string]> = [
      ["not JSON", { rawBody: "{nope" }, 400, "BODY_NOT_JSON"],
      ["an array", { rawBody: "[1]" }, 400, "BODY_NOT_OBJECT"],
      ["no project", { body: {} }, 400, "PROJECT_REQUIRED"],
      ["a project id with a slash", { body: { projectId: "a/b" } }, 400, "PROJECT_REQUIRED"],
      ["level 2", { body: { projectId: "proj-a", level: 2 } }, 400, "BAD_LEVEL"],
      ["level text", { body: { projectId: "proj-a", level: "high" } }, 400, "BAD_LEVEL"],
      ["3 days", { body: { projectId: "proj-a", days: 3 } }, 400, "BAD_DAYS"],
      ["31 days", { body: { projectId: "proj-a", days: 31 } }, 400, "BAD_DAYS"],
      ["an empty function list", { body: { projectId: "proj-a", functions: [] } }, 400, "BAD_FUNCTIONS"],
      ["a function list that is not a list", { body: { projectId: "proj-a", functions: "all" } }, 400, "BAD_FUNCTIONS"],
      ["hidePersonal text", { body: { projectId: "proj-a", hidePersonal: "yes" } }, 400, "BAD_HIDE_PERSONAL"],
      ["a label over 80 characters", { body: { projectId: "proj-a", label: "x".repeat(81) } }, 400, "BAD_LABEL"],
      ["a label with a control character", { body: { projectId: "proj-a", label: "a\u0007b" } }, 400, "BAD_LABEL"],
      ["a body over 8 KB", { rawBody: JSON.stringify({ projectId: "proj-a", label: "x".repeat(9000) }) }, 413, "BODY_TOO_LARGE"],
    ]
    for (const [name, o, status, code] of cases) {
      h.reset()
      const r = await h.call("POST", "/mint", { token, ...o })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: ${status} ${code}`)
      expect(`${name}: ${h.sqlCalls().join(",")}`).toBe(`${name}: `)
    }
  })

  test("the allowed values pass: 1, 7 and 30 days, level 0 and 1, hidePersonal false, and the alias `project`", async () => {
    for (const days of [1, 7, 30]) {
      h.reset()
      const r = await mint({ body: { project: "proj-a", days, hidePersonal: false, level: days === 7 ? 1 : 0 } })
      expect(`${days}: ${r.res.status}`).toBe(`${days}: 201`)
      expect(r.json.hide_personal).toBe(false)
      const hours = (Date.parse(r.json.expires_at) - Date.now()) / 3_600_000
      expect(Math.abs(hours - days * 24)).toBeLessThan(1)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- CORS and methods
describe("CORS and methods", () => {
  test("a PROJEXA origin is echoed with Vary: Origin; another origin gets the production origin, which its browser will not match", async () => {
    expect([...PROJEXA_ORIGINS]).toEqual([...ALLOWED_ORIGINS])
    for (const origin of ALLOWED_ORIGINS) {
      const r = await mint({ headers: { origin } })
      expect(r.res.headers.get("access-control-allow-origin")).toBe(origin)
      expect(r.res.headers.get("vary")).toContain("Origin")
    }
    const foreign = await mint({ headers: { origin: "https://evil.example" } })
    expect(foreign.res.headers.get("access-control-allow-origin")).toBe("https://projexa-ai.com")
    const noOrigin = await mint()
    expect(noOrigin.res.headers.get("access-control-allow-origin")).toBe("https://projexa-ai.com")
  })

  test("the preflight allows Authorization; GET /mint is 405 with Allow: POST", async () => {
    const pre = await h.call("OPTIONS", "/mint", { headers: { origin: "https://projexa-ai.com", "access-control-request-headers": "authorization" } })
    expect(pre.res.status).toBe(204)
    expect(pre.res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization")
    const wrong = await h.call("GET", "/mint", { token: await h.sign() })
    expect(wrong.res.status).toBe(405)
    expect(wrong.res.headers.get("allow")).toBe("POST")
  })

  test("without a session verifier the route keeps the old answers: 401 with no session, 501 with one", async () => {
    expect((await h.call("POST", "/mint", { session: "none", body: {} })).res.status).toBe(401)
    expect((await h.call("POST", "/mint", { session: "none", token: await h.sign(), body: {} })).res.status).toBe(501)
  })
})

describe("the issuer constants are the two Auth projects", () => {
  test("PROJEXA and verdian-ai", () => {
    expect(PROJEXA_ISSUER).toContain("evpckeuxgvahguwsaeul")
    expect(VERIDIAN_ISSUER).toContain("pcrjmlpuqsbocqfwoxod")
  })
})
