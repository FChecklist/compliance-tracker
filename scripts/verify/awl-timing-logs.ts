// AUDIT-100 B58: FIND the slow and failed calls of the AI work link.
//
// Every request to the ai-work-link Edge Function writes ONE line to the function's logs (supabase/functions/ai-work-link/timing.ts):
//   [awl-timing] {"route":"/:token/projects/:id","method":"GET","status":503,"ms":4003,"slow":true,"failed":true}
// `slow` is 3 s or more, `failed` is a 5xx. This file is the tested way to find those lines, so a stall is never "invisible to us":
//
//   bun scripts/verify/awl-timing-logs.ts                 last 24 hours: counts, p50/p95/max ms, slow+failed by route, the 20 newest bad calls
//   bun scripts/verify/awl-timing-logs.ts --hours 6       a shorter window (1 to 24; the logs API caps one query at 24 hours)
//   bun scripts/verify/awl-timing-logs.ts --json          the same, as JSON
//
// It reads the logs through the Supabase Management API (GET /v1/projects/{ref}/analytics/endpoints/logs, the unified `logs` table) with
// the owner's access token (SUPABASE_ACCESS_TOKEN, or C:\ct\ct\.env.local; never printed). Read only. The same SQL works unchanged in the
// Supabase dashboard (Logs -> SQL) and in the `query_logs` MCP tool: copy `badCallsSql()` from below.
//
// The SQL matches the line TEXT (`"slow":true`), so it depends on JSON.stringify writing no spaces; src/lib/services/ai-work-link-timing-logs.test.ts
// feeds real timing.ts output through these exact patterns and fails the moment the format and the query drift apart.
import { PROJECT_REF, accessToken, redact } from "./awl-live/live-lib"

export const TIMING_PREFIX = "[awl-timing] "
/** SQL LIKE patterns, applied to `event_message`. Exported so the unit test checks them against real log lines. */
export const LIKE_ANY = "%[awl-timing]%"
export const LIKE_SLOW = '%"slow":true%'
export const LIKE_FAILED = '%"failed":true%'

export type ParsedTiming = { route: string; method: string; status: number; ms: number; slow: boolean; failed: boolean }

/** One `event_message` -> the timing fields, or null when the message is not a well-formed timing line. */
export function parseTimingLine(message: string): ParsedTiming | null {
  const at = message.indexOf(TIMING_PREFIX)
  if (at < 0) return null
  let j: any
  try { j = JSON.parse(message.slice(at + TIMING_PREFIX.length).trim()) } catch { return null }
  if (!j || typeof j !== "object") return null
  const { route, method, status, ms, slow, failed } = j
  if (typeof route !== "string" || !route.startsWith("/") || typeof method !== "string") return null
  if (!Number.isInteger(status) || !Number.isFinite(ms) || ms < 0 || typeof slow !== "boolean" || typeof failed !== "boolean") return null
  return { route, method, status, ms, slow, failed }
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

/** All timing lines (newest first). `routeLike` narrows to one route text (used by the live test to find its own probe). */
export function timingLinesSql(opts: { limit?: number; routeLike?: string } = {}): string {
  const limit = Math.max(1, Math.min(1000, Math.floor(opts.limit ?? 1000)))
  const route = opts.routeLike ? ` and event_message like ${sqlString(`%"route":"${opts.routeLike}"%`)}` : ""
  return `select timestamp, event_message from logs where source = 'function_logs' and event_message like ${sqlString(LIKE_ANY)}${route} order by timestamp desc limit ${limit}`
}

/** Only the slow (>= 3 s) or failed (5xx) calls, newest first. This is the query to paste into the dashboard. */
export function badCallsSql(limit = 200): string {
  const l = Math.max(1, Math.min(1000, Math.floor(limit)))
  return `select timestamp, event_message from logs where source = 'function_logs' and event_message like ${sqlString(LIKE_ANY)} and (event_message like ${sqlString(LIKE_SLOW)} or event_message like ${sqlString(LIKE_FAILED)}) order by timestamp desc limit ${l}`
}

export type Row = { timestamp: string; event_message: string }

/** Runs one logs query through the Management API over [start, end] (at most 24 hours). Throws on a non-200, with the token redacted. */
export async function queryLogs(sql: string, start: Date, end: Date, token = accessToken()): Promise<Row[]> {
  if (!token) throw new Error("no Supabase access token available")
  const u = new URL(`https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs`)
  u.searchParams.set("sql", sql)
  u.searchParams.set("iso_timestamp_start", start.toISOString())
  u.searchParams.set("iso_timestamp_end", end.toISOString())
  const r = await fetch(u, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) })
  const text = await r.text()
  if (r.status !== 200) throw new Error(redact(`logs query failed ${r.status}: ${text.slice(0, 300)}`))
  const body = JSON.parse(text)
  if (body.error) throw new Error(redact(`logs query error: ${JSON.stringify(body.error).slice(0, 300)}`))
  return (body.result ?? []) as Row[]
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : null)

export function summarize(rows: Row[]) {
  const parsed = rows.map((r) => ({ at: r.timestamp, line: parseTimingLine(r.event_message) }))
  const good = parsed.filter((p): p is { at: string; line: ParsedTiming } => p.line !== null)
  const ms = good.map((g) => g.line.ms).sort((a, b) => a - b)
  const byRoute: Record<string, { calls: number; slow: number; failed: number; max_ms: number }> = {}
  for (const { line } of good) {
    const k = `${line.method} ${line.route}`
    const e = (byRoute[k] ??= { calls: 0, slow: 0, failed: 0, max_ms: 0 })
    e.calls++
    if (line.slow) e.slow++
    if (line.failed) e.failed++
    e.max_ms = Math.max(e.max_ms, line.ms)
  }
  return {
    calls: good.length,
    unparsed: parsed.length - good.length,
    slow: good.filter((g) => g.line.slow).length,
    failed: good.filter((g) => g.line.failed).length,
    ms: { p50: pct(ms, 50), p95: pct(ms, 95), max: ms.length ? ms[ms.length - 1] : null },
    by_route: byRoute,
    newest_bad: good.filter((g) => g.line.slow || g.line.failed).slice(0, 20).map((g) => ({ at: g.at, ...g.line })),
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const h = args.indexOf("--hours")
  const hours = Math.max(1, Math.min(24, Number(h >= 0 ? args[h + 1] : 24) || 24))
  const end = new Date()
  const start = new Date(end.getTime() - hours * 3600_000)
  const all = await queryLogs(timingLinesSql(), start, end)
  const out = { window: { start: start.toISOString(), end: end.toISOString(), hours }, note: all.length >= 1000 ? "1000-row cap reached: counts cover the newest 1000 calls only" : undefined, ...summarize(all) }
  if (args.includes("--json")) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`ai-work-link calls, last ${hours} h: ${out.calls} (slow >= 3 s: ${out.slow}, failed 5xx: ${out.failed}); ms p50 ${out.ms.p50} p95 ${out.ms.p95} max ${out.ms.max}${out.note ? ` [${out.note}]` : ""}`)
    for (const [k, v] of Object.entries(out.by_route).sort((a, b) => b[1].slow + b[1].failed - (a[1].slow + a[1].failed))) if (v.slow || v.failed) console.log(`  ${k}: ${v.calls} calls, ${v.slow} slow, ${v.failed} failed, max ${v.max_ms} ms`)
    for (const b of out.newest_bad) console.log(`  ${b.at}  ${b.method} ${b.route} -> ${b.status} in ${b.ms} ms`)
  }
}
