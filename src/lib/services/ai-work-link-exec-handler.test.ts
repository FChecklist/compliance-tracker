/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register rows AW-505, AW-510; spec 9.6, 9.8): the router of the ai-work-link-exec Edge function, with the database and the
// pipeline replaced by fakes. It proves the rules that need no database: who may call, that a function without its two owner-set settings is inert,
// the order claim -> run -> finish, that a refusal at the claim runs nothing, and that no message, parameter or secret is ever answered or logged.
// The same handler over REAL SQL and the REAL pipeline is ai-work-link-exec.test.ts.
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. handler.ts: check the bearer AFTER the not-configured test is skipped (answer 401 before 503)  -> "without its settings everything is 503" fails
//   2. handler.ts: run the pipeline when the claim answered refused                                   -> "a refused claim runs nothing" fails
//   3. handler.ts: compare the bearer with === instead of constantTimeEqual                            -> "constantTimeEqual ..." still passes;
//      so the break used is: accept any bearer of the right length                                     -> "a wrong bearer is 401" fails
//   4. handler.ts: return the thrown error's message in the answer                                     -> "a run that throws ..." fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-exec-handler.test.ts
import { describe, expect, test } from "bun:test"
import { constantTimeEqual, handleExec, routeOf, type Claimed, type ExecDeps, type ExecRpc, type Ran } from "../../../supabase/functions/ai-work-link-exec/handler"

const SECRET = "test-secret-value-of-some-length"
const URL_RUN = "https://x.supabase.co/functions/v1/ai-work-link-exec/run"
const URL_HEALTH = "https://x.supabase.co/functions/v1/ai-work-link-exec/health"

const CLAIM: Claimed & { status: "ok" } = {
  status: "ok",
  intent: { id: "int-1", kind: "action", function_id: "record_attendance", params: { rosterId: "roster_a", note: "SECRET-PARAM-TEXT" } },
  ctx: { link_id: "link-1", org_id: "org_1", user_id: "user_1", project_id: "project_a", live_role: "manager", live_rank: 3, effective_level: 1, money_visible: true },
}

type Calls = { rpc: Array<{ fn: string; args: Record<string, unknown> }>; run: Claimed[]; logs: string[] }

function deps(over: Partial<ExecDeps> & { claim?: unknown; ran?: Ran | Error; finishError?: boolean } = {}): { deps: ExecDeps; calls: Calls } {
  const calls: Calls = { rpc: [], run: [], logs: [] }
  const rpc: ExecRpc = async (fn, args = {}) => {
    calls.rpc.push({ fn, args })
    if (fn === "ai_work_link_intent_claim") return { data: over.claim === undefined ? CLAIM : over.claim, error: null }
    if (fn === "ai_work_link_intent_finish") return over.finishError ? { data: null, error: { message: "finish down" } } : { data: { updated: true }, error: null }
    return { data: null, error: { message: "unknown" } }
  }
  const d: ExecDeps = {
    rpc,
    secret: SECRET,
    dbConfigured: true,
    run: async (c) => {
      calls.run.push(c)
      if (over.ran instanceof Error) throw over.ran
      return over.ran ?? { status: "done", submission_id: "sub-1", record: { id: "rec-1", route: "/attendance/rec-1" } }
    },
    health: async () => ({ db_role: "app_runtime" }),
    log: (l) => calls.logs.push(l),
    ...over,
  }
  delete (d as Record<string, unknown>).claim
  delete (d as Record<string, unknown>).ran
  delete (d as Record<string, unknown>).finishError
  return { deps: d, calls }
}

const post = (body: unknown, bearer: string | null = SECRET, url = URL_RUN) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }) }, body: typeof body === "string" ? body : JSON.stringify(body) })
const get = (bearer: string | null = SECRET, url = URL_HEALTH) => new Request(url, { method: "GET", headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` } })
const read = async (r: Response) => ({ status: r.status, json: (await r.json()) as Record<string, any> })

describe("who may call, and the two owner-set settings", () => {
  test("without its settings everything is 503 NOT_CONFIGURED naming what is missing, before any bearer check, and nothing is touched", async () => {
    for (const [name, o, missing] of [
      ["no secret", { secret: undefined }, ["AWL_EXEC_INTERNAL_SECRET"]],
      ["empty secret", { secret: "" }, ["AWL_EXEC_INTERNAL_SECRET"]],
      ["no database url", { dbConfigured: false }, ["APP_RUNTIME_DATABASE_URL"]],
      ["neither", { secret: undefined, dbConfigured: false }, ["AWL_EXEC_INTERNAL_SECRET", "APP_RUNTIME_DATABASE_URL"]],
    ] as const) {
      const { deps: d, calls } = deps(o)
      for (const req of [post({ intent_id: "int-1" }), get(), post({ intent_id: "int-1" }, null), post({ intent_id: "int-1" }, "wrong")]) {
        const r = await read(await handleExec(req, d))
        expect({ name, status: r.status, code: r.json.code, missing: r.json.missing }).toEqual({ name, status: 503, code: "NOT_CONFIGURED", missing })
      }
      expect({ name, rpc: calls.rpc.length, run: calls.run.length }).toEqual({ name, rpc: 0, run: 0 })
    }
  })

  test("no bearer and a wrong bearer are 401 and touch nothing; the right one passes", async () => {
    const { deps: d, calls } = deps()
    for (const bearer of [null, "wrong", SECRET + "x", SECRET.slice(0, -1), "Bearer", SECRET.toUpperCase()]) {
      const r = await read(await handleExec(post({ intent_id: "int-1" }, bearer), d))
      expect({ bearer, status: r.status, code: r.json.code }).toEqual({ bearer, status: 401, code: "UNAUTHORIZED" })
    }
    expect(calls.rpc).toEqual([])
    expect(calls.run).toEqual([])
    expect((await read(await handleExec(post({ intent_id: "int-1" }), d))).status).toBe(200)
  })

  test("a link token or a JWT is not the secret: a bearer of another shape is 401", async () => {
    const { deps: d } = deps()
    for (const bearer of ["pxa_" + "a".repeat(64), "ey" + "JhbGciOiJFUzI1NiJ9.e30.sig"]) expect((await read(await handleExec(post({ intent_id: "int-1" }, bearer), d))).status).toBe(401)
  })

  test("constantTimeEqual: equal strings, different strings, a prefix and the empty string", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true)
    expect(constantTimeEqual("abc", "abd")).toBe(false)
    expect(constantTimeEqual("abc", "abcd")).toBe(false)
    expect(constantTimeEqual("abcd", "abc")).toBe(false)
    expect(constantTimeEqual("", "")).toBe(true)
    expect(constantTimeEqual("", "a")).toBe(false)
  })

  test("routeOf reads the route after the function's own name, or the last segment", () => {
    expect(routeOf("/functions/v1/ai-work-link-exec/run")).toBe("run")
    expect(routeOf("/ai-work-link-exec/health")).toBe("health")
    expect(routeOf("/run")).toBe("run")
    expect(routeOf("/")).toBe("")
  })
})

describe("routes", () => {
  test("GET /health answers the role of the database connection; a database that cannot be reached is 503 DB_UNREACHABLE", async () => {
    expect(await read(await handleExec(get(), deps().deps))).toEqual({ status: 200, json: { ok: true, db_role: "app_runtime" } })
    const down = deps({ health: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:6543") } })
    const r = await read(await handleExec(get(), down.deps))
    expect(r).toEqual({ status: 503, json: { ok: false, code: "DB_UNREACHABLE" } })
    expect(JSON.stringify(r)).not.toContain("10.0.0.1")
  })

  test("wrong method and unknown route: 405 and 404, nothing run", async () => {
    const { deps: d, calls } = deps()
    expect((await handleExec(new Request(URL_RUN, { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }), d)).status).toBe(405)
    expect((await handleExec(new Request(URL_HEALTH, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }), d)).status).toBe(405)
    expect((await handleExec(post({ intent_id: "int-1" }, SECRET, "https://x.supabase.co/functions/v1/ai-work-link-exec/other"), d)).status).toBe(404)
    expect(calls.rpc).toEqual([])
  })

  test("a bad body is 400 before the claim: no intent id, a non-string id, an id with a slash, a body over 2 KB, text that is not JSON", async () => {
    const { deps: d, calls } = deps()
    for (const body of [{}, { intent_id: 5 }, { intent_id: "a/b" }, { intent_id: "x".repeat(200) }, "not json", { intent_id: "int-1", pad: "x".repeat(3000) }, []]) {
      const r = await read(await handleExec(post(body), d))
      expect({ status: r.status, code: r.json.code }).toEqual({ status: 400, code: "BAD_REQUEST" })
    }
    expect(calls.rpc).toEqual([])
  })
})

describe("the run: claim, then the pipeline, then finish", () => {
  test("a claimed intent is run ONCE with the claim's own intent and context, then finished done with {id, route}", async () => {
    const { deps: d, calls } = deps()
    const r = await read(await handleExec(post({ intent_id: "int-1" }), d))
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ intent_id: "int-1", status: "done", submission_id: "sub-1", record: { id: "rec-1", route: "/attendance/rec-1" }, stored: true })
    expect(calls.rpc.map((c) => c.fn)).toEqual(["ai_work_link_intent_claim", "ai_work_link_intent_finish"])
    expect(calls.rpc[0].args).toEqual({ p_intent_id: "int-1" })
    expect(calls.run).toHaveLength(1)
    expect(calls.run[0].ctx.user_id).toBe("user_1")
    expect(calls.rpc[1].args).toEqual({ p_intent_id: "int-1", p_status: "done", p_submission_id: "sub-1", p_result: { id: "rec-1", route: "/attendance/rec-1" }, p_failure: null })
  })

  test("a failure is finished failed with a closed code and the names of what is missing, and answered the same way", async () => {
    const { deps: d, calls } = deps({ ran: { status: "failed", code: "RECORD_NOT_FOUND", missing: ["worker"], submission_id: "sub-9" } })
    const r = await read(await handleExec(post({ intent_id: "int-1" }), d))
    expect(r.json).toEqual({ intent_id: "int-1", status: "failed", code: "RECORD_NOT_FOUND", missing: ["worker"], stored: true })
    expect(calls.rpc[1].args).toEqual({ p_intent_id: "int-1", p_status: "failed", p_submission_id: "sub-9", p_result: null, p_failure: { code: "RECORD_NOT_FOUND", missing: ["worker"] } })
  })

  test("a refused claim runs nothing and finishes nothing: ROLE_CHANGED, LINK_GONE, expired, another call executing, writes off", async () => {
    for (const [claim, want] of [
      [{ status: "refused", reason: "ROLE_CHANGED" }, { status: "refused", code: "ROLE_CHANGED" }],
      [{ status: "refused", reason: "LINK_GONE" }, { status: "refused", code: "LINK_GONE" }],
      [{ status: "refused", reason: "expired" }, { status: "refused", code: "EXPIRED" }],
      [{ status: "refused", reason: "not_claimable", current: "done" }, { status: "refused", code: "NOT_CLAIMABLE" }],
      [{ status: "refused", reason: "already_executing" }, { status: "executing" }],
      [{ status: "not_enabled" }, { status: "refused", code: "WRITES_NOT_ENABLED" }],
    ] as const) {
      const { deps: d, calls } = deps({ claim })
      const r = await read(await handleExec(post({ intent_id: "int-1" }), d))
      const got: Record<string, unknown> = { claim, http: r.status, ...r.json }
      const expected: Record<string, unknown> = { claim, http: 200, intent_id: "int-1", ...want }
      expect(got).toEqual(expected)
      expect({ claim, run: calls.run.length, rpc: calls.rpc.map((c) => c.fn) }).toEqual({ claim, run: 0, rpc: ["ai_work_link_intent_claim"] })
    }
  })

  test("a claim that cannot be read is 503 CLAIM_UNAVAILABLE and runs nothing (an rpc error, a throw, an unknown shape, an ok without a context)", async () => {
    const shapes: unknown[] = [null, "ok", { status: "weird" }, { status: "ok" }, { status: "ok", intent: { id: "i", function_id: "f" }, ctx: { link_id: "l" } }]
    for (const claim of shapes) {
      const { deps: d, calls } = deps({ claim })
      const r = await read(await handleExec(post({ intent_id: "int-1" }), d))
      expect({ claim, status: r.status, code: r.json.code }).toEqual({ claim, status: 503, code: "CLAIM_UNAVAILABLE" })
      expect(calls.run).toHaveLength(0)
    }
    const boom = deps()
    boom.deps.rpc = async () => {
      throw new Error("connection reset")
    }
    expect((await read(await handleExec(post({ intent_id: "int-1" }), boom.deps))).json.code).toBe("CLAIM_UNAVAILABLE")
    const err = deps()
    err.deps.rpc = async () => ({ data: null, error: { message: "permission denied" } })
    expect((await read(await handleExec(post({ intent_id: "int-1" }), err.deps))).status).toBe(503)
  })

  test("a run that throws is finished failed INTERNAL_ERROR, and neither the answer nor the log carries the message, the parameters or the secret", async () => {
    const { deps: d, calls } = deps({ ran: new Error("connect ECONNREFUSED 10.9.8.7:6543 credential-marker-in-message") })
    const r = await read(await handleExec(post({ intent_id: "int-1" }), d))
    expect(r.json).toMatchObject({ status: "failed", code: "INTERNAL_ERROR", missing: [], stored: true })
    expect(calls.rpc[1].args).toMatchObject({ p_status: "failed", p_failure: { code: "INTERNAL_ERROR", missing: [] } })
    const everything = JSON.stringify([r, calls.logs, calls.rpc[1].args])
    for (const leak of ["10.9.8.7", "credential-marker-in-message", "ECONNREFUSED", SECRET, "SECRET-PARAM-TEXT"]) expect(everything).not.toContain(leak)
  })

  test("a finish that cannot be stored is retried once, then answered with stored false and logged; the outcome is still answered", async () => {
    const { deps: d, calls } = deps({ finishError: true })
    const r = await read(await handleExec(post({ intent_id: "int-1" }), d))
    expect(r.json).toMatchObject({ status: "done", stored: false })
    expect(calls.rpc.filter((c) => c.fn === "ai_work_link_intent_finish")).toHaveLength(2)
    expect(calls.logs.join("\n")).toContain("EXECUTION_UNCERTAIN")
  })
})
