/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (register row AW-403; spec sections 10.1, 10.3, 10.5): the per-person limits on making links, through the REAL
// handler over the REAL SQL (drizzle/0618, 0621 to 0628, 0631 on PGlite).
//
// THE TWO LIMITS
//   the cap    kept in SQL, in platform.user_ai_links (the table the links are written to): 10 links in any rolling hour and 30 in any rolling
//              day per person, 5 shell projects a day; AW429 with MINT_CAP_HOUR, MINT_CAP_DAY and SHELL_CAP_DAY. Revoked links count.
//              The route answers 429 with a code and Retry-After. A refused mint writes nothing and revokes nothing.
//   the brake  kept in the Edge isolate's memory: 5 mint or new-project calls a minute per verified person, then 429 RATE_LIMITED with
//              Retry-After 60, before any SQL. It is a brake, not a cap: the cap below holds whatever isolate a call lands on.
//
// Run: bun test --isolate src/lib/services/ai-work-link-mint-limits.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { MINT_LIMIT_PER_MINUTE } from "../../../supabase/functions/ai-work-link/mint"
import { AUTH, makeHarness, one, openMintDb, type Harness, type J } from "./__test-helpers__/awl-mint-harness"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

let h: Harness

beforeAll(async () => {
  h = await makeHarness(await openMintDb())
}, 120_000)
afterAll(async () => {
  await h.db.close()
})
beforeEach(async () => {
  h.reset()
  await h.db.exec("truncate platform.ai_work_link_call; delete from platform.user_ai_links; delete from compliance.projects where name = 'New project (AI setup)'")
})

const total = async (userId: string) => (await one<{ n: number }>(h.db, "select count(*)::int n from platform.user_ai_links where user_id = $1", [userId])).n
const activeCount = async (userId: string) => (await one<{ n: number }>(h.db, "select count(*)::int n from platform.user_ai_links where user_id = $1 and status = 'active'", [userId])).n

/** n links made by the SQL function itself (so the brake of the route is not involved), each `agoMinutes` old. */
async function seed(userId: string, n: number, agoMinutes: number, projectId = "proj-a"): Promise<void> {
  for (let i = 0; i < n; i++) await h.db.query("select public.ai_work_link_create_for($1, $2, 0, null, 7, true, $3, $1)", [userId, projectId, `seed ${i}`])
  await h.db.query("update platform.user_ai_links set created_at = now() - make_interval(mins => $2) where user_id = $1", [userId, agoMinutes])
}

const mint = async (sub = AUTH.mgr, body: J = { projectId: "proj-a" }, now?: () => number) => h.call("POST", "/mint", { token: await h.sign({ sub }), body, now })

// ---------------------------------------------------------------------------------------------------------------------------------- the cap
describe("the cap: 10 an hour and 30 a day per person, in SQL", () => {
  test("nine links in the last hour leave room for the tenth; the eleventh is 429 MINT_CAP_HOUR with Retry-After", async () => {
    await seed("u-mgr", 9, 5)
    const tenth = await mint()
    expect(tenth.res.status).toBe(201)
    expect(await total("u-mgr")).toBe(10)
    const eleventh = await mint()
    expect(eleventh.res.status).toBe(429)
    expect(eleventh.json).toMatchObject({ status: 429, code: "MINT_CAP_HOUR" })
    expect(eleventh.res.headers.get("retry-after")).toBe("3600")
    expect(eleventh.text).not.toMatch(/pxa_/)
  })

  test("a refused mint writes nothing and revokes nothing: the live link keeps working", async () => {
    await seed("u-mgr", 9, 5)
    const tenth = await mint()
    expect(tenth.res.status).toBe(201)
    const before = await total("u-mgr")
    const refused = await mint()
    expect(refused.res.status).toBe(429)
    expect(await total("u-mgr")).toBe(before)
    expect(await activeCount("u-mgr")).toBe(1)
    const ctx = await h.call("GET", `/${tenth.json.token}/context`, { session: "none" })
    expect(ctx.res.status).toBe(200)
  })

  test("the cap is per person: the manager at the cap does not stop the member", async () => {
    await seed("u-mgr", 10, 5)
    expect((await mint(AUTH.mgr)).json.code).toBe("MINT_CAP_HOUR")
    expect((await mint(AUTH.mem)).res.status).toBe(201)
  })

  test("revoked and replaced links count: rotating does not reset the count", async () => {
    await seed("u-mgr", 10, 5) // ten links, nine of them revoked by rotation, one active
    expect(await activeCount("u-mgr")).toBe(1)
    expect((await mint()).json.code).toBe("MINT_CAP_HOUR")
  })

  test("links older than an hour leave the hour count; links older than a day leave the day count", async () => {
    await seed("u-mgr", 10, 61)
    const hourFree = await mint()
    expect(hourFree.res.status).toBe(201) // 10 links, all 61 minutes old: the hour is clear, the day has room
    await h.db.exec("delete from platform.user_ai_links where user_id = 'u-mgr'")
    await seed("u-mgr", 30, 25 * 60)
    expect((await mint()).res.status).toBe(201) // 30 links, all 25 hours old: the day is clear
  })

  test("thirty links in the last day: the next is 429 MINT_CAP_DAY even when none is from the last hour", async () => {
    await seed("u-mgr", 30, 3 * 60)
    const r = await mint()
    expect(r.res.status).toBe(429)
    expect(r.json.code).toBe("MINT_CAP_DAY")
    expect(r.res.headers.get("retry-after")).toBe("3600")
    expect(await total("u-mgr")).toBe(30)
  })

  test("the cap holds in a new isolate: a fresh brake (as in another isolate) does not reset it", async () => {
    await seed("u-mgr", 10, 5)
    h.reset() // the brake lives in one isolate's memory: this is another isolate
    expect((await mint()).json.code).toBe("MINT_CAP_HOUR")
  })

  test("a project the person cannot read is refused (404) before the count: at the cap it is still 404, not 429", async () => {
    await seed("u-mem", 10, 5)
    const priv = await mint(AUTH.mem, { projectId: "proj-priv" })
    expect(priv.res.status).toBe(404)
    expect(priv.json.code).toBe("PROJECT_NOT_FOUND")
    const other = await mint(AUTH.mem, { projectId: "proj-b" })
    expect(other.res.status).toBe(404)
    expect((await mint(AUTH.mem)).json.code).toBe("MINT_CAP_HOUR")
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- the brake
describe("the brake: 5 mint or new-project calls a minute per person, in the isolate's memory", () => {
  test("the sixth call in a minute is 429 RATE_LIMITED with Retry-After 60 and reaches no SQL; another person and the next minute are fine", async () => {
    const t = Date.now()
    for (let i = 0; i < MINT_LIMIT_PER_MINUTE; i++) {
      const r = await mint(AUTH.mgr, { projectId: "proj-a" }, () => t + i * 1000)
      expect(`${i}: ${r.res.status}`).toBe(`${i}: 201`)
    }
    const calls = h.sqlCalls().length
    const sixth = await mint(AUTH.mgr, { projectId: "proj-a" }, () => t + 6000)
    expect(sixth.res.status).toBe(429)
    expect(sixth.json).toMatchObject({ status: 429, code: "RATE_LIMITED" })
    expect(sixth.res.headers.get("retry-after")).toBe("60")
    expect(h.sqlCalls().length).toBe(calls) // no database call for the refused one
    expect((await mint(AUTH.mem, { projectId: "proj-a" }, () => t + 6000)).res.status).toBe(201)
    expect((await mint(AUTH.mgr, { projectId: "proj-a" }, () => t + 61_000)).res.status).toBe(201)
  })

  test("the brake counts /new-project too, and reads have their own bucket", async () => {
    const t = Date.now()
    for (let i = 0; i < 3; i++) expect((await mint(AUTH.mgr, { projectId: "proj-a" }, () => t + i)).res.status).toBe(201)
    for (let i = 0; i < 2; i++) {
      const r = await h.call("POST", "/new-project", { token: await h.sign(), body: {}, now: () => t + 10 + i })
      expect(r.res.status).toBe(201)
    }
    const sixth = await mint(AUTH.mgr, { projectId: "proj-a" }, () => t + 100)
    expect(sixth.json.code).toBe("RATE_LIMITED")
    const shell = await h.call("POST", "/new-project", { token: await h.sign(), body: {}, now: () => t + 101 })
    expect(shell.json.code).toBe("RATE_LIMITED")
    // listing is a read: its bucket is separate
    expect((await h.call("GET", "/links", { token: await h.sign(), now: () => t + 102 })).res.status).toBe(200)
  })

  test("a refused stale session is not counted against the brake", async () => {
    const t = Date.now()
    for (let i = 0; i < 10; i++) {
      const r = await h.call("POST", "/mint", { token: await h.sign({ iatAgoSeconds: 3600 }), body: { projectId: "proj-a" }, now: () => t + i })
      expect(r.json.code).toBe("SESSION_STALE")
    }
    expect((await mint(AUTH.mgr, { projectId: "proj-a" }, () => t + 50)).res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- shell cap
describe("the shell-project cap: 5 a day", () => {
  test("five shells and their links, then 429 SHELL_CAP_DAY; the refused one creates no project", async () => {
    const t = Date.now()
    for (let i = 0; i < 5; i++) {
      const r = await h.call("POST", "/new-project", { token: await h.sign(), body: {}, now: () => t + i * 20_000 })
      expect(`${i}: ${r.res.status}`).toBe(`${i}: 201`)
    }
    const shells = async () => (await one<{ n: number }>(h.db, "select count(*)::int n from compliance.projects where name = 'New project (AI setup)' and lead_user_id = 'u-mgr'")).n
    expect(await shells()).toBe(5)
    const sixth = await h.call("POST", "/new-project", { token: await h.sign(), body: {}, now: () => t + 200_000 })
    expect(sixth.res.status).toBe(429)
    expect(sixth.json.code).toBe("SHELL_CAP_DAY")
    expect(await shells()).toBe(5)
    // an older day's shells do not count
    await h.db.exec("update platform.user_ai_links set created_at = now() - interval '25 hours' where label = 'AI setup'")
    const later = await h.call("POST", "/new-project", { token: await h.sign(), body: {}, now: () => t + 300_000 })
    expect(later.res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- SQL directly
describe("the SQL function itself", () => {
  const fail = async (sql: string, params: unknown[] = []) => {
    try {
      await h.db.query(sql, params)
      return { message: "", code: "" }
    } catch (e) {
      const err = e as { message?: string; code?: string }
      return { message: String(err.message), code: String(err.code) }
    }
  }

  test("ai_work_link_mint_for raises AW429 with the cap's own word, and the eligibility words first", async () => {
    await seed("u-mgr", 10, 5)
    expect(await fail("select public.ai_work_link_mint_for('u-mgr', 'proj-a')")).toEqual({ message: "MINT_CAP_HOUR", code: "AW429" })
    expect(await fail("select public.ai_work_link_mint_for('u-mgr', 'proj-b')")).toEqual({ message: "PROJECT_NOT_FOUND", code: "AW404" })
    expect(await fail("select public.ai_work_link_mint_for('u-off', 'proj-a')")).toEqual({ message: "USER_NOT_ACTIVE", code: "AW403" })
    expect(await fail("select public.ai_work_link_mint_for('u-mem', 'proj-priv')")).toEqual({ message: "PROJECT_NOT_READABLE", code: "AW403" })
  })

  test("the mint records who made the link: created_by is the person, and the hash is the only stored form of the token", async () => {
    const r = (await one<{ r: J }>(h.db, "select public.ai_work_link_mint_for('u-mgr', 'proj-a', 0, null, 30, true, 'sql') r")).r
    expect(r.token).toMatch(/^pxa_[0-9a-f]{64}$/)
    const row = await one<J>(h.db, "select created_by_user_id, token, token_hash, label from platform.user_ai_links where id = $1", [r.link_id])
    expect(row).toMatchObject({ created_by_user_id: "u-mgr", token: null, label: "sql" })
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
