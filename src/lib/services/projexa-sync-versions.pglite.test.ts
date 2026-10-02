/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST SYNC: drizzle/0679_projexa_record_versions.sql on PGlite (real Postgres as WASM, built the way the live database is: 0618 gateway,
// the AI work link, 0677 read side, 0678 keys) and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts) running over those SQL functions.
//   * versions:   a record's version is 1 on first write, +1 on every REAL change; a write that changes nothing, or only updated_at, is not a new version
//   * history:    the change log is append-only with a rising seq; a delete is a tombstone (op D) and the same id coming back continues the version
//   * changes:    a laptop asks "what changed in my project since seq N"; it never learns of another organisation's rows, and a project it may not read is the one 404
//   * ids mode:   exact rows by id, scoped on organisation AND project, with the version, signed
//   * safety:     the trigger NEVER blocks a business write, even when its own tables refuse the insert
//   * reversible: the down file removes everything and restores the 0677 pull; the forward file can be applied twice
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
  return r ? { version: String(r.version), deleted: r.deleted, project_id: r.project_id } : undefined
}
const log = async (kind: string, id: string) =>
  (await db.query<{ seq: unknown; version: unknown; op: string }>(`select seq, version, op from platform.projexa_change_log where kind = '${kind}' and record_id = '${id}' order by seq`)).rows.map((r) => ({ seq: String(r.seq), version: String(r.version), op: r.op }))
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 1, title: `Task ${id}`, updated_at: "2026-09-01T10:00:00Z", ...extra })

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
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("versions: +1 on every real change, nothing for a touch", () => {
  test("first write is version 1; the pull carries it and the signature covers it", async () => {
    await db.exec(insert("pms_issues", [task("v1", { number: 1 }), task("v2", { number: 2 })]))
    expect((await head("tasks", "v1")).version).toBe("1")
    const r = await hit("u-mgr", "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 200 })
    const it = (r.json.items as J[]).find((i) => i.id === "v1")!
    expect(it.version).toBe(1)
    const msg = itemMessage({ org: "org-a", project: "proj-a", kind: "tasks", id: "v1", version: 1, updatedAt: it.updated_at, dataHash: await sha256Hex(canonicalize(it.data)) })
    expect(await verifyMessage(await importPublic(key.public_jwk), msg, it.sig)).toBe(true)
    // the same row claimed at another version does not verify
    expect(await verifyMessage(await importPublic(key.public_jwk), msg.replace("|1|", "|2|"), it.sig)).toBe(false)
  })

  test("a real change makes the next version; the same values, or only updated_at, do not", async () => {
    await db.exec(`update compliance.pms_issues set title = 'Renamed' where id = 'v1'`)
    expect((await head("tasks", "v1")).version).toBe("2")
    await db.exec(`update compliance.pms_issues set title = 'Renamed' where id = 'v1'`)
    expect((await head("tasks", "v1")).version).toBe("2")
    await db.exec(`update compliance.pms_issues set updated_at = '2026-09-09T09:09:09Z' where id = 'v1'`)
    expect((await head("tasks", "v1")).version).toBe("2")
    await db.exec(`update compliance.pms_issues set title = 'Renamed again' where id = 'v1'`)
    expect((await head("tasks", "v1")).version).toBe("3")
    expect((await log("tasks", "v1")).map((l) => [l.version, l.op])).toEqual([["1", "I"], ["2", "U"], ["3", "U"]])
  })

  test("the log is append-only with a rising seq", async () => {
    const seqs = (await db.query<{ seq: unknown }>(`select seq from platform.projexa_change_log order by seq`)).rows.map((r) => Number(r.seq))
    expect(seqs.length).toBeGreaterThan(3)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
  })

  test("a delete is a tombstone, and the same id coming back continues the version", async () => {
    await db.exec(`delete from compliance.pms_issues where id = 'v2'`)
    expect(await head("tasks", "v2")).toMatchObject({ version: "2", deleted: true })
    expect((await log("tasks", "v2")).map((l) => l.op)).toEqual(["I", "D"])
    await db.exec(insert("pms_issues", [task("v2", { number: 2, title: "Back again" })]))
    expect(await head("tasks", "v2")).toMatchObject({ version: "3", deleted: false })
  })

  test("a record never seen by tracking gets version 1 on its first update (the baseline is 0, no backfill needed)", async () => {
    await db.exec(`alter table compliance.pms_issues disable trigger projexa_track_change`)
    await db.exec(insert("pms_issues", [task("old1", { number: 50 })]))
    await db.exec(`alter table compliance.pms_issues enable trigger projexa_track_change`)
    expect(await head("tasks", "old1")).toBeUndefined()
    const before = await hit("u-mgr", "pull", { project_id: "proj-a", kind: "tasks", ids: ["old1"] })
    expect((before.json.items as J[])[0].version).toBe(0)
    await db.exec(`update compliance.pms_issues set title = 'Touched' where id = 'old1'`)
    expect((await head("tasks", "old1")).version).toBe("1")
  })
})

describe("changes: what a laptop learns since a sequence number", () => {
  test("after_seq null answers the head only; a later change and a tombstone appear after it, in order", async () => {
    const first = await changes("u-mgr", "proj-a", null)
    expect(first.status).toBe(200)
    expect(first.json.changes).toEqual([])
    const headSeq = first.json.head_seq as number
    expect(headSeq).toBeGreaterThan(0)
    expect(first.json.next_seq).toBe(headSeq)

    await db.exec(`update compliance.pms_issues set title = 'Changed after head' where id = 'v1'`)
    await db.exec(insert("pms_issues", [task("v9", { number: 9 })]))
    await db.exec(`delete from compliance.pms_issues where id = 'v9'`)
    const next = await changes("u-mgr", "proj-a", headSeq)
    expect(next.json.changes).toEqual([
      { seq: expect.any(Number), kind: "tasks", id: "v1", version: 4, op: "U" },
      { seq: expect.any(Number), kind: "tasks", id: "v9", version: 1, op: "I" },
      { seq: expect.any(Number), kind: "tasks", id: "v9", version: 2, op: "D" },
    ])
    expect(next.json.has_more).toBe(false)
    expect(next.json.next_seq).toBe(next.json.head_seq)
    expect(((await changes("u-mgr", "proj-a", next.json.next_seq as number)).json.changes as J[]).length).toBe(0)
  })

  test("paging: limit 1 walks every change exactly once", async () => {
    const all = (await changes("u-mgr", "proj-a", 0, { limit: 1000 })).json.changes as J[]
    const seen: number[] = []
    let after = 0
    for (let i = 0; i < 100; i++) {
      const r = await changes("u-mgr", "proj-a", after, { limit: 1 })
      for (const c of r.json.changes as J[]) seen.push(c.seq)
      after = r.json.next_seq as number
      if (!r.json.has_more) break
    }
    expect(seen).toEqual(all.map((c) => c.seq))
  })

  test("another organisation's row that names the project is never listed, and its person gets the one 404", async () => {
    await db.exec(insert("pms_issues", [{ id: "tw-v", org_id: "org-b", project_id: "proj-a", type_id: "ty", status_id: "st", number: 9, title: "Wrong org row", updated_at: "2026-09-01T10:00:00Z" }]))
    const r = await changes("u-mgr", "proj-a", 0)
    expect(JSON.stringify(r.json)).not.toContain("tw-v")
    expect(await changes("u-b", "proj-a", 0)).toEqual({ status: 404, json: { error: "Not found" } })
  })

  test("a private project is the one 404 for a person who may not read it, and open to its lead", async () => {
    await db.exec(insert("pms_issues", [task("priv1", { project_id: "proj-priv" })]))
    expect(await changes("u-mem", "proj-priv", null)).toEqual({ status: 404, json: { error: "Not found" } })
    const lead = await changes("u-sen", "proj-priv", 0)
    expect(lead.status).toBe(200)
    expect((lead.json.changes as J[]).map((c) => c.id)).toEqual(["priv1"])
  })

  test("a BOQ line is filed under its BOQ's project; it is still tombstoned when its BOQ went first", async () => {
    await db.exec(insert("construction_boqs", [{ id: "boq-v", org_id: "org-a", project_id: "proj-a", title: "BOQ v", created_by_id: "u-mgr" }]))
    await db.exec(insert("construction_boq_line_items", [{ id: "li-v", boq_id: "boq-v", org_id: "org-a", description: "Slab", unit: "cum", quantity: 1, rate: 1, amount: 1, created_at: "2026-09-01T09:00:00Z" }]))
    expect(await head("boq_lines", "li-v")).toMatchObject({ version: "1", project_id: "proj-a" })
    await db.exec(`delete from compliance.construction_boqs where id = 'boq-v'`)
    await db.exec(`delete from compliance.construction_boq_line_items where id = 'li-v'`)
    expect(await head("boq_lines", "li-v")).toMatchObject({ version: "2", deleted: true, project_id: "proj-a" })
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
    const r = await pullIds("u-mgr", "proj-a", "tasks", ["v1", "old1", "nope", "tw-v"])
    expect(r.status).toBe(200)
    expect((r.json.items as J[]).map((i) => i.id).sort()).toEqual(["old1", "v1"])
    expect((r.json.items as J[]).find((i) => i.id === "v1")!.version).toBe(4)
    expect(r.json.has_more).toBe(false)
    for (const it of r.json.items as J[]) expect(typeof it.sig).toBe("string")
  })

  test("validation and the one 404", async () => {
    expect((await pullIds("u-mgr", "proj-a", "tasks", [])).status).toBe(400)
    expect((await pullIds("u-mgr", "proj-a", "tasks", Array.from({ length: 201 }, (_, i) => `i${i}`))).status).toBe(400)
    expect((await pullIds("u-mgr", "proj-a", "tasks", ["bad id!"])).status).toBe(400)
    expect((await pullIds("u-mgr", "proj-a", "tasks", "v1")).status).toBe(400)
    for (const a of [await pullIds("u-b", "proj-a", "tasks", ["v1"]), await pullIds("u-mem", "proj-priv", "tasks", ["priv1"]), await pullIds("u-mgr", "proj-a", "no_such_kind", ["v1"])]) {
      expect(a).toEqual({ status: 404, json: { error: "Not found" } })
    }
  })
})

describe("safety: tracking never blocks a business write", () => {
  test("a refusing change log does not fail the insert, the update or the delete", async () => {
    await db.exec(`alter table platform.projexa_change_log add constraint boom check (false) not valid`)
    try {
      await db.exec(insert("pms_issues", [task("safe1", { number: 70 })]))
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

  test("a bulk write of 2,000 rows is tracked without trouble", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => task(`bulk-${i}`, { number: 1000 + i }))
    const t0 = Date.now()
    for (let i = 0; i < rows.length; i += 500) await db.exec(insert("pms_issues", rows.slice(i, i + 500)))
    const ms = Date.now() - t0
    expect(Number((await db.query<{ n: unknown }>(`select count(*) n from platform.projexa_record_head where kind = 'tasks' and record_id like 'bulk-%'`)).rows[0].n)).toBe(2000)
    expect(ms).toBeLessThan(60_000)
  })
})

describe("reversible", () => {
  test("the down file removes everything and restores the 0677 pull; the forward file applies twice", async () => {
    await db.exec(downSql("0679_projexa_record_versions"))
    expect((await db.query<{ a: string | null; b: string | null }>(`select to_regclass('platform.projexa_change_log')::text a, to_regclass('platform.projexa_record_head')::text b`)).rows[0]).toEqual({ a: null, b: null })
    expect((await db.query(`select 1 from pg_trigger where tgname = 'projexa_track_change'`)).rows.length).toBe(0)
    // the restored 0677 pull still answers (no version on its items: the handler reports 0)
    const r = await hit("u-mgr", "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 5 })
    expect(r.status).toBe(200)
    for (const it of r.json.items as J[]) expect(it.version).toBe(0)
    await db.exec(forwardSql("0679_projexa_record_versions"))
    await db.exec(forwardSql("0679_projexa_record_versions"))
    // exactly one tracking trigger per table after two applications (no duplicates)
    const trig = (await db.query<{ n: unknown; d: unknown }>(`select count(*) n, count(distinct tgrelid) d from pg_trigger where tgname = 'projexa_track_change'`)).rows[0]
    expect(Number(trig.n)).toBeGreaterThanOrEqual(4)
    expect(Number(trig.n)).toBe(Number(trig.d))
    await db.exec(`update compliance.pms_issues set title = 'After re-apply' where id = 'v1'`)
    expect((await head("tasks", "v1")).version).toBe("1")
  })
})
