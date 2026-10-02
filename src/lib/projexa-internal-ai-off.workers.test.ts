/// <reference types="bun-types" />
// lf-b3-ai-off: the cron/worker paths whose work is a model call are SILENT while PROJEXA_INTERNAL_AI_ENABLED is unset: they return a
// quiet "skipped" result, read nothing they would only feed a model, consult no provider and log no error -- and with the switch at
// "1" they go down their old path. The database, the provider gate and the model resolver are spies.
//
//   job (cron route)                                   service                         off: proven by
//   /api/internal/l2-phrase-promotion/run              runL2Batch                      no org scan, no system-batch gate
//   /api/internal/role-quality-regression/run          runAllRoleQualityChecks         no prompt template read
//   /api/internal/instruction-audit/run                runInstructionMismatchAudit     no commitment read
//   /api/internal/dispatch-completion-monitor/run      runDispatchCompletionSweep      no stuck-activity read (so no escalations)
//   /api/internal/loops/run (loop 1)                   runLoopEngineeringAudit         audit recorded, no model resolved
//   /api/internal/capability-audit/run                 runCapabilityAudit              no capability read
//   /api/internal/crr-catchup-worker/run               (the route itself)              200 skipped, no source_object read
//
// Run: bun test --isolate src/lib/projexa-internal-ai-off.workers.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const spy = <T>(value: T) => mock(async (..._a: unknown[]) => value)
const fakeDb = {
  execute: spy([] as unknown[]),
  query: {
    instructionCommitments: { findMany: spy([] as unknown[]) },
    loopDefinitions: { findMany: spy([] as unknown[]) },
    promptTemplates: { findFirst: spy(undefined) },
    taskCapabilities: { findFirst: spy(undefined) },
    sourceObject: { findMany: spy([] as unknown[]) },
  },
  insert: mock(() => ({ values: async () => {} })),
}
const realDb = await import("@/lib/db")
mock.module("@/lib/db", () => ({ ...realDb, db: fakeDb }))

const realAdapter = await import("@/lib/ai/adapter")
const systemBatchGate = mock(() => {})
mock.module("@/lib/ai/adapter", () => ({ ...realAdapter, assertAiProviderAllowedForSystemBatch: systemBatchGate }))

const realActivity = await import("@/lib/activity-log-service")
const listStuckActivities = spy([] as unknown[])
mock.module("@/lib/activity-log-service", () => ({ ...realActivity, listStuckActivities }))

const realResolver = await import("@/lib/orchestra-model-resolver")
const resolvePlatformModelConfig = spy(null)
mock.module("@/lib/orchestra-model-resolver", () => ({ ...realResolver, resolvePlatformModelConfig }))

const { runL2Batch } = await import("@/lib/ai/batch/analyse")
const { runAllRoleQualityChecks } = await import("@/lib/services/role-quality-regression-service")
const { runInstructionMismatchAudit } = await import("@/lib/loops/instruction-mismatch-audit")
const { runDispatchCompletionSweep } = await import("@/lib/monitors/dispatch-completion-monitor")
const { runLoopEngineeringAudit } = await import("@/lib/loops/loop-engineering-audit")
const { runCapabilityAudit } = await import("@/lib/services/capability-audit-service")
const crrCatchup = await import("@/app/api/internal/crr-catchup-worker/run/route")
const { INTERNAL_AI_OFF_SKIP } = await import("@/lib/projexa-internal-ai")

const FLAG = "PROJEXA_INTERNAL_AI_ENABLED"
const savedFlag = process.env[FLAG]
const savedCron = process.env.CRON_SECRET
const allSpies = [fakeDb.execute, fakeDb.query.instructionCommitments.findMany, fakeDb.query.loopDefinitions.findMany, fakeDb.query.promptTemplates.findFirst, fakeDb.query.taskCapabilities.findFirst, fakeDb.query.sourceObject.findMany, fakeDb.insert, systemBatchGate, listStuckActivities, resolvePlatformModelConfig]
let errorSpy: ReturnType<typeof mock>
const realConsoleError = console.error
beforeEach(() => {
  delete process.env[FLAG]
  process.env.CRON_SECRET = "cron-secret-for-tests"
  for (const s of allSpies) s.mockClear()
  errorSpy = mock(() => {})
  console.error = errorSpy as unknown as typeof console.error
})
afterAll(async () => {
  console.error = realConsoleError
  if (savedFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = savedFlag
  if (savedCron === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedCron
  mock.restore()
  await mock.module("@/lib/db", () => realDb)
  await mock.module("@/lib/ai/adapter", () => realAdapter)
  await mock.module("@/lib/activity-log-service", () => realActivity)
  await mock.module("@/lib/orchestra-model-resolver", () => realResolver)
})
const on = () => {
  process.env[FLAG] = "1"
}

describe("L2 nightly batch", () => {
  test("off: skipped, no org scan, the system-batch provider gate never consulted (so no nightly 500)", async () => {
    const result = await runL2Batch()
    expect(result).toMatchObject({ orgsProcessed: 0, clustersAnalysed: 0, skipped: "internal_ai_off" })
    expect(fakeDb.execute).not.toHaveBeenCalled()
    expect(systemBatchGate).not.toHaveBeenCalled()
  })

  test("on: scans for orgs and passes the gate, as before", async () => {
    on()
    const result = await runL2Batch()
    expect(fakeDb.execute).toHaveBeenCalledTimes(1)
    expect(systemBatchGate).toHaveBeenCalledTimes(1)
    expect(result.skipped).toBeUndefined()
  })
})

describe("per-role quality regression", () => {
  test("off: nothing checked, nothing read, flagged as off", async () => {
    const summary = await runAllRoleQualityChecks({ triggeredBy: "scheduled" })
    expect(summary).toMatchObject({ checked: 0, skipped: 0, regressions: [], results: [], internalAiOff: true })
    expect(fakeDb.query.promptTemplates.findFirst).not.toHaveBeenCalled()
  })

  test("on: every eligible role is looked up, as before", async () => {
    on()
    const summary = await runAllRoleQualityChecks({ triggeredBy: "scheduled" })
    expect(fakeDb.query.promptTemplates.findFirst).toHaveBeenCalled()
    expect(summary.internalAiOff).toBeUndefined()
  })
})

describe("instruction-mismatch audit", () => {
  test("off: no commitment is read or judged", async () => {
    expect(await runInstructionMismatchAudit()).toMatchObject({ checked: 0, skipped: "internal_ai_off" })
    expect(fakeDb.query.instructionCommitments.findMany).not.toHaveBeenCalled()
  })

  test("on: the pending commitments are read, as before", async () => {
    on()
    await runInstructionMismatchAudit()
    expect(fakeDb.query.instructionCommitments.findMany).toHaveBeenCalledTimes(1)
  })
})

describe("dispatch-completion monitor", () => {
  const admin = { id: "admin-1", orgId: "org-1", role: "veridian_admin" } as never
  test("off: no stuck activity is read, so its fail-closed path cannot page a human for every row", async () => {
    expect(await runDispatchCompletionSweep("org-1", admin, 1000)).toMatchObject({ checked: 0, escalated: 0, skipped: "internal_ai_off" })
    expect(listStuckActivities).not.toHaveBeenCalled()
  })

  test("on: the stuck activities are read, as before", async () => {
    on()
    await runDispatchCompletionSweep("org-1", admin, 1000)
    expect(listStuckActivities).toHaveBeenCalledTimes(1)
  })
})

describe("loop 1 (loop engineering) synthesis", () => {
  test("off: the audit is still recorded, the model is never resolved, and nothing is logged as a failure", async () => {
    await runLoopEngineeringAudit("loop-1")
    expect(fakeDb.insert).toHaveBeenCalledTimes(1)
    expect(resolvePlatformModelConfig).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test("on: the model is resolved, as before", async () => {
    on()
    await runLoopEngineeringAudit("loop-1")
    expect(resolvePlatformModelConfig).toHaveBeenCalledTimes(1)
  })
})

describe("capability audit", () => {
  test("off: not audited, nothing read, the capability keeps its turn", async () => {
    const result = await runCapabilityAudit("cap-1")
    expect(result.audited).toBe(false)
    expect(fakeDb.query.taskCapabilities.findFirst).not.toHaveBeenCalled()
  })

  test("on: the capability is read, as before", async () => {
    on()
    await expect(runCapabilityAudit("cap-1")).rejects.toThrow("No capability found")
    expect(fakeDb.query.taskCapabilities.findFirst).toHaveBeenCalledTimes(1)
  })
})

describe("CRR catch-up worker route", () => {
  const req = () => {
    const r = new Request("http://localhost/api/internal/crr-catchup-worker/run", { headers: { authorization: "Bearer cron-secret-for-tests" } }) as Request & { nextUrl: URL }
    r.nextUrl = new URL(r.url)
    return r as never
  }

  test("off: 200 skipped, no stuck row is read (their resumable status is kept for later)", async () => {
    const res = await crrCatchup.GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(INTERNAL_AI_OFF_SKIP)
    expect(fakeDb.query.sourceObject.findMany).not.toHaveBeenCalled()
  })

  test("still refuses a caller without the cron secret, switch or no switch", async () => {
    const bad = new Request("http://localhost/api/internal/crr-catchup-worker/run") as Request & { nextUrl: URL }
    bad.nextUrl = new URL(bad.url)
    expect((await crrCatchup.GET(bad as never)).status).toBe(401)
  })

  test("on: the stuck rows are scanned, as before", async () => {
    on()
    const res = await crrCatchup.GET(req())
    expect(res.status).toBe(200)
    expect(fakeDb.query.sourceObject.findMany).toHaveBeenCalledTimes(1)
  })
})
