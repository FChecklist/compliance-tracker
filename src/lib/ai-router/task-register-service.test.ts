/// <reference types="bun-types" />
// Audit round 1 (GLM-5.2, M2 finding): "no test exercises step
// accumulation across multiple recordExecutionReport() calls for the same
// taskId -- the bugs (B1-B4) all live here and none of the 3 prior test
// files would have caught them." This file exercises exactly that, with
// @/lib/db mocked as an in-memory single-row store (same pattern
// roster-overrides.test.ts already established for this codebase's DB
// dependencies) -- never touching a live DB from a .test.ts file.
import { describe, expect, test, mock, afterEach } from "bun:test"
import type { ExecutionReport } from "./instruction-contract"

type StoredRow = {
  taskId: string
  status: string
  executionReport: ExecutionReport | null
  instructionContract: unknown
}

function mockTaskRegisterTable() {
  let row: StoredRow | null = null
  mock.module("@/lib/db", () => ({
    db: {
      query: {
        taskRegister: {
          findFirst: mock(async () => (row ? { ...row } : undefined)),
        },
      },
      insert: mock(() => ({
        values: mock((v: Record<string, unknown>) => {
          row = { taskId: v.taskId as string, status: v.status as string, executionReport: null, instructionContract: v.instructionContract }
          return Promise.resolve()
        }),
      })),
      update: mock(() => ({
        set: mock((v: Record<string, unknown>) => ({
          where: mock(async () => {
            // Tests exercise recordExecutionReport() directly, without a
            // prior registerInstructionContract() insert -- initialize the
            // row on first update rather than silently no-op'ing when none
            // exists yet (mirrors production only in that a row always
            // ends up present; production always inserts first via the
            // route, this mock just tolerates being called standalone).
            row = { taskId: row?.taskId ?? "unknown", status: "pending", executionReport: null, instructionContract: null, ...row, ...v } as StoredRow
          }),
        })),
      })),
    },
    taskRegister: {},
  }))
  return () => row
}

afterEach(() => {
  mock.restore()
})

function makeStepReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    task_id: "TASK-ACC-1",
    task_type: "Single Step",
    objective: "step objective",
    status: "PASS",
    overall_confidence: 99,
    completion: { completed: 1, expected: 1, percentage: 100 },
    steps: [{ step_no: 1, name: "step", status: "PASS", confidence: 99, retry_count: 0, validation: "PASS" }],
    missing: [],
    warnings: [],
    errors: [],
    escalation: { required: false, reason: "" },
    execution_summary: { duration_seconds: 10, tokens_used: 500 },
    ...overrides,
  }
}

describe("recordExecutionReport -- multi-step aggregation (audit round 1, B1-B4)", () => {
  test("first call with no prior row: report + status pass through unchanged, status is in_progress when expectedSteps > 1", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    const result = await recordExecutionReport("TASK-ACC-1", makeStepReport(), 3)
    expect(result.ok).toBe(true)
    expect(result.status).toBe("in_progress") // 1 of 3 expected steps -- not done yet
    expect(result.mergedReport?.steps.length).toBe(1)
  })

  test("B1 fix: multi-step workflow is NOT marked completed after the first passing step", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    const r1 = await recordExecutionReport("TASK-ACC-2", makeStepReport({ task_id: "TASK-ACC-2" }), 3)
    expect(r1.status).not.toBe("completed")
  })

  test("B1 fix: workflow IS marked completed once accumulated steps reach expectedSteps", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    await recordExecutionReport("TASK-ACC-3", makeStepReport({ task_id: "TASK-ACC-3", steps: [{ step_no: 1, name: "s1", status: "PASS", confidence: 99, retry_count: 0, validation: "PASS" }] }), 2)
    const r2 = await recordExecutionReport("TASK-ACC-3", makeStepReport({ task_id: "TASK-ACC-3", steps: [{ step_no: 2, name: "s2", status: "PASS", confidence: 95, retry_count: 0, validation: "PASS" }] }), 2)
    expect(r2.status).toBe("completed")
    expect(r2.mergedReport?.steps.length).toBe(2)
  })

  test("B2 fix: execution_summary is SUMMED across steps, not overwritten with the latest step's values", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    await recordExecutionReport("TASK-ACC-4", makeStepReport({ task_id: "TASK-ACC-4", execution_summary: { duration_seconds: 8, tokens_used: 800, files_created: 1 } }), 2)
    const r2 = await recordExecutionReport(
      "TASK-ACC-4",
      makeStepReport({ task_id: "TASK-ACC-4", steps: [{ step_no: 2, name: "s2", status: "PASS", confidence: 98, retry_count: 0, validation: "PASS" }], execution_summary: { duration_seconds: 16, tokens_used: 1680, files_created: 2, tests_passed: 4 } }),
      2
    )
    expect(r2.mergedReport?.execution_summary.duration_seconds).toBe(24)
    expect(r2.mergedReport?.execution_summary.tokens_used).toBe(2480)
    expect(r2.mergedReport?.execution_summary.files_created).toBe(3)
    expect(r2.mergedReport?.execution_summary.tests_passed).toBe(4)
  })

  test("B3 fix: overall_confidence is the MINIMUM across accumulated steps, not the latest step's value", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    await recordExecutionReport("TASK-ACC-5", makeStepReport({ task_id: "TASK-ACC-5", overall_confidence: 60 }), 2)
    const r2 = await recordExecutionReport("TASK-ACC-5", makeStepReport({ task_id: "TASK-ACC-5", overall_confidence: 99, steps: [{ step_no: 2, name: "s2", status: "PASS", confidence: 99, retry_count: 0, validation: "PASS" }] }), 2)
    expect(r2.mergedReport?.overall_confidence).toBe(60) // workflow is only as confident as its weakest step
  })

  test("B3 fix: status is FAIL if ANY accumulated step FAILed, even if the latest step PASSed", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    await recordExecutionReport("TASK-ACC-6", makeStepReport({ task_id: "TASK-ACC-6", status: "FAIL", steps: [{ step_no: 1, name: "s1", status: "FAIL", confidence: 40, retry_count: 1, validation: "FAIL" }] }), 2)
    const r2 = await recordExecutionReport("TASK-ACC-6", makeStepReport({ task_id: "TASK-ACC-6", steps: [{ step_no: 2, name: "s2", status: "PASS", confidence: 99, retry_count: 0, validation: "PASS" }] }), 2)
    expect(r2.mergedReport?.status).toBe("FAIL")
    expect(r2.status).toBe("failed")
  })

  test("B4 fix: merged objective is the FIRST step's objective, never overwritten by a later step's narrower objective", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    await recordExecutionReport("TASK-ACC-7", makeStepReport({ task_id: "TASK-ACC-7", objective: "Implement Complete User Management Module" }), 2)
    const r2 = await recordExecutionReport("TASK-ACC-7", makeStepReport({ task_id: "TASK-ACC-7", objective: "wire the login test", steps: [{ step_no: 2, name: "s2", status: "PASS", confidence: 97, retry_count: 0, validation: "PASS" }] }), 2)
    expect(r2.mergedReport?.objective).toBe("Implement Complete User Management Module")
  })

  test("escalation.required on any step propagates to the aggregated report and the task_register status", async () => {
    mockTaskRegisterTable()
    const { recordExecutionReport } = await import("./task-register-service")
    await recordExecutionReport("TASK-ACC-8", makeStepReport({ task_id: "TASK-ACC-8" }), 2)
    const r2 = await recordExecutionReport("TASK-ACC-8", makeStepReport({ task_id: "TASK-ACC-8", steps: [{ step_no: 2, name: "s2", status: "PARTIAL", confidence: 80, retry_count: 1, validation: "FAIL" }], escalation: { required: true, reason: "confidence below threshold" } }), 2)
    expect(r2.mergedReport?.escalation.required).toBe(true)
    expect(r2.status).toBe("escalated")
  })
})
