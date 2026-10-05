/// <reference types="bun-types" />
// AUDIT-100 B58: the FINDER of slow/failed AI-work-link calls (scripts/verify/awl-timing-logs.ts) and the LOG LINE the function writes
// (supabase/functions/ai-work-link/timing.ts) must never drift apart. The finder's SQL matches the line's TEXT with LIKE patterns; this test
// feeds lines produced by the REAL withTiming() through those exact patterns (LIKE translated to a regex, the way Postgres/ClickHouse read
// it) and through the parser. If someone pretty-prints the log JSON, renames a field or changes the prefix, this fails.
// The live half (a real call found again in the real logs) is scripts/verify/awl-live/timing-logs.live.test.ts.
// Run: bun test --isolate src/lib/services/ai-work-link-timing-logs.test.ts
import { describe, expect, test } from "bun:test"
import { withTiming } from "../../../supabase/functions/ai-work-link/timing"
import { LIKE_ANY, LIKE_FAILED, LIKE_SLOW, badCallsSql, parseTimingLine, summarize, timingLinesSql } from "../../../scripts/verify/awl-timing-logs"

const BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"

/** SQL LIKE -> RegExp (% any run, _ one char, everything else literal). */
const like = (pattern: string) => new RegExp(`^${pattern.split("").map((c) => (c === "%" ? "[\\s\\S]*" : c === "_" ? "[\\s\\S]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("")}$`)

/** One real log line: withTiming() around a fake handler that answers `status` after `ms` on a fake clock. */
async function realLine(path: string, status: number, ms: number, method = "GET"): Promise<string> {
  const lines: string[] = []
  let t = 0
  await withTiming(new Request(`${BASE}${path}`, { method }), async () => { t += ms; return new Response("", { status }) }, (l) => lines.push(l), () => t)
  expect(lines.length).toBe(1)
  // what Supabase stores as event_message: console.log adds a newline
  return `${lines[0]}\n`
}

const isBad = (m: string) => like(LIKE_ANY).test(m) && (like(LIKE_SLOW).test(m) || like(LIKE_FAILED).test(m))

describe("the finder's LIKE patterns select exactly the slow or failed real log lines", () => {
  test("a fast 200 is a timing line but not a bad call; a 21 s stall, a 503 and a thrown handler are bad calls", async () => {
    const fast = await realLine("/pxa_abc", 200, 420)
    const stall = await realLine("/pxa_abc/projects", 200, 21_000)
    const overloaded = await realLine("/pxa_abc", 503, 4003)
    const slow4xx = await realLine("/pxa_abc/context", 404, 3000)
    expect(like(LIKE_ANY).test(fast)).toBe(true)
    expect(isBad(fast)).toBe(false)
    expect(isBad(stall)).toBe(true)
    expect(isBad(overloaded)).toBe(true)
    expect(isBad(slow4xx)).toBe(true) // exactly at the 3 s threshold
    // a handler that throws is logged as a 500 before the error goes on
    const lines: string[] = []
    await expect(withTiming(new Request(`${BASE}/pxa_x`), async () => { throw new Error("boom") }, (l) => lines.push(l), () => 0)).rejects.toThrow("boom")
    expect(isBad(lines[0])).toBe(true)
  })

  test("a line from some other function, or a free-text mention, is not a timing line", () => {
    expect(like(LIKE_ANY).test('{"route":"/x","slow":true}')).toBe(false)
    expect(parseTimingLine("[awl-timing] not json")).toBeNull()
    expect(parseTimingLine('[awl-timing] {"route":"/x","method":"GET","status":"200","ms":1,"slow":false,"failed":false}')).toBeNull() // status as text
    expect(parseTimingLine("booted (time: 30ms)")).toBeNull()
  })

  test("the parser reads back every field of a real line; the line carries no token", async () => {
    const m = await realLine("/pxa_secretsecretsecret/projects/8f14e45f-ceea-467a-9ab1-0a5b1c2d3e4f/actions", 503, 5742, "POST")
    expect(parseTimingLine(m)).toEqual({ route: "/:token/projects/:id/actions", method: "POST", status: 503, ms: 5742, slow: true, failed: true })
    expect(m).not.toContain("secret")
  })
})

describe("the SQL the finder sends", () => {
  test("filters to the function's timing lines and to slow-or-failed, with the exact patterns tested above", () => {
    const sql = badCallsSql(50)
    expect(sql).toContain("source = 'function_logs'")
    expect(sql).toContain(`event_message like '${LIKE_ANY}'`)
    expect(sql).toContain(`(event_message like '${LIKE_SLOW}' or event_message like '${LIKE_FAILED}')`)
    expect(sql).toContain("order by timestamp desc limit 50")
    expect(badCallsSql(99999)).toContain("limit 1000")
  })

  test("a route filter is quoted safely (no way out of the string literal)", () => {
    const sql = timingLinesSql({ routeLike: "/x' or '1'='1", limit: 5 })
    expect(sql).toContain(`like '%"route":"/x'' or ''1''=''1"%'`)
    expect(sql.endsWith("limit 5")).toBe(true)
  })
})

describe("summarize", () => {
  test("counts, percentiles, per-route totals and the newest bad calls", async () => {
    const rows = [
      { timestamp: "t4", event_message: await realLine("/pxa_a", 503, 4003) },
      { timestamp: "t3", event_message: await realLine("/pxa_a", 200, 500) },
      { timestamp: "t2", event_message: await realLine("/pxa_a/projects", 200, 21_000) },
      { timestamp: "t1", event_message: "shutdown" },
    ]
    const s = summarize(rows)
    expect(s.calls).toBe(3)
    expect(s.unparsed).toBe(1)
    expect(s.slow).toBe(2)
    expect(s.failed).toBe(1)
    expect(s.ms).toEqual({ p50: 4003, p95: 21_000, max: 21_000 })
    expect(s.by_route["GET /:token"]).toEqual({ calls: 2, slow: 1, failed: 1, max_ms: 4003 })
    expect(s.newest_bad.map((b) => b.at)).toEqual(["t4", "t2"])
  })
})
