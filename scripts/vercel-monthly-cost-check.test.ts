/**
 * Network-free tests for scripts/vercel-monthly-cost-check.mjs (PROJEXA-COST-001 Step 5.4).
 * `globalThis.fetch` is stubbed with fake FOCUS v1.3 JSONL; the script's CLI entry is
 * guarded by an import.meta.url check, so importing it here performs no network call.
 *
 *   bun test --isolate scripts/vercel-monthly-cost-check.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  aggregateByService,
  bucketize,
  classifyService,
  decideExitCode,
  formatLine,
  parseFocusJsonl,
  projectMonthly,
  run,
  utcDayWindows,
} from "./vercel-monthly-cost-check.mjs"

const FAKE_TOKEN = "vct_FAKE_TOKEN_FOR_TEST_ONLY"
const originalFetch = globalThis.fetch

const line = (o: Record<string, unknown>) => JSON.stringify(o)
/** 3 fake FOCUS lines: one plan charge, one add-on, one serving item with a STRING BilledCost. */
const THREE_LINES = [
  line({ ServiceName: "Pro", ServiceCategory: "Subscription", BilledCost: 0.6452, EffectiveCost: 0.6452, ChargePeriodStart: "2026-09-20T00:00:00Z", ChargePeriodEnd: "2026-09-21T00:00:00Z" }),
  line({ ServiceName: "Speed Insights Plus", ServiceCategory: "Analytics", BilledCost: 0.6452, EffectiveCost: 0.6452, ChargePeriodStart: "2026-09-20T00:00:00Z", ChargePeriodEnd: "2026-09-21T00:00:00Z" }),
  line({ ServiceName: "Function Invocations", ServiceCategory: "Compute", BilledCost: "0.0011", EffectiveCost: "0.0011", ChargePeriodStart: "2026-09-20T00:00:00Z", ChargePeriodEnd: "2026-09-21T00:00:00Z" }),
].join("\n")

type Call = { url: string; auth: string | undefined }
function stubFetch(handler: (url: string, call: number) => { status: number; body: string }) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, auth: headers.Authorization })
    const { status, body } = handler(url, calls.length)
    return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } })
  }) as typeof fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("aggregation", () => {
  test("parseFocusJsonl + aggregateByService sums BilledCost per ServiceName, coercing string costs", () => {
    const { records, error } = parseFocusJsonl(THREE_LINES)
    expect(error).toBeNull()
    expect(records).toHaveLength(3)
    const agg = aggregateByService(records)
    expect(agg).toEqual({ Pro: 0.6452, "Speed Insights Plus": 0.6452, "Function Invocations": 0.0011 })
  })

  test("classifyService maps names to the one-liner buckets", () => {
    expect(classifyService("Pro")).toBe("pro")
    expect(classifyService("Speed Insights Plus")).toBe("speedInsightsPlus")
    expect(classifyService("Web Analytics Plus")).toBe("webAnalyticsPlus")
    expect(classifyService("Build CPU Minutes")).toBe("builds")
    expect(classifyService("Function Invocations")).toBe("serving")
    expect(classifyService("Edge Requests Additional CPU Duration")).toBe("serving")
    expect(classifyService("ISR Writes")).toBe("serving")
    expect(classifyService("Some New Thing")).toBe("other")
  })

  test("bucketize totals and surfaces unknown services under other", () => {
    const { buckets, otherNames, total } = bucketize({ Pro: 1, "Build CPU Minutes": 0.5, "Mystery Add-on": 0.25 })
    expect(buckets.pro).toBe(1)
    expect(buckets.builds).toBe(0.5)
    expect(buckets.other).toBe(0.25)
    expect(otherNames).toEqual(["Mystery Add-on"])
    expect(total).toBe(1.75)
  })

  test("projectMonthly is daily average × 30 and decideExitCode is strictly-greater-than target", () => {
    expect(projectMonthly(1.2915, 1)).toBeCloseTo(38.745, 3)
    expect(projectMonthly(3, 3)).toBe(30)
    expect(decideExitCode(20.0)).toBe(0)
    expect(decideExitCode(19.999)).toBe(0)
    expect(decideExitCode(20.01)).toBe(1)
  })

  test("utcDayWindows: one full UTC day per window, each to == next from; default is yesterday", () => {
    const now = new Date("2026-09-22T13:45:00Z")
    const one = utcDayWindows({ now })
    expect(one).toEqual([{ day: "2026-09-21", from: "2026-09-21T00:00:00.000Z", to: "2026-09-22T00:00:00.000Z" }])
    const three = utcDayWindows({ days: 3, now })
    expect(three.map((w) => w.day)).toEqual(["2026-09-19", "2026-09-20", "2026-09-21"])
    expect(three[0].to).toBe(three[1].from)
    expect(three[1].to).toBe(three[2].from)
    expect(utcDayWindows({ date: "2026-09-20" })[0]).toEqual({ day: "2026-09-20", from: "2026-09-20T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" })
  })
})

describe("run() end-to-end with stubbed fetch", () => {
  test("single day over target: aggregates the 3 fake lines, prints one line, exits 1, never leaks the token", async () => {
    const calls = stubFetch(() => ({ status: 200, body: THREE_LINES }))
    const r = await run(["--date", "2026-09-20"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN } })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain("/v1/billing/charges?teamId=team_Iqx3zyb7sDdsdzcNskCFFsHD")
    expect(calls[0].url).toContain("from=2026-09-20T00%3A00%3A00.000Z")
    expect(calls[0].url).toContain("to=2026-09-21T00%3A00%3A00.000Z")
    expect(calls[0].auth).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(r.exitCode).toBe(1)
    expect(r.stdout.split("\n")).toHaveLength(1)
    expect(r.stdout).toBe(
      "2026-09-20 PT  total=$1.2915  pro=$0.6452  speedInsightsPlus=$0.6452  webAnalyticsPlus=$0.0000  builds=$0.0000  serving=$0.0011  → projected/mo=$38.75 (target $20.00)  ⚠ OVER",
    )
    expect(r.stdout + r.stderr).not.toContain(FAKE_TOKEN)
  })

  test("single day under target exits 0 with OK", async () => {
    stubFetch(() => ({ status: 200, body: line({ ServiceName: "Pro", BilledCost: 0.5 }) }))
    const r = await run(["--date", "2026-09-20"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN } })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("projected/mo=$15.00 (target $20.00)  ✓ OK")
  })

  test("--days 2 makes one call per UTC day, chains windows, sums both days, projects on the daily average", async () => {
    const calls = stubFetch((_url, n) => ({ status: 200, body: line({ ServiceName: "Pro", BilledCost: n === 1 ? 1.0 : 0.5 }) }))
    const now = new Date("2026-09-22T05:00:00Z")
    const r = await run(["--days", "2"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN }, now })
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain("from=2026-09-20T00%3A00%3A00.000Z&to=2026-09-21T00%3A00%3A00.000Z")
    expect(calls[1].url).toContain("from=2026-09-21T00%3A00%3A00.000Z&to=2026-09-22T00%3A00%3A00.000Z")
    expect(r.stdout).toContain("2026-09-20..2026-09-21 (2d UTC)  total=$1.5000  pro=$1.5000")
    expect(r.stdout).toContain("projected/mo=$22.50 (target $20.00)  ⚠ OVER")
    expect(r.exitCode).toBe(1)
  })

  test("labels rows by Vercel's Pacific-time ChargePeriodStart day when the records carry one", async () => {
    stubFetch(() => ({ status: 200, body: line({ ServiceName: "Pro", BilledCost: 0.5, ChargePeriodStart: "2026-09-19T07:00:00.000Z", ChargePeriodEnd: "2026-09-20T07:00:00.000Z" }) }))
    const r = await run(["--date", "2026-09-20"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN } })
    expect(r.stdout.startsWith("2026-09-19 PT  total=$0.5000")).toBe(true)
    expect(r.exitCode).toBe(0)
  })

  test("a costs_not_found day counts as $0 and is reported, not fatal", async () => {
    stubFetch((_url, n) =>
      n === 1
        ? { status: 404, body: JSON.stringify({ error: { code: "costs_not_found", message: "No costs found for the given period" } }) }
        : { status: 200, body: line({ ServiceName: "Pro", BilledCost: 0.4 }) },
    )
    const r = await run(["--days", "2"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN }, now: new Date("2026-09-22T00:00:00Z") })
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain("no data for 2026-09-20")
    expect(r.stdout).toContain("total=$0.4000")
    expect(r.stdout).toContain("(no data: 2026-09-20)")
  })

  test("empty 200 body is treated as no data", async () => {
    stubFetch(() => ({ status: 200, body: "" }))
    const r = await run(["--date", "2026-09-20"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN } })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("total=$0.0000")
    expect(r.stdout).toContain("(no data: 2026-09-20)")
  })

  test("non-200 HTTP failure exits 2 with status + body snippet", async () => {
    stubFetch(() => ({ status: 500, body: "x".repeat(500) }))
    const r = await run(["--date", "2026-09-20"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN } })
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain("HTTP 500 for 2026-09-20: ")
    expect(r.stderr.length).toBeLessThan(300) // first 200 chars of body only
  })

  test("missing VERCEL_API_TOKEN exits 2 without calling the network", async () => {
    const calls = stubFetch(() => ({ status: 200, body: THREE_LINES }))
    const r = await run([], { env: {} })
    expect(r.exitCode).toBe(2)
    expect(calls).toHaveLength(0)
    expect(r.stderr).toContain("VERCEL_API_TOKEN is not set")
  })

  test("--json prints the per-service map and buckets", async () => {
    stubFetch(() => ({ status: 200, body: THREE_LINES }))
    const r = await run(["--date", "2026-09-20", "--json"], { env: { VERCEL_API_TOKEN: FAKE_TOKEN, VERCEL_TEAM_ID: "team_other" } })
    const j = JSON.parse(r.stdout)
    expect(j.teamId).toBe("team_other")
    expect(j.services).toEqual({ Pro: 0.6452, "Speed Insights Plus": 0.6452, "Function Invocations": 0.0011 })
    expect(j.buckets.serving).toBeCloseTo(0.0011, 6)
    expect(j.projectedMonthly).toBe(38.75)
    expect(j.over).toBe(true)
    expect(r.exitCode).toBe(1)
  })

  test("formatLine surfaces unknown services so nothing is silently dropped", () => {
    const s = formatLine({ label: "2026-09-20", buckets: { pro: 0, speedInsightsPlus: 0, webAnalyticsPlus: 0, builds: 0, serving: 0, other: 0.3 }, otherNames: ["Mystery"], total: 0.3, projected: 9 })
    expect(s).toContain("other=$0.3000[Mystery]")
    expect(s).toContain("✓ OK")
  })
})
