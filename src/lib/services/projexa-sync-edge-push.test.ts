// projexa-sync Edge handler, POST /push decisions that need no database (review D1: SYNC-04 = tests-quality:F02, F-02, F-03, F-07, F-08, F05(c), F8).
// The rpc is a small in-memory stand-in for projexa_sync_push_begin/finish (a ledger keyed by op id, the same actions the SQL answers) so each branch can
// be forced; the real SQL ledger is exercised in projexa-sync-edge-push-ledger.pglite.test.ts and projexa-sync-push.pglite.test.ts.
import { describe, expect, test } from "bun:test"
import { PIPELINE_ERROR_CODES, RETRYABLE_ERROR_CODES } from "@/lib/pipeline/error-codes"
import {
  checkOp,
  classifyFailure,
  handleSync,
  PUSH_FAILURE_CLASS,
  PUSH_OP_MAX_BYTES,
  PUSH_START_CUTOFF_MS,
  RateLimiter,
  type ExecOutcome,
  type ExecRunBody,
  type Rpc,
  type SyncDeps,
} from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"

type J = Record<string, unknown>
const DEVICE = "device-0001"
const session: SessionVerifier = async (t) => (t.startsWith("tok:") ? { ok: true, sub: t.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

function world(o: { beginFail?: (opId: string, n: number) => "error500" | "error400" | "throw" | "unlinked" | "bad" | null; finishFail?: (opId: string) => boolean } = {}) {
  const ledger = new Map<string, { status: string; code?: string | null }>()
  const calls = { begin: 0, finish: [] as Array<{ op: string; status: string; code: string | null }>, pullIds: 0, manifest: 0 }
  const rpc: Rpc = async (fn, args = {}) => {
    if (fn === "projexa_sync_push_begin") {
      calls.begin++
      const op = args.p_op as J
      const opId = String(op.op_id)
      const f = o.beginFail?.(opId, calls.begin)
      if (f === "throw") throw new Error("connect ECONNREFUSED 10.0.0.5:6543")
      if (f === "error500") return { data: null, error: { message: "invalid byte sequence", code: "22P05" } }
      if (f === "error400") return { data: null, error: { message: "BAD", code: "AW400" } }
      if (f === "unlinked") return { data: { status: "not_linked" }, error: null }
      if (f === "bad") return { data: { status: "ok", action: "frobnicate" }, error: null }
      const had = ledger.get(opId)
      if (had?.status === "applied" || had?.status === "rejected") return { data: { status: "ok", action: "duplicate", stored_status: had.status, error_code: had.code ?? null, result: { id: "t1" } }, error: null }
      if (had?.status === "running") return { data: { status: "ok", action: "retry", code: "IN_PROGRESS" }, error: null }
      if (had?.status === "uncertain") return { data: { status: "ok", action: "retry", code: "EXECUTION_UNCERTAIN" }, error: null }
      ledger.set(opId, { status: "running" })
      return { data: { status: "ok", action: "run", ctx: { org_id: "org-a", user_id: "u1", project_id: op.project_id ?? null, live_role: "manager", device_id: DEVICE } }, error: null }
    }
    if (fn === "projexa_sync_push_finish") {
      const opId = String(args.p_op_id)
      calls.finish.push({ op: opId, status: String(args.p_status), code: (args.p_error_code as string | null) ?? null })
      if (o.finishFail?.(opId)) throw new Error("timeout")
      ledger.set(opId, { status: String(args.p_status), code: (args.p_error_code as string | null) ?? null })
      return { data: { status: "ok", version: 7 }, error: null }
    }
    if (fn === "projexa_sync_pull_ids") {
      calls.pullIds++
      return { data: { status: "ok", items: (args.p_ids as string[]).map((id) => ({ id, updated_at: "2026-10-01T00:00:00Z", version: 7, data: { id } })), money_visible: true }, error: null }
    }
    if (fn === "projexa_sync_manifest") {
      calls.manifest++
      return { data: { status: "ok", user: { id: "u1", org_id: "org-a" }, projects: [], kinds: [], view_class: "vc1" }, error: null }
    }
    return { data: null, error: { message: "unknown", code: "42883" } }
  }
  return { rpc, ledger, calls }
}

const op = (id: string, extra: J = {}) => ({ op_id: id, function_id: "update_task", project_id: "proj-a", params: { taskId: "t1", title: `by ${id}` }, ...extra })
const recOf = (id: string) => ({ record: { kind: "tasks", id, base_version: 0 } })

async function push(w: ReturnType<typeof world>, ops: unknown[], d: Partial<SyncDeps> = {}) {
  const req = new Request("https://x.supabase.co/functions/v1/projexa-sync/push", { method: "POST", headers: { authorization: "Bearer tok:u1" }, body: JSON.stringify({ device_id: DEVICE, ops }) })
  const res = await handleSync(req, { rpc: w.rpc, session, limiter: new RateLimiter(100000), now: () => new Date("2026-10-02T00:00:00Z"), log: () => {}, ...d })
  const json = (await res.json()) as J
  return { status: res.status, json, results: json.results as J[] }
}
const scripted = (m: Record<string, ExecOutcome | "throw">, seen: ExecRunBody[] = []) => async (b: ExecRunBody): Promise<ExecOutcome> => {
  seen.push(b)
  const s = m[b.op_id]
  if (s === "throw") throw new Error("network")
  return s ?? { kind: "done", record: { id: String(b.params.taskId ?? "t1"), route: "/x" }, submission_id: "s" }
}

describe("failure classes come from the codes the pipeline REALLY returns (SYNC-04, tests-quality:F02)", () => {
  test("every PIPELINE_ERROR_CODES member has a deliberate class here (a new pipeline code fails this test until it is classified)", () => {
    for (const code of PIPELINE_ERROR_CODES) expect([code, Object.prototype.hasOwnProperty.call(PUSH_FAILURE_CLASS, code)]).toEqual([code, true])
  })

  test("the pipeline's retryable codes are never terminal; FUNCTION_NOT_AVAILABLE is needs_server; business refusals are rejected; unknown is retryable", () => {
    for (const code of RETRYABLE_ERROR_CODES) expect(classifyFailure(code)).toBe("failed")
    expect(classifyFailure("BACKEND_UNAVAILABLE")).toBe("failed")
    expect(classifyFailure("UPSTREAM_TIMEOUT")).toBe("failed")
    expect(classifyFailure("INTERNAL_ERROR")).toBe("failed")
    expect(classifyFailure("FUNCTION_NOT_AVAILABLE")).toBe("needs_server")
    for (const code of ["VALUE_REQUIRED", "RECORD_NOT_FOUND", "ALREADY_RECORDED", "NOT_PERMITTED", "REQUEST_REJECTED", "TOTAL_MISMATCH", "BOQ_SEALED", "DUPLICATE_ITEM_CODE", "TEXT_TOO_LONG", "BAD_OP"]) expect([code, classifyFailure(code)]).toEqual([code, "rejected"])
    expect(classifyFailure("SOMETHING_NEW_FROM_A_SERVICE")).toBe("failed")
  })

  for (const code of ["BACKEND_UNAVAILABLE", "UPSTREAM_TIMEOUT"]) {
    test(`${code} from the pipeline: result failed, ledger failed, the record is held, and a resend RUNS AGAIN`, async () => {
      const w = world()
      const seen: ExecRunBody[] = []
      const m: Record<string, ExecOutcome> = { "op-tr-00001": { kind: "failed", code, missing: [] } }
      const r = await push(w, [op("op-tr-00001", recOf("t1")), op("op-tr-00002", recOf("t1"))], { execRun: scripted(m, seen) })
      expect(r.results[0]).toMatchObject({ status: "failed", error: { code } })
      expect(r.results[1]).toMatchObject({ status: "failed", error: { code: "PREVIOUS_OP_BLOCKED" } })
      expect(w.calls.finish).toEqual([{ op: "op-tr-00001", status: "failed", code }])
      delete m["op-tr-00001"]
      const again = await push(w, [op("op-tr-00001", recOf("t1"))], { execRun: scripted(m, seen) })
      expect(again.results[0]).toMatchObject({ status: "applied" })
      expect(seen.filter((b) => b.op_id === "op-tr-00001")).toHaveLength(2)
    })
  }

  test("a business code is rejected (terminal) and does not hold the record", async () => {
    const w = world()
    const r = await push(w, [op("op-bz-00001", recOf("t1")), op("op-bz-00002", recOf("t1"))], { execRun: scripted({ "op-bz-00001": { kind: "failed", code: "VALUE_REQUIRED", missing: ["title"] } }) })
    expect(r.results.map((x) => x.status)).toEqual(["rejected", "applied"])
    expect(w.calls.finish[0]).toMatchObject({ status: "rejected", code: "VALUE_REQUIRED" })
  })
})

describe("op checks at the edge, before any RPC (F-02, F-03, F-08)", () => {
  test("malformed ops cost no database call", async () => {
    const w = world()
    const r = await push(w, [{}, op("x"), { ...op("op-sh-00001"), params: [1] }, { ...op("op-sh-00002"), function_id: "bad id!" }, { ...op("op-sh-00003"), project_id: "" }, { ...op("op-sh-00004"), record: { kind: "nope", id: "t1", base_version: 0 } }], { execRun: scripted({}) })
    expect(r.results.every((x) => x.status === "rejected" && (x.error as J).code === "BAD_OP")).toBe(true)
    expect(w.calls.begin).toBe(0)
  })

  test("a 3-byte-script op over the byte cap is TOO_LARGE before begin (it would have passed the SQL's CHARACTER cap and been refused by exec forever)", async () => {
    const w = world()
    const note = "क".repeat(25_000) // 25,000 characters, 75,000 UTF-8 bytes: under 65,536 characters, over exec's 73,728 bytes
    const big = op("op-big-00001", { params: { taskId: "t1", note } })
    expect(JSON.stringify(big).length).toBeLessThan(65_536)
    const r = await push(w, [big], { execRun: scripted({}) })
    expect(r.results[0]).toMatchObject({ status: "rejected", error: { code: "TOO_LARGE" } })
    expect(w.calls.begin).toBe(0)
  })

  test("the largest op the edge accepts still fits the exec function's byte cap", () => {
    // 19,900 Devanagari characters = 59,700 bytes of note; the op as a whole is just under PUSH_OP_MAX_BYTES
    const ok = checkOp(op("op-fit-00001", { params: { taskId: "t1", note: "क".repeat(19_900) } }))
    expect(ok.ok).toBe(true)
    expect(PUSH_OP_MAX_BYTES + 2048).toBeLessThan(72 * 1024)
  })

  test("U+0000 and very deep nesting are BAD_OP (Postgres jsonb would fail begin for the whole batch)", async () => {
    const w = world()
    let deep: J = {}
    const root = deep
    for (let i = 0; i < 40; i++) deep = (deep.x = {}) as J
    const r = await push(w, [op("op-nul-00001", { params: { taskId: "t1", title: "a\u0000b" } }), op("op-deep-0001", { params: { taskId: "t1", deep: root } }), op("op-fine-0001")], { execRun: scripted({}) })
    expect(r.results.map((x) => [x.status, (x.error as J | undefined)?.code ?? null])).toEqual([["rejected", "BAD_OP"], ["rejected", "BAD_OP"], ["applied", null]])
    expect(w.calls.begin).toBe(1)
  })
})

describe("one bad op never fails the whole batch (F-08, tests-quality:F05 b/c)", () => {
  test("an SQL error on ONE op's begin is that op's answer; the batch goes on", async () => {
    const w = world({ beginFail: (id) => (id === "op-pe-00002" ? "error500" : id === "op-pe-00003" ? "error400" : null) })
    const r = await push(w, [op("op-pe-00001", recOf("t1")), op("op-pe-00002", recOf("t2")), op("op-pe-00003", recOf("t3")), op("op-pe-00004", recOf("t4"))], { execRun: scripted({}) })
    expect(r.status).toBe(200)
    expect(r.results.map((x) => [x.status, (x.error as J | undefined)?.code ?? null])).toEqual([["applied", null], ["failed", "BEGIN_FAILED"], ["rejected", "BAD_OP"], ["applied", null]])
  })

  test("three begin failures in a row stop the push: the rest are RETRY_LATER with no more calls", async () => {
    const w = world({ beginFail: () => "error500" })
    const r = await push(w, Array.from({ length: 10 }, (_, i) => op(`op-st-${String(i).padStart(5, "0")}`)), { execRun: scripted({}) })
    expect(w.calls.begin).toBe(3)
    expect(r.results.slice(3).every((x) => (x.error as J).code === "RETRY_LATER")).toBe(true)
  })

  test("the service goes down after an op ran: 200, the applied op keeps its answer, the rest are retryable", async () => {
    const w = world({ beginFail: (_id, n) => (n === 2 ? "throw" : null) })
    const r = await push(w, [op("op-dn-00001", recOf("t1")), op("op-dn-00002", recOf("t2")), op("op-dn-00003", recOf("t3"))], { execRun: scripted({}) })
    expect(r.status).toBe(200)
    expect(r.results.map((x) => [x.status, (x.error as J | undefined)?.code ?? null])).toEqual([["applied", null], ["failed", "SERVICE_UNAVAILABLE"], ["failed", "SERVICE_UNAVAILABLE"]])
    expect(w.ledger.get("op-dn-00001")?.status).toBe("applied")
  })

  test("down (or not linked) before anything ran: the whole push is refused as before", async () => {
    expect((await push(world({ beginFail: () => "throw" }), [op("op-dn-00009")], { execRun: scripted({}) })).status).toBe(503)
    expect((await push(world({ beginFail: () => "unlinked" }), [op("op-dn-00010")], { execRun: scripted({}) })).status).toBe(403)
  })

  test("an unknown begin action is BAD_ANSWER and holds the record", async () => {
    const w = world({ beginFail: (id) => (id === "op-ba-00001" ? "bad" : null) })
    const r = await push(w, [op("op-ba-00001", recOf("t1")), op("op-ba-00002", recOf("t1"))], { execRun: scripted({}) })
    expect(r.results.map((x) => (x.error as J | undefined)?.code)).toEqual(["BAD_ANSWER", "PREVIOUS_OP_BLOCKED"])
  })
})

describe("deadline and uncertainty (F-07)", () => {
  test("no new op starts after the cutoff: the rest are RETRY_LATER and never reach begin", async () => {
    const w = world()
    let t = 0
    const exec = async (b: ExecRunBody): Promise<ExecOutcome> => {
      t += PUSH_START_CUTOFF_MS / 2 + 1 // each op is slow
      return { kind: "done", record: { id: String(b.params.taskId), route: null }, submission_id: null }
    }
    const r = await push(w, [op("op-dl-00001", recOf("t1")), op("op-dl-00002", recOf("t2")), op("op-dl-00003", recOf("t3")), op("op-dl-00004", recOf("t4"))], { execRun: exec, clock: () => t })
    expect(r.results.map((x) => x.status)).toEqual(["applied", "applied", "failed", "failed"])
    expect(r.results.slice(2).map((x) => (x.error as J).code)).toEqual(["RETRY_LATER", "RETRY_LATER"])
    expect(w.calls.begin).toBe(2)
  })

  test("a lost answer and a lost finish are EXECUTION_UNCERTAIN, marked uncertain:true (status stays `failed` for older laptops)", async () => {
    const w = world({ finishFail: (id) => id === "op-un-00002" })
    const r = await push(w, [op("op-un-00001", recOf("t1")), op("op-un-00002", recOf("t2")), op("op-un-00003", recOf("t2"))], { execRun: scripted({ "op-un-00001": { kind: "uncertain" } }) })
    expect(r.results[0]).toMatchObject({ status: "failed", uncertain: true, error: { code: "EXECUTION_UNCERTAIN" } })
    expect(r.results[1]).toMatchObject({ status: "failed", uncertain: true, error: { code: "EXECUTION_UNCERTAIN" } })
    expect(r.results[2]).toMatchObject({ status: "failed", error: { code: "PREVIOUS_OP_BLOCKED" } })
    expect(w.ledger.get("op-un-00002")?.status).toBe("running")
  })
})

describe("cost of one push (F8 / F-02)", () => {
  test("batch mode: a push of 20 ops on different records is ONE exec call and ONE pull-by-ids for the signed rows", async () => {
    const w = world()
    let batches = 0
    const execRunBatch = async (bodies: ExecRunBody[]): Promise<ExecOutcome[]> => {
      batches++
      return bodies.map((b) => ({ kind: "done", record: { id: String(b.params.taskId), route: null }, submission_id: null }) as ExecOutcome)
    }
    const ops = Array.from({ length: 20 }, (_, i) => op(`op-co-${String(i).padStart(5, "0")}`, { params: { taskId: `t${i}`, title: "x" }, ...recOf(`t${i}`) }))
    const r = await push(w, ops, { execRunBatch, signing: undefined })
    expect(r.results.every((x) => x.status === "applied")).toBe(true)
    expect(batches).toBe(1)
    expect(w.calls.pullIds).toBe(1)
    expect((r.results[3].server as J).id).toBe("t3")
  })

  test("batch mode keeps the order on one record: a second op on the same record waits for the first one's outcome", async () => {
    const w = world()
    const sizes: number[] = []
    const execRunBatch = async (bodies: ExecRunBody[]): Promise<ExecOutcome[]> => {
      sizes.push(bodies.length)
      return bodies.map((b) => (b.op_id === "op-or-00001" ? ({ kind: "failed", code: "BACKEND_UNAVAILABLE", missing: [] } as ExecOutcome) : ({ kind: "done", record: { id: String(b.params.taskId), route: null }, submission_id: null } as ExecOutcome)))
    }
    const r = await push(w, [op("op-or-00001", recOf("t1")), op("op-or-00002", { params: { taskId: "t2" }, ...recOf("t2") }), op("op-or-00003", recOf("t1"))], { execRunBatch })
    expect(sizes).toEqual([2])
    expect(r.results.map((x) => (x.error as J | undefined)?.code ?? x.status)).toEqual(["BACKEND_UNAVAILABLE", "applied", "PREVIOUS_OP_BLOCKED"])
    expect(w.calls.begin).toBe(2)
  })

  test("a batch answer of the wrong length is uncertain for every op in it (never guessed by position)", async () => {
    const w = world()
    const r = await push(w, [op("op-wl-00001", recOf("t1")), op("op-wl-00002", recOf("t2"))], { execRunBatch: async () => [{ kind: "done", record: { id: "t1", route: null }, submission_id: null }] })
    expect(r.results.every((x) => x.uncertain === true)).toBe(true)
  })
})
