/// <reference types="bun-types" />
// projexa-sync push against the REAL push ledger (drizzle/0681 on PGlite) for the two most dangerous branches no test reached before (review D1
// tests-quality:F05 a/b) and the transient-code resend (SYNC-04 / tests-quality:F02 "resend calls the pipeline again"):
//   (a) the write succeeded but projexa_sync_push_finish failed: EXECUTION_UNCERTAIN, the ledger stays `running`, a resend is IN_PROGRESS then
//       EXECUTION_UNCERTAIN after 10 minutes, and the pipeline is NEVER called a second time; a later op on the record in that batch is held
//   (b) begin fails for the 2nd op of a batch after the 1st applied: the answer keeps op 1 `applied` (not a bare 503), and a resend of both with a
//       healthy database answers [duplicate, applied] with the pipeline called once per op in total
//   BACKEND_UNAVAILABLE / UPSTREAM_TIMEOUT: ledger `failed`, and a resend of the SAME op id runs the pipeline again
// Run: bun test --isolate src/lib/services/projexa-sync-edge-push-ledger.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type ExecOutcome, type ExecRunBody, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { forwardSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(180_000)

const SUB = "11111111-1111-4111-8111-111111111111" // u-mgr of the user-link fixture
const NOW = new Date("2026-10-02T00:00:00Z")
const FN = "update_task"
const DEVICE = "laptop-test-0002"

let db: PGlite
let realRpc: Rpc
let calls: ExecRunBody[] = []
let script: Record<string, ExecOutcome> = {}

const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

async function stand(body: ExecRunBody): Promise<ExecOutcome> {
  calls.push(body)
  if (script[body.op_id]) return script[body.op_id]
  const id = String(body.params.taskId)
  await db.exec(`update compliance.pms_issues set title = 'pushed ${body.op_id}' where id = '${id}'`)
  return { kind: "done", record: { id, route: `/schedule/${id}` }, submission_id: null }
}

async function push(ops: unknown[], rpc: Rpc = realRpc) {
  const req = new Request("https://x.supabase.co/functions/v1/projexa-sync/push", { method: "POST", headers: { authorization: `Bearer tok:${SUB}` }, body: JSON.stringify({ device_id: DEVICE, ops }) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW, execRun: stand, log: () => {} })
  return { status: res.status, results: ((await res.json()) as J).results as J[] }
}
const op = (id: string, task: string) => ({ op_id: id, function_id: FN, project_id: "proj-a", params: { taskId: task, title: `by ${id}` } })
const ledger = async (opId: string) => (await db.query<J>(`select status, error_code from platform.projexa_sync_op where op_id = '${opId}'`)).rows[0]
const ranFor = (opId: string) => calls.filter((c) => c.op_id === opId).length

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
  await db.exec(forwardSql("0679_projexa_record_versions"))
  await db.exec(forwardSql("0681_projexa_sync_push"))
  realRpc = pgRpc(db)
  await db.exec(
    insert("pms_issues", [
      { id: "l1", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 11, title: "One", updated_at: "2026-09-01T10:00:00Z" },
      { id: "l2", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 12, title: "Two", updated_at: "2026-09-01T10:00:00Z" },
      { id: "l3", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 13, title: "Three", updated_at: "2026-09-01T10:00:00Z" },
    ]),
  )
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("(a) the write landed but its ledger row could not be closed", () => {
  test("EXECUTION_UNCERTAIN, ledger running, never re-run; IN_PROGRESS, then EXECUTION_UNCERTAIN after 10 minutes; a later op on the record is held", async () => {
    calls = []
    const failFinish: Rpc = async (fn, args) => (fn === "projexa_sync_push_finish" ? { data: null, error: { message: "statement timeout", code: "57014" } } : realRpc(fn, args))
    const head = Number((await db.query<{ version: unknown }>(`select version from platform.projexa_record_head where kind = 'tasks' and record_id = 'l1'`)).rows[0]?.version ?? 0)
    const rec = { record: { kind: "tasks", id: "l1", base_version: head } }
    const r = await push([{ ...op("op-led-a0001", "l1"), ...rec }, { ...op("op-led-a0002", "l1"), ...rec }], failFinish)
    expect(r.results[0]).toMatchObject({ status: "failed", uncertain: true, error: { code: "EXECUTION_UNCERTAIN" } })
    expect(r.results[1]).toMatchObject({ status: "failed", error: { code: "PREVIOUS_OP_BLOCKED" } })
    expect(await ledger("op-led-a0001")).toMatchObject({ status: "running" })
    expect(ranFor("op-led-a0001")).toBe(1)

    // the SAME op (same content) resent: the ledger answers, the pipeline is not called
    const same = { ...op("op-led-a0001", "l1"), ...rec }
    expect((await push([same])).results[0]).toMatchObject({ status: "failed", error: { code: "IN_PROGRESS" } })
    await db.exec(`update platform.projexa_sync_op set created_at = clock_timestamp() - interval '11 minutes' where op_id = 'op-led-a0001'`)
    expect((await push([same])).results[0]).toMatchObject({ status: "failed", uncertain: true, error: { code: "EXECUTION_UNCERTAIN" } })
    expect(await ledger("op-led-a0001")).toMatchObject({ status: "uncertain" })
    expect(ranFor("op-led-a0001")).toBe(1)
  })
})

describe("(b) the database fails halfway through a batch", () => {
  test("op 1 keeps `applied`; resend gives [duplicate, applied]; the pipeline ran once per op in total", async () => {
    calls = []
    let begins = 0
    const secondBeginThrows: Rpc = async (fn, args) => {
      if (fn === "projexa_sync_push_begin" && ++begins === 2) throw new Error("connect ECONNREFUSED 10.0.0.5:6543")
      return realRpc(fn, args)
    }
    const first = await push([op("op-led-b0001", "l2"), op("op-led-b0002", "l3")], secondBeginThrows)
    expect(first.status).toBe(200)
    expect(first.results.map((x) => x.status)).toEqual(["applied", "failed"])
    expect(first.results[1].error).toMatchObject({ code: "SERVICE_UNAVAILABLE" })
    expect(JSON.stringify(first.results)).not.toContain("10.0.0.5")
    expect(await ledger("op-led-b0001")).toMatchObject({ status: "applied" })
    expect(await ledger("op-led-b0002")).toBeUndefined()

    const again = await push([op("op-led-b0001", "l2"), op("op-led-b0002", "l3")])
    expect(again.results.map((x) => x.status)).toEqual(["duplicate", "applied"])
    expect(ranFor("op-led-b0001")).toBe(1)
    expect(ranFor("op-led-b0002")).toBe(1)
  })
})

describe("the pipeline's transient codes may run again (SYNC-04)", () => {
  for (const code of ["BACKEND_UNAVAILABLE", "UPSTREAM_TIMEOUT"]) {
    test(`${code}: ledger failed, resend of the same op id calls the pipeline again and applies`, async () => {
      calls = []
      const id = `op-led-${code.slice(0, 4).toLowerCase()}1`
      script[id] = { kind: "failed", code, missing: [] }
      expect((await push([op(id, "l3")])).results[0]).toMatchObject({ status: "failed", error: { code } })
      expect(await ledger(id)).toMatchObject({ status: "failed", error_code: code })
      delete script[id]
      expect((await push([op(id, "l3")])).results[0]).toMatchObject({ status: "applied" })
      expect(ranFor(id)).toBe(2)
    })
  }

  test("a business refusal (VALUE_REQUIRED) is terminal: a resend is answered from the ledger, the pipeline is not called again", async () => {
    calls = []
    script["op-led-biz01"] = { kind: "failed", code: "VALUE_REQUIRED", missing: ["title"] }
    expect((await push([op("op-led-biz01", "l3")])).results[0]).toMatchObject({ status: "rejected" })
    delete script["op-led-biz01"]
    expect((await push([op("op-led-biz01", "l3")])).results[0]).toMatchObject({ status: "rejected", error: { code: "VALUE_REQUIRED" } })
    expect(ranFor("op-led-biz01")).toBe(1)
  })
})
