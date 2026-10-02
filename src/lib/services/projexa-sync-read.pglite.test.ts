/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST SYNC, READ SIDE: drizzle/0677_projexa_sync_read.sql on PGlite (real Postgres as WASM) built the way the live database is (0621 to
// 0675-era AI work link, 0618 gateway), and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts) running over those SQL functions.
//   * isolation: a person of organisation A never gets a row of B; a foreign, an unreadable and a missing project, and an unsupported kind answer ONE 404
//   * membership: a person who may not read a private project gets nothing from it (manifest and pull); its lead and an admin do
//   * redaction: a row a laptop receives is EXACTLY the row the same person gets through the AI work link; money columns are null below rank 3
//   * cursor: keyset on (cursor field, id): pages never skip or duplicate a row, also with equal timestamps and with rows changing between pages;
//     a re-pull with the last cursor returns only what changed; created_at is the cursor field of a table without updated_at
//   * the handler: 401 without a session, 403 for a person who is not linked, CORS allow-list, body and cursor validation, the rate cap
// Run: bun test --isolate src/lib/services/projexa-sync-read.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, decodeCursor, encodeCursor, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { forwardSql, downSql, one } from "./__test-helpers__/awl-pglite"
import { call, createUserLinkDb, mintUser, refused, type J } from "./__test-helpers__/awl-user-link-db"
import { insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(120_000)

const SUBS: Record<string, string> = {
  "u-mgr": "11111111-1111-4111-8111-111111111111",
  "u-sen": "55555555-5555-4555-8555-555555555555",
  "u-mem": "22222222-2222-4222-8222-222222222222",
  "u-view": "66666666-6666-4666-8666-666666666666",
  "u-adm": "33333333-3333-4333-8333-333333333333",
  "u-b": "44444444-4444-4444-8444-444444444444",
}
const SUB_TO_USER = Object.fromEntries(Object.entries(SUBS).map(([u, s]) => [s, u]))
const NOBODY = "99999999-9999-4999-8999-999999999999"

let db: PGlite
let rpc: Rpc

/** A verifier that accepts the token "tok:<sub>" (the real one is jose against the published key sets; its own tests are ai-work-link-confirm.test.ts). */
const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

function hit(who: string | null, path: string, body?: unknown, origin?: string, limiter = new RateLimiter(100000)) {
  const headers: Record<string, string> = {}
  if (who) headers.authorization = `Bearer tok:${who}`
  if (origin) headers.origin = origin
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return handleSync(req, { rpc, session, limiter, now: () => new Date("2026-10-02T00:00:00Z") })
}
const sync = async (user: string, body: Record<string, unknown>) => {
  const res = await hit(SUBS[user] ?? user, "pull", { limit: 200, ...body })
  return { status: res.status, json: (await res.json()) as J }
}
const ids = (r: { json: J }) => (r.json.items as J[]).map((i) => i.id)

/** All pages of a kind, following next_cursor while has_more; returns every (id, updated_at) in the order received. */
async function drain(user: string, project: string, kind: string, limit: number, hook?: (page: number) => Promise<void>): Promise<Array<{ id: string; ts: string }>> {
  const out: Array<{ id: string; ts: string }> = []
  let after: string | null = null
  for (let page = 0; page < 50; page++) {
    const r = await sync(user, { project_id: project, kind, after, limit })
    expect(r.status).toBe(200)
    for (const it of r.json.items as J[]) out.push({ id: it.id, ts: it.updated_at })
    if (r.json.next_cursor) after = r.json.next_cursor
    if (!r.json.has_more) break
    if (hook) await hook(page)
  }
  return out
}

beforeAll(async () => {
  db = await createUserLinkDb()
  // the gateway's resolver (drizzle/0618), applied as live
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  rpc = pgRpc(db)
  await db.exec(
    [
      insert("pms_issues", [
        { id: "t1", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 1, title: "Pour slab", updated_at: "2026-09-01T10:00:00.000001Z" },
        { id: "t2", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 2, title: "Paint wall", updated_at: "2026-09-01T10:00:00.000002Z" },
        // t3 and t4 share one timestamp: the id breaks the tie
        { id: "t3", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 3, title: "Tie one", updated_at: "2026-09-01T11:00:00Z" },
        { id: "t4", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 4, title: "Tie two", updated_at: "2026-09-01T11:00:00Z" },
        { id: "t5", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 5, title: "Five", updated_at: "2026-09-01T12:00:00Z" },
        { id: "t6", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 6, title: "Six", updated_at: "2026-09-01T13:00:00Z" },
        { id: "t7", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 7, title: "Seven", updated_at: "2026-09-01T14:00:00Z" },
        { id: "tx", org_id: "org-a", project_id: "proj-a2", type_id: "ty", status_id: "st", number: 1, title: "Other project", updated_at: "2026-09-01T10:00:00Z" },
        { id: "tp", org_id: "org-a", project_id: "proj-priv", type_id: "ty", status_id: "st", number: 1, title: "Private task", updated_at: "2026-09-01T10:00:00Z" },
        { id: "tb", org_id: "org-b", project_id: "proj-b", type_id: "ty", status_id: "st", number: 1, title: "B task", updated_at: "2026-09-01T10:00:00Z" },
        // a row of ANOTHER organisation that names proj-a: must never reach organisation A's person (nor B's)
        { id: "tw", org_id: "org-b", project_id: "proj-a", type_id: "ty", status_id: "st", number: 9, title: "Wrong org row", updated_at: "2026-09-01T10:00:00Z" },
      ]),
      insert("construction_boqs", [{ id: "boq1", org_id: "org-a", project_id: "proj-a", title: "BOQ 1", created_by_id: "u-mgr" }]),
      insert("construction_boq_line_items", [
        { id: "li1", boq_id: "boq1", org_id: "org-a", description: "Slab", unit: "cum", quantity: 10, rate: 5000, amount: 50000, created_at: "2026-09-01T09:00:00Z" },
        { id: "li2", boq_id: "boq1", org_id: "org-a", description: "Wall", unit: "sqm", quantity: 20, rate: 700, amount: 14000, created_at: "2026-09-01T09:30:00Z" },
      ]),
      insert("construction_change_orders", [{ id: "co1", org_id: "org-a", project_id: "proj-a", number: 1, title: "Extra work", cost_impact: 123456, requested_by_id: "u-mgr", created_at: "2026-09-01T08:00:00Z" }]),
    ].join("\n"),
  )
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("isolation: one organisation never sees another's rows", () => {
  test("a person of A pulls A's project; the row of organisation B that names proj-a never appears", async () => {
    const r = await sync("u-mgr", { project_id: "proj-a", kind: "tasks" })
    expect(r.status).toBe(200)
    expect(ids(r).sort()).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7"])
    expect(JSON.stringify(r.json)).not.toContain("Wrong org row")
    expect(JSON.stringify(r.json)).not.toContain("B task")
  })

  test("a person of B gets A's project, kind and rows as the one 404, and B's own project works", async () => {
    const foreign = await sync("u-b", { project_id: "proj-a", kind: "tasks" })
    expect(foreign).toEqual({ status: 404, json: { error: "Not found" } })
    const own = await sync("u-b", { project_id: "proj-b", kind: "tasks" })
    expect(ids(own)).toEqual(["tb"])
    // and the other way round
    expect(await sync("u-mgr", { project_id: "proj-b", kind: "tasks" })).toEqual({ status: 404, json: { error: "Not found" } })
  })

  test("a foreign project, a private one the person may not read, a missing one and an unsupported kind are ONE answer (no existence oracle)", async () => {
    const asks = [
      sync("u-mem", { project_id: "proj-b", kind: "tasks" }),
      sync("u-mem", { project_id: "proj-b-priv", kind: "tasks" }),
      sync("u-mem", { project_id: "proj-priv", kind: "tasks" }),
      sync("u-mem", { project_id: "no-such-project", kind: "tasks" }),
      sync("u-mem", { project_id: "proj-a", kind: "no_such_kind" }),
      sync("u-mem", { project_id: "proj-a", kind: "people" }), // exists in the AI link, not a supported sync kind
    ]
    const answers = await Promise.all(asks)
    for (const a of answers) expect(a).toEqual({ status: 404, json: { error: "Not found" } })
  })

  test("the manifest lists only the person's own organisation", async () => {
    const m = await hit(SUBS["u-b"], "manifest")
    const j = (await m.json()) as J
    expect(m.status).toBe(200)
    expect(j.user).toMatchObject({ id: "u-b", role: "manager", org_id: "org-b" })
    expect((j.projects as J[]).map((p) => p.id).sort()).toEqual(["proj-b", "proj-b-priv"])
    expect(JSON.stringify(j)).not.toContain("Villa")
  })
})

describe("membership: a private project is for its lead and admins", () => {
  test("a member neither lists nor pulls it; its lead and an admin do", async () => {
    const mem = (await (await hit(SUBS["u-mem"], "manifest")).json()) as J
    expect((mem.projects as J[]).map((p) => p.id).sort()).toEqual(["proj-a", "proj-a2"])
    expect(await sync("u-mem", { project_id: "proj-priv", kind: "tasks" })).toEqual({ status: 404, json: { error: "Not found" } })
    for (const who of ["u-sen", "u-adm"]) {
      const m = (await (await hit(SUBS[who], "manifest")).json()) as J
      expect((m.projects as J[]).map((p) => p.id)).toContain("proj-priv")
      expect(ids(await sync(who, { project_id: "proj-priv", kind: "tasks" }))).toEqual(["tp"])
    }
  })

  test("a project that turns private between two pulls stops being served on the next call (live check, nothing cached)", async () => {
    expect((await sync("u-mem", { project_id: "proj-a2", kind: "tasks" })).status).toBe(200)
    await db.exec("update compliance.projects set access_level = 'private' where id = 'proj-a2'")
    try {
      expect(await sync("u-mem", { project_id: "proj-a2", kind: "tasks" })).toEqual({ status: 404, json: { error: "Not found" } })
    } finally {
      await db.exec("update compliance.projects set access_level = 'public' where id = 'proj-a2'")
    }
  })

  test("a person who is not linked, or was deactivated, gets 403 and no data; no session is 401", async () => {
    expect((await sync(NOBODY, { project_id: "proj-a", kind: "tasks" })).status).toBe(403)
    expect((await hit(NOBODY, "manifest")).status).toBe(403)
    await db.exec("update compliance.users set is_active = false where id = 'u-view'")
    try {
      expect((await sync("u-view", { project_id: "proj-a", kind: "tasks" })).status).toBe(403)
    } finally {
      await db.exec("update compliance.users set is_active = true where id = 'u-view'")
    }
    expect((await hit(null, "manifest")).status).toBe(401)
    expect((await hit("not-a-uuid", "manifest")).status).toBe(403) // a verified token whose sub names no person
    const noTok = await handleSync(new Request("https://x/functions/v1/projexa-sync/manifest", { headers: { authorization: "Bearer garbage" } }), { rpc, session })
    expect(noTok.status).toBe(401)
  })
})

describe("redaction is the AI work link's own", () => {
  const MONEY_KINDS = ["boq_lines", "change_orders", "project"] as const

  test("for every role the rows of a laptop equal the rows of the same person's AI work link, byte for byte, hidden fields included", async () => {
    for (const who of ["u-mgr", "u-sen", "u-mem", "u-adm"]) {
      const link = await mintUser(db, who)
      for (const kind of MONEY_KINDS) {
        const viaLink = await call(db, "ai_work_link_records", [link.token, kind, null, 50, "{}", "proj-a"])
        const viaSync = await call(db, "projexa_sync_pull", [SUBS[who], null, "proj-a", kind, null, null, 200])
        const byId = (xs: J[]) => Object.fromEntries(xs.map((x) => [x.id, x]))
        expect({ who, kind, rows: byId(viaSync.items.map((i: J) => i.data)) }).toEqual({ who, kind, rows: byId(viaLink.items) })
        expect({ who, kind, hidden: viaSync.hidden_fields }).toEqual({ who, kind, hidden: viaLink.hidden_fields })
      }
    }
  })

  test("money fields are null (and listed as hidden) for a role that may not see money, present for one that may; redacted says so", async () => {
    const member = await sync("u-mem", { project_id: "proj-a", kind: "boq_lines" })
    expect(member.json.redacted).toBe(true)
    expect(member.json.hidden_fields).toContain("rate")
    for (const it of member.json.items as J[]) expect({ id: it.id, rate: it.data.rate, amount: it.data.amount }).toEqual({ id: it.id, rate: null, amount: null })
    const co = await sync("u-mem", { project_id: "proj-a", kind: "change_orders" })
    expect((co.json.items as J[])[0].data.cost_impact).toBeNull()
    expect(JSON.stringify(co.json)).not.toContain("123456")

    const mgr = await sync("u-mgr", { project_id: "proj-a", kind: "boq_lines" })
    expect(mgr.json.hidden_fields).toEqual([])
    expect((mgr.json.items as J[]).find((i) => i.id === "li1")!.data).toMatchObject({ rate: 5000, amount: 50000 })
    expect(JSON.stringify((await sync("u-mgr", { project_id: "proj-a", kind: "change_orders" })).json)).toContain("123456")
    // a senior whose organisation withholds cost keeps the project-side cost fields hidden, as the link does
    const sen = await sync("u-sen", { project_id: "proj-a", kind: "project" })
    expect((sen.json.items as J[])[0].data.project_value).toBeNull()
  })

  test("the person-masking of the link applies (a user link hides other people's emails): not a field of any synced kind, but hide_personal is the link's", async () => {
    const r = await call(db, "projexa_sync_pull", [SUBS["u-mgr"], null, "proj-a", "tasks", null, null, 5])
    expect(r.status).toBe("ok")
  })
})

describe("cursor: keyset on (cursor field, id)", () => {
  test("pages of 3 return every task once, in (updated_at, id) order, with ties broken by id", async () => {
    const all = await drain("u-mgr", "proj-a", "tasks", 3)
    expect(all.map((x) => x.id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7"])
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length)
    // microsecond precision survives the round trip
    expect(all[0].ts).toBe("2026-09-01T10:00:00.000001Z")
    expect(all[1].ts).toBe("2026-09-01T10:00:00.000002Z")
    const one1 = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", limit: 1 })
    expect(one1.json).toMatchObject({ has_more: true })
    expect(decodeCursor(one1.json.next_cursor)).toEqual({ ts: "2026-09-01T10:00:00.000001Z", id: "t1" })
  })

  test("a page boundary inside two rows of one timestamp neither skips nor repeats either of them", async () => {
    const p1 = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", limit: 3 }) // t1 t2 t3
    expect(ids(p1)).toEqual(["t1", "t2", "t3"])
    const p2 = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", limit: 3, after: p1.json.next_cursor })
    expect(ids(p2)).toEqual(["t4", "t5", "t6"])
  })

  test("rows that change between pages: nothing unchanged is skipped, nothing unchanged is repeated; a changed row comes again with its new data", async () => {
    const seen: Array<{ id: string; ts: string }> = []
    let after: string | null = null
    const r1 = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", limit: 3 })
    for (const it of r1.json.items as J[]) seen.push({ id: it.id, ts: it.updated_at })
    after = r1.json.next_cursor
    // between the pages: t2 (already served) and t6 (not yet served) change, and a new row appears
    await db.exec(`update compliance.pms_issues set title = 'Paint wall v2', updated_at = '2026-09-02T09:00:00Z' where id = 't2';
                   update compliance.pms_issues set title = 'Six v2', updated_at = '2026-09-02T10:00:00Z' where id = 't6';`)
    await db.exec(insert("pms_issues", [{ id: "t8", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 8, title: "New", updated_at: "2026-09-02T11:00:00Z" }]))
    try {
      const titles: Record<string, string> = {}
      for (let i = 0; i < 10; i++) {
        const r = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", limit: 3, after })
        for (const it of r.json.items as J[]) {
          seen.push({ id: it.id, ts: it.updated_at })
          titles[it.id] = it.data.title
        }
        after = r.json.next_cursor ?? after
        if (!r.json.has_more) break
      }
      const order = seen.map((s) => s.id)
      // every task is seen at least once; the unchanged ones exactly once
      for (const id of ["t1", "t3", "t4", "t5", "t7", "t8"]) expect({ id, n: order.filter((x) => x === id).length }).toEqual({ id, n: 1 })
      // the changed ones come again in their new place, with the new title
      expect(order.filter((x) => x === "t2").length).toBe(2)
      expect(order.filter((x) => x === "t6").length).toBe(1)
      expect(titles.t2).toBe("Paint wall v2")
      expect(titles.t6).toBe("Six v2")
      // the stream is non-decreasing in (ts, id): the keyset order held across the change
      const keys = seen.slice(3).map((s) => s.ts + "|" + s.id)
      expect([...keys].sort()).toEqual(keys)
    } finally {
      await db.exec("delete from compliance.pms_issues where id = 't8'")
      await db.exec(`update compliance.pms_issues set title = 'Paint wall', updated_at = '2026-09-01T10:00:00.000002Z' where id = 't2';
                     update compliance.pms_issues set title = 'Six', updated_at = '2026-09-01T13:00:00Z' where id = 't6';`)
    }
  })

  test("a re-pull with the last cursor returns only what changed since; an empty answer gives no cursor to move to", async () => {
    const last = await drain("u-mgr", "proj-a", "tasks", 200)
    expect(last.length).toBe(7)
    const full = await sync("u-mgr", { project_id: "proj-a", kind: "tasks" })
    const cursor = full.json.next_cursor as string
    expect(full.json.has_more).toBe(false)
    const nothing = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", after: cursor })
    expect(nothing.json).toMatchObject({ items: [], has_more: false, next_cursor: null })
    await db.exec("update compliance.pms_issues set title = 'Seven edited', updated_at = '2026-09-03T00:00:00Z' where id = 't7'")
    try {
      const changed = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", after: cursor })
      expect(ids(changed)).toEqual(["t7"])
      expect((changed.json.items as J[])[0].data.title).toBe("Seven edited")
    } finally {
      await db.exec("update compliance.pms_issues set title = 'Seven', updated_at = '2026-09-01T14:00:00Z' where id = 't7'")
    }
  })

  test("a table with no updated_at pages on created_at, and the manifest says so", async () => {
    const m = (await (await hit(SUBS["u-mgr"], "manifest")).json()) as J
    const field = Object.fromEntries((m.kinds as J[]).map((k) => [k.kind, k.cursor_field]))
    expect(field).toMatchObject({ tasks: "updated_at", project: "updated_at", boqs: "updated_at", boq_lines: "created_at", change_orders: "created_at", rfis: "created_at", documents: "created_at" })
    expect((m.kinds as J[]).every((k) => k.deletes_supported === false && k.project_scoped === true)).toBe(true)
    const lines = await drain("u-mgr", "proj-a", "boq_lines", 1)
    expect(lines.map((l) => l.id)).toEqual(["li1", "li2"])
    expect(lines.map((l) => l.ts)).toEqual(["2026-09-01T09:00:00.000000Z", "2026-09-01T09:30:00.000000Z"])
  })

  test("the cursor is validated: junk, a cursor that is not ours, a wrong limit and a non-object body are 400", async () => {
    for (const after of ["!!!", "abc", encodeCursor("not-a-time", "t1"), btoa('["2026-09-01T10:00:00Z"]'), 5 as unknown as string]) {
      expect({ after, s: (await sync("u-mgr", { project_id: "proj-a", kind: "tasks", after })).status }).toEqual({ after, s: 400 })
    }
    for (const limit of [0, 501, 1.5, "10"]) expect((await sync("u-mgr", { project_id: "proj-a", kind: "tasks", limit })).status).toBe(400)
    expect((await sync("u-mgr", { kind: "tasks" })).status).toBe(400)
    const arr = await handleSync(new Request("https://x/projexa-sync/pull", { method: "POST", headers: { authorization: `Bearer tok:${SUBS["u-mgr"]}` }, body: "[]" }), { rpc, session })
    expect(arr.status).toBe(400)
    // the SQL refuses a bad cursor and a bad limit itself, whoever calls it
    expect((await refused(db, "select public.projexa_sync_pull($1, null, 'proj-a', 'tasks', 'x', 'y', 10)", [SUBS["u-mgr"]]))?.message).toBe("BAD_CURSOR")
    expect((await refused(db, "select public.projexa_sync_pull($1, null, 'proj-a', 'tasks', null, null, 501)", [SUBS["u-mgr"]]))?.message).toBe("BAD_LIMIT")
  })
})

describe("the handler: contract and edges", () => {
  test("manifest shape and server_time; every supported kind is listed", async () => {
    const m = await hit(SUBS["u-mgr"], "manifest", undefined, "http://localhost:3100")
    const j = (await m.json()) as J
    // view_class is 0678's; this file applies 0677 only, so the handler reports it as null (the 0678 test file asserts the real value)
    expect(Object.keys(j).sort()).toEqual(["kinds", "projects", "release", "server_time", "user", "view_class"])
    expect(j.view_class).toBeNull()
    // no release registry in this harness (0680 is not applied): nothing is current and nobody is held back
    expect(j.release).toEqual({ current: null, min_compatible: null, protocol: 2 })
    expect(j.user).toMatchObject({ id: "u-mgr", name: "Mira Manager", role: "manager", org_id: "org-a" })
    expect(j.server_time).toBe("2026-10-02T00:00:00.000Z")
    expect((j.kinds as J[]).map((k) => k.kind)).toEqual(["project", "tasks", "boqs", "boq_lines", "activities", "progress", "rfis", "submittals", "punch_list", "change_orders", "milestones", "materials", "documents"])
    expect((j.projects as J[])[0]).toEqual({ id: expect.any(String), name: expect.any(String), status: expect.any(String) })
  })

  test("pull shape: items {id, updated_at, data}, next_cursor, has_more, hidden_fields, redacted, server_time", async () => {
    const r = await sync("u-mgr", { project_id: "proj-a", kind: "tasks", limit: 2 })
    // kid is the signing key's id: null here because this harness injects no signing key, and then the items are unsigned
    expect(Object.keys(r.json).sort()).toEqual(["has_more", "hidden_fields", "items", "kid", "next_cursor", "redacted", "server_time"])
    expect(r.json.kid).toBeNull()
    // version is the record version: 0 here because this harness applies 0677 only (no change tracking)
    expect(Object.keys((r.json.items as J[])[0]).sort()).toEqual(["data", "id", "updated_at", "version"])
    expect((r.json.items as J[])[0].version).toBe(0)
    expect(r.json.server_time).toBe("2026-10-02T00:00:00.000Z")
  })

  test("CORS: the PROJEXA origins and localhost 3100 and 3101 are echoed, any other origin gets no allow header; the preflight is 204", async () => {
    for (const o of ["https://projexa-ai.com", "http://localhost:3100", "http://localhost:3101"]) {
      expect((await hit(SUBS["u-mgr"], "manifest", undefined, o)).headers.get("access-control-allow-origin")).toBe(o)
    }
    expect((await hit(SUBS["u-mgr"], "manifest", undefined, "https://evil.example")).headers.get("access-control-allow-origin")).toBeNull()
    const pre = await handleSync(new Request("https://x/functions/v1/projexa-sync/pull", { method: "OPTIONS", headers: { origin: "http://localhost:3100" } }), { rpc, session })
    expect(pre.status).toBe(204)
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization")
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull()
  })

  test("the rate cap answers 429 with Retry-After for one person and does not touch another", async () => {
    const limiter = new RateLimiter(3)
    for (let i = 0; i < 3; i++) expect((await hit(SUBS["u-mgr"], "manifest", undefined, undefined, limiter)).status).toBe(200)
    const over = await hit(SUBS["u-mgr"], "manifest", undefined, undefined, limiter)
    expect(over.status).toBe(429)
    expect(over.headers.get("retry-after")).toBe("60")
    expect((await hit(SUBS["u-adm"], "manifest", undefined, undefined, limiter)).status).toBe(200)
  })

  test("wrong method and unknown path: 405 and 404; a token never appears in an answer", async () => {
    expect((await handleSync(new Request("https://x/functions/v1/projexa-sync/pull", { headers: { authorization: "Bearer tok:x" } }), { rpc, session })).status).toBe(405)
    expect((await handleSync(new Request("https://x/functions/v1/projexa-sync/nope", { headers: { authorization: "Bearer tok:x" } }), { rpc, session })).status).toBe(404)
  })
})

describe("grants and shape of the SQL", () => {
  test("the two public functions are SECURITY DEFINER with a pinned search_path, runnable by service_role alone; the helpers by nobody", async () => {
    const r = await db.query<{ n: string; definer: boolean; cfg: string[] | null; anon: boolean; auth: boolean; app: boolean; svc: boolean; pub: boolean }>(
      `select p.proname n, p.prosecdef definer, p.proconfig cfg,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('app_runtime', p.oid, 'EXECUTE') app, has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), true) pub
         from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'projexa\\_sync%' order by 1`,
    )
    expect(r.rows.map((x) => x.n)).toEqual(["projexa_sync__ctx", "projexa_sync__cursor_field", "projexa_sync__src", "projexa_sync_manifest", "projexa_sync_pull"])
    for (const x of r.rows) {
      const isPublic = x.n === "projexa_sync_manifest" || x.n === "projexa_sync_pull"
      expect({ n: x.n, anon: x.anon, auth: x.auth, app: x.app, pub: x.pub, svc: x.svc }).toEqual({ n: x.n, anon: false, auth: false, app: false, pub: false, svc: isPublic })
      if (isPublic) {
        expect(x.definer).toBe(true)
        expect(x.cfg).toContain("search_path=pg_catalog, pg_temp")
      }
    }
  })

  test("applying it again changes nothing, and the down file removes exactly these functions", async () => {
    await db.exec(forwardSql("0677_projexa_sync_read"))
    expect((await sync("u-mgr", { project_id: "proj-a", kind: "tasks" })).status).toBe(200)
    const d = await createUserLinkDb()
    try {
      await d.exec(forwardSql("0618_build001_projexa_gateway"))
      await d.exec(forwardSql("0677_projexa_sync_read"))
      await d.exec(downSql("0677_projexa_sync_read"))
      expect((await one<{ n: number }>(d, "select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'projexa\\_sync%'")).n).toBe(0)
      expect((await one<{ n: number }>(d, "select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'ai_work_link__records_core'")).n).toBe(1)
    } finally {
      await d.close()
    }
  })

  test("the journal registers 0677 after 0675 with a down file", async () => {
    const journal = JSON.parse(await Bun.file(new URL("../../../drizzle/meta/_journal.json", import.meta.url)).text()) as { entries: Array<{ tag: string; when: number }> }
    const e = journal.entries.find((x) => x.tag === "0677_projexa_sync_read")!
    expect(e).toBeTruthy()
    expect(e.when).toBeGreaterThan(journal.entries.find((x) => x.tag === "0675_awl_first_user_self_heal")!.when)
    expect(downSql("0677_projexa_sync_read").length).toBeGreaterThan(100)
  })
})
