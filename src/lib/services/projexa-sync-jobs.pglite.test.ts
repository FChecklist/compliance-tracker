/// <reference types="bun-types" />
// PROJEXA WORK OFFLOAD: drizzle/0682_projexa_work_jobs.sql on PGlite (real Postgres as WASM, built the way the live database is: 0618 gateway, the AI work link, 0677 read side, 0678 view class)
// and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts, routes /jobs/*).
//   * who may run it:  by default only the requester's own devices; a colleague only when the requester opted in AND the colleague is in the same organisation, may read the project NOW and has the
//                      SAME VIEW CLASS (a colleague who sees money never computes for a requester who does not); another organisation never
//   * rules:           only whitelisted display-only types exist (nothing that feeds money, approvals, billing or permissions); a result is a proposal stored on the job, never written to a business table
//   * lease:           a claim expires; an expired claim is offered again (3 attempts, then LEASE_EXPIRED); a late result is refused; the same result twice is answered once; heartbeats extend to 5 minutes at most
//   * limits:          params 16 KB, result 256 KB, 30 open jobs per person
// Run: bun test --isolate src/lib/services/projexa-sync-jobs.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { forwardSql, downSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(180_000)

const SUBS: Record<string, string> = {
  "u-mgr": "11111111-1111-4111-8111-111111111111",
  "u-sen": "55555555-5555-4555-8555-555555555555",
  "u-mem": "22222222-2222-4222-8222-222222222222",
  "u-view": "66666666-6666-4666-8666-666666666666",
  "u-adm": "33333333-3333-4333-8333-333333333333",
  "u-b": "44444444-4444-4444-8444-444444444444",
}
const NOW = new Date("2026-10-02T00:00:00Z")
const DEV_A = "laptop-aaaa-0001"
const DEV_B = "laptop-bbbb-0002"

let db: PGlite
let rpc: Rpc
const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

async function hit(user: string, path: string, body: unknown) {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: "POST", headers: { authorization: `Bearer tok:${SUBS[user] ?? user}` }, body: JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW })
  return { status: res.status, json: (await res.json()) as J }
}
const enqueue = (user: string, o: Record<string, unknown> = {}) => hit(user, "jobs/enqueue", { project_id: "proj-a", type: "boq_rollup", params: { boqId: "boq1" }, ...o })
const claim = (user: string, o: Record<string, unknown> = {}) => hit(user, "jobs/claim", { device_id: DEV_A, types: ["boq_rollup", "csv_export", "report_preview", "search_index"], ...o })
const result = (user: string, jobId: string, leaseId: string, o: Record<string, unknown> = {}) => hit(user, "jobs/result", { job_id: jobId, lease_id: leaseId, ok: true, result: { total: 42 }, ...o })
const get = (user: string, jobId: string) => hit(user, "jobs/get", { job_id: jobId })
const row = async (id: string) => (await db.query<J>(`select status, attempts, claimed_by, claimed_device, error_code, result_bytes, view_class, visibility from platform.projexa_work_job where id = '${id}'`)).rows[0]
const reset = () => db.exec(`delete from platform.projexa_work_job`)
/** The view class of a person, read straight from the database (the same function the queue uses). */
const classOf = async (user: string) => (await db.query<J>(`select public.projexa_sync__view_class(u.org_id, u.role::text) c from compliance.users u where u.id = '${user}'`)).rows[0].c as string
/** Two DIFFERENT people with the SAME view class: so a refusal can only be the rule under test, never the class. */
async function sameClassPair(): Promise<[string, string]> {
  const people = ["u-mgr", "u-sen", "u-mem", "u-view", "u-adm"]
  const cls = await Promise.all(people.map(classOf))
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) if (cls[i] === cls[j]) return [people[i], people[j]]
  throw new Error("the fixture has no two people of one view class")
}

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
  await db.exec(forwardSql("0682_projexa_work_jobs"))
  rpc = pgRpc(db)
  // a private project led by the MEMBER: the viewer has the member's view class but may not read it, so a refusal can only be the readability rule
  await db.exec(`insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level, project_value, status, created_at) values ('proj-priv-mem', 'prod', 'org-a', 'Mem Secret', 'u-mem', 'private', 1, 'active', now())`)
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("enqueue", () => {
  test("a job is queued for the requester with the requester's view class", async () => {
    await reset()
    const r = await enqueue("u-mgr")
    expect(r.status).toBe(200)
    const j = await row(r.json.job_id)
    expect(j).toMatchObject({ status: "queued", attempts: 0, visibility: "requester" })
    expect(j.view_class).toMatch(/^[0-9a-f]{16}$/)
  })

  test("only whitelisted display-only types exist; nothing that feeds money, approvals or permissions can be queued", async () => {
    for (const type of ["payroll_total", "approve_boq", "invoice_post", "permissions_update", "BOQ_ROLLUP", ""]) expect((await enqueue("u-mgr", { type })).status).toBe(400)
    for (const type of ["boq_rollup", "csv_export", "report_preview", "search_index"]) expect((await enqueue("u-mgr", { type })).status).toBe(200)
  })

  test("validation: params, visibility, size, project", async () => {
    await reset()
    expect((await enqueue("u-mgr", { params: [1] })).status).toBe(400)
    expect((await enqueue("u-mgr", { params: { big: "x".repeat(17000) } })).status).toBe(400)
    expect((await enqueue("u-mgr", { visibility: "everyone" })).status).toBe(400)
    expect((await hit("u-mgr", "jobs/enqueue", { type: "boq_rollup", params: {} })).status).toBe(400)
  })

  test("a project of another organisation, and a private one the person may not read, are the one 404", async () => {
    expect(await enqueue("u-b", { project_id: "proj-a" })).toEqual({ status: 404, json: { error: "Not found" } })
    expect(await enqueue("u-mem", { project_id: "proj-priv" })).toEqual({ status: 404, json: { error: "Not found" } })
    expect(await enqueue("u-mgr", { project_id: "no-such-project" })).toEqual({ status: 404, json: { error: "Not found" } })
  })

  test("30 open jobs per person, then 429", async () => {
    await reset()
    let last = 200
    let n = 0
    while (last === 200 && n < 40) {
      last = (await enqueue("u-mem")).status
      n++
    }
    expect(last).toBe(429)
    expect(n).toBe(31)
  })

  test("a person who is not linked gets 403 and nothing is queued", async () => {
    await reset()
    expect((await enqueue("99999999-9999-4999-8999-999999999999")).status).toBe(403)
    expect(Number((await db.query<J>(`select count(*) n from platform.projexa_work_job`)).rows[0].n)).toBe(0)
  })
})

describe("who may claim", () => {
  test("the requester's own device gets the job with a lease; it cannot be claimed twice", async () => {
    await reset()
    const id = (await enqueue("u-mgr")).json.job_id
    const c = await claim("u-mgr")
    expect(c.status).toBe(200)
    expect(c.json.job).toMatchObject({ job_id: id, type: "boq_rollup", project_id: "proj-a", params: { boqId: "boq1" }, attempt: 1, requested_by_you: true })
    expect(c.json.job.lease_id).toMatch(/^[0-9a-f]{32}$/)
    expect((await row(id)).status).toBe("claimed")
    expect((await claim("u-mgr", { device_id: DEV_B })).json.job).toBeNull()
  })

  test("by default a colleague cannot claim it (even one of the SAME view class), nor can another organisation", async () => {
    await reset()
    const [requester, colleague] = await sameClassPair()
    await enqueue(requester)
    expect((await claim(colleague)).json.job).toBeNull()
    expect((await claim("u-b")).json.job).toBeNull()
    expect((await claim(requester)).json.job).not.toBeNull()
  })

  test("when the requester opts in, a colleague with the SAME view class who may read the project can; one with a different view class cannot", async () => {
    await reset()
    const vc = async (user: string) => (await db.query<J>(`select public.projexa_sync__view_class('org-a', (select role::text from compliance.users where id = '${user}')) c`)).rows[0].c as string
    const [mgr, sen, mem2, view] = [await vc("u-mgr"), await vc("u-sen"), await vc("u-mem"), await vc("u-view")]
    expect(mgr).not.toBe(sen) // the manager sees cost, the senior does not
    // pick a colleague pair that really shares a class (member and viewer both see no cost)
    const same = mem2 === view ? ["u-mem", "u-view"] : sen === mem2 ? ["u-sen", "u-mem"] : null
    expect(same).not.toBeNull()
    const [requester, colleague] = same!
    const id = (await enqueue(requester, { visibility: "project" })).json.job_id
    // a colleague of ANOTHER view class does not get it
    const other = ["u-mgr", "u-sen", "u-mem", "u-view"].find((u) => u !== requester && u !== colleague && ([mgr, sen, mem2, view][["u-mgr", "u-sen", "u-mem", "u-view"].indexOf(u)] !== [mgr, sen, mem2, view][["u-mgr", "u-sen", "u-mem", "u-view"].indexOf(requester)]))!
    expect((await claim(other)).json.job).toBeNull()
    const c = await claim(colleague)
    expect(c.json.job).toMatchObject({ job_id: id, requested_by_you: false })
    expect((await row(id)).claimed_by).toBe(colleague)
  })

  test("a colleague who may not read a private project never gets its job, even with the SAME view class", async () => {
    await reset()
    expect(await classOf("u-mem")).toBe(await classOf("u-view"))
    const id = (await enqueue("u-mem", { project_id: "proj-priv-mem", visibility: "project" })).json.job_id
    expect((await claim("u-view")).json.job).toBeNull()
    expect((await claim("u-mem")).json.job).toMatchObject({ job_id: id })
  })
  test("a claim asks for types: other types are not handed out", async () => {
    await reset()
    await enqueue("u-mgr", { type: "csv_export" })
    expect((await claim("u-mgr", { types: ["boq_rollup"] })).json.job).toBeNull()
    expect((await claim("u-mgr", { types: ["csv_export"] })).json.job).toMatchObject({ type: "csv_export" })
  })

  test("two claims at once: exactly one wins", async () => {
    await reset()
    await enqueue("u-mgr")
    const [a, b] = await Promise.all([claim("u-mgr", { device_id: DEV_A }), claim("u-mgr", { device_id: DEV_B })])
    expect([a.json.job, b.json.job].filter(Boolean)).toHaveLength(1)
  })

  test("validation of a claim", async () => {
    expect((await hit("u-mgr", "jobs/claim", { device_id: "x", types: ["boq_rollup"] })).status).toBe(400)
    expect((await hit("u-mgr", "jobs/claim", { device_id: DEV_A, types: [] })).status).toBe(400)
    expect((await hit("u-mgr", "jobs/claim", { device_id: DEV_A, types: ["boq_rollup"], lease_seconds: 5 })).status).toBe(400)
    expect((await hit("u-mgr", "jobs/claim", { device_id: DEV_A, types: ["boq_rollup"], lease_seconds: 500 })).status).toBe(400)
  })
})

describe("results are proposals, accepted once per lease", () => {
  test("the claimant's result is stored on the job; only the requester reads it", async () => {
    await reset()
    const id = (await enqueue("u-mem", { visibility: "project" })).json.job_id
    const c = (await claim("u-view")).json.job // a colleague of the same class runs it, if the classes match
    const claimant = c ? "u-view" : "u-mem"
    const lease = c ? c.lease_id : (await claim("u-mem")).json.job.lease_id
    const r = await result(claimant, id, lease)
    expect(r.json).toMatchObject({ outcome: "accepted", job_status: "done" })
    const mine = await get("u-mem", id)
    expect(mine.json).toMatchObject({ job_status: "done", result: { total: 42 }, ran_here: claimant === "u-mem" })
    expect((await get("u-mgr", id)).status).toBe(404) // not the requester
    expect((await get("u-b", id)).status).toBe(404)
  })

  test("the same result twice is answered once (duplicate); a wrong lease, another person and an unknown job are 404", async () => {
    await reset()
    const id = (await enqueue("u-mgr")).json.job_id
    const lease = (await claim("u-mgr")).json.job.lease_id
    expect((await result("u-mgr", id, lease)).json.outcome).toBe("accepted")
    expect((await result("u-mgr", id, lease, { result: { total: 999 } })).json).toMatchObject({ outcome: "duplicate", job_status: "done" })
    expect((await get("u-mgr", id)).json.result).toEqual({ total: 42 })
    expect((await result("u-mgr", id, "0".repeat(32))).status).toBe(404)
    expect((await result("u-sen", id, lease)).status).toBe(404)
    expect((await result("u-mgr", "no-such-job", lease)).status).toBe(404)
  })

  test("a failure is recorded with its code; no result is kept", async () => {
    await reset()
    const id = (await enqueue("u-mgr")).json.job_id
    const lease = (await claim("u-mgr")).json.job.lease_id
    expect((await hit("u-mgr", "jobs/result", { job_id: id, lease_id: lease, ok: false, error: "WORKER_CRASHED" })).json).toMatchObject({ outcome: "accepted", job_status: "failed" })
    expect(await row(id)).toMatchObject({ status: "failed", error_code: "WORKER_CRASHED" })
    expect((await get("u-mgr", id)).json.result).toBeNull()
  })

  test("limits and validation: a result over 256 KB, a missing result, a missing lease", async () => {
    await reset()
    const id = (await enqueue("u-mgr")).json.job_id
    const lease = (await claim("u-mgr")).json.job.lease_id
    expect((await result("u-mgr", id, lease, { result: { big: "x".repeat(262200) } })).status).toBe(400)
    expect((await hit("u-mgr", "jobs/result", { job_id: id, lease_id: lease, ok: true })).status).toBe(400)
    expect((await hit("u-mgr", "jobs/result", { job_id: id, ok: true, result: {} })).status).toBe(400)
    expect((await row(id)).status).toBe("claimed")
  })

  test("a result is never written into a business table", async () => {
    await reset()
    const before = Number((await db.query<J>(`select count(*) n from compliance.construction_boq_line_items`)).rows[0].n)
    const id = (await enqueue("u-mgr")).json.job_id
    const lease = (await claim("u-mgr")).json.job.lease_id
    await result("u-mgr", id, lease, { result: { lineItems: [{ id: "evil", amount: 1e9 }] } })
    expect(Number((await db.query<J>(`select count(*) n from compliance.construction_boq_line_items`)).rows[0].n)).toBe(before)
  })
})

describe("the lease", () => {
  test("a late result is refused LEASE_EXPIRED; the job is offered again; after three attempts it fails for good", async () => {
    await reset()
    const id = (await enqueue("u-mgr")).json.job_id
    for (let attempt = 1; attempt <= 3; attempt++) {
      const c = (await claim("u-mgr")).json.job
      expect(c).toMatchObject({ job_id: id, attempt })
      await db.exec(`update platform.projexa_work_job set lease_expires_at = clock_timestamp() - interval '1 second' where id = '${id}'`)
      expect((await result("u-mgr", id, c.lease_id)).json.outcome).toBe("lease_expired")
    }
    expect((await claim("u-mgr")).json.job).toBeNull()
    expect(await row(id)).toMatchObject({ status: "failed", error_code: "LEASE_EXPIRED", attempts: 3 })
  })

  test("a vanished claimant's job is offered to another device of the same person", async () => {
    await reset()
    const id = (await enqueue("u-mgr")).json.job_id
    const first = (await claim("u-mgr", { device_id: DEV_A })).json.job
    await db.exec(`update platform.projexa_work_job set lease_expires_at = clock_timestamp() - interval '1 second' where id = '${id}'`)
    const second = (await claim("u-mgr", { device_id: DEV_B })).json.job
    expect(second).toMatchObject({ job_id: id, attempt: 2 })
    expect(second.lease_id).not.toBe(first.lease_id)
    expect((await row(id)).claimed_device).toBe(DEV_B)
    // the first device's late result is refused; the second's is accepted
    expect((await result("u-mgr", id, first.lease_id)).status).toBe(404)
    expect((await result("u-mgr", id, second.lease_id)).json.outcome).toBe("accepted")
  })

  test("heartbeat extends the lease, but never past five minutes in all; a dead lease cannot be extended", async () => {
    await reset()
    const id = (await enqueue("u-mgr")).json.job_id
    const lease = (await claim("u-mgr")).json.job.lease_id
    const hb = await hit("u-mgr", "jobs/heartbeat", { job_id: id, lease_id: lease })
    expect(hb.json.outcome).toBe("extended")
    await db.exec(`update platform.projexa_work_job set lease_started_at = clock_timestamp() - interval '4 minutes 50 seconds', lease_expires_at = clock_timestamp() + interval '5 seconds' where id = '${id}'`)
    const capped = await hit("u-mgr", "jobs/heartbeat", { job_id: id, lease_id: lease })
    const left = Number((await db.query<J>(`select extract(epoch from (lease_started_at + interval '5 minutes' - lease_expires_at)) s from platform.projexa_work_job where id = '${id}'`)).rows[0].s)
    expect(capped.json.outcome).toBe("extended")
    expect(left).toBeGreaterThanOrEqual(-0.5) // the new expiry is at most the five-minute ceiling
    await db.exec(`update platform.projexa_work_job set lease_expires_at = clock_timestamp() - interval '1 second' where id = '${id}'`)
    expect((await hit("u-mgr", "jobs/heartbeat", { job_id: id, lease_id: lease })).json.outcome).toBe("lease_expired")
    expect((await hit("u-mgr", "jobs/heartbeat", { job_id: id, lease_id: "nope" })).json.outcome).toBe("lease_expired")
  })
})

describe("reversible", () => {
  test("the down file removes the queue; the forward file applies twice", async () => {
    await db.exec(downSql("0682_projexa_work_jobs"))
    expect((await db.query<J>(`select to_regclass('platform.projexa_work_job')::text a, to_regproc('public.projexa_job_claim')::text b`)).rows[0]).toEqual({ a: null, b: null })
    await db.exec(forwardSql("0682_projexa_work_jobs"))
    await db.exec(forwardSql("0682_projexa_work_jobs"))
    expect((await enqueue("u-mgr")).status).toBe(200)
  })
})
