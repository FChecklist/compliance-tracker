/// <reference types="bun-types" />
// AUDIT-100 row B8 (deletes sync): drizzle/0727_projexa_sync_meeting_soft_delete_read.sql on PGlite (real Postgres as WASM, over the sync chain 0618 to 0687 as the
// live database has it) and the REAL projexa-sync Edge handler. No live database is touched.
// THE DEFECT (measured live 2026-10-05): delete_meeting soft-deletes (pms_meetings.deleted_at, 0687) and the tracking tombstones the head (mode col_unset), but the
// read side (projexa_sync__src from 0683, ai_work_link__records_core from 0643) still served the meeting, so /pull kept returning it, /ids kept listing it and a
// laptop never dropped it. These tests re-read the database after the delete and assert:
//   * /pull, /ids and pull-by-ids no longer serve the soft-deleted meeting; the other meeting is untouched
//   * /changes (from the head before the delete) lists ONE delete (op D) for it, and the head says deleted; the source row stays (a soft delete, deleted_at set)
//   * the AI link's own record read (ai_work_link__records_core) no longer lists it nor answers it by id
//   * the down file brings the old read back (the deleted meeting is served again), and the forward file applies again (twice changes nothing)
// SEEN TO FAIL without the fix: B8_BREAK=1 skips 0727 and the read-side assertions fail.
// Run: bun test --isolate src/lib/services/projexa-sync-meeting-delete.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { downSql, forwardSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { A2, S, insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(240_000)

const MGR_SUB = "11111111-1111-4111-8111-111111111111"
const NOW = new Date("2026-10-05T00:00:00Z")
const FIX = "0727_projexa_sync_meeting_soft_delete_read"
// construction_boq_categories is not in the committed base snapshot (0687 needs it): its live shape, from schema.ts (drizzle/0532)
const CATEGORIES_TABLE = `CREATE TABLE IF NOT EXISTS compliance.construction_boq_categories (
  id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`

let db: PGlite
let rpc: Rpc
const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

async function hit(path: string, body?: unknown) {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer tok:${MGR_SUB}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW })
  expect(res.status).toBe(200)
  return (await res.json()) as J
}
const pulled = async () => ((await hit("pull", { project_id: "proj-a", kind: "meetings", after: null, limit: 200 })).items as J[]).map((i) => i.id as string).sort()
const listed = async () => ((await hit("ids", { project_id: "proj-a", kind: "meetings" })).ids as string[]).slice().sort()
const pulledById = async (id: string) => ((await hit("pull", { project_id: "proj-a", kind: "meetings", ids: [id] })).items as J[]).map((i) => i.id as string)
/** The AI link's own read of the project's meetings (all, or one id), as the manager. */
async function aiRead(id: string | null): Promise<string[]> {
  const r = await db.query<{ r: J }>(
    "select public.ai_work_link__records_core(public.ai_work_link__bind(public.projexa_sync__ctx('u-mgr', 'org-a'), 'proj-a'), 'meetings', NULL, 50, '{}'::jsonb, $1) r",
    [id],
  )
  return ((r.rows[0].r.items as J[] | undefined) ?? []).map((i) => i.id as string).sort()
}

let headBefore = 0

beforeAll(async () => {
  db = await createUserLinkDb()
  for (const m of ["0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0683_projexa_sync_more_kinds", "0685_awl_ai_crud"]) {
    await db.exec(forwardSql(m))
  }
  await db.exec(CATEGORIES_TABLE)
  await db.exec(forwardSql("0687_awl_ai_crud_b5"))
  if (process.env.B8_BREAK !== "1") await db.exec(forwardSql(FIX))
  rpc = pgRpc(db)
  await db.exec(insert("pms_meetings", [
    { id: "pm-keep", ...S(), title: "Weekly site", scheduled_at: "2026-10-10T09:00:00Z", duration_minutes: 60 },
    { id: "pm-del", ...S(), title: "B8 delete round trip", scheduled_at: "2026-10-11T09:00:00Z", duration_minutes: 30 },
    { id: "pm-a2", ...A2(), title: "Other project", scheduled_at: "2026-10-10T09:00:00Z", duration_minutes: 30 },
  ]))
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("a soft-deleted meeting leaves the read path (AUDIT-100 B8)", () => {
  test("before the delete, the project's two meetings are pulled, listed and readable by the AI link", async () => {
    expect(await pulled()).toEqual(["pm-del", "pm-keep"])
    expect(await listed()).toEqual(["pm-del", "pm-keep"])
    expect(await aiRead(null)).toEqual(["pm-del", "pm-keep"])
    headBefore = (await hit("changes", { project_id: "proj-a", after_seq: null })).head_seq as number
  })

  test("after delete_meeting's soft delete: /pull, /ids and pull-by-ids no longer serve it; the other meeting stays", async () => {
    // exactly what pms-meeting-service.ts deleteMeeting writes
    await db.exec("update compliance.pms_meetings set deleted_at = now() where id = 'pm-del'")
    // the source row stays (a soft delete), re-read from the database
    const src = await db.query<{ deleted: boolean }>("select deleted_at is not null as deleted from compliance.pms_meetings where id = 'pm-del'")
    expect(src.rows).toEqual([{ deleted: true }])
    expect(await pulled()).toEqual(["pm-keep"])
    expect(await listed()).toEqual(["pm-keep"])
    expect(await pulledById("pm-del")).toEqual([])
    expect(await pulledById("pm-keep")).toEqual(["pm-keep"])
  })

  test("the change feed lists ONE delete for it and the head is a tombstone, so a laptop drops it", async () => {
    const feed = await hit("changes", { project_id: "proj-a", after_seq: headBefore })
    const mine = (feed.changes as J[]).filter((c) => c.kind === "meetings" && c.id === "pm-del")
    expect(mine.map((c) => c.op)).toEqual(["D"])
    const head = await db.query<{ deleted: boolean; version: number }>("select deleted, version::int as version from platform.projexa_record_head where kind = 'meetings' and record_id = 'pm-del'")
    expect(head.rows).toEqual([{ deleted: true, version: 2 }])
  })

  test("the AI link's own record read no longer lists it nor answers it by id", async () => {
    expect(await aiRead(null)).toEqual(["pm-keep"])
    expect(await aiRead("pm-del")).toEqual([])
    expect(await aiRead("pm-keep")).toEqual(["pm-keep"])
  })

  test("the down file serves the deleted meeting again; the forward file applies twice and hides it again", async () => {
    if (process.env.B8_BREAK === "1") return
    await db.exec(downSql(FIX))
    expect(await pulled()).toEqual(["pm-del", "pm-keep"])
    expect(await aiRead("pm-del")).toEqual(["pm-del"])
    await db.exec(forwardSql(FIX))
    await db.exec(forwardSql(FIX))
    expect(await pulled()).toEqual(["pm-keep"])
    expect(await listed()).toEqual(["pm-keep"])
    expect(await aiRead("pm-del")).toEqual([])
  })
})
