/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST SYNC: drizzle/0679_projexa_record_versions.sql on PGlite (real Postgres as WASM, built the way the live database is: 0618 gateway,
// the AI work link, 0677 read side, 0678 keys) and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts) running over those SQL functions.
//   * versions:     a record's version is 1 on first write, +1 on every REAL change; a write that changes nothing, or only updated_at, is not a new version
//   * history:      every log row carries the transaction that wrote it; a delete is a tombstone (op D) and the same id coming back continues the version
//   * changes:      a laptop asks "what changed in my project since cursor N"; one entry per record per page (its latest change), a page ends at a transaction
//                   boundary and a transaction larger than a page comes whole; another organisation's rows never appear; a project it may not read is the one 404
//   * commit order: a transaction that commits AFTER a later one is still delivered: the feed never passes a transaction that is not finished (sql:SQL-04,
//                   sync:SYNC-01). PGlite is one backend and cannot hold two open transactions, so the "open" transaction is reproduced deterministically by pinning
//                   the reader's horizon (public.projexa_sync__horizon) at its transaction id, then writing its rows with that id and LOWER seq values.
//   * reset:        a cursor from the future (a restored database) answers reset_required; the epoch changes when the tables are re-created (sync:SYNC-09)
//   * ids mode:     exact rows by id, scoped on organisation AND project, with the version, signed
//   * safety:       the trigger NEVER blocks a business write, even when its own tables refuse the insert
//   * reversible:   the down file removes everything and restores the 0677 pull; the forward file can be applied twice
// Expected versions are read from the head at test time, not hard-coded, so a single test can run alone with -t (tests:F14).
// Run: bun test --isolate src/lib/services/projexa-sync-versions.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { canonicalize, createSigning, generateKeyRecord, importPublic, itemMessage, sha256Hex, verifyMessage, type KeyRecord, type Signing } from "../../../supabase/functions/projexa-sync/sign"
import { forwardSql, downSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(180_000)

const SUBS: Record<string, string> = {
  "u-mgr": "11111111-1111-4111-8111-111111111111",
  "u-sen": "55555555-5555-4555-8555-555555555555",
  "u-mem": "22222222-2222-4222-8222-222222222222",
  "u-b": "44444444-4444-4444-8444-444444444444",
}
const NOW = new Date("2026-10-02T00:00:00Z")

let db: PGlite
let rpc: Rpc
let key: KeyRecord
let signing: Signing

const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

async function hit(user: string, path: string, body?: unknown) {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer tok:${SUBS[user]}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW, signing: async () => signing })
  return { status: res.status, json: (await res.json()) as J }
}
const changes = (user: string, project: string, afterSeq: number | null, extra: Record<string, unknown> = {}) => hit(user, "changes", { project_id: project, after_seq: afterSeq, ...extra })
const pullIds = (user: string, project: string, kind: string, ids: unknown) => hit(user, "pull", { project_id: project, kind, ids })
const head = async (kind: string, id: string) => {
  const r = (await db.query<{ version: unknown; deleted: boolean; project_id: string }>(`select version, deleted, project_id from platform.projexa_record_head where kind = '${kind}' and record_id = '${id}'`)).rows[0]
  return r ? { version: Number(r.version), deleted: r.deleted, project_id: r.project_id } : undefined
}
const version = async (kind: string, id: string) => (await head(kind, id))?.version ?? 0
const log = async (kind: string, id: string) =>
  (await db.query<{ seq: unknown; xid: string; version: unknown; op: string }>(`select seq, xid::text xid, version, op from platform.projexa_change_log where kind = '${kind}' and record_id = '${id}' order by seq`)).rows.map((r) => ({ seq: Number(r.seq), xid: Number(r.xid), version: Number(r.version), op: r.op }))
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 1, title: `Task ${id}`, updated_at: "2026-09-01T10:00:00Z", ...extra })
const HORIZON_SQL = `CREATE OR REPLACE FUNCTION public.projexa_sync__horizon() RETURNS xid8 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT pg_snapshot_xmin(pg_current_snapshot()) $fn$`
const pinHorizon = (x: number) => db.exec(`CREATE OR REPLACE FUNCTION public.projexa_sync__horizon() RETURNS xid8 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT '${x}'::xid8 $fn$`)
let nextNumber = 5000
const fresh = (id: string, extra: Record<string, unknown> = {}) => task(id, { number: nextNumber++, ...extra })

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
  await db.exec(forwardSql("0679_projexa_record_versions"))
  rpc = pgRpc(db)
  key = await generateKeyRecord()
  await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk })
  signing = await createSigning(key)
  await db.exec(insert("pms_issues", [task("v1", { number: 1 }), task("v2", { number: 2 })]))
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("versions: +1 on every real change, nothing for a touch", () => {
  test("first write is version 1; the pull carries it and the signature covers it", async () => {
    await db.exec(insert("pms_issues", [fresh("first1")]))
    expect(await version("tasks", "first1")).toBe(1)
    const r = await pullIds("u-mgr", "proj-a", "tasks", ["first1"])
    const it = (r.json.items as J[]).find((i) => i.id === "first1")!
    expect(it.version).toBe(1)
    const msg = itemMessage({ org: "org-a", project: "proj-a", kind: "tasks", id: "first1", version: 1, updatedAt: it.updated_at, dataHash: await sha256Hex(canonicalize(it.data)) })
    expect(await verifyMessage(await importPublic(key.public_jwk), msg, it.sig)).toBe(true)
    // the same row claimed at another version does not verify
    expect(await verifyMessage(await importPublic(key.public_jwk), msg.replace("|1|", "|2|"), it.sig)).toBe(false)
  })

  test("a real change makes the next version; the same values, or only updated_at, do not", async () => {
    const v0 = await version("tasks", "v1")
    await db.exec(`update compliance.pms_issues set title = 'Renamed' where id = 'v1'`)
    expect(await version("tasks", "v1")).toBe(v0 + 1)
    await db.exec(`update compliance.pms_issues set title = 'Renamed' where id = 'v1'`)
    expect(await version("tasks", "v1")).toBe(v0 + 1)
    await db.exec(`update compliance.pms_issues set updated_at = '2026-09-09T09:09:09Z' where id = 'v1'`)
    expect(await version("tasks", "v1")).toBe(v0 + 1)
    await db.exec(`update compliance.pms_issues set title = 'Renamed again' where id = 'v1'`)
    expect(await version("tasks", "v1")).toBe(v0 + 2)
    expect((await log("tasks", "v1")).slice(-2).map((l) => [l.version, l.op])).toEqual([[v0 + 1, "U"], [v0 + 2, "U"]])
  })

  test("every log row carries the transaction that wrote it: one statement's rows share it, a later transaction's is larger", async () => {
    await db.exec(insert("pms_issues", [fresh("tx-a"), fresh("tx-b")]))
    await db.exec(`update compliance.pms_issues set title = 'later' where id = 'tx-a'`)
    const [a1, a2] = await log("tasks", "tx-a")
    const [b1] = await log("tasks", "tx-b")
    expect(a1.xid).toBe(b1.xid)
    expect(a2.xid).toBeGreaterThan(a1.xid)
  })

  test("a delete is a tombstone, and the same id coming back continues the version", async () => {
    await db.exec(insert("pms_issues", [fresh("tomb1")]))
    await db.exec(`delete from compliance.pms_issues where id = 'tomb1'`)
    expect(await head("tasks", "tomb1")).toMatchObject({ version: 2, deleted: true })
    expect((await log("tasks", "tomb1")).map((l) => l.op)).toEqual(["I", "D"])
    await db.exec(insert("pms_issues", [fresh("tomb1", { title: "Back again" })]))
    expect(await head("tasks", "tomb1")).toMatchObject({ version: 3, deleted: false })
  })

  test("a record never seen by tracking gets version 1 on its first update (the baseline is 0, no backfill needed)", async () => {
    await db.exec(`alter table compliance.pms_issues disable trigger projexa_track_i`)
    await db.exec(insert("pms_issues", [fresh("old1")]))
    await db.exec(`alter table compliance.pms_issues enable trigger projexa_track_i`)
    expect(await head("tasks", "old1")).toBeUndefined()
    const before = await pullIds("u-mgr", "proj-a", "tasks", ["old1"])
    expect((before.json.items as J[])[0].version).toBe(0)
    await db.exec(`update compliance.pms_issues set title = 'Touched' where id = 'old1'`)
    expect(await version("tasks", "old1")).toBe(1)
  })
})

describe("changes: what a laptop learns since a cursor", () => {
  test("after_seq null answers the head only; later changes appear after it, one entry per record (its latest), tombstones included", async () => {
    const first = await changes("u-mgr", "proj-a", null)
    expect(first.status).toBe(200)
    expect(first.json.changes).toEqual([])
    const headSeq = first.json.head_seq as number
    expect(headSeq).toBeGreaterThan(0)
    expect(first.json.next_seq).toBe(headSeq)
    expect([first.json.reset_required, typeof first.json.epoch]).toEqual([false, "string"])

    await db.exec(`update compliance.pms_issues set title = 'Changed after head' where id = 'v1'`)
    await db.exec(insert("pms_issues", [fresh("v9")]))
    await db.exec(`delete from compliance.pms_issues where id = 'v9'`)
    const next = await changes("u-mgr", "proj-a", headSeq)
    expect(next.json.changes).toEqual([
      { seq: expect.any(Number), kind: "tasks", id: "v1", version: await version("tasks", "v1"), op: "U" },
      { seq: expect.any(Number), kind: "tasks", id: "v9", version: 2, op: "D" },
    ])
    expect(next.json.has_more).toBe(false)
    expect(next.json.next_seq).toBe(next.json.head_seq)
    expect(((await changes("u-mgr", "proj-a", next.json.next_seq as number)).json.changes as J[]).length).toBe(0)
  })

  test("paging: limit 1 walks every transaction exactly once, the cursor always moves forward", async () => {
    const all = (await changes("u-mgr", "proj-a", 0, { limit: 1000 })).json
    expect(all.has_more).toBe(false)
    const latest = new Map<string, J>()
    let after = 0
    for (let i = 0; i < 500; i++) {
      const r = await changes("u-mgr", "proj-a", after, { limit: 1 })
      for (const c of r.json.changes as J[]) latest.set(`${c.kind}:${c.id}`, c)
      if (r.json.has_more) expect(r.json.next_seq).toBeGreaterThan(after)
      after = r.json.next_seq as number
      if (!r.json.has_more) break
    }
    expect(after).toBe(all.next_seq)
    const byRecord = (list: J[]) => list.map((c) => `${c.kind}:${c.id}:${c.version}:${c.op}`).sort()
    expect(byRecord([...latest.values()])).toEqual(byRecord(all.changes as J[]))
  })

  test("a page ends at a transaction boundary, and one transaction larger than the page comes whole", async () => {
    const start = (await changes("u-mgr", "proj-a", null)).json.head_seq as number
    await db.exec(insert("pms_issues", [fresh("big-1"), fresh("big-2"), fresh("big-3"), fresh("big-4"), fresh("big-5")]))
    await db.exec(insert("pms_issues", [fresh("after-1")]))
    const p1 = await changes("u-mgr", "proj-a", start, { limit: 2 })
    expect((p1.json.changes as J[]).map((c) => c.id).sort()).toEqual(["big-1", "big-2", "big-3", "big-4", "big-5"])
    expect(p1.json.has_more).toBe(true)
    const p2 = await changes("u-mgr", "proj-a", p1.json.next_seq as number, { limit: 2 })
    expect([(p2.json.changes as J[]).map((c) => c.id), p2.json.has_more]).toEqual([["after-1"], false])
    // a page never cuts a transaction: the first transaction fits, the second does not, so the page stops after the first
    await db.exec(insert("pms_issues", [fresh("two-1"), fresh("two-2")]))
    await db.exec(insert("pms_issues", [fresh("three-1"), fresh("three-2"), fresh("three-3")]))
    const p3 = await changes("u-mgr", "proj-a", p2.json.next_seq as number, { limit: 4 })
    expect([(p3.json.changes as J[]).map((c) => c.id).sort(), p3.json.has_more]).toEqual([["two-1", "two-2"], true])
  })

  test("commit order: a transaction that commits AFTER a later one is still delivered (sql:SQL-04, sync:SYNC-01)", async () => {
    const start = (await changes("u-mgr", "proj-a", null)).json.head_seq as number
    // T1 takes its transaction id first and stays open (its rows are not visible to anyone yet)
    const x1 = Number((await db.query<{ x: string }>(`select pg_current_xact_id()::text x`)).rows[0].x)
    // T2 starts later, changes a task and COMMITS
    await db.exec(`update compliance.pms_issues set title = 'T2 committed first' where id = 'v2'`)
    const t2 = (await log("tasks", "v2")).at(-1)!
    expect(t2.xid).toBeGreaterThan(x1)
    try {
      // while T1 is open, every reader's snapshot xmin is at most T1's id
      await pinHorizon(x1)
      const during = await changes("u-mgr", "proj-a", start)
      expect(during.json.changes).toEqual([]) // T2 is withheld: handing out its position now would skip T1 for ever
      expect([during.json.next_seq, during.json.head_seq]).toEqual([start, start])
      // T1 commits: its rows carry the EARLIER transaction id and LOWER seq values than T2's (the seq was taken when its trigger fired)
      await db.exec(`insert into platform.projexa_change_log (seq, xid, org_id, project_id, kind, record_id, version, op) overriding system value values
                       (-2, '${x1}', 'org-a', 'proj-a', 'tasks', 't1-line-a', 1, 'I'), (-1, '${x1}', 'org-a', 'proj-a', 'tasks', 't1-line-b', 1, 'I')`)
    } finally {
      await db.exec(HORIZON_SQL)
    }
    const after = await changes("u-mgr", "proj-a", start)
    expect((after.json.changes as J[]).map((c) => c.id)).toEqual(["t1-line-a", "t1-line-b", "v2"])
    expect(after.json.next_seq).toBe(t2.xid)
  })

  test("a cursor from the future (a database restored to an earlier point) answers reset_required", async () => {
    const r = await changes("u-mgr", "proj-a", 9_000_000_000)
    expect([r.status, r.json.reset_required, r.json.changes]).toEqual([200, true, []])
    expect(r.json.next_seq).toBe(r.json.head_seq)
  })

  test("another organisation's row that names the project is never listed, and its person gets the one 404", async () => {
    await db.exec(insert("pms_issues", [{ id: "tw-v", org_id: "org-b", project_id: "proj-a", type_id: "ty", status_id: "st", number: 9, title: "Wrong org row", updated_at: "2026-09-01T10:00:00Z" }]))
    const r = await changes("u-mgr", "proj-a", 0)
    expect(JSON.stringify(r.json)).not.toContain("tw-v")
    expect(await changes("u-b", "proj-a", 0)).toEqual({ status: 404, json: { error: "Not found" } })
  })

  test("a private project is the one 404 for a person who may not read it, and open to its lead", async () => {
    await db.exec(insert("pms_issues", [fresh("priv1", { project_id: "proj-priv" })]))
    expect(await changes("u-mem", "proj-priv", null)).toEqual({ status: 404, json: { error: "Not found" } })
    const lead = await changes("u-sen", "proj-priv", 0)
    expect(lead.status).toBe(200)
    expect((lead.json.changes as J[]).map((c) => c.id)).toEqual(["priv1"])
  })

  test("a BOQ line is filed under its BOQ's project; it is still tombstoned when its BOQ went first", async () => {
    await db.exec(insert("construction_boqs", [{ id: "boq-v", org_id: "org-a", project_id: "proj-a", title: "BOQ v", created_by_id: "u-mgr" }]))
    await db.exec(insert("construction_boq_line_items", [{ id: "li-v", boq_id: "boq-v", org_id: "org-a", description: "Slab", unit: "cum", quantity: 1, rate: 1, amount: 1, created_at: "2026-09-01T09:00:00Z" }]))
    expect(await head("boq_lines", "li-v")).toMatchObject({ version: 1, project_id: "proj-a" })
    await db.exec(`delete from compliance.construction_boqs where id = 'boq-v'`)
    await db.exec(`delete from compliance.construction_boq_line_items where id = 'li-v'`)
    expect(await head("boq_lines", "li-v")).toMatchObject({ version: 2, deleted: true, project_id: "proj-a" })
  })

  test("validation: limit, cursor, body", async () => {
    expect((await changes("u-mgr", "proj-a", 0, { limit: 0 })).status).toBe(400)
    expect((await changes("u-mgr", "proj-a", 0, { limit: 1001 })).status).toBe(400)
    expect((await changes("u-mgr", "proj-a", -1)).status).toBe(400)
    expect((await hit("u-mgr", "changes", { after_seq: 1 })).status).toBe(400)
  })
})

describe("pull by ids", () => {
  test("returns exactly the asked rows of the project, with version and signature; foreign and unknown ids are absent", async () => {
    await db.exec(insert("pms_issues", [{ id: "tw-p", org_id: "org-b", project_id: "proj-a", type_id: "ty", status_id: "st", number: 8, title: "Wrong org row", updated_at: "2026-09-01T10:00:00Z" }]))
    const r = await pullIds("u-mgr", "proj-a", "tasks", ["v1", "v2", "nope", "tw-p"])
    expect(r.status).toBe(200)
    expect((r.json.items as J[]).map((i) => i.id).sort()).toEqual(["v1", "v2"])
    expect((r.json.items as J[]).find((i) => i.id === "v1")!.version).toBe(await version("tasks", "v1"))
    expect(r.json.has_more).toBe(false)
    expect(typeof r.json.view_class).toBe("string")
    for (const it of r.json.items as J[]) expect(typeof it.sig).toBe("string")
  })

  test("validation and the one 404", async () => {
    await db.exec(insert("pms_issues", [fresh("priv2", { project_id: "proj-priv" })]))
    expect((await pullIds("u-mgr", "proj-a", "tasks", [])).status).toBe(400)
    expect((await pullIds("u-mgr", "proj-a", "tasks", Array.from({ length: 201 }, (_, i) => `i${i}`))).status).toBe(400)
    expect((await pullIds("u-mgr", "proj-a", "tasks", ["bad id!"])).status).toBe(400)
    expect((await pullIds("u-mgr", "proj-a", "tasks", "v1")).status).toBe(400)
    for (const a of [await pullIds("u-b", "proj-a", "tasks", ["v1"]), await pullIds("u-mem", "proj-priv", "tasks", ["priv2"]), await pullIds("u-mgr", "proj-a", "no_such_kind", ["v1"])]) {
      expect(a).toEqual({ status: 404, json: { error: "Not found" } })
    }
  })
})

describe("safety: tracking never blocks a business write", () => {
  test("a refusing change log does not fail the insert, the update or the delete", async () => {
    await db.exec(`alter table platform.projexa_change_log add constraint boom check (false) not valid`)
    try {
      await db.exec(insert("pms_issues", [fresh("safe1")]))
      await db.exec(`update compliance.pms_issues set title = 'Still saved' where id = 'safe1'`)
      expect((await db.query<{ title: string }>(`select title from compliance.pms_issues where id = 'safe1'`)).rows[0].title).toBe("Still saved")
      await db.exec(`delete from compliance.pms_issues where id = 'safe1'`)
      expect((await db.query(`select 1 from compliance.pms_issues where id = 'safe1'`)).rows.length).toBe(0)
    } finally {
      await db.exec(`alter table platform.projexa_change_log drop constraint boom`)
    }
    // and nothing half-written was left behind for it
    expect(await head("tasks", "safe1")).toBeUndefined()
  })

  test("a bulk write of 2,000 rows (four 500-row statements) versions every row", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => fresh(`bulk-${i}`))
    for (let i = 0; i < rows.length; i += 500) await db.exec(insert("pms_issues", rows.slice(i, i + 500)))
    expect(Number((await db.query<{ n: unknown }>(`select count(*) n from platform.projexa_record_head where kind = 'tasks' and record_id like 'bulk-%'`)).rows[0].n)).toBe(2000)
  })
})

describe("reversible", () => {
  test("the down file removes everything and restores the 0677 pull; the forward file applies twice and makes a NEW epoch (sync:SYNC-09)", async () => {
    const epoch0 = (await changes("u-mgr", "proj-a", null)).json.epoch as string
    await db.exec(downSql("0679_projexa_record_versions"))
    expect((await db.query<{ a: string | null; b: string | null; c: string | null }>(`select to_regclass('platform.projexa_change_log')::text a, to_regclass('platform.projexa_record_head')::text b, to_regclass('platform.projexa_sync_epoch')::text c`)).rows[0]).toEqual({ a: null, b: null, c: null })
    expect((await db.query(`select 1 from pg_trigger where tgname like 'projexa_track%'`)).rows.length).toBe(0)
    // the restored 0677 pull still answers (no version on its items: the handler reports 0), and the 0678 ids carries no versions
    const r = await hit("u-mgr", "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 5 })
    expect(r.status).toBe(200)
    for (const it of r.json.items as J[]) expect(it.version).toBe(0)
    expect((await hit("u-mgr", "ids", { project_id: "proj-a", kind: "tasks" })).json.versions).toBeNull()
    await db.exec(forwardSql("0679_projexa_record_versions"))
    await db.exec(forwardSql("0679_projexa_record_versions"))
    // exactly three tracking triggers per table after two applications (no duplicates), on every one of the 13 tables that exist here
    const trig = (await db.query<{ n: unknown; d: unknown }>(`select count(*) n, count(distinct tgrelid) d from pg_trigger where tgname in ('projexa_track_i', 'projexa_track_u', 'projexa_track_d')`)).rows[0]
    const tables = Number((await db.query<{ n: unknown }>(`select count(*) n from unnest(array['projects','pms_issues','construction_boqs','construction_boq_line_items','construction_activities','construction_work_progress_entries','construction_rfis','construction_submittals','construction_punch_list_items','construction_change_orders','pms_milestones','construction_materials','documents']) t where to_regclass('compliance.' || t) is not null`)).rows[0].n)
    expect([Number(trig.n), Number(trig.d)]).toEqual([3 * tables, tables])
    await db.exec(`update compliance.pms_issues set title = 'After re-apply' where id = 'v1'`)
    expect(await version("tasks", "v1")).toBe(1)
    // versions restarted at 1: the new epoch is what tells every laptop that the numbers it holds are void
    const epoch1 = (await changes("u-mgr", "proj-a", null)).json.epoch as string
    expect(epoch1).toMatch(/^[0-9a-f]{32}$/)
    expect(epoch1).not.toBe(epoch0)
  })

  test("the down file refuses to run while a later migration's triggers still exist (strict reverse order, sql:SQL-09)", async () => {
    await db.exec(forwardSql("0683_projexa_sync_more_kinds"))
    let err = ""
    try {
      await db.exec(downSql("0679_projexa_record_versions"))
    } catch (e) {
      err = String((e as Error).message)
      await db.exec("rollback") // the file's own BEGIN is still open after the RAISE
    }
    expect(err).toContain("roll back 0684 and 0683 before 0679")
    expect((await db.query<{ a: string | null }>(`select to_regclass('platform.projexa_change_log')::text a`)).rows[0].a).not.toBeNull()
    // re-running 0679 after 0683 regresses nothing: the 15 new tables keep tracking (the function is not redefined by 0683)
    await db.exec(forwardSql("0679_projexa_record_versions"))
    await db.exec(insert("construction_labour_roster", [{ id: "ro-after", org_id: "org-a", project_id: "proj-a", name: "R", trade: "x", skill_level: "skilled", employee_code: "E9", is_active: true, daily_rate: 1 }]))
    expect(await version("roster", "ro-after")).toBe(1)
    // re-running 0678 after 0683 and 0679 leaves the 28-kind list and 0679's ids in place
    await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
    expect(Number((await db.query<{ n: unknown }>(`select cardinality(public.projexa_sync__kinds()) n`)).rows[0].n)).toBe(28)
    expect(Array.isArray((await hit("u-mgr", "ids", { project_id: "proj-a", kind: "tasks" })).json.versions)).toBe(true)
  })
})
