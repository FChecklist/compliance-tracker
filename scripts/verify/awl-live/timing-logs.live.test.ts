/// <reference types="bun-types" />
// Audit 100, checklist row B58: slow and failed calls to the DEPLOYED work-link function are visible to us, and we have a tested way to
// FIND them (scripts/verify/awl-timing-logs.ts; the format/query contract is unit-tested in src/lib/services/ai-work-link-timing-logs.test.ts).
//
//   1. PROBE  one GET to a unique, token-free address (`/awlprobe.<random>`): the function refuses it 404 on the token-shape check, before
//             any database call, so the probe costs the shared database nothing. Its timing line names that route.
//   2. FIND   the finder's own query, through the Supabase Management API logs endpoint, finds EXACTLY that one line again (log ingestion
//             takes a few seconds to a minute, so it polls for up to 3 minutes) and the line's status equals what HTTP answered.
//   3. BAD    the slow-or-failed query (the one to paste into the dashboard) returns only lines that really are slow (>= 3 s) or 5xx.
// Evidence: ai-os/audit37/evidence/timing-logs-<UTC time>.json. Mints no link, writes nothing.
// Run: bun test --isolate ./scripts/verify/awl-live/timing-logs.live.test.ts
import { describe, test, expect, setDefaultTimeout } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AWL_BASE, call, liveEnabled, redact } from "./live-lib"
import { badCallsSql, parseTimingLine, queryLogs, summarize, timingLinesSql, type ParsedTiming } from "../awl-timing-logs"

setDefaultTimeout(300_000)

describe.skipIf(!liveEnabled())("slow/failed work-link calls can be found in the function logs (live)", () => {
  const marker = `awlprobe.${Math.random().toString(36).slice(2, 10)}`
  const evidence: Record<string, unknown> = { measured_at: new Date().toISOString(), marker }

  test("a probe call is found again, exactly once, by the finder's query, with the status HTTP answered", async () => {
    const sentAt = new Date()
    const r = await call(`${AWL_BASE}/${marker}`)
    expect(r.status).toBe(404) // malformed token: refused before the database
    evidence.probe = { status: r.status, client_ms: Math.round(r.ms) }

    let found: Array<{ timestamp: string; line: ParsedTiming | null }> = []
    const t0 = Date.now()
    while (Date.now() - t0 < 180_000) {
      await new Promise((res) => setTimeout(res, 10_000))
      const rows = await queryLogs(timingLinesSql({ routeLike: `/${marker}`, limit: 10 }), new Date(sentAt.getTime() - 60_000), new Date(Date.now() + 60_000))
      found = rows.map((x) => ({ timestamp: x.timestamp, line: parseTimingLine(x.event_message) }))
      if (found.length > 0) break
    }
    evidence.found_after_s = Math.round((Date.now() - t0) / 1000)
    evidence.found = found
    expect(found.length).toBe(1)
    const line = found[0].line!
    expect(line).not.toBeNull()
    expect(line.route).toBe(`/${marker}`)
    expect(line.method).toBe("GET")
    expect(line.status).toBe(r.status)
    expect(line.failed).toBe(false)
    expect(line.slow).toBe(line.ms >= 3000)
  })

  test("the slow-or-failed query returns only calls that are really slow (>= 3 s) or 5xx; the 24 h summary is recorded", async () => {
    const end = new Date()
    const start = new Date(end.getTime() - 24 * 3600_000)
    const bad = await queryLogs(badCallsSql(500), start, end)
    const parsed = bad.map((b) => parseTimingLine(b.event_message))
    for (const p of parsed) {
      expect(p).not.toBeNull()
      expect(p!.slow || p!.failed).toBe(true)
      expect(p!.slow).toBe(p!.ms >= 3000)
      expect(p!.failed).toBe(p!.status >= 500)
    }
    const all = summarize(await queryLogs(timingLinesSql(), start, end))
    // every bad call the narrow query found is also counted by the broad one (unless the broad one hit its 1000-row cap)
    if (all.calls < 1000) expect(all.slow + all.failed).toBeGreaterThanOrEqual(bad.length)
    evidence.last_24h = { ...all, bad_query_rows: bad.length }

    const dir = join(import.meta.dir, "..", "..", "..", "ai-os", "audit37", "evidence")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `timing-logs-${String(evidence.measured_at).replace(/[:.]/g, "-")}.json`), redact(JSON.stringify(evidence, null, 2)) + "\n")
  })
})
