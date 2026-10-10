/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (register row AW-404; spec section 10.1, audit A-04, A-17): GET or POST /warning of the Edge function
// ai-work-link, the sentence a person reads BEFORE the link exists, through the REAL handler over the REAL SQL (drizzle/0618, 0621 to 0628,
// 0631 on PGlite).
//
// THE POINT: the sentence must be TRUE for the current state. drizzle/0624's ai_work_link_warning said "It can also record daily entries in
// your name" to any rank 2 person who asked for level 1, while platform.ai_work_link_settings.writes_enabled was false and every link acted
// at level 0. ai_work_link_warning_for reads that switch and changes the sentence.
//
// WHAT IS PROVEN
//   the counts     lines, tasks and people in the sentence are the counts the database has for that project
//   truthful       level 1 with writes OFF: the sentence says recording is not switched on yet and never promises entries; with writes ON:
//                  it promises entries, and only to a person of rank 2 and above who asked for level 1; level 0: never
//   the money clause  only from rank 3
//   the two closing clauses (an assistant may send the data elsewhere; use it in an assistant you alone use) are always present
//   the functions listed are those the person's rank may have, and are exactly what a mint with no list would give
//   refused        no session 401; a private project the person cannot read, another organisation's and an unknown project are 404
//   the old function ai_work_link_warning(uuid, ...) is called by nothing in the Edge code
//
// Run: bun test --isolate src/lib/services/ai-work-link-warning.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { readFileSync } from "node:fs"
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
  await h.db.exec("truncate platform.ai_work_link_call; delete from platform.user_ai_links")
  await h.setWrites(false)
})

const warn = async (sub: string, query: string, iatAgoSeconds = 60) => h.call("GET", `/warning${query}`, { token: await h.sign({ sub, iatAgoSeconds }) })

const RECORDS = "It can also record daily entries in your name."
const NOT_YET = "Recording entries directly is not switched on yet, so this link can read and prepare drafts only. It cannot change anything without your click."
const NO_CHANGE = "It cannot change anything without your click."
const CLOSING = [" When you paste it into an AI assistant, this information is sent to the company that runs that assistant", "an assistant that follows instructions in the data could send this information elsewhere.", "Use it only in an assistant that you alone use."]

describe("the counts are the database's", () => {
  test("lines, tasks and people in the sentence equal what the project holds", async () => {
    const r = await warn(AUTH.mgr, "?project=proj-a&level=0")
    expect(r.res.status).toBe(200)
    const lines = (await one<{ n: number }>(h.db, "select count(*)::int n from compliance.construction_boq_line_items li join compliance.construction_boqs b on b.id = li.boq_id where b.project_id = 'proj-a'")).n
    const tasks = (await one<{ n: number }>(h.db, "select count(*)::int n from compliance.pms_issues where project_id = 'proj-a'")).n
    expect([lines, tasks]).toEqual([2, 3])
    expect(r.json).toMatchObject({ lines, tasks, project: { id: "proj-a", name: "Villa A" }, rank: 3, level: 0 })
    // the people are the lead (Mira), the assignees and authors (Mo), and the person asking (Mira): two
    expect(r.json.people).toBe(2)
    expect(r.json.sentence).toContain(`This link lets an AI assistant read project Villa A as you see it: ${lines} BOQ lines, ${tasks} tasks and the names of ${r.json.people} people`)
    // and the counts move with the data
    await h.db.exec("insert into compliance.pms_issues (id, org_id, project_id, type_id, status_id, number, title, description, assignee_id, created_by_id, priority) values ('is-9', 'org-a', 'proj-a', 'ty', 'st-open', 9, 'New', 'd', 'u-view', 'u-view', 'low')")
    try {
      const more = await warn(AUTH.mgr, "?project=proj-a&level=0")
      expect(more.json).toMatchObject({ tasks: 4, people: 3 })
      expect(more.json.sentence).toContain("4 tasks and the names of 3 people")
    } finally {
      await h.db.exec("delete from compliance.pms_issues where id = 'is-9'")
    }
  })

  test("the closing clauses are in every sentence, and the answer carries only the documented fields", async () => {
    for (const [sub, level] of [[AUTH.mgr, 0], [AUTH.mgr, 1], [AUTH.mem, 1], [AUTH.view, 0]] as Array<[string, number]>) {
      const r = await warn(sub, `?project=proj-a&level=${level}`)
      for (const c of CLOSING) expect(r.json.sentence).toContain(c)
      expect(Object.keys(r.json).sort()).toEqual(["can_record", "functions", "level", "lines", "max_level", "money_visible", "people", "project", "rank", "sentence", "tasks", "writes_enabled"])
    }
  })
})

describe("TRUE for the current state: the switch writes_enabled decides what the sentence promises", () => {
  test("writes OFF: a level 1 request never gets the promise of entries, and the sentence says why", async () => {
    for (const sub of [AUTH.mgr, AUTH.mem, AUTH.adm, AUTH.sen]) {
      const r = await warn(sub, "?project=proj-a&level=1")
      expect(`${sub}: ${r.json.writes_enabled} ${r.json.can_record}`).toBe(`${sub}: false false`)
      expect(r.json.sentence).not.toContain("record daily entries")
      expect(r.json.sentence).toContain(NOT_YET)
    }
  })

  test("writes ON: a level 1 request from rank 2 and above is promised entries; the sentence flips with the switch", async () => {
    await h.setWrites(true)
    const r = await warn(AUTH.mgr, "?project=proj-a&level=1")
    expect(r.json).toMatchObject({ writes_enabled: true, can_record: true })
    expect(r.json.sentence).toContain(RECORDS)
    expect(r.json.sentence).not.toContain("not switched on yet")
    const member = await warn(AUTH.mem, "?project=proj-a&level=1")
    expect(member.json.can_record).toBe(true)
    expect(member.json.sentence).toContain(RECORDS)
    // and back off: the very next read says so
    await h.setWrites(false)
    const off = await warn(AUTH.mgr, "?project=proj-a&level=1")
    expect(off.json.can_record).toBe(false)
    expect(off.json.sentence).not.toContain("record daily entries")
  })

  test("level 0 is never promised entries, switch on or off; a viewer is never promised entries and has max_level 0", async () => {
    for (const on of [false, true]) {
      await h.setWrites(on)
      const zero = await warn(AUTH.mgr, "?project=proj-a&level=0")
      expect(`${on}: ${zero.json.can_record}`).toBe(`${on}: false`)
      expect(zero.json.sentence).toContain(NO_CHANGE)
      expect(zero.json.sentence).not.toContain("record daily entries")
      const viewer = await warn(AUTH.view, "?project=proj-a&level=1")
      expect(`${on}: ${viewer.json.can_record} ${viewer.json.max_level}`).toBe(`${on}: false 0`)
      expect(viewer.json.sentence).not.toContain("record daily entries")
      expect(viewer.json.sentence).not.toContain("not switched on yet") // they did not qualify for level 1 in the first place
      expect(viewer.json.sentence).toContain(NO_CHANGE)
    }
    expect((await warn(AUTH.mgr, "?project=proj-a")).json.level).toBe(0) // no level means 0
  })

  test("what the warning says is what a mint then does: a level 1 link made while writes are off acts at level 0", async () => {
    const w = await warn(AUTH.mgr, "?project=proj-a&level=1")
    expect(w.json.can_record).toBe(false)
    const m = await h.call("POST", "/mint", { token: await h.sign(), body: { projectId: "proj-a", level: 1 } })
    expect(m.res.status).toBe(201)
    const ctx = await h.call("GET", `/${m.json.token}/context`, { session: "none", headers: { accept: "application/json" } })
    expect(ctx.json.level).toBe(0)
  })
})

describe("the money clause and the function list follow the rank", () => {
  test("the money clause appears from rank 3 only", async () => {
    const money = ", and money figures such as rates, amounts and budgets"
    expect((await warn(AUTH.mgr, "?project=proj-a")).json.sentence).toContain(money)
    expect((await warn(AUTH.sen, "?project=proj-a")).json.money_visible).toBe(true)
    for (const sub of [AUTH.mem, AUTH.view]) {
      const r = await warn(sub, "?project=proj-a")
      expect(r.json.money_visible).toBe(false)
      expect(r.json.sentence).not.toContain("money figures")
    }
  })

  test("the listed functions are the rank's, and are exactly what a mint with no list gives", async () => {
    for (const sub of [AUTH.mem, AUTH.mgr, AUTH.view]) {
      const w = await warn(sub, "?project=proj-a")
      const ids: string[] = w.json.functions.map((f: J) => f.function_id)
      expect(ids.length).toBeGreaterThan(0)
      expect(w.json.functions.every((f: J) => f.min_role_rank <= w.json.rank)).toBe(true)
      expect([...ids]).toEqual([...ids].sort())
      const m = await h.call("POST", "/mint", { token: await h.sign({ sub }), body: { projectId: "proj-a" } })
      expect(m.res.status).toBe(201)
      expect(m.json.allowed_functions).toEqual(ids)
    }
    const member = (await warn(AUTH.mem, "?project=proj-a")).json.functions as J[]
    const manager = (await warn(AUTH.mgr, "?project=proj-a")).json.functions as J[]
    expect(manager.length).toBeGreaterThan(member.length) // the higher rank has more to choose from
    for (const f of member) expect(Object.keys(f).sort()).toEqual(["function_id", "kind", "level", "min_role_rank", "money_sensitive"])
  })
})

describe("refused", () => {
  test("no session is 401 and reaches no SQL; an old session (issued two hours ago) is still allowed to read the warning", async () => {
    const none = await h.call("GET", "/warning?project=proj-a")
    expect(none.res.status).toBe(401)
    expect(h.sqlCalls()).toEqual([])
    expect((await warn(AUTH.mgr, "?project=proj-a", 2 * 3600)).res.status).toBe(200)
  })

  test("a private project the person may not read, another organisation's project and an unknown one are the same 404", async () => {
    const priv = await warn(AUTH.mem, "?project=proj-priv")
    const other = await warn(AUTH.mgr, "?project=proj-b")
    const none = await warn(AUTH.mgr, "?project=no-such-project")
    for (const r of [priv, other, none]) {
      expect(r.res.status).toBe(404)
      expect(r.json).toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" })
      expect(r.text).not.toContain("Secret A")
    }
    // an admin and the lead see the private project's warning
    expect((await warn(AUTH.adm, "?project=proj-priv")).res.status).toBe(200)
    expect((await warn(AUTH.sen, "?project=proj-priv")).res.status).toBe(200)
  })

  test("a missing project, a bad level and a bad project id are 400 and reach no SQL", async () => {
    for (const [query, code] of [["", "PROJECT_REQUIRED"], ["?project=a%2Fb", "PROJECT_REQUIRED"], ["?project=proj-a&level=2", "BAD_LEVEL"], ["?project=proj-a&level=x", "BAD_LEVEL"]]) {
      h.reset()
      const r = await warn(AUTH.mgr, query)
      expect(`${query}: ${r.res.status} ${r.json.code}`).toBe(`${query}: 400 ${code}`)
      expect(h.sqlCalls()).toEqual([])
    }
  })

  test("POST with a JSON body answers the same as GET, and accepts projectId", async () => {
    const get = await warn(AUTH.mgr, "?project=proj-a&level=1")
    const post = await h.call("POST", "/warning", { token: await h.sign(), body: { projectId: "proj-a", level: 1 } })
    expect(post.res.status).toBe(200)
    expect(post.json).toEqual(get.json)
    expect((await h.call("POST", "/warning", { token: await h.sign(), rawBody: "{nope" })).json.code).toBe("BODY_NOT_JSON")
  })

  test("fail closed: an error, a throw and an answer without a sentence are 503", async () => {
    const cases: Record<string, (a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = {
      error: async () => ({ data: null, error: { message: "boom", code: "XX000" } }),
      throw: async () => { throw new Error("connection reset") },
      "no sentence": async () => ({ data: { lines: 1 }, error: null }),
    }
    for (const [name, f] of Object.entries(cases)) {
      const r = await h.call("GET", "/warning?project=proj-a", { token: await h.sign(), over: { ai_work_link_warning_for: f } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 MINT_UNAVAILABLE`)
      expect(r.json.sentence).toBeUndefined()
    }
  })
})

describe("the old function", () => {
  test("nothing in the Edge code calls ai_work_link_warning(uuid, ...), whose sentence promises entries whatever the switch says", () => {
    const dir = new URL("../../../supabase/functions/ai-work-link/", import.meta.url)
    for (const f of ["handler.ts", "mint.ts", "reads.ts", "confirm.ts", "index.ts"]) {
      const src = readFileSync(new URL(f, dir), "utf8")
      expect(`${f} ${/["'`]ai_work_link_warning["'`]/.test(src)}`).toBe(`${f} false`)
    }
    expect(readFileSync(new URL("mint.ts", dir), "utf8")).toContain('"ai_work_link_warning_for"')
  })

  test("the new sentence differs from the old one exactly where the old one was untrue", async () => {
    const old = (await one<{ r: J }>(h.db, "select public.ai_work_link_warning($1::uuid, 'proj-a', 1) r", [AUTH.mgr])).r
    expect(old.sentence).toContain(RECORDS) // the untruth, with writes off
    const fresh = (await one<{ r: J }>(h.db, "select public.ai_work_link_warning_for('u-mgr', 'proj-a', 1) r")).r
    expect(fresh.sentence).not.toContain(RECORDS)
    expect(old.sentence.replace(RECORDS, NOT_YET)).toBe(fresh.sentence)
  })
})
