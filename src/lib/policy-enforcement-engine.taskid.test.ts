/// <reference types="bun-types" />
// R67 Part B gap-closure (2026-09-03, PHASE3_RESULTS.md "the finding that
// matters for the AI usage ledger"): regression test for the specific bug
// fixed in this change -- enforcePolicy()'s denial-logging call now threads
// ctx.taskId through to recordOrchestraExecution() instead of silently
// dropping it, and task-execution-engine.ts's two enforcePolicy() call sites
// (package dispatch, free-text planning) now pass their own in-scope taskId.
//
// A separate file from policy-enforcement-engine.test.ts (not merged into
// it) because this needs recordOrchestraExecution() itself mock.module()'d
// BEFORE policy-enforcement-engine.ts is ever imported -- the existing test
// file already has a static top-level import of policy-enforcement-engine.ts,
// which would bind to the real (unmocked) orchestra-execution-logger before
// any mock.module() call in a test body could take effect. Same "@/lib/db
// mock.module()'d, spread the real module, dynamic-import the module under
// test after mocking" convention as token-usage-service.test.ts /
// dispatch-outcomes.test.ts -- here the mocked module is
// orchestra-execution-logger.ts, not @/lib/db, since enforcePolicy() never
// touches the db directly (recordOrchestraExecution does).
import { describe, expect, test, mock, afterEach } from "bun:test"

afterEach(() => {
  mock.restore()
})

function mockOrchestraLogger() {
  const recordSpy = mock((_input: unknown) => undefined)
  mock.module("@/lib/orchestra-execution-logger", () => ({
    recordOrchestraExecution: recordSpy,
  }))
  return { recordSpy }
}

describe("enforcePolicy -- task_id attribution on denial", () => {
  test("passes ctx.taskId through to the denial's recordOrchestraExecution() call when the caller has one", async () => {
    const { recordSpy } = mockOrchestraLogger()
    const { enforcePolicy } = await import("./policy-enforcement-engine")

    const decision = enforcePolicy(
      { orgId: "org_test", userId: "user_test", taskId: "task_abc123", layerKey: "task_oa", eventType: "task_execution.planning" },
      "What's my horoscope for today?" // triggers the personal_use denylist
    )

    expect(decision.allowed).toBe(false)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    const recordedInput = recordSpy.mock.calls[0][0] as Record<string, unknown>
    expect(recordedInput.taskId).toBe("task_abc123")
    expect(recordedInput.status).toBe("denied")
  })

  test("still logs taskId: undefined (never a fabricated value) when the caller genuinely has none", async () => {
    const { recordSpy } = mockOrchestraLogger()
    const { enforcePolicy } = await import("./policy-enforcement-engine")

    const decision = enforcePolicy(
      { orgId: "org_test", userId: "user_test", layerKey: "task_oa", eventType: "crm_intelligence.score_lead" },
      "What's my horoscope for today?"
    )

    expect(decision.allowed).toBe(false)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    const recordedInput = recordSpy.mock.calls[0][0] as Record<string, unknown>
    expect(recordedInput.taskId).toBeUndefined()
  })

  test("does not log at all on an allowed decision, taskId present or not", async () => {
    const { recordSpy } = mockOrchestraLogger()
    const { enforcePolicy } = await import("./policy-enforcement-engine")

    const decision = enforcePolicy(
      { orgId: "org_test", userId: "user_test", taskId: "task_abc123", layerKey: "task_oa", eventType: "task_execution.planning" },
      "List all overdue compliance items for this quarter"
    )

    expect(decision.allowed).toBe(true)
    expect(recordSpy).not.toHaveBeenCalled()
  })
})
