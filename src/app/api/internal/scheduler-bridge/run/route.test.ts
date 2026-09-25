/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-40, register row BR-515: the scheduler bridge's app route. A due schedule runs as the schedule's OWNER (user id and
// role; no API key anywhere) and yields a PROPOSAL for a write (PMD-05), at most one waiting proposal per schedule; a read runs
// through the executor registry as the owner. Every claimed run has one audit row, a run that throws included.
//
// WHAT IS REAL: the route (secret check), src/lib/pipeline/scheduler-bridge.ts (the due read, the atomic claim, the owner check, the
// proposal, the audit row, the result record), src/lib/pipeline/cron-next.ts, the function registry, logActivity, drizzle's query
// builders and the schema.ts declarations, and the database: PGlite (real Postgres as WASM) built from the committed live snapshot
// scripts/verify/fixtures/0642_build001_pipeline_schedules.base.sql plus drizzle/0642 itself. The bridge's plain reads and its claim run
// as the table owner (the real db client bypasses RLS); everything it writes for an organisation runs inside a transaction that
// switches to the app_runtime role and sets app.current_org_id, so the real row-level-security policies of submissions and audit_logs
// judge each write.
// WHAT IS FAKED, and nothing else: withTenantContext (replaced by that transaction; it refuses nesting like the real one and records
// every context it was given) and executeTask, the pipeline's executor entry point (it records the exact object it was called with and
// answers what the test says; the real executors would need the whole construction schema). Nothing here reaches the network, a model,
// or a live database, and no real key or secret is used: the secret below is a test value.
//
// Run: bun test --isolate src/app/api/internal/scheduler-bridge/run/route.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"

import * as realDb from "@/lib/db"
import * as realTenant from "@/lib/db/tenant-scoped"
import * as realExecutor from "@/lib/pipeline/executor"
import * as schema from "@/lib/db/schema"
import { pipelineFailure } from "@/lib/pipeline/error-codes"
import { nextCronRun } from "@/lib/pipeline/cron-next"

const REPO_ROOT = new URL("../../../../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")

// Built at run time from plain pieces so that no key-shaped literal sits in the file (the secret scanner flags one).
const SECRET = "bridge-test-" + "k".repeat(32)
const ORG_A = "org-a"
const ORG_B = "org-b"
const OWNER = { id: "u-owner-a", name: "Asha Manager", email: "asha.mgr@example.test", role: "manager", org: ORG_A }
const MEMBER = { id: "u-member-a", name: "Meera Member", email: "meera.mem@example.test", role: "member", org: ORG_A }
const OWNER_B = { id: "u-owner-b", name: "Ravi Admin", email: "ravi.adm@example.test", role: "admin", org: ORG_B }
const API_KEY_ID = "key-not-an-actor"
const MARKER = "Confidential title 7f3a"

// ─── the database ──────────────────────────────────────────────────────────
const pglite = await PGlite.create()
await pglite.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN; CREATE ROLE app_runtime NOLOGIN;
CREATE SCHEMA compliance;
GRANT USAGE ON SCHEMA compliance TO app_runtime, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA compliance GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, app_runtime;
`)
await pglite.exec(read("scripts/verify/fixtures/0642_build001_pipeline_schedules.base.sql"))
await pglite.exec(read("drizzle/0642_build001_pipeline_schedules.sql"))
const pgDb = drizzle(pglite, { schema })

// ─── the two fakes ─────────────────────────────────────────────────────────
const tenantCalls: Array<{ orgId: string; userId?: string }> = []
let tenantDepth = 0
async function withTenantContextDouble<T>(ctx: { orgId: string; userId?: string }, fn: (tx: any) => Promise<T>): Promise<T> {
  if (tenantDepth > 0) throw new Error("nested withTenantContext (the real one refuses this too)")
  tenantCalls.push({ orgId: ctx.orgId, userId: ctx.userId })
  tenantDepth++
  try {
    return await pgDb.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_runtime`)
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`)
      return fn(tx)
    })
  } finally {
    tenantDepth--
  }
}

type ExecTask = Parameters<typeof realExecutor.executeTask>[0]
const execCalls: ExecTask[] = []
const okRead = async () => ({ success: true as const, result: { rows: [1, 2, 3] } })
let execBehaviour: (task: ExecTask) => Promise<Awaited<ReturnType<typeof realExecutor.executeTask>>> = okRead

mock.module("@/lib/db", () => ({ ...realDb, db: pgDb }))
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenant, withTenantContext: withTenantContextDouble }))
mock.module("@/lib/pipeline/executor", () => ({
  ...realExecutor,
  executeTask: async (task: ExecTask) => {
    execCalls.push(task)
    return execBehaviour(task)
  },
}))

const { POST, ...routeModule } = await import("./route")
const { runDueSchedules } = await import("@/lib/pipeline/scheduler-bridge")

// ─── helpers ───────────────────────────────────────────────────────────────
async function reset() {
  await pglite.exec("DELETE FROM compliance.audit_logs; DELETE FROM compliance.submissions; DELETE FROM compliance.pipeline_schedules; DELETE FROM compliance.users")
  for (const u of [OWNER, MEMBER, OWNER_B]) {
    await pglite.query("INSERT INTO compliance.users (id, name, email, password_hash, role, org_id) VALUES ($1, $2, $3, 'x', $4, $5)", [u.id, u.name, u.email, u.role, u.org])
  }
  execCalls.length = 0
  tenantCalls.length = 0
  execBehaviour = okRead
  process.env.SCHEDULER_BRIDGE_INTERNAL_SECRET = SECRET
}

type ScheduleOverrides = { org?: string; owner?: string; fn?: string; params?: unknown; cadence?: string; next?: string; active?: boolean }
async function addSchedule(id: string, o: ScheduleOverrides = {}) {
  await pglite.query(
    `INSERT INTO compliance.pipeline_schedules (id, org_id, owner_user_id, function_id, params, cadence, next_run_at, is_active)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [id, o.org ?? ORG_A, o.owner ?? OWNER.id, o.fn ?? "get_construction_project_dashboard", JSON.stringify(o.params ?? { projectId: "proj-1" }), o.cadence ?? "0 9 * * *", o.next ?? "2020-01-01T00:00:00Z", o.active ?? true],
  )
}
type ScheduleRow = { id: string; next_run_at: Date; last_run_at: Date | null; last_result: Record<string, unknown> | null; is_active: boolean }
async function schedule(id: string): Promise<ScheduleRow> {
  return (await pglite.query<ScheduleRow>("SELECT id, next_run_at, last_run_at, last_result, is_active FROM compliance.pipeline_schedules WHERE id = $1", [id])).rows[0]
}
type AuditRow = { action: string; entity_type: string; entity_id: string; user_id: string | null; api_key_id: string | null; actor_name: string; actor_role: string; org_id: string; surface: string | null; details: string | null }
async function audits(entityId?: string): Promise<AuditRow[]> {
  const q = "SELECT action, entity_type, entity_id, user_id, api_key_id, actor_name, actor_role, org_id, surface, details FROM compliance.audit_logs"
  return (entityId ? await pglite.query<AuditRow>(`${q} WHERE entity_id = $1 ORDER BY created_at, id`, [entityId]) : await pglite.query<AuditRow>(`${q} ORDER BY created_at, id`)).rows
}
type SubmissionRow = { id: string; org_id: string; project_id: string | null; mode: string; selected_chain: Record<string, any>; raw_input: string; user_id: string; status: string; classification: string | null }
async function submissions(): Promise<SubmissionRow[]> {
  return (await pglite.query<SubmissionRow>("SELECT id, org_id, project_id, mode, selected_chain, raw_input, user_id, status, classification FROM compliance.submissions ORDER BY created_at, id")).rows
}

function request(auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers = new Headers()
  if (auth !== null) headers.set("authorization", auth)
  return new NextRequest("https://app.example.test/api/internal/scheduler-bridge/run", { method: "POST", headers })
}
type Summary = { ranAt: string; checked: number; claimed: number; proposed: number; alreadyPending: number; readsRun: number; failed: number; skipped: number; deferred: number; results: Array<{ scheduleId: string; outcome: string }> }
async function run(auth?: string | null): Promise<{ status: number; body: Summary; text: string }> {
  const res = await POST(request(auth))
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as Summary, text }
}

beforeEach(reset)

// ─── who may call it ───────────────────────────────────────────────────────
describe("POST /api/internal/scheduler-bridge/run: the secret", () => {
  test("no header, a wrong secret, a non-Bearer header and an empty bearer give 401 and run nothing", async () => {
    await addSchedule("s-1")
    for (const auth of [null, `Bearer ${SECRET}x`, `Bearer wrong-${"k".repeat(32)}`, SECRET, "Bearer ", "Basic abc"]) {
      const res = await run(auth)
      expect(res.status).toBe(401)
    }
    expect(execCalls).toEqual([])
    const row = await schedule("s-1")
    expect(row.last_run_at).toBeNull()
    expect(row.last_result).toBeNull()
    expect(await audits()).toEqual([])
  })

  test("the route fails closed when the secret is not set or is shorter than 24 characters, even for a bearer that matches it", async () => {
    await addSchedule("s-1")
    delete process.env.SCHEDULER_BRIDGE_INTERNAL_SECRET
    expect((await run("Bearer undefined")).status).toBe(401)
    expect((await run("Bearer ")).status).toBe(401)
    process.env.SCHEDULER_BRIDGE_INTERNAL_SECRET = "short-secret"
    expect((await run("Bearer short-secret")).status).toBe(401)
    expect(execCalls).toEqual([])
    expect((await schedule("s-1")).last_run_at).toBeNull()
  })

  test("only POST is exported", () => {
    expect(Object.keys(routeModule).filter((k) => ["GET", "PUT", "PATCH", "DELETE"].includes(k))).toEqual([])
  })
})

// ─── a due schedule runs as its owner ──────────────────────────────────────
describe("a due schedule runs through the pipeline as the schedule's owner", () => {
  test("a due READ runs through the executor as the owner: the owner's id and role, no API key, one audit row, next run moved on", async () => {
    await addSchedule("s-read", { params: { projectId: "proj-1" } })
    const { status, body } = await run()

    expect(status).toBe(200)
    expect(body).toMatchObject({ checked: 1, claimed: 1, readsRun: 1, proposed: 0, failed: 0, skipped: 0, deferred: 0 })
    expect(body.results).toEqual([{ scheduleId: "s-read", outcome: "read_ok" }])

    // The one call the pipeline got: exactly these fields, the owner as user and actor, the owner's role read from compliance.users.
    expect(execCalls).toHaveLength(1)
    const task = execCalls[0]
    expect(Object.keys(task).sort()).toEqual(["actorUserId", "functionId", "orgId", "params", "projectId", "role", "userId"])
    expect(task).toEqual({ orgId: ORG_A, userId: OWNER.id, actorUserId: OWNER.id, role: "manager", projectId: "proj-1", functionId: "get_construction_project_dashboard", params: { projectId: "proj-1" } })
    expect(JSON.stringify(task)).not.toMatch(/api.?key|key-/i)

    // The record of the run.
    const row = await schedule("s-read")
    expect(row.last_run_at?.toISOString()).toBe(body.ranAt)
    expect(row.next_run_at.toISOString()).toBe(nextCronRun("0 9 * * *", new Date(body.ranAt))!.toISOString())
    expect(row.next_run_at.getTime()).toBeGreaterThan(new Date(body.ranAt).getTime())
    expect(row.is_active).toBe(true)
    expect(row.last_result).toEqual({ trigger: "scheduler_bridge", ranAt: body.ranAt, outcome: "read_ok", functionId: "get_construction_project_dashboard", result: { kind: "object", keys: 1 } })

    // One audit row: the owner is the user, no key, surface s1, details say scheduler_bridge (register row BR-517 reads exactly this).
    const rows = await audits("s-read")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: "pipeline_schedule.run", entity_type: "pipeline_schedule", user_id: OWNER.id, api_key_id: null, actor_name: OWNER.name, actor_role: "manager", org_id: ORG_A, surface: "s1_one_page_ai_prepared" })
    expect(JSON.parse(rows[0].details!)).toEqual({ trigger: "scheduler_bridge", scheduleId: "s-read", functionId: "get_construction_project_dashboard", outcome: "read_ok", result: { kind: "object", keys: 1 } })

    // A read stores no proposal.
    expect(await submissions()).toEqual([])
  })

  test("the role is the owner's role at run time, read from compliance.users: a demoted owner's next run carries the new role", async () => {
    await addSchedule("s-mgr", { owner: OWNER.id, next: "2020-01-01T00:00:00Z" })
    await addSchedule("s-mem", { owner: MEMBER.id, next: "2020-01-02T00:00:00Z" })
    await run()
    expect(execCalls.map((t) => [t.userId, t.actorUserId, t.role])).toEqual([
      [OWNER.id, OWNER.id, "manager"],
      [MEMBER.id, MEMBER.id, "member"],
    ])

    await pglite.query("UPDATE compliance.users SET role = 'viewer' WHERE id = $1", [OWNER.id])
    await pglite.query("UPDATE compliance.pipeline_schedules SET next_run_at = '2020-01-01T00:00:00Z' WHERE id = 's-mgr'")
    await run()
    expect(execCalls).toHaveLength(3)
    expect(execCalls[2].role).toBe("viewer")
    expect((await audits("s-mgr")).map((a) => a.actor_role)).toEqual(["manager", "viewer"])
  })

  test("a due WRITE is never run: it yields one proposal in the approval store, in the owner's name, and nothing else is written", async () => {
    const params = { projectId: "proj-1", title: MARKER, lineItems: [{ description: "Partition", unit: "m2", quantity: 10, rate: 845 }] }
    await addSchedule("s-write", { fn: "create_boq", params })
    const { status, body, text } = await run()

    expect(status).toBe(200)
    expect(body).toMatchObject({ checked: 1, claimed: 1, proposed: 1, readsRun: 0, failed: 0 })
    expect(body.results).toEqual([{ scheduleId: "s-write", outcome: "proposed" }])
    // PMD-05: the write executor was not called (no other table a write would touch exists in this database either).
    expect(execCalls).toEqual([])

    const subs = await submissions()
    expect(subs).toHaveLength(1)
    const sub = subs[0]
    expect(sub).toMatchObject({ org_id: ORG_A, project_id: "proj-1", mode: "Projects", raw_input: "new boq", user_id: OWNER.id, status: "in_progress", classification: "TASK" })
    // The row shape the approval list reads (prepared-proposals.ts: source, functionId, params, note), plus the schedule's id.
    expect(Object.keys(sub.selected_chain).sort()).toEqual(["functionId", "note", "params", "scheduleId", "source"])
    expect(sub.selected_chain).toMatchObject({ source: "scheduler_bridge", functionId: "create_boq", params, scheduleId: "s-write" })
    expect(sub.selected_chain.note).toContain("Nothing is written until a person approves it")

    const rows = await audits("s-write")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: "pipeline_schedule.run", user_id: OWNER.id, api_key_id: null, actor_role: "manager", surface: "s1_one_page_ai_prepared" })
    expect(JSON.parse(rows[0].details!)).toEqual({ trigger: "scheduler_bridge", scheduleId: "s-write", functionId: "create_boq", outcome: "proposed", missing: [], submissionId: sub.id })

    // The parameters live in the proposal only: not in the response, the audit row or last_result.
    const row = await schedule("s-write")
    expect(row.last_result).toEqual({ trigger: "scheduler_bridge", ranAt: body.ranAt, outcome: "proposed", functionId: "create_boq", missing: [], submissionId: sub.id })
    expect(text).not.toContain(MARKER)
    expect(rows[0].details).not.toContain(MARKER)
    expect(JSON.stringify(row.last_result)).not.toContain(MARKER)
  })

  test("a write that is missing a required parameter is still stored as a proposal, and last_result names what is missing", async () => {
    await addSchedule("s-incomplete", { fn: "create_boq", params: { projectId: "proj-1" } })
    const { body } = await run()
    expect(body.proposed).toBe(1)
    expect((await schedule("s-incomplete")).last_result).toMatchObject({ outcome: "proposed", missing: ["title"] })
    expect(execCalls).toEqual([])
  })

  test("a proposal is written inside the schedule's own organisation, under the real row-level-security policies", async () => {
    await addSchedule("s-a", { fn: "create_boq", params: { projectId: "proj-a", title: "A" } })
    await addSchedule("s-b", { fn: "create_boq", org: ORG_B, owner: OWNER_B.id, params: { projectId: "proj-b", title: "B" }, next: "2020-01-02T00:00:00Z" })
    await run()
    expect(tenantCalls).toEqual([
      { orgId: ORG_A, userId: OWNER.id },
      { orgId: ORG_B, userId: OWNER_B.id },
    ])
    expect((await submissions()).map((s) => [s.org_id, s.user_id, s.project_id])).toEqual([
      [ORG_A, OWNER.id, "proj-a"],
      [ORG_B, OWNER_B.id, "proj-b"],
    ])
    expect((await audits()).map((a) => [a.org_id, a.user_id, a.entity_id])).toEqual([
      [ORG_A, OWNER.id, "s-a"],
      [ORG_B, OWNER_B.id, "s-b"],
    ])
  })
})

// ─── not due, inactive ─────────────────────────────────────────────────────
describe("what does not run", () => {
  test("a schedule that is not due yet does not run and is left exactly as it was", async () => {
    await addSchedule("s-future", { next: "2999-01-01T00:00:00Z" })
    const before = await schedule("s-future")
    const { body } = await run()
    expect(body).toMatchObject({ checked: 0, claimed: 0, results: [] })
    expect(execCalls).toEqual([])
    expect(await schedule("s-future")).toEqual(before)
    expect(await audits()).toEqual([])
    expect(await submissions()).toEqual([])
  })

  test("an inactive schedule does not run, however overdue", async () => {
    await addSchedule("s-off", { active: false, next: "2020-01-01T00:00:00Z" })
    await addSchedule("s-off-write", { active: false, fn: "create_boq", params: { projectId: "p", title: "t" } })
    const before = await schedule("s-off")
    const { body } = await run()
    expect(body).toMatchObject({ checked: 0, claimed: 0 })
    expect(execCalls).toEqual([])
    expect(await schedule("s-off")).toEqual(before)
    expect(await submissions()).toEqual([])
    expect(await audits()).toEqual([])
  })

  test("due means next_run_at at or before now: the boundary instant runs, one millisecond later does not (pinned clock)", async () => {
    const now = new Date("2026-09-26T09:30:00.000Z")
    await addSchedule("s-at", { cadence: "30 9 * * *", next: "2026-09-26T09:30:00.000Z" })
    await addSchedule("s-after", { cadence: "30 9 * * *", next: "2026-09-26T09:30:00.001Z" })
    const summary = await runDueSchedules({ now })
    expect(summary.results).toEqual([{ scheduleId: "s-at", outcome: "read_ok" }])
    const at = await schedule("s-at")
    expect(at.last_run_at?.toISOString()).toBe("2026-09-26T09:30:00.000Z")
    expect(at.next_run_at.toISOString()).toBe("2026-09-27T09:30:00.000Z")
    expect((await schedule("s-after")).next_run_at.toISOString()).toBe("2026-09-26T09:30:00.001Z")
  })
})

// ─── overlap ───────────────────────────────────────────────────────────────
describe("two overlapping runs", () => {
  test("run one schedule once: both read it as due, exactly one claims it, and it runs, is audited and is recorded once", async () => {
    await addSchedule("s-once")
    const [first, second] = await Promise.all([run(), run()])

    // Both saw the schedule as due (the overlap is real), and the database let one claim win.
    expect(first.body.checked).toBe(1)
    expect(second.body.checked).toBe(1)
    expect(first.body.claimed + second.body.claimed).toBe(1)
    expect([...first.body.results, ...second.body.results].map((r) => r.outcome).sort()).toEqual(["claimed_elsewhere", "read_ok"])

    expect(execCalls).toHaveLength(1)
    expect(await audits("s-once")).toHaveLength(1)
    // ...and a write schedule yields one proposal, not two.
    await addSchedule("s-once-write", { fn: "create_boq", params: { projectId: "p", title: "t" } })
    await Promise.all([run(), run()])
    expect(await submissions()).toHaveLength(1)
    expect(await audits("s-once-write")).toHaveLength(1)
  })
})

// ─── a departed owner ──────────────────────────────────────────────────────
describe("an owner who is no longer an active user of the organisation (PMD-33)", () => {
  test("a deactivated owner: the schedule is skipped and deactivated, nothing runs or is proposed, and the audit row says so", async () => {
    await addSchedule("s-left")
    await addSchedule("s-left-write", { fn: "create_boq", params: { projectId: "p", title: "t" }, next: "2020-01-02T00:00:00Z" })
    await pglite.query("UPDATE compliance.users SET is_active = false WHERE id = $1", [OWNER.id])
    const { body } = await run()

    expect(body).toMatchObject({ checked: 2, claimed: 2, skipped: 2, readsRun: 0, proposed: 0 })
    expect(execCalls).toEqual([])
    expect(await submissions()).toEqual([])
    for (const id of ["s-left", "s-left-write"]) {
      const row = await schedule(id)
      expect(row.is_active).toBe(false)
      expect(row.last_result).toMatchObject({ trigger: "scheduler_bridge", outcome: "owner_not_active", reason: "owner_inactive" })
      const rows = await audits(id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ action: "pipeline_schedule.deactivated", user_id: OWNER.id, api_key_id: null, surface: "s1_one_page_ai_prepared" })
      expect(JSON.parse(rows[0].details!)).toMatchObject({ trigger: "scheduler_bridge", scheduleId: id, outcome: "owner_not_active", reason: "owner_inactive" })
    }
    // A deactivated schedule is not picked up again.
    expect((await run()).body.checked).toBe(0)
  })

  test("an owner who now belongs to another organisation is not an active user of this one: skipped and deactivated", async () => {
    await addSchedule("s-moved")
    await pglite.query("UPDATE compliance.users SET org_id = $1 WHERE id = $2", [ORG_B, OWNER.id])
    const { body } = await run()
    expect(body.skipped).toBe(1)
    expect(execCalls).toEqual([])
    expect(await schedule("s-moved")).toMatchObject({ is_active: false, last_result: { outcome: "owner_not_active", reason: "owner_other_org" } })
    expect((await audits("s-moved"))[0]).toMatchObject({ action: "pipeline_schedule.deactivated", org_id: ORG_A, user_id: OWNER.id, api_key_id: null })
  })

  test("a departed owner's schedule does not stop the others in the same run", async () => {
    await addSchedule("s-left", { owner: MEMBER.id, next: "2020-01-01T00:00:00Z" })
    await addSchedule("s-fine", { owner: OWNER.id, next: "2020-01-02T00:00:00Z" })
    await pglite.query("UPDATE compliance.users SET is_active = false WHERE id = $1", [MEMBER.id])
    const { body } = await run()
    expect(body.results).toEqual([
      { scheduleId: "s-left", outcome: "owner_not_active" },
      { scheduleId: "s-fine", outcome: "read_ok" },
    ])
    expect(execCalls.map((t) => t.userId)).toEqual([OWNER.id])
  })

  // The foreign key on owner_user_id cascades, so a normal delete of the owner removes the schedule with them and nothing is left to run.
  // The bridge can still meet a schedule whose owner row is gone, in a race: the owner's delete commits after the due read and the
  // claim and before the owner read. The two tests below hold that state by deleting the owner with foreign-key triggers switched off
  // for the one statement (session_replication_role), on the same connection, so the schedule stays behind.
  async function deleteUserLeavingSchedules(id: string): Promise<void> {
    await pglite.exec("SET session_replication_role = replica")
    try {
      await pglite.query("DELETE FROM compliance.users WHERE id = $1", [id])
    } finally {
      await pglite.exec("SET session_replication_role = origin")
    }
  }

  test("a normal delete of the owner takes the schedule with it (ON DELETE CASCADE), so the bridge finds nothing to run", async () => {
    await addSchedule("s-cascade")
    await pglite.query("DELETE FROM compliance.users WHERE id = $1", [OWNER.id])
    expect((await pglite.query("SELECT id FROM compliance.pipeline_schedules WHERE id = 's-cascade'")).rows).toEqual([])
    expect((await run()).body).toMatchObject({ checked: 0, claimed: 0 })
    expect(execCalls).toEqual([])
  })

  test("an owner row that is gone at run time: the schedule is skipped and deactivated, and one audit row with no person says so", async () => {
    await addSchedule("s-gone")
    await addSchedule("s-gone-write", { fn: "create_boq", params: { projectId: "p", title: "t" }, next: "2020-01-02T00:00:00Z" })
    await deleteUserLeavingSchedules(OWNER.id)
    const { body } = await run()

    expect(body).toMatchObject({ checked: 2, claimed: 2, skipped: 2, readsRun: 0, proposed: 0, failed: 0 })
    expect(body.results).toEqual([
      { scheduleId: "s-gone", outcome: "owner_not_active" },
      { scheduleId: "s-gone-write", outcome: "owner_not_active" },
    ])
    expect(execCalls).toEqual([])
    expect(await submissions()).toEqual([])
    for (const [id, functionId] of [["s-gone", "get_construction_project_dashboard"], ["s-gone-write", "create_boq"]]) {
      const row = await schedule(id)
      expect(row.is_active).toBe(false)
      expect(row.last_result).toMatchObject({ trigger: "scheduler_bridge", outcome: "owner_not_active", reason: "owner_missing" })
      const rows = await audits(id)
      expect(rows).toHaveLength(1)
      // No owner to name: no person and no API key, the bridge itself is the actor, in the schedule's own organisation, on surface s1.
      expect(rows[0]).toMatchObject({ action: "pipeline_schedule.deactivated", entity_type: "pipeline_schedule", entity_id: id, user_id: null, api_key_id: null, actor_name: "Scheduler bridge", actor_role: "system", org_id: ORG_A, surface: "s1_one_page_ai_prepared" })
      expect(JSON.parse(rows[0].details!)).toEqual({ trigger: "scheduler_bridge", scheduleId: id, functionId, outcome: "owner_not_active", reason: "owner_missing" })
    }
    // The audit rows were written inside the schedule's organisation, under the real row-level-security policy, with no user id.
    expect(tenantCalls).toEqual([{ orgId: ORG_A, userId: undefined }, { orgId: ORG_A, userId: undefined }])
    // A deactivated schedule is not picked up again.
    expect((await run()).body.checked).toBe(0)
  })

  test("a cadence that cannot be read on a schedule whose owner row is gone is still audited once, with no person", async () => {
    await addSchedule("s-gone-badcron", { cadence: "61 * * * *" })
    await deleteUserLeavingSchedules(OWNER.id)
    const { body } = await run()
    expect(body).toMatchObject({ claimed: 1, skipped: 1 })
    expect(execCalls).toEqual([])
    expect(await schedule("s-gone-badcron")).toMatchObject({ is_active: false, last_result: { outcome: "invalid_cadence", reason: "cadence_not_readable" } })
    const rows = await audits("s-gone-badcron")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: "pipeline_schedule.deactivated", user_id: null, api_key_id: null, actor_role: "system", org_id: ORG_A })
    expect(JSON.parse(rows[0].details!)).toMatchObject({ outcome: "invalid_cadence", reason: "cadence_not_readable" })
  })
})

// ─── one waiting proposal per schedule ─────────────────────────────────────
describe("one proposal waits per schedule: a frequent cadence cannot flood the approval list", () => {
  const dueAgain = (id: string) => pglite.query("UPDATE compliance.pipeline_schedules SET next_run_at = '2020-01-01T00:00:00Z' WHERE id = $1", [id])
  const WRITE = { fn: "create_boq", params: { projectId: "proj-1", title: "Weekly BOQ" }, cadence: "*/5 * * * *" }

  test("a write schedule whose earlier proposal is still in_progress stores no second one: already_pending, each run audited, next run moved on", async () => {
    await addSchedule("s-dup", WRITE)
    const first = await run()
    expect(first.body).toMatchObject({ proposed: 1, alreadyPending: 0 })
    const [proposal] = await submissions()
    expect(proposal.status).toBe("in_progress")

    // Three more due ticks while nobody has acted on the proposal.
    for (let tick = 0; tick < 3; tick++) {
      await dueAgain("s-dup")
      const again = await run()
      expect(again.body).toMatchObject({ claimed: 1, proposed: 0, alreadyPending: 1, failed: 0, skipped: 0, readsRun: 0 })
      expect(again.body.results).toEqual([{ scheduleId: "s-dup", outcome: "already_pending" }])
      const row = await schedule("s-dup")
      expect(row.last_result).toEqual({ trigger: "scheduler_bridge", ranAt: again.body.ranAt, outcome: "already_pending", functionId: "create_boq", pendingSubmissionId: proposal.id })
      expect(row.next_run_at.getTime()).toBeGreaterThan(new Date(again.body.ranAt).getTime())
      expect(row.is_active).toBe(true)
    }

    // Still one proposal, and nothing was executed.
    expect((await submissions()).map((s) => s.id)).toEqual([proposal.id])
    expect(execCalls).toEqual([])
    // One audit row per claimed run: four runs, four rows, all in the owner's name; the last three say what they did not do.
    const rows = await audits("s-dup")
    expect(rows.map((r) => JSON.parse(r.details!).outcome)).toEqual(["proposed", "already_pending", "already_pending", "already_pending"])
    for (const r of rows) expect(r).toMatchObject({ action: "pipeline_schedule.run", user_id: OWNER.id, api_key_id: null, actor_role: "manager", org_id: ORG_A, surface: "s1_one_page_ai_prepared" })
    expect(JSON.parse(rows[3].details!)).toEqual({ trigger: "scheduler_bridge", scheduleId: "s-dup", functionId: "create_boq", outcome: "already_pending", pendingSubmissionId: proposal.id })
  })

  test("once the waiting proposal has been acted on (no longer in_progress), the next due tick proposes again", async () => {
    await addSchedule("s-cycle", WRITE)
    await run()
    const [first] = await submissions()
    await pglite.query("UPDATE compliance.submissions SET status = 'done' WHERE id = $1", [first.id])
    await dueAgain("s-cycle")
    const { body } = await run()
    expect(body).toMatchObject({ proposed: 1, alreadyPending: 0 })
    const subs = await submissions()
    expect(subs).toHaveLength(2)
    expect(subs.map((s) => s.status).sort()).toEqual(["done", "in_progress"])
    expect((await audits("s-cycle")).map((r) => JSON.parse(r.details!).outcome)).toEqual(["proposed", "proposed"])
  })

  test("a proposal that waits for one schedule does not hold back another schedule, even for the same function and parameters", async () => {
    await addSchedule("s-one", WRITE)
    await addSchedule("s-two", { ...WRITE, next: "2020-01-02T00:00:00Z" })
    await run()
    expect((await submissions()).map((s) => s.selected_chain.scheduleId).sort()).toEqual(["s-one", "s-two"])
    await dueAgain("s-one")
    await pglite.query("UPDATE compliance.submissions SET status = 'done' WHERE selected_chain->>'scheduleId' = 's-one'")
    await addSchedule("s-three", { ...WRITE, next: "2020-01-03T00:00:00Z" })
    const { body } = await run()
    expect(body.results).toEqual([
      { scheduleId: "s-one", outcome: "proposed" },
      { scheduleId: "s-three", outcome: "proposed" },
    ])
    expect(await submissions()).toHaveLength(4)
  })
})

// ─── failures ──────────────────────────────────────────────────────────────
describe("a failing schedule moves on instead of running every tick", () => {
  test("a function that fails records its code, moves next_run_at on, and does not run again at the next tick", async () => {
    execBehaviour = async () => ({ success: false as const, failure: pipelineFailure("RECORD_NOT_FOUND") })
    await addSchedule("s-fail")
    const first = await run()
    expect(first.body).toMatchObject({ claimed: 1, failed: 1, readsRun: 0 })
    const row = await schedule("s-fail")
    expect(row.last_result).toMatchObject({ trigger: "scheduler_bridge", outcome: "failed", failureCode: "RECORD_NOT_FOUND" })
    expect(row.next_run_at.getTime()).toBeGreaterThan(new Date(first.body.ranAt).getTime())
    expect(row.is_active).toBe(true)
    expect(JSON.parse((await audits("s-fail"))[0].details!)).toMatchObject({ outcome: "failed", failureCode: "RECORD_NOT_FOUND" })

    // The next five-minute tick finds nothing due.
    const second = await run()
    expect(second.body).toMatchObject({ checked: 0, claimed: 0 })
    expect(execCalls).toHaveLength(1)
  })

  test("an executor that throws is recorded as a failed run with an audit row, and the next schedule in the batch still runs", async () => {
    execBehaviour = async (task) => {
      if (task.params.projectId === "boom") throw new Error("connection reset by peer")
      return { success: true as const, result: [1, 2] }
    }
    await addSchedule("s-boom", { params: { projectId: "boom" }, next: "2020-01-01T00:00:00Z" })
    await addSchedule("s-after", { params: { projectId: "fine" }, next: "2020-01-02T00:00:00Z" })
    const { body } = await run()
    expect(body.results).toEqual([
      { scheduleId: "s-boom", outcome: "failed" },
      { scheduleId: "s-after", outcome: "read_ok" },
    ])
    expect((await schedule("s-boom")).last_result).toMatchObject({ outcome: "failed", failureCode: "INTERNAL_ERROR" })
    expect(JSON.stringify((await schedule("s-boom")).last_result)).not.toContain("connection reset")
    expect((await audits("s-boom"))).toHaveLength(1)
    expect((await schedule("s-after")).last_result).toMatchObject({ outcome: "read_ok", result: { kind: "list", count: 2 } })
    for (const id of ["s-boom", "s-after"]) expect((await schedule(id)).next_run_at.getTime()).toBeGreaterThan(new Date(body.ranAt).getTime())
  })

  // The proposal and its audit row share one transaction, so a proposal that fails to store rolls its own audit row back with it. The
  // run is still one claimed run and still owes one audit row: it is written afterwards, in a transaction of its own. The insert is made
  // to fail by a CHECK constraint on the real submissions table, which the real database enforces (a stand-in for any failed insert).
  test("a proposal that cannot be stored is a failed run that still gets its one audit row, naming the owner, and leaves nothing half-written", async () => {
    await pglite.exec("ALTER TABLE compliance.submissions ADD CONSTRAINT u40_refuse_bridge_proposals CHECK (coalesce(selected_chain->>'source', '') <> 'scheduler_bridge')")
    try {
      await addSchedule("s-store-fails", { fn: "create_boq", params: { projectId: "p", title: MARKER }, next: "2020-01-01T00:00:00Z" })
      await addSchedule("s-after", { next: "2020-01-02T00:00:00Z" })
      const { body, text } = await run()

      expect(body.results).toEqual([
        { scheduleId: "s-store-fails", outcome: "failed" },
        { scheduleId: "s-after", outcome: "read_ok" },
      ])
      expect(body).toMatchObject({ claimed: 2, failed: 1, readsRun: 1, proposed: 0, alreadyPending: 0 })
      expect(await submissions()).toEqual([])

      const row = await schedule("s-store-fails")
      expect(row.last_result).toEqual({ trigger: "scheduler_bridge", ranAt: body.ranAt, outcome: "failed", functionId: "create_boq", failureCode: "INTERNAL_ERROR" })
      expect(row.next_run_at.getTime()).toBeGreaterThan(new Date(body.ranAt).getTime())
      expect(row.is_active).toBe(true)

      const rows = await audits("s-store-fails")
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ action: "pipeline_schedule.run", entity_type: "pipeline_schedule", user_id: OWNER.id, api_key_id: null, actor_name: OWNER.name, actor_role: "manager", org_id: ORG_A, surface: "s1_one_page_ai_prepared" })
      expect(JSON.parse(rows[0].details!)).toEqual({ trigger: "scheduler_bridge", scheduleId: "s-store-fails", functionId: "create_boq", outcome: "failed", failureCode: "INTERNAL_ERROR" })
      // Neither the database's error text nor the parameters reach the response, the audit row or last_result.
      for (const seen of [text, rows[0].details!, JSON.stringify(row.last_result)]) {
        expect(seen).not.toContain(MARKER)
        expect(seen).not.toContain("u40_refuse_bridge_proposals")
      }
      // Two claimed runs, two audit rows in all.
      expect(await audits()).toHaveLength(2)
    } finally {
      await pglite.exec("ALTER TABLE compliance.submissions DROP CONSTRAINT u40_refuse_bridge_proposals")
    }
  })

  // The owner read is the other step that can throw before any audit row exists. The owner is then not known, so the row names no
  // person (it goes out as the bridge's own) and says why. The read is made to fail by taking the users table away for one run.
  test("an owner row that cannot be read at all is a failed run with one audit row that names no person and says why", async () => {
    await addSchedule("s-lookup")
    await pglite.exec("ALTER TABLE compliance.users RENAME TO users_offline")
    try {
      const { body } = await run()
      expect(body).toMatchObject({ claimed: 1, failed: 1, readsRun: 0 })
      expect(execCalls).toEqual([])
      expect((await schedule("s-lookup")).last_result).toEqual({ trigger: "scheduler_bridge", ranAt: body.ranAt, outcome: "failed", functionId: "get_construction_project_dashboard", failureCode: "INTERNAL_ERROR", reason: "owner_lookup_failed" })
      const rows = await audits("s-lookup")
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ action: "pipeline_schedule.run", user_id: null, api_key_id: null, actor_name: "Scheduler bridge", actor_role: "system", org_id: ORG_A, surface: "s1_one_page_ai_prepared" })
      expect(JSON.parse(rows[0].details!)).toMatchObject({ trigger: "scheduler_bridge", outcome: "failed", failureCode: "INTERNAL_ERROR", reason: "owner_lookup_failed" })
    } finally {
      await pglite.exec("ALTER TABLE compliance.users_offline RENAME TO users")
    }
  })

  test("a function id the registry does not know fails without calling the pipeline", async () => {
    await addSchedule("s-unknown", { fn: "no_such_function" })
    const { body } = await run()
    expect(body.failed).toBe(1)
    expect(execCalls).toEqual([])
    expect((await schedule("s-unknown")).last_result).toMatchObject({ outcome: "failed", failureCode: "FUNCTION_NOT_AVAILABLE" })
    expect(await submissions()).toEqual([])
  })

  test("a cadence that cannot be read deactivates the schedule instead of running it", async () => {
    await addSchedule("s-badcron", { cadence: "61 * * * *" })
    const { body } = await run()
    expect(body).toMatchObject({ claimed: 1, skipped: 1 })
    expect(execCalls).toEqual([])
    expect(await schedule("s-badcron")).toMatchObject({ is_active: false, last_result: { outcome: "invalid_cadence", reason: "cadence_not_readable" } })
    expect((await audits("s-badcron"))[0]).toMatchObject({ action: "pipeline_schedule.deactivated", user_id: OWNER.id, api_key_id: null })
  })
})

// ─── batch and budget ──────────────────────────────────────────────────────
describe("a run is bounded", () => {
  test("at most 10 schedules per run, oldest first; the rest wait for the next tick", async () => {
    for (let i = 1; i <= 12; i++) {
      await addSchedule(`s-${String(i).padStart(2, "0")}`, { params: { projectId: `p-${i}` }, next: `2020-01-${String(i).padStart(2, "0")}T00:00:00Z` })
    }
    const first = await run()
    expect(first.body).toMatchObject({ checked: 10, claimed: 10, readsRun: 10 })
    expect(execCalls.map((t) => t.projectId)).toEqual(Array.from({ length: 10 }, (_, i) => `p-${i + 1}`))
    const second = await run()
    expect(second.body).toMatchObject({ checked: 2, claimed: 2 })
    expect(execCalls.map((t) => t.projectId).slice(10)).toEqual(["p-11", "p-12"])
    expect(await audits()).toHaveLength(12)
  })

  test("a run that is out of time starts no new schedule and leaves them all due", async () => {
    await addSchedule("s-1")
    await addSchedule("s-2", { next: "2020-01-02T00:00:00Z" })
    const summary = await runDueSchedules({ timeBudgetMs: -1 })
    expect(summary).toMatchObject({ checked: 2, claimed: 0, deferred: 2, results: [] })
    expect(execCalls).toEqual([])
    expect((await schedule("s-1")).last_run_at).toBeNull()
    expect((await run()).body.claimed).toBe(2)
  })

  test("a requested batch size is clamped to 1..50", async () => {
    for (let i = 1; i <= 55; i++) await addSchedule(`c-${String(i).padStart(2, "0")}`, { next: `2020-02-${String(Math.min(i, 28)).padStart(2, "0")}T00:00:${String(i % 60).padStart(2, "0")}Z` })
    expect((await runDueSchedules({ batchSize: 1000 })).claimed).toBe(50)
    expect((await runDueSchedules({ batchSize: 0 })).claimed).toBe(1)
    expect((await runDueSchedules({ batchSize: -5 })).claimed).toBe(1)
    expect((await runDueSchedules({ batchSize: 1000 })).claimed).toBe(3)
  })
})

// ─── whole-run properties ──────────────────────────────────────────────────
describe("across a mixed run", () => {
  test("every claimed run has exactly one audit row naming its owner, never an API key, on surface s1 with trigger scheduler_bridge", async () => {
    await addSchedule("m-read", { next: "2020-01-01T00:00:00Z" })
    await addSchedule("m-write", { fn: "create_boq", params: { projectId: "p", title: "t" }, next: "2020-01-02T00:00:00Z" })
    await addSchedule("m-fail", { params: { projectId: "fail" }, next: "2020-01-03T00:00:00Z" })
    await addSchedule("m-left", { owner: MEMBER.id, next: "2020-01-04T00:00:00Z" })
    await addSchedule("m-b", { org: ORG_B, owner: OWNER_B.id, next: "2020-01-05T00:00:00Z" })
    execBehaviour = async (task) => (task.params.projectId === "fail" ? { success: false as const, failure: pipelineFailure("RECORD_NOT_FOUND") } : { success: true as const, result: null })
    await pglite.query("UPDATE compliance.users SET is_active = false WHERE id = $1", [MEMBER.id])

    const { body } = await run()
    expect(body.results.map((r) => r.outcome)).toEqual(["read_ok", "proposed", "failed", "owner_not_active", "read_ok"])

    const rows = await audits()
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.entity_id).sort()).toEqual(["m-b", "m-fail", "m-left", "m-read", "m-write"])
    for (const r of rows) {
      expect(r.api_key_id).toBeNull()
      expect(r.user_id).not.toBeNull()
      expect(r.actor_role).not.toBe("api_key")
      expect(r.surface).toBe("s1_one_page_ai_prepared")
      expect(JSON.parse(r.details!).trigger).toBe("scheduler_bridge")
    }
    expect(rows.find((r) => r.entity_id === "m-b")).toMatchObject({ user_id: OWNER_B.id, org_id: ORG_B, actor_role: "admin" })
    // The executor saw only owners, never the key id the test kept in scope as a decoy.
    for (const t of execCalls) expect([OWNER.id, OWNER_B.id]).toContain(t.userId)
    expect(JSON.stringify(execCalls)).not.toContain(API_KEY_ID)
    expect(JSON.stringify(rows)).not.toContain(API_KEY_ID)
  })
})
