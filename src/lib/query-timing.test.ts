/// <reference types="bun-types" />
// R67 F-33 (R-278): the instrument the task-create path is measured with.
// Everything here is deliberately assertable without a DB -- the timer never
// touches one.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createQueryTimer, latencyDebugEnabled } from "./query-timing"

const originalDebug = process.env.DEBUG_LATENCY
const originalFile = process.env.DEBUG_LATENCY_FILE

beforeEach(() => {
  delete process.env.DEBUG_LATENCY
  delete process.env.DEBUG_LATENCY_FILE
})

afterEach(() => {
  if (originalDebug === undefined) delete process.env.DEBUG_LATENCY
  else process.env.DEBUG_LATENCY = originalDebug
  if (originalFile === undefined) delete process.env.DEBUG_LATENCY_FILE
  else process.env.DEBUG_LATENCY_FILE = originalFile
})

describe("createQueryTimer", () => {
  test("passes the query's own value straight through", async () => {
    const timer = createQueryTimer("createIssue")
    const value = await timer.time("issue.insert", async () => ({ id: "issue-1" }))
    expect(value).toEqual({ id: "issue-1" })
  })

  test("records one entry per query, in call order, with the label given at the call site", async () => {
    const timer = createQueryTimer("createIssue")
    await timer.time("project.sequence", async () => 1)
    await timer.time("issue.insert", async () => 2)
    expect(timer.timings().map((q) => q.label)).toEqual(["project.sequence", "issue.insert"])
    expect(timer.timings().every((q) => q.outcome === "ok")).toBe(true)
  })

  test("a query that throws is recorded as an error AND re-thrown -- the slow-then-failed query is the interesting one", async () => {
    const timer = createQueryTimer("createIssue")
    await expect(
      timer.time("issue.insert", async () => {
        throw new Error("duplicate key value violates unique constraint")
      })
    ).rejects.toThrow("duplicate key value violates unique constraint")

    const [entry] = timer.timings()
    expect(entry.label).toBe("issue.insert")
    expect(entry.outcome).toBe("error")
  })

  test("a step answered from cache is recorded as a step, so the line still shows every stage of the operation", async () => {
    const timer = createQueryTimer("createIssue")
    timer.note("issueType.cacheHit")
    await timer.time("issue.insert", async () => null)
    expect(timer.timings().map((q) => q.label)).toEqual(["issueType.cacheHit", "issue.insert"])
    expect(timer.timings()[0].ms).toBe(0)
  })

  test("timings() hands back a copy -- a caller cannot mutate the timer's own record", async () => {
    const timer = createQueryTimer("createIssue")
    await timer.time("issue.insert", async () => null)
    timer.timings().push({ label: "invented", ms: 999, outcome: "ok" })
    expect(timer.timings().map((q) => q.label)).toEqual(["issue.insert"])
  })

  test("durations are real elapsed milliseconds, not zero", async () => {
    const timer = createQueryTimer("createIssue")
    await timer.time("slow.query", () => new Promise((resolve) => setTimeout(resolve, 25)))
    expect(timer.timings()[0].ms).toBeGreaterThanOrEqual(20)
    expect(timer.totalMs()).toBeGreaterThanOrEqual(20)
  })

  test("collection happens with the flag OFF; only the log line is gated", async () => {
    expect(latencyDebugEnabled()).toBe(false)
    const timer = createQueryTimer("createIssue")
    await timer.time("issue.insert", async () => null)
    const printed: string[] = []
    const originalLog = console.log
    console.log = (line: string) => printed.push(line)
    try {
      timer.finish()
    } finally {
      console.log = originalLog
    }
    expect(timer.timings()).toHaveLength(1)
    expect(printed).toHaveLength(0)
  })

  test("with DEBUG_LATENCY=1 finish() prints one JSON line naming the operation and every query", async () => {
    process.env.DEBUG_LATENCY = "1"
    const timer = createQueryTimer("createIssue")
    await timer.time("project.sequence", async () => null)
    await timer.time("issue.insert", async () => null)

    const printed: string[] = []
    const originalLog = console.log
    console.log = (line: string) => printed.push(line)
    try {
      timer.finish({ projectId: "project-1" })
      // Called twice on purpose: a handler with several exits must not print
      // the same operation twice.
      timer.finish()
    } finally {
      console.log = originalLog
    }

    expect(printed).toHaveLength(1)
    const parsed = JSON.parse(printed[0])
    expect(parsed.t).toBe("query-timing")
    expect(parsed.scope).toBe("createIssue")
    expect(parsed.projectId).toBe("project-1")
    expect(parsed.queries.map((q: { label: string }) => q.label)).toEqual(["project.sequence", "issue.insert"])
    expect(typeof parsed.totalMs).toBe("number")
  })
})
