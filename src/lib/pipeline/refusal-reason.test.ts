/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { executeTask, type ExecutableTask, type ExecutionOutcome } from "./executor"
import { REFUSAL_REASON_MAX, refusalReason, safeRefusalReason, serialiseFailure } from "./error-codes"
import { failureFromServiceError } from "./executors/common"
import { handleExec, type ExecDeps } from "../../../supabase/functions/ai-work-link-exec/handler"
import { execOutcomeOf } from "../../../supabase/functions/projexa-sync/handler"
import { ServiceError } from "@/lib/services/compliance-service"

// UAT 2026-10-13, checklist 2.19 / R-90: an offline write the server refuses for a business rule reached the laptop as a closed code only, so the person read the
// generic "check the values and try again" while the service knew exactly why ("would reach 105 of 100 sqm ... only 5 sqm remains"). A service's own words for a
// REQUEST_REJECTED now travel to the laptop on the PUSH route, made safe first; nothing else about the closed vocabulary changes.

const REASON = "Progress on A1 would reach 105 of 100 sqm (105%), more than 100%. Only 5 sqm remains on this line."
const TASK: ExecutableTask = { orgId: "org_1", userId: "user_1", projectId: "project_1", functionId: "record_work_progress", params: {} }
const throwing = (error: unknown) => ({ record_work_progress: async (): Promise<ExecutionOutcome> => { throw error } })

describe("safeRefusalReason: only prose that is safe to hand a client", () => {
  test("a normal sentence is kept as it is", () => {
    expect(safeRefusalReason(REASON)).toBe(REASON)
  })
  test("control characters and runs of whitespace become single spaces", () => {
    expect(safeRefusalReason("Line one\r\nline\ttwo\u0000  three")).toBe("Line one line two three")
  })
  test("nothing, a non-string, or too long is undefined", () => {
    expect(safeRefusalReason("")).toBeUndefined()
    expect(safeRefusalReason("   ")).toBeUndefined()
    expect(safeRefusalReason(undefined)).toBeUndefined()
    expect(safeRefusalReason({ message: REASON })).toBeUndefined()
    expect(safeRefusalReason("x".repeat(REFUSAL_REASON_MAX + 1))).toBeUndefined()
    expect(safeRefusalReason("x".repeat(REFUSAL_REASON_MAX))).toHaveLength(REFUSAL_REASON_MAX)
  })
  test("a driver errno or an address is never handed on", () => {
    expect(safeRefusalReason("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBeUndefined()
    expect(safeRefusalReason("connect ECONNREFUSED")).toBeUndefined()
    expect(safeRefusalReason("db.example.supabase.co:5432 refused")).toBeUndefined()
  })
  test("only a REQUEST_REJECTED carries words; a 404, a 409 or a role refusal keeps its closed code alone", () => {
    expect(refusalReason("REQUEST_REJECTED", REASON)).toEqual({ reason: REASON })
    for (const code of ["RECORD_NOT_FOUND", "ALREADY_RECORDED", "NOT_PERMITTED", "INTERNAL_ERROR"]) expect(refusalReason(code, REASON)).toEqual({})
    expect(refusalReason("REQUEST_REJECTED", "write CONNECT_TIMEOUT 3.109.171.244:6543")).toEqual({})
  })
})

describe("executeTask carries a service's own REQUEST_REJECTED words, and nothing else", () => {
  test("a 422 business refusal: the outcome has the reason; the persisted failure still has the code only", async () => {
    const outcome = await executeTask(TASK, throwing(new ServiceError(REASON, 422)))
    expect(outcome.success).toBe(false)
    if (outcome.success) return
    expect(outcome.failure.code).toBe("REQUEST_REJECTED")
    expect(outcome.reason).toBe(REASON)
    expect(serialiseFailure(outcome.failure)).not.toContain("sqm") // what is stored is unchanged: a code, never prose
  })
  test("a 404, a 409 and a plain Error carry no reason", async () => {
    for (const error of [new ServiceError("Activity not found", 404), new ServiceError("Attendance already recorded", 409), new Error("boom: the pool is full")]) {
      const outcome = await executeTask(TASK, throwing(error))
      expect(outcome.success).toBe(false)
      if (outcome.success) return
      expect(outcome.reason).toBeUndefined()
    }
  })
  test("a 422 whose message shows an address carries no reason", async () => {
    const outcome = await executeTask(TASK, throwing(new ServiceError("write CONNECT_TIMEOUT 3.109.171.244:6543", 422)))
    expect(outcome.success).toBe(false)
    if (outcome.success) return
    expect(outcome.reason).toBeUndefined()
  })
  test("an executor that maps a service error itself (failureFromServiceError) carries it too", () => {
    const out = failureFromServiceError(TASK, new ServiceError(REASON, 400))
    expect(out).toMatchObject({ success: false, reason: REASON })
    expect(failureFromServiceError(TASK, new ServiceError("gone", 404))).not.toHaveProperty("reason")
  })
})

describe("the exec function answers the reason on the laptop push route only", () => {
  const SECRET = "test-secret-value-of-some-length"
  const op = { op_id: "op-sync-0001", function_id: "record_work_progress", params: {}, ctx: { org_id: "o", user_id: "u", project_id: "p", live_role: "manager", device_id: "laptop-test-0001" } }
  const deps = (ran: unknown): ExecDeps => ({
    rpc: async () => { throw new Error("sync-run must never touch the intent tables") },
    secret: SECRET, dbConfigured: true,
    run: async () => ({ status: "failed", code: "NOT_USED", missing: [] }),
    syncRun: async () => ran as never,
    health: async () => ({ db_role: "app_runtime" }), log: () => {},
  })
  const call = async (ran: unknown) => {
    const res = await handleExec(new Request("https://x.supabase.co/functions/v1/ai-work-link-exec/sync-run", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify(op) }), deps(ran))
    return (await res.json()) as Record<string, unknown>
  }
  test("a REQUEST_REJECTED answers its reason (bounded); any other code answers the closed shape it always did", async () => {
    expect(await call({ status: "failed", code: "REQUEST_REJECTED", missing: [], reason: REASON })).toEqual({ op_id: "op-sync-0001", status: "failed", code: "REQUEST_REJECTED", missing: [], reason: REASON })
    const long = await call({ status: "failed", code: "REQUEST_REJECTED", missing: [], reason: "y".repeat(900) })
    expect((long.reason as string).length).toBe(300)
    expect(await call({ status: "failed", code: "RECORD_NOT_FOUND", missing: [], reason: REASON })).toEqual({ op_id: "op-sync-0001", status: "failed", code: "RECORD_NOT_FOUND", missing: [] })
    expect(await call({ status: "failed", code: "REQUEST_REJECTED", missing: [] })).toEqual({ op_id: "op-sync-0001", status: "failed", code: "REQUEST_REJECTED", missing: [] })
  })
})

describe("projexa-sync reads the reason from the exec answer", () => {
  test("only for REQUEST_REJECTED, bounded to 300 characters", () => {
    expect(execOutcomeOf(200, { status: "failed", code: "REQUEST_REJECTED", missing: [], reason: REASON })).toEqual({ kind: "failed", code: "REQUEST_REJECTED", missing: [], reason: REASON })
    expect((execOutcomeOf(200, { status: "failed", code: "REQUEST_REJECTED", missing: [], reason: "z".repeat(900) }) as { reason: string }).reason).toHaveLength(300)
    expect(execOutcomeOf(200, { status: "failed", code: "NOT_PERMITTED", missing: [], reason: REASON })).toEqual({ kind: "failed", code: "NOT_PERMITTED", missing: [] })
    expect(execOutcomeOf(200, { status: "failed", code: "REQUEST_REJECTED", missing: [] })).toEqual({ kind: "failed", code: "REQUEST_REJECTED", missing: [] })
  })
})
