/// <reference types="bun-types" />
// R65 Part C Phase 3: unit tests for run-submission.ts's own memory-pipeline
// wiring. Only buildTaskResultMemoryContent() -- a pure formatter -- is
// tested here, matching this file's pre-existing (zero) test coverage
// convention for everything else in run-submission.ts: every other function
// here is withTenantContext/DB-backed (segment/classify/deriveChain/
// executeTask, all real DB round-trips) and none of it has ever had a
// mocked-DB unit test in this repo (unlike executor.ts/classify.ts/
// level0.ts/segment.ts, which do). captureTaskResultMemory() itself (the
// withTenantContext + createMemoryRecord() call this phase adds) is
// therefore a disclosed gap, not a silently-skipped one -- see this PR's
// own description.
//
// R65 Part D Phase 3 (2026-09) adds markInProgress() to this same file, for
// the same reason and under the same disclosed gap: it is a one-line
// withTenantContext DB write with no pure logic of its own to extract and
// unit test (unlike buildTaskResultMemoryContent()'s real string
// formatting), so it is exercised by this repo's real-DB-backed
// integration/E2E surface, not a mocked-DB unit test here.
import { describe, expect, test } from "bun:test"
import { buildTaskResultMemoryContent } from "./run-submission"

describe("buildTaskResultMemoryContent -- R65 Part C Phase 3 task memory", () => {
  test("includes the segment text and function id", () => {
    const content = buildTaskResultMemoryContent("record_work_progress", "PP1 is 50% done", { itemCode: "PP1", percent: 50 })
    expect(content).toContain("PP1 is 50% done")
    expect(content).toContain("record_work_progress")
  })

  test("includes a plain key=value param summary", () => {
    const content = buildTaskResultMemoryContent("record_work_progress", "PP1 is 50% done", { itemCode: "PP1", percent: 50 })
    expect(content).toContain("itemCode=\"PP1\"")
    expect(content).toContain("percent=50")
  })

  test("omits the parenthesised param summary entirely when there are no params", () => {
    const content = buildTaskResultMemoryContent("record_work_progress", "mark it done", {})
    expect(content).toBe('Task completed: "mark it done" -> record_work_progress')
    expect(content).not.toContain("()")
  })
})
