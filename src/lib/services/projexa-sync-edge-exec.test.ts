// The HTTP contract between the two halves of push (review D1 tests-quality:F06, F-03, F-07, F-14c, F8, F-05 = TI-3, F02's NOT_AVAILABLE_ON_EXEC).
// projexa-sync's exec client (createExecRun / createExecRunBatch / execOutcomeOf, pure in handler.ts) is driven against the REAL ai-work-link-exec
// handleExec through an in-process fetch, with only the pipeline (syncRun) stubbed. No database.
import { describe, expect, test } from "bun:test"
import { codeOfThrown } from "@/lib/pipeline/link-exec-entry"
import { unavailable } from "@/lib/pipeline/link-exec-stubs/unavailable"
import { claimSyncOp, handleExec, SYNC_BATCH_START_CUTOFF_MS, type ExecDeps, type SyncBody, type SyncClaim } from "../../../supabase/functions/ai-work-link-exec/handler"
import { checkOp, classifyFailure, createExecRun, createExecRunBatch, execOutcomeOf, PUSH_OP_MAX_BYTES, type ExecRunBody } from "../../../supabase/functions/projexa-sync/handler"

const SECRET = "s3cret-for-tests-only"
const URL_BASE = "https://x.supabase.co/functions/v1/ai-work-link-exec"
const ctx = { org_id: "org-a", user_id: "u1", project_id: "proj-a", live_role: "manager", device_id: "device-0001" }
const body = (op_id: string, params: Record<string, unknown> = { taskId: "t1" }): ExecRunBody => ({ op_id, function_id: "update_task", params, ctx })

function execDeps(over: Partial<ExecDeps> = {}, ran: SyncBody[] = []): ExecDeps {
  return {
    rpc: async () => ({ data: null, error: { message: "nope" } }),
    secret: SECRET,
    dbConfigured: true,
    run: async () => ({ status: "failed", code: "INTERNAL_ERROR", missing: [] }),
    syncRun: async (op) => {
      ran.push(op)
      return op.function_id === "boom" ? { status: "failed", code: "BACKEND_UNAVAILABLE", missing: [] } : { status: "done", submission_id: "s", record: { id: String(op.params.taskId ?? "x"), route: "/r" } }
    },
    health: async () => ({ db_role: "app_runtime" }),
    log: () => {},
    ...over,
  }
}
/** fetch that hands the request to the real exec handler (what Supabase's gateway does between the two functions) */
const viaExec = (d: ExecDeps, seen: string[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url))
    return handleExec(new Request(String(url), init), d)
  }) as unknown as typeof fetch

describe("execOutcomeOf: the exec function's HTTP answer -> what happened (F06 table)", () => {
  test.each([
    [400, null, { kind: "failed", code: "BAD_OP", missing: [] }],
    [413, null, { kind: "failed", code: "TOO_LARGE", missing: [] }],
    [401, null, { kind: "unavailable" }],
    [404, null, { kind: "unavailable" }],
    [405, null, { kind: "unavailable" }],
    [429, null, { kind: "unavailable" }],
    [503, null, { kind: "unavailable" }],
    [500, null, { kind: "uncertain" }],
    [502, null, { kind: "uncertain" }],
    [504, null, { kind: "uncertain" }],
    [546, null, { kind: "uncertain" }],
    [200, null, { kind: "uncertain" }],
    [200, { status: "weird" }, { kind: "uncertain" }],
    [200, { status: "not_run" }, { kind: "unavailable" }],
    [200, { status: "done", record: { id: "r1", route: "/x" }, submission_id: "s1" }, { kind: "done", record: { id: "r1", route: "/x" }, submission_id: "s1" }],
    [200, { status: "failed", code: "VALUE_REQUIRED", missing: ["title"] }, { kind: "failed", code: "VALUE_REQUIRED", missing: ["title"] }],
  ] as const)("%i %j", (status, b, want) => {
    expect(execOutcomeOf(status, b)).toEqual(want as never)
  })

  test("a 400 from exec is a TERMINAL refusal at the push level (no poison op retried forever)", () => {
    const o = execOutcomeOf(400, null)
    expect(o.kind === "failed" && classifyFailure(o.code)).toBe("rejected")
  })

  test("a network error / timeout is uncertain; every non-200 body is cancelled", async () => {
    const throws = (async () => {
      throw new Error("aborted")
    }) as unknown as typeof fetch
    expect(await createExecRun({ url: URL_BASE, secret: SECRET, fetchImpl: throws })(body("op-ne-00001"))).toEqual({ kind: "uncertain" })
    let cancelled = false
    const stream = new ReadableStream({ cancel: () => void (cancelled = true) })
    const bad = (async () => new Response(stream, { status: 502 })) as unknown as typeof fetch
    expect(await createExecRun({ url: URL_BASE, secret: SECRET, fetchImpl: bad })(body("op-ne-00002"))).toEqual({ kind: "uncertain" })
    expect(cancelled).toBe(true)
  })
})

describe("contract: projexa-sync's exec client against the REAL exec handler", () => {
  test("done, failed with the pipeline's code, wrong secret = unavailable, not configured = unavailable", async () => {
    const run = createExecRun({ url: URL_BASE, secret: SECRET, fetchImpl: viaExec(execDeps()) })
    expect(await run(body("op-ct-00001"))).toEqual({ kind: "done", record: { id: "t1", route: "/r" }, submission_id: "s" })
    expect(await run({ ...body("op-ct-00002"), function_id: "boom" })).toEqual({ kind: "failed", code: "BACKEND_UNAVAILABLE", missing: [] })
    expect(await createExecRun({ url: URL_BASE, secret: "wrong", fetchImpl: viaExec(execDeps()) })(body("op-ct-00003"))).toEqual({ kind: "unavailable" })
    expect(await createExecRun({ url: URL_BASE, secret: SECRET, fetchImpl: viaExec(execDeps({ dbConfigured: false })) })(body("op-ct-00004"))).toEqual({ kind: "unavailable" })
  })

  test("the largest op the edge accepts (multi-byte) is ACCEPTED by exec, not refused 400", async () => {
    const ran: SyncBody[] = []
    const run = createExecRun({ url: URL_BASE, secret: SECRET, fetchImpl: viaExec(execDeps({}, ran)) })
    // grow a Devanagari note until the op is just under the edge's byte cap
    let n = 19_000
    while (checkOp({ op_id: "op-ct-00005", function_id: "update_task", project_id: "proj-a", params: { taskId: "t1", note: "क".repeat(n + 100) } }).ok) n += 100
    const params = { taskId: "t1", note: "क".repeat(n) }
    expect(checkOp({ op_id: "op-ct-00005", function_id: "update_task", project_id: "proj-a", params }).ok).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify({ op_id: "op-ct-00005", function_id: "update_task", project_id: "proj-a", params })).length).toBeGreaterThan(PUSH_OP_MAX_BYTES - 400)
    expect((await run(body("op-ct-00005", params))).kind).toBe("done")
    expect(ran).toHaveLength(1)
  })

  test("an exec body exec refuses (a bad shape) comes back terminal, not 'unavailable'", async () => {
    const run = createExecRun({ url: URL_BASE, secret: SECRET, fetchImpl: viaExec(execDeps()) })
    const o = await run({ ...body("op-ct-00006"), ctx: { ...ctx, device_id: "x" } })
    expect(o).toEqual({ kind: "failed", code: "BAD_OP", missing: [] })
  })
})

describe("POST /sync-run-batch: one invocation per push (F8 / F-02)", () => {
  test("every op runs in order in ONE call; a bad op is answered on its own; answers are matched by op_id", async () => {
    const ran: SyncBody[] = []
    const seen: string[] = []
    const batch = createExecRunBatch({ url: URL_BASE, secret: SECRET, fetchImpl: viaExec(execDeps({}, ran), seen) })
    const out = await batch([body("op-bt-00001", { taskId: "a" }), { ...body("op-bt-00002"), ctx: { ...ctx, device_id: "x" } }, { ...body("op-bt-00003"), function_id: "boom" }, body("op-bt-00004", { taskId: "d" })])
    expect(seen).toEqual([`${URL_BASE}/sync-run-batch`])
    expect(ran.map((r) => r.op_id)).toEqual(["op-bt-00001", "op-bt-00003", "op-bt-00004"])
    expect(out.map((o) => (o.kind === "failed" ? o.code : o.kind))).toEqual(["done", "BAD_OP", "BACKEND_UNAVAILABLE", "done"])
  })

  test("past the exec function's time budget the rest are not_run, i.e. unavailable (nothing ran)", async () => {
    let t = 0
    const ran: SyncBody[] = []
    const d = execDeps({ clock: () => t, syncRun: async (op) => ((t += SYNC_BATCH_START_CUTOFF_MS / 2 + 1), ran.push(op), { status: "done", submission_id: null, record: { id: "x", route: null } }) })
    const out = await createExecRunBatch({ url: URL_BASE, secret: SECRET, fetchImpl: viaExec(d) })([body("op-bb-00001"), body("op-bb-00002"), body("op-bb-00003")])
    expect(out.map((o) => o.kind)).toEqual(["done", "done", "unavailable"])
    expect(ran).toHaveLength(2)
  })

  test("an exec function deployed before the batch route existed (404): falls back to one call per op", async () => {
    const seen: string[] = []
    const old = execDeps()
    const oldExec = (async (url: string, init?: RequestInit) => {
      seen.push(String(url))
      if (String(url).endsWith("/sync-run-batch")) return new Response(JSON.stringify({ ok: false, code: "NOT_FOUND" }), { status: 404 })
      return handleExec(new Request(String(url), init), old)
    }) as unknown as typeof fetch
    const out = await createExecRunBatch({ url: URL_BASE, secret: SECRET, fetchImpl: oldExec })([body("op-fb-00001"), body("op-fb-00002")])
    expect(out.map((o) => o.kind)).toEqual(["done", "done"])
    expect(seen.filter((u) => u.endsWith("/sync-run"))).toHaveLength(2)
  })

  test("a lost batch answer is uncertain for every op (never guessed)", async () => {
    const out = await createExecRunBatch({ url: URL_BASE, secret: SECRET, fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch })([body("op-lb-00001"), body("op-lb-00002")])
    expect(out).toEqual([{ kind: "uncertain" }, { kind: "uncertain" }])
  })
})

describe("/sync-run trust boundary (F-05 = TI-3)", () => {
  const post = (d: ExecDeps, secret: string, route = "sync-run", b: unknown = body("op-tb-00001")) =>
    handleExec(new Request(`${URL_BASE}/${route}`, { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(b) }), d)

  test("with a dedicated sync secret set, the AI link's secret no longer reaches /sync-run or /sync-run-batch (but still reaches /health)", async () => {
    const d = execDeps({ syncSecret: "sync-only-secret" })
    expect((await post(d, SECRET)).status).toBe(401)
    expect((await post(d, SECRET, "sync-run-batch", { ops: [body("op-tb-00002")] })).status).toBe(401)
    expect((await post(d, "sync-only-secret")).status).toBe(200)
    expect((await handleExec(new Request(`${URL_BASE}/health`, { headers: { authorization: `Bearer ${SECRET}` } }), d)).status).toBe(200)
    expect((await handleExec(new Request(`${URL_BASE}/health`, { headers: { authorization: "Bearer sync-only-secret" } }), d)).status).toBe(401)
  })

  test("with the ledger claim, the context that RUNS is the database's, not the body's; a refused claim runs nothing", async () => {
    const ran: SyncBody[] = []
    const claims: Record<string, SyncClaim> = {
      "op-tc-00001": { ok: true, ctx: { org_id: "org-a", user_id: "u1", project_id: "proj-a", live_role: "member" } },
      "op-tc-00002": { ok: false, code: "NOT_CLAIMED" },
      "op-tc-00003": { ok: "unsupported" },
    }
    const d = execDeps({ syncClaim: async (op) => claims[op.op_id] }, ran)
    const forged = { ...body("op-tc-00001"), ctx: { ...ctx, live_role: "owner" } }
    expect(await (await post(d, SECRET, "sync-run", forged)).json()).toMatchObject({ status: "done" })
    expect(ran[0].ctx.live_role).toBe("member")
    expect(await (await post(d, SECRET, "sync-run", body("op-tc-00002"))).json()).toMatchObject({ status: "failed", code: "NOT_CLAIMED" })
    expect(ran).toHaveLength(1)
    expect(await (await post(d, SECRET, "sync-run", body("op-tc-00003"))).json()).toMatchObject({ status: "done" })
    expect(ran).toHaveLength(2)
  })

  test("claimSyncOp: missing SQL function = unsupported; another error = CLAIM_UNAVAILABLE; a claim for someone else = NOT_CLAIMED; ok = the live context", async () => {
    const op: SyncBody = body("op-cl-00001")
    const rpcOf = (r: { data: unknown; error: { message: string; code?: string } | null }) => async () => r
    expect(await claimSyncOp(rpcOf({ data: null, error: { message: "x", code: "PGRST202" } }), op)).toEqual({ ok: "unsupported" })
    expect(await claimSyncOp(rpcOf({ data: null, error: { message: "x", code: "57014" } }), op)).toEqual({ ok: false, code: "CLAIM_UNAVAILABLE" })
    expect(await claimSyncOp(rpcOf({ data: { status: "refused", reason: "not_running" }, error: null }), op)).toEqual({ ok: false, code: "NOT_CLAIMED" })
    expect(await claimSyncOp(rpcOf({ data: { status: "ok", ctx: { org_id: "org-b", user_id: "u1", project_id: "proj-a", live_role: "owner" } }, error: null }), op)).toEqual({ ok: false, code: "NOT_CLAIMED" })
    expect(await claimSyncOp(rpcOf({ data: { status: "ok", ctx: { org_id: "org-a", user_id: "u1", project_id: "proj-a", live_role: "member" } }, error: null }), op)).toEqual({ ok: true, ctx: { org_id: "org-a", user_id: "u1", project_id: "proj-a", live_role: "member" } })
  })
})

describe("a stubbed module reached on the edge is needs_server, not a retry forever (tests-quality:F02)", () => {
  test("codeOfThrown(NOT_AVAILABLE_ON_EXEC: ...) is FUNCTION_NOT_AVAILABLE, which push classifies needs_server", () => {
    let thrown: unknown
    try {
      unavailable("resend")
    } catch (e) {
      thrown = e
    }
    expect(codeOfThrown(thrown)).toBe("FUNCTION_NOT_AVAILABLE")
    expect(classifyFailure(codeOfThrown(thrown))).toBe("needs_server")
    expect(codeOfThrown(new Error("something else"))).toBe("INTERNAL_ERROR")
  })
})
