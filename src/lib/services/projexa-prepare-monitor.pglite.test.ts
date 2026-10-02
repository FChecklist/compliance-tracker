/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST: drizzle/0688_projexa_prepare_monitor.sql on PGlite and the REAL Edge handler (route /prepare).
//   * report:   a laptop's stage/percent/status lands for the signed-in PERSON; a bad report is refused (400); each person's laptop is its own row
//   * state:    one row per (person, device); the percent never goes backwards inside one attempt; a new attempt may restart; done at 100 stamps completion
//   * health:   a laptop silent while running is STALLED, a retrying one past 3 attempts or a failed one is FAILING, a long-unfinished one NEVER_FINISHED; a done one is clean
//   * reasons:  the error class is kept (unknown classes become `other`), the detail is bounded
//   * edge:     /prepare needs a session and is POST only
//   * reversible: the down file removes everything; the forward file applies twice
// Run: bun test --isolate src/lib/services/projexa-prepare-monitor.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { forwardSql, downSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(180_000)

const SUBS: Record<string, string> = { "u-mgr": "11111111-1111-4111-8111-111111111111", "u-mem": "22222222-2222-4222-8222-222222222222" }
const DEV1 = "laptop-one-0001"
const DEV2 = "laptop-two-0002"
let db: PGlite
let rpc: Rpc

const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })
async function hit(user: string | null, body: unknown, method = "POST") {
  const headers: Record<string, string> = user ? { authorization: `Bearer tok:${SUBS[user]}` } : {}
  const req = new Request("https://x.supabase.co/functions/v1/projexa-sync/prepare", { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => new Date() })
  return { status: res.status, json: (await res.json()) as J }
}
const report = (user: string, o: Record<string, unknown>) => hit(user, { device_id: DEV1, stage: "app", percent: 40, status: "running", attempt: 1, release_version: "2026.10.02-865", ...o })
const state = async (device = DEV1) => (await db.query<Record<string, unknown>>(`select * from platform.projexa_prepare_state where device_id = '${device}' order by user_id`)).rows
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const health = async (stall = 3, never = 15, stuck = 5) => ((await db.query<{ h: Record<string, any> }>(`select public.projexa_prepare_health(${stall}, ${never}, ${stuck}) as h`)).rows[0]!.h)
const age = (device: string, minutes: number) => db.exec(`update platform.projexa_prepare_state set last_seen_at = clock_timestamp() - interval '${minutes} minutes', started_at = started_at - interval '${minutes} minutes' where device_id = '${device}'`)

beforeAll(async () => {
  db = await createUserLinkDb()
  for (const m of ["0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0680_projexa_release_registry", "0688_projexa_prepare_monitor", "0689_projexa_prepare_stuck"]) await db.exec(forwardSql(m))
  rpc = pgRpc(db)
}, 300_000)
afterAll(async () => { await db?.close() })

describe("report", () => {
  test("a laptop's progress lands for the signed-in person", async () => {
    const r = await report("u-mgr", { percent: 40 })
    expect(r.status).toBe(200)
    const [row] = await state()
    expect(row).toMatchObject({ stage: "app", percent: 40, status: "running", attempts: 1 })
    expect(row!.last_seen_at).toBeTruthy()
  })
  test("a bad report is refused and nothing more is stored", async () => {
    for (const bad of [{ percent: 101 }, { percent: -1 }, { stage: "nope" }, { status: "weird" }, { device_id: "x" }, { release_version: "not a release" }]) {
      const r = await report("u-mgr", bad)
      expect(r.status).toBe(400)
    }
    expect((await state()).length).toBe(1)
  })
  test("no session: 401; a GET: 405", async () => {
    expect((await hit(null, {})).status).toBe(401)
    expect((await hit("u-mgr", {}, "GET")).status).toBe(405)
  })
  test("percent never goes backwards inside one attempt; a new attempt may restart; done at 100 stamps completion", async () => {
    await report("u-mgr", { percent: 70, stage: "projects" })
    await report("u-mgr", { percent: 55, stage: "projects" })
    expect((await state())[0]).toMatchObject({ percent: 70 })
    await report("u-mgr", { percent: 10, stage: "worker", attempt: 2, status: "retrying", error_class: "service_unreachable" })
    expect((await state())[0]).toMatchObject({ percent: 10, attempts: 2, status: "retrying", error_class: "service_unreachable" })
    await report("u-mgr", { percent: 100, stage: "done", status: "done", attempt: 2 })
    const row = (await state())[0]!
    expect(row).toMatchObject({ percent: 100, status: "done" })
    expect(row.completed_at).toBeTruthy()
    expect(row.error_class).toBeNull()
  })
  test("the reason class is kept, an unknown class becomes `other`, the detail is cut to 300", async () => {
    await report("u-mem", { device_id: DEV2, status: "failed", error_class: "storage_blocked", error_detail: "x".repeat(900) })
    const row = (await state(DEV2))[0]!
    expect(row.error_class).toBe("storage_blocked")
    expect(String(row.error_detail).length).toBe(300)
    await report("u-mem", { device_id: DEV2, status: "failed", error_class: "made-up" })
    expect((await state(DEV2))[0]!.error_class).toBe("other")
  })
  test("two people on one device id are two rows", async () => {
    await report("u-mgr", { device_id: "shared-dev-0003" })
    await report("u-mem", { device_id: "shared-dev-0003" })
    expect((await state("shared-dev-0003")).length).toBe(2)
  })
})

describe("health: which laptops are not at 100%, and why", () => {
  test("a finished laptop is clean", async () => {
    await db.exec(`delete from platform.projexa_prepare_state`)
    await report("u-mgr", { percent: 100, stage: "done", status: "done" })
    const h = await health()
    expect(h).toMatchObject({ laptops: 1, done: 1, stalled: 0, failing: 0, never_finished: 0 })
    expect(h.problems).toEqual([])
  })
  test("silent while running = STALLED, with how long and where it stopped", async () => {
    await db.exec(`delete from platform.projexa_prepare_state`)
    await report("u-mgr", { percent: 45, stage: "projects", status: "running" })
    expect((await health()).stalled).toBe(0) // heard from a moment ago
    await age(DEV1, 5)
    const h = await health()
    expect(h.stalled).toBe(1)
    expect(h.problems[0]).toMatchObject({ health: "stalled", stage: "projects", percent: 45, status: "running", device_id: DEV1 })
    expect(h.problems[0].silent_minutes).toBeGreaterThanOrEqual(5)
  })
  test("a failed run is FAILING with its reason; three retries is FAILING too", async () => {
    await db.exec(`delete from platform.projexa_prepare_state`)
    await report("u-mgr", { status: "failed", error_class: "service_unreachable", error_detail: "the copy service did not answer" })
    let h = await health()
    expect(h.failing).toBe(1)
    expect(h.problems[0]).toMatchObject({ health: "failing", error_class: "service_unreachable" })
    await db.exec(`delete from platform.projexa_prepare_state`)
    await report("u-mgr", { status: "retrying", attempt: 3, error_class: "timeout" })
    h = await health()
    expect(h.failing).toBe(1)
  })
  test("a run that started long ago and never finished is reported even if it keeps reporting", async () => {
    await db.exec(`delete from platform.projexa_prepare_state`)
    await report("u-mgr", { percent: 70, stage: "projects", status: "running" })
    await db.exec(`update platform.projexa_prepare_state set started_at = clock_timestamp() - interval '40 minutes'`)
    const h = await health()
    expect(h.never_finished).toBe(1)
    expect(h.problems[0]).toMatchObject({ health: "never_finished", percent: 70 })
  })
})

describe("stuck: alive but not advancing", () => {
  const ageProgress = (minutes: number) => db.exec(`update platform.projexa_prepare_state set progress_at = clock_timestamp() - interval '${minutes} minutes'`)
  test("a laptop that keeps reporting the same stage and percentage is STUCK after the window, not before", async () => {
    await db.exec(`delete from platform.projexa_prepare_state`)
    await report("u-mgr", { percent: 70, stage: "projects", status: "running" })
    expect((await health()).stuck).toBe(0)
    await ageProgress(6)
    await report("u-mgr", { percent: 70, stage: "projects", status: "running" }) // a heartbeat: same state, heard just now
    const h = await health()
    expect(h).toMatchObject({ stuck: 1, stalled: 0 })
    expect(h.problems[0]).toMatchObject({ health: "stuck", stage: "projects", percent: 70 })
    expect(h.problems[0].no_progress_minutes).toBeGreaterThanOrEqual(6)
  })
  test("any forward move clears it: a higher percentage, a new stage or a new attempt", async () => {
    await ageProgress(6)
    await report("u-mgr", { percent: 71, stage: "projects", status: "running" })
    expect((await health()).stuck).toBe(0)
    await ageProgress(6)
    await report("u-mgr", { percent: 71, stage: "projects", status: "running", attempt: 2 })
    expect((await health()).stuck).toBe(0)
  })
  test("a finished laptop is never stuck", async () => {
    await report("u-mgr", { percent: 100, stage: "done", status: "done", attempt: 2 })
    await ageProgress(60)
    expect((await health()).stuck).toBe(0)
  })
})

describe("grants and reversibility", () => {
  test("the forward file applies twice; the down file removes everything", async () => {
    await db.exec(forwardSql("0689_projexa_prepare_stuck"))
    await db.exec(downSql("0689_projexa_prepare_stuck"))
    await db.exec(downSql("0688_projexa_prepare_monitor"))
    const left = await db.query(`select 1 from pg_proc where proname in ('projexa_prepare_report','projexa_prepare_health') union all select 1 from information_schema.tables where table_name in ('projexa_prepare_state','projexa_prepare_event')`)
    expect(left.rows.length).toBe(0)
  })
})
