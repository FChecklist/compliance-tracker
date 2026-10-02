/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST SYNC, PUSH SIDE: drizzle/0681_projexa_sync_push.sql on PGlite (real Postgres as WASM; the AI work link registry of 113 functions, the people and projects of the
// user-link fixture, 0618 gateway, 0677 to 0679 sync) and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts). The pipeline that does the WRITE is replaced by a scripted
// stand-in (`execRun`): what is under test here is every decision made BEFORE and AFTER a write -- the real pipeline run is in ai-work-link-sync-run.test.ts.
//   * gate:        only a REGISTERED WRITE runs; a read function, an unknown one, a role below its rank, a project the person may not read, a malformed op never reach the pipeline
//   * ledger:      the same op never has two effects (duplicate answers from the ledger, the pipeline is not called again); the same op id with other content is refused
//   * conflict:    an edit made on an older version of a record is NOT written; the server's current signed row comes back; after the person resolves, the resend runs
//   * outcomes:    permanent refusals are `rejected`, transient ones are `failed` and may re-run, an op that cannot run on the edge is `needs_server`, a lost answer is `EXECUTION_UNCERTAIN`
//                  and is never blindly re-run
//   * order:       a record whose earlier op did not apply holds its later ops (they are not run), other records go on
//   * limits:      600 ops an hour, 5 create_project a day
//   * versions:    an applied op reports the record's NEW version (from the change tracking of 0679) and the signed row at that version
// Run: bun test --isolate src/lib/services/projexa-sync-push.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type ExecOutcome, type ExecRunBody, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
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
  "u-view": "66666666-6666-4666-8666-666666666666",
  "u-b": "44444444-4444-4444-8444-444444444444",
}
const NOW = new Date("2026-10-02T00:00:00Z")
const FN = "update_task" // a registered level-1 write, min role rank 2
const DEVICE = "laptop-test-0001"

let db: PGlite
let rpc: Rpc
let key: KeyRecord
let signing: Signing
let calls: ExecRunBody[] = []
/** What the stand-in pipeline answers per op id; the default is "done, and the task's title was really changed" (so change tracking runs, as it does for a real write). */
let script: Record<string, ExecOutcome | "throw"> = {}

const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

async function stand(body: ExecRunBody): Promise<ExecOutcome> {
  calls.push(body)
  const s = script[body.op_id]
  if (s === "throw") throw new Error("network")
  if (s) return s
  const id = (body.params.taskId as string) ?? "t1"
  await db.exec(`update compliance.pms_issues set title = 'pushed ${body.op_id}' where id = '${id}'`)
  return { kind: "done", record: { id, route: `/schedule/${id}` }, submission_id: `sub-${body.op_id}` }
}

async function push(user: string, ops: unknown[], o: { device?: string | null; exec?: boolean } = {}) {
  const body = { device_id: o.device === null ? undefined : (o.device ?? DEVICE), ops }
  const req = new Request("https://x.supabase.co/functions/v1/projexa-sync/push", { method: "POST", headers: { authorization: `Bearer tok:${SUBS[user] ?? user}` }, body: JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW, signing: async () => signing, execRun: o.exec === false ? undefined : stand })
  return { status: res.status, json: (await res.json()) as J }
}
const op = (id: string, extra: Record<string, unknown> = {}) => ({ op_id: id, function_id: FN, project_id: "proj-a", params: { taskId: "t1", title: `by ${id}` }, ...extra })
const rec = (version: number, id = "t1", kind = "tasks") => ({ record: { kind, id, base_version: version } })
const head = async (id: string) => Number((await db.query<{ version: unknown }>(`select version from platform.projexa_record_head where kind = 'tasks' and record_id = '${id}'`)).rows[0]?.version ?? 0)
const ledger = async (opId: string) => (await db.query<J>(`select status, error_code, applied_version, base_version from platform.projexa_sync_op where op_id = '${opId}'`)).rows[0]
const only = (r: { json: J }) => (r.json.results as J[])[0]

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
  await db.exec(forwardSql("0679_projexa_record_versions"))
  await db.exec(forwardSql("0681_projexa_sync_push"))
  rpc = pgRpc(db)
  key = await generateKeyRecord()
  await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk })
  signing = await createSigning(key)
  const reg = (await db.query<J>(`select kind, link_level, min_role_rank from platform.ai_work_link_functions where function_id = '${FN}'`)).rows[0]
  expect(reg).toMatchObject({ kind: "write" })
  await db.exec(
    insert("pms_issues", [
      { id: "t1", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 1, title: "Pour slab", updated_at: "2026-09-01T10:00:00Z" },
      { id: "t2", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 2, title: "Paint wall", updated_at: "2026-09-01T10:00:00Z" },
      { id: "tp", org_id: "org-a", project_id: "proj-priv", type_id: "ty", status_id: "st", number: 1, title: "Private", updated_at: "2026-09-01T10:00:00Z" },
    ]),
  )
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("the gate: what may reach the pipeline at all", () => {
  test("a registered write by a person with the rank runs, as that person, with their LIVE role", async () => {
    calls = []
    const r = await push("u-mgr", [op("op-gate-0001", rec(await head("t1")))])
    expect(only(r)).toMatchObject({ op_id: "op-gate-0001", status: "applied", record_id: "t1" })
    expect(calls).toHaveLength(1)
    expect(calls[0].ctx).toEqual({ org_id: "org-a", user_id: "u-mgr", project_id: "proj-a", live_role: "manager", live_rank: 3, device_id: DEVICE } as never)
    expect(calls[0].function_id).toBe(FN)
  })

  test("a function that is not a registered write, a read function and an unknown one never run", async () => {
    calls = []
    const read = (await db.query<J>(`select function_id from platform.ai_work_link_functions where kind = 'read' limit 1`)).rows[0].function_id as string
    const excluded = (await db.query<J>(`select function_id from platform.ai_work_link_functions where link_level is null limit 1`)).rows[0]?.function_id as string | undefined
    const asks = [{ ...op("op-gate-0002"), function_id: read }, { ...op("op-gate-0003"), function_id: "no_such_function" }, ...(excluded ? [{ ...op("op-gate-0004"), function_id: excluded }] : [])]
    const r = await push("u-mgr", asks)
    for (const x of r.json.results as J[]) expect(x).toMatchObject({ status: "rejected", error: { code: "FUNCTION_NOT_ALLOWED" } })
    expect(calls).toHaveLength(0)
  })

  test("a role below the function's rank is refused ROLE_TOO_LOW", async () => {
    calls = []
    const r = await push("u-view", [op("op-gate-0005")])
    expect(only(r)).toMatchObject({ status: "rejected", error: { code: "ROLE_TOO_LOW" } })
    expect(calls).toHaveLength(0)
  })

  test("a project of another organisation, and a private one the person may not read, are PROJECT_NOT_READABLE", async () => {
    calls = []
    const r = await push("u-b", [op("op-gate-0006")]) // org B's person, org A's project
    expect(only(r)).toMatchObject({ status: "rejected", error: { code: "PROJECT_NOT_READABLE" } })
    const r2 = await push("u-mem", [{ ...op("op-gate-0007"), project_id: "proj-priv", params: { taskId: "tp", title: "x" } }])
    expect(only(r2)).toMatchObject({ status: "rejected", error: { code: "PROJECT_NOT_READABLE" } })
    expect(calls).toHaveLength(0)
  })

  test("malformed ops are BAD_OP without touching the pipeline; one bad op does not fail the batch", async () => {
    calls = []
    const r = await push("u-mgr", [
      { function_id: FN, project_id: "proj-a", params: {} }, // no op id
      { ...op("op-gate-0008"), params: [1, 2] },
      { ...op("op-gate-0009"), project_id: null },
      { ...op("op-gate-0010"), op_id: "x" },
      { ...op("op-gate-0011"), record: { kind: "nonsense", id: "t1", base_version: 1 } },
      { ...op("op-gate-0012"), record: { kind: "tasks", id: "t1", base_version: -1 } },
      "not an object",
      op("op-gate-0013"),
    ])
    const rs = r.json.results as J[]
    expect(rs.slice(0, 7).map((x) => [x.status, x.error?.code])).toEqual(Array(7).fill(["rejected", "BAD_OP"]))
    expect(rs[7].status).toBe("applied")
    expect(calls).toHaveLength(1)
  })

  test("body validation: device, ops, size, session, linked person, pipeline available", async () => {
    expect((await push("u-mgr", [op("op-val-00001")], { device: null })).status).toBe(400)
    expect((await push("u-mgr", [op("op-val-00002")], { device: "x" })).status).toBe(400)
    expect((await push("u-mgr", [])).status).toBe(400)
    expect((await push("u-mgr", Array.from({ length: 51 }, (_, i) => op(`op-val-big-${i}`)))).status).toBe(400)
    expect((await push("99999999-9999-4999-8999-999999999999", [op("op-val-00003")])).status).toBe(403)
    expect((await push("u-mgr", [op("op-val-00004")], { exec: false })).status).toBe(503)
    const noAuth = await handleSync(new Request("https://x/functions/v1/projexa-sync/push", { method: "POST", body: "{}" }), { rpc, session })
    expect(noAuth.status).toBe(401)
    const get = await handleSync(new Request("https://x/functions/v1/projexa-sync/push", { method: "GET", headers: { authorization: `Bearer tok:${SUBS["u-mgr"]}` } }), { rpc, session })
    expect(get.status).toBe(405)
  })
})

describe("applied: the new version and the signed row", () => {
  test("an applied op reports the record's new version and the signed row at that version", async () => {
    const before = await head("t2")
    const r = await push("u-mgr", [op("op-app-00001", { params: { taskId: "t2", title: "x" }, ...rec(before, "t2") })])
    const x = only(r)
    expect(x.status).toBe("applied")
    expect(x.version).toBe(before + 1)
    expect(await head("t2")).toBe(before + 1)
    expect(x.server.version).toBe(before + 1)
    expect(x.server.data.title).toContain("pushed op-app-00001")
    const msg = itemMessage({ org: "org-a", project: "proj-a", kind: "tasks", id: "t2", version: x.server.version, updatedAt: x.server.updated_at, dataHash: await sha256Hex(canonicalize(x.server.data)) })
    expect(await verifyMessage(await importPublic(key.public_jwk), msg, x.server.sig)).toBe(true)
    expect(await ledger("op-app-00001")).toMatchObject({ status: "applied" })
    expect(Number((await ledger("op-app-00001")).applied_version)).toBe(before + 1)
  })

  test("a create names the kind it made through record_kind and gets that record's version", async () => {
    script["op-app-00002"] = { kind: "done", record: { id: "t1", route: "/schedule/t1" }, submission_id: "s" }
    const r = await push("u-mgr", [{ ...op("op-app-00002"), record_kind: "tasks" }])
    expect(only(r)).toMatchObject({ status: "applied", record_id: "t1", route: "/schedule/t1" })
    expect(only(r).version).toBeGreaterThanOrEqual(1)
  })
})

describe("the ledger: one effect per op", () => {
  test("the same op sent again is a duplicate answered from the ledger; the pipeline is not called again", async () => {
    calls = []
    const o = op("op-led-00001", rec(await head("t1")))
    const first = only(await push("u-mgr", [o]))
    expect(first.status).toBe("applied")
    const n = calls.length
    const second = only(await push("u-mgr", [o]))
    expect(second).toMatchObject({ status: "duplicate", record_id: first.record_id, version: first.version })
    expect(calls).toHaveLength(n)
  })

  test("the same op id with other content is refused OP_ID_REUSED", async () => {
    const a = only(await push("u-mgr", [op("op-led-00002")]))
    expect(a.status).toBe("applied")
    const b = only(await push("u-mgr", [{ ...op("op-led-00002"), params: { taskId: "t1", title: "different" } }]))
    expect(b).toMatchObject({ status: "rejected", error: { code: "OP_ID_REUSED" } })
  })

  test("two people may use the same op id: the ledger is per person", async () => {
    calls = []
    const a = only(await push("u-mgr", [op("op-led-shared")]))
    const b = only(await push("u-mem", [op("op-led-shared")]))
    expect(a.status).toBe("applied")
    expect(b.status).toBe("applied")
    expect(calls.filter((c) => c.op_id === "op-led-shared").map((c) => c.ctx.user_id).sort()).toEqual(["u-mem", "u-mgr"])
  })

  test("a rejected op replays as rejected with its code", async () => {
    script["op-led-00003"] = { kind: "failed", code: "VALIDATION_FAILED", missing: ["title"] }
    const o = op("op-led-00003")
    expect(only(await push("u-mgr", [o]))).toMatchObject({ status: "rejected", error: { code: "VALIDATION_FAILED", missing: ["title"] } })
    expect(only(await push("u-mgr", [o]))).toMatchObject({ status: "rejected", error: { code: "VALIDATION_FAILED" } })
  })
})

describe("conflict: an edit made on an older version is not written", () => {
  test("nothing is written; the current signed row comes back; the resend with the new base version runs", async () => {
    // someone else changed t1 after the laptop read it
    const mine = await head("t1")
    await db.exec(`update compliance.pms_issues set title = 'Changed by someone else' where id = 't1'`)
    const current = await head("t1")
    expect(current).toBe(mine + 1)
    calls = []
    const stale = only(await push("u-mgr", [op("op-con-00001", rec(mine))]))
    expect(stale.status).toBe("conflict")
    expect(stale).toMatchObject({ version: current, base_version: mine })
    expect(stale.server.data.title).toBe("Changed by someone else")
    expect(stale.server.version).toBe(current)
    expect(calls).toHaveLength(0)
    expect(await ledger("op-con-00001")).toBeUndefined()
    // the person chose "keep mine": resend with the server's version
    const again = only(await push("u-mgr", [op("op-con-00001", rec(current))]))
    expect(again).toMatchObject({ status: "applied", version: current + 1 })
    expect(calls).toHaveLength(1)
  })

  test("a record that was deleted on the server is a conflict with no server row", async () => {
    await db.exec(insert("pms_issues", [{ id: "t-del", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 8, title: "Gone soon", updated_at: "2026-09-01T10:00:00Z" }]))
    const v = await head("t-del")
    await db.exec(`delete from compliance.pms_issues where id = 't-del'`)
    const r = only(await push("u-mgr", [op("op-con-00002", { params: { taskId: "t-del", title: "x" }, ...rec(v, "t-del") })]))
    expect(r.status).toBe("conflict")
    expect(r.server).toBeNull()
  })
})

describe("outcomes of a run", () => {
  test("permanent refusal -> rejected; transient -> failed and may re-run with the same op id; not on the edge -> needs_server", async () => {
    script["op-out-00001"] = { kind: "failed", code: "TEXT_TOO_LONG", missing: [] }
    expect(only(await push("u-mgr", [op("op-out-00001")]))).toMatchObject({ status: "rejected", error: { code: "TEXT_TOO_LONG" } })

    script["op-out-00002"] = { kind: "failed", code: "INTERNAL_ERROR", missing: [] }
    expect(only(await push("u-mgr", [op("op-out-00002")]))).toMatchObject({ status: "failed", error: { code: "INTERNAL_ERROR" } })
    expect(await ledger("op-out-00002")).toMatchObject({ status: "failed" })
    delete script["op-out-00002"] // the next attempt works: the SAME op id runs again, nothing was written the first time
    calls = []
    expect(only(await push("u-mgr", [op("op-out-00002")]))).toMatchObject({ status: "applied" })
    expect(calls).toHaveLength(1)

    script["op-out-00003"] = { kind: "failed", code: "FUNCTION_NOT_AVAILABLE", missing: [] }
    expect(only(await push("u-mgr", [op("op-out-00003")]))).toMatchObject({ status: "needs_server", error: { code: "FUNCTION_NOT_AVAILABLE" } })
    expect(await ledger("op-out-00003")).toMatchObject({ status: "needs_server" })
  })

  test("the pipeline unavailable is a retryable failure; nothing ran", async () => {
    script["op-out-00004"] = { kind: "unavailable" }
    expect(only(await push("u-mgr", [op("op-out-00004")]))).toMatchObject({ status: "failed", error: { code: "SYNC_NOT_AVAILABLE" } })
    delete script["op-out-00004"]
    expect(only(await push("u-mgr", [op("op-out-00004")])).status).toBe("applied")
  })

  test("a lost answer is EXECUTION_UNCERTAIN, and the same op is NEVER blindly re-run", async () => {
    for (const s of [{ kind: "uncertain" } as ExecOutcome, "throw" as const]) {
      const id = s === "throw" ? "op-out-00006" : "op-out-00005"
      script[id] = s
      calls = []
      expect(only(await push("u-mgr", [op(id)]))).toMatchObject({ status: "failed", error: { code: "EXECUTION_UNCERTAIN" } })
      expect(await ledger(id)).toMatchObject({ status: "uncertain" })
      delete script[id]
      expect(only(await push("u-mgr", [op(id)]))).toMatchObject({ status: "failed", error: { code: "EXECUTION_UNCERTAIN" } })
      expect(calls).toHaveLength(1) // only the first attempt ever reached the pipeline
    }
  })

  test("a running op is IN_PROGRESS for 10 minutes, then it is uncertain", async () => {
    await db.exec(`insert into platform.projexa_sync_op (user_id, op_id, org_id, device_id, function_id, project_id, params_hash, status)
                   values ('u-mgr', 'op-out-00007', 'org-a', '${DEVICE}', '${FN}', 'proj-a', 'h', 'running')`)
    // the hash differs, so first prove the content check, then use the real hash by letting the handler create the row
    expect(only(await push("u-mgr", [op("op-out-00007")]))).toMatchObject({ status: "rejected", error: { code: "OP_ID_REUSED" } })
    await db.exec(`delete from platform.projexa_sync_op where op_id = 'op-out-00007'`)
    script["op-out-00008"] = "throw"
    await push("u-mgr", [op("op-out-00008")])
    await db.exec(`update platform.projexa_sync_op set status = 'running', error_code = null where op_id = 'op-out-00008'`)
    delete script["op-out-00008"]
    expect(only(await push("u-mgr", [op("op-out-00008")]))).toMatchObject({ status: "failed", error: { code: "IN_PROGRESS" } })
    await db.exec(`update platform.projexa_sync_op set created_at = clock_timestamp() - interval '11 minutes' where op_id = 'op-out-00008'`)
    expect(only(await push("u-mgr", [op("op-out-00008")]))).toMatchObject({ status: "failed", error: { code: "EXECUTION_UNCERTAIN" } })
    expect(await ledger("op-out-00008")).toMatchObject({ status: "uncertain" })
  })
})

describe("order inside a batch", () => {
  test("a record whose earlier op did not apply holds its later ops; another record goes on", async () => {
    script["op-ord-00001"] = { kind: "failed", code: "INTERNAL_ERROR", missing: [] }
    calls = []
    const r = await push("u-mgr", [
      op("op-ord-00001", { params: { taskId: "t1", title: "a" }, ...rec(await head("t1")) }),
      op("op-ord-00002", { params: { taskId: "t1", title: "b" }, ...rec(await head("t1")) }),
      op("op-ord-00003", { params: { taskId: "t2", title: "c" }, ...rec(await head("t2"), "t2") }),
    ])
    const rs = r.json.results as J[]
    expect(rs.map((x) => x.status)).toEqual(["failed", "failed", "applied"])
    expect(rs[1].error.code).toBe("PREVIOUS_OP_BLOCKED")
    expect(calls.map((c) => c.op_id)).toEqual(["op-ord-00001", "op-ord-00003"])
    expect(await ledger("op-ord-00002")).toBeUndefined()
  })

  test("a conflict holds the later ops on that record too", async () => {
    const stale = await head("t1")
    await db.exec(`update compliance.pms_issues set title = 'moved on again' where id = 't1'`)
    calls = []
    const r = await push("u-mgr", [op("op-ord-00004", rec(stale)), op("op-ord-00005", rec(stale))])
    expect((r.json.results as J[]).map((x) => x.status)).toEqual(["conflict", "failed"])
    expect(calls).toHaveLength(0)
  })
})

describe("limits", () => {
  test("600 ops an hour per person, then RATE_LIMITED (a retry, not a refusal)", async () => {
    await db.exec(`insert into platform.projexa_sync_op (user_id, op_id, org_id, device_id, function_id, project_id, params_hash, status)
                   select 'u-sen', 'op-rate-' || lpad(g::text, 6, '0'), 'org-a', '${DEVICE}', '${FN}', 'proj-a', 'h', 'applied' from generate_series(1, 600) g`)
    calls = []
    const r = only(await push("u-sen", [op("op-rate-new-1")]))
    expect(r).toMatchObject({ status: "failed", error: { code: "RATE_LIMITED" } })
    expect(calls).toHaveLength(0)
    // another person is not affected
    expect(only(await push("u-mgr", [op("op-rate-mgr-1")])).status).toBe("applied")
  })

  test("5 create_project a day, then CAP_DAY", async () => {
    await db.exec(`insert into platform.projexa_sync_op (user_id, op_id, org_id, device_id, function_id, project_id, params_hash, status)
                   select 'u-mem', 'op-proj-' || lpad(g::text, 4, '0'), 'org-a', '${DEVICE}', 'create_project', null, 'h', 'applied' from generate_series(1, 5) g`)
    const r = only(await push("u-mem", [{ op_id: "op-proj-new-1", function_id: "create_project", params: { name: "Sixth" } }]))
    expect(r).toMatchObject({ status: "rejected", error: { code: "CAP_DAY" } })
  })
})

describe("reversible", () => {
  test("the down file removes the ledger; the forward file applies twice", async () => {
    await db.exec(downSql("0681_projexa_sync_push"))
    expect((await db.query<J>(`select to_regclass('platform.projexa_sync_op')::text a, to_regproc('public.projexa_sync_push_begin')::text b`)).rows[0]).toEqual({ a: null, b: null })
    await db.exec(forwardSql("0681_projexa_sync_push"))
    await db.exec(forwardSql("0681_projexa_sync_push"))
    expect(only(await push("u-mgr", [op("op-rev-00001")])).status).toBe("applied")
  })
})
