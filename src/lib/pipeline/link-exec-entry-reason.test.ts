/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"

// UAT 2026-10-13, checklist 2.19 / R-90: runSyncOp (the laptop push route's entry) hands on the service's own words for a REQUEST_REJECTED, and ONLY then.
// The pipeline underneath (runDirectTask) is replaced by one that answers a chosen failure, so this proves the plumbing of link-exec-entry.ts alone; the
// service -> executor half is refusal-reason.test.ts and the HTTP half is refusal-reason.test.ts's handler tests.

const REASON = "Progress on A1 would reach 105 of 100 sqm (105%), more than 100%. Only 5 sqm remains on this line."
let answer: Record<string, unknown> = {}
let runSyncOp: typeof import("./link-exec-entry").runSyncOp
let restore: () => Promise<void> = async () => {}

beforeAll(async () => {
  const real = await import("./run-submission")
  const realExports = { ...real }
  mock.module("./run-submission", () => ({ ...realExports, runDirectTask: async () => answer }))
  restore = async () => { await mock.module("./run-submission", () => realExports) }
  ;({ runSyncOp } = await import("./link-exec-entry"))
})
afterAll(async () => { await restore() })

const failure = (code: string, over: Record<string, unknown> = {}) => ({
  submissionId: "sub_1", status: "failed", tasks: [], gaps: [], flagged: false, l0HitRate: 1, modelCalls: 0,
  failures: [{ segmentText: "x", code, missing: [], picker: "none" }], ...over,
})
const op = { op_id: "op-sync-0001", function_id: "record_work_progress", params: { quantityDone: 30 }, ctx: { org_id: "o", user_id: "u", project_id: "p", live_role: "manager", device_id: "laptop-test-0001" } }

describe("runSyncOp: the reason travels with a REQUEST_REJECTED only", () => {
  test("a business refusal carries the service's words", async () => {
    answer = failure("REQUEST_REJECTED", { refusalReason: REASON })
    expect(await runSyncOp(op)).toEqual({ status: "failed", code: "REQUEST_REJECTED", missing: [], submission_id: "sub_1", reason: REASON })
  })
  test("any other code stays a closed code, even if a reason were somehow present", async () => {
    answer = failure("RECORD_NOT_FOUND", { refusalReason: REASON })
    expect(await runSyncOp(op)).toEqual({ status: "failed", code: "RECORD_NOT_FOUND", missing: [], submission_id: "sub_1" })
  })
  test("a REQUEST_REJECTED with no reason is the closed code alone", async () => {
    answer = failure("REQUEST_REJECTED")
    expect(await runSyncOp(op)).toEqual({ status: "failed", code: "REQUEST_REJECTED", missing: [], submission_id: "sub_1" })
  })
})
