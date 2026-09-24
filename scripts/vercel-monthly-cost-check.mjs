#!/usr/bin/env node
/**
 * vercel-monthly-cost-check.mjs — the "ten-second monthly cost check"
 * (work order PROJEXA-COST-001, Step 5.4: Vercel bill must never exceed $20/month).
 *
 * Pulls the team's FOCUS v1.3 billing charges from Vercel, ONE UTC day per API call
 * (each window's `to` is the next window's `from`), aggregates BilledCost by
 * ServiceName, prints exactly ONE line on stdout, and exits:
 *   0  projected monthly spend <= $20.00
 *   1  projected monthly spend  > $20.00   (so this can be a CI / cron guard)
 *   2  missing token, HTTP error, or unusable response
 *
 * Usage (never echo the token; it is read from the environment only):
 *   VERCEL_API_TOKEN=... node scripts/vercel-monthly-cost-check.mjs            # yesterday (UTC)
 *   VERCEL_API_TOKEN=... node scripts/vercel-monthly-cost-check.mjs --days 3   # last 3 full UTC days, summed
 *   VERCEL_API_TOKEN=... node scripts/vercel-monthly-cost-check.mjs --date 2026-09-20
 *   ... --json     print the per-service map (and buckets) instead of the one-liner
 *   VERCEL_TEAM_ID overrides the default team.
 *
 * Plain Node ESM, zero dependencies. All aggregation/formatting is exported so
 * `scripts/vercel-monthly-cost-check.test.ts` can exercise it without network access;
 * the CLI entry at the bottom only runs when this file is executed directly.
 */
import { pathToFileURL } from "node:url"

export const DEFAULT_TEAM_ID = "team_Iqx3zyb7sDdsdzcNskCFFsHD"
export const TARGET_MONTHLY_USD = 20.0
export const API_BASE = "https://api.vercel.com"
export const DAYS_PER_MONTH = 30

/** ServiceNames (case-insensitive substring match) that count as "serving" — traffic-driven usage. */
export const SERVING_SERVICE_PATTERNS = [
  "Function Invocations",
  "Fluid Active CPU",
  "Fluid Provisioned Memory",
  "Fast Origin Transfer",
  "Edge Requests", // also matches "Edge Requests Additional CPU Duration"
  "Additional CPU Duration",
  "Fast Data Transfer",
  "ISR Reads",
  "ISR Writes",
  "Observability Events",
]

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a FOCUS v1.3 response body. Vercel returns JSONL (one object per line), but
 * be tolerant of a JSON array or a single JSON object (e.g. an error envelope).
 * Returns { records, error } where `error` is set when the body is an error envelope.
 */
export function parseFocusJsonl(text) {
  const trimmed = (text ?? "").trim()
  if (!trimmed) return { records: [], error: null }
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed)
      return { records: Array.isArray(arr) ? arr : [], error: null }
    } catch {
      /* fall through to line-wise parsing */
    }
  }
  const records = []
  let error = null
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue // ignore a non-JSON line rather than abort the whole day
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (obj.error && !("ServiceName" in obj)) {
        error = obj.error
        continue
      }
      records.push(obj)
    }
  }
  return { records, error }
}

/** True when an error envelope / HTTP body means "Vercel has no cost data for this day". */
export function isNoDataError(status, bodyText, errorObj) {
  const code = String(errorObj?.code ?? "")
  const msg = String(errorObj?.message ?? "")
  const body = String(bodyText ?? "")
  if (/costs?_not_found|no_costs|not_found/i.test(code)) return true
  if (/costs?_not_found|no (cost|billing) data/i.test(msg)) return true
  if (/costs?_not_found/i.test(body)) return true
  return false
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Coerce a BilledCost/EffectiveCost value (number or numeric string) to a finite number. */
export function toCost(value) {
  if (value === null || value === undefined || value === "") return 0
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** Sum BilledCost by ServiceName → { [serviceName]: usd }. Missing/blank names bucket as "(unnamed)". */
export function aggregateByService(records, field = "BilledCost") {
  const out = {}
  for (const r of records ?? []) {
    if (!r || typeof r !== "object") continue
    const name = String(r.ServiceName ?? "").trim() || "(unnamed)"
    out[name] = (out[name] ?? 0) + toCost(r[field])
  }
  return out
}

/**
 * Vercel's FOCUS records are cut on Pacific-time days (ChargePeriodStart = 07:00Z/08:00Z), so a request
 * for UTC day D returns the PT day that ends inside D. Returns that PT calendar date ("YYYY-MM-DD"), or null.
 */
export function chargePeriodStart(records) {
  const ps = (records ?? []).find((r) => r && typeof r === "object" && r.ChargePeriodStart)?.ChargePeriodStart
  return ps ? String(ps).slice(0, 10) : null
}

/** Merge several per-day service maps into one. */
export function mergeServiceMaps(maps) {
  const out = {}
  for (const m of maps) for (const [k, v] of Object.entries(m ?? {})) out[k] = (out[k] ?? 0) + v
  return out
}

/** Classify a ServiceName into one of the one-liner's buckets. */
export function classifyService(name) {
  const n = String(name ?? "")
  if (/build/i.test(n)) return "builds"
  if (SERVING_SERVICE_PATTERNS.some((p) => n.toLowerCase().includes(p.toLowerCase()))) return "serving"
  if (/speed insights/i.test(n)) return "speedInsightsPlus"
  if (/web analytics/i.test(n)) return "webAnalyticsPlus"
  if (/^pro\b/i.test(n)) return "pro"
  return "other"
}

/** Roll a per-service map up into the fixed buckets + a list of "other" service names. */
export function bucketize(serviceMap) {
  const buckets = { pro: 0, speedInsightsPlus: 0, webAnalyticsPlus: 0, builds: 0, serving: 0, other: 0 }
  const otherNames = []
  let total = 0
  for (const [name, cost] of Object.entries(serviceMap ?? {})) {
    const b = classifyService(name)
    buckets[b] += cost
    total += cost
    if (b === "other" && cost !== 0) otherNames.push(name)
  }
  return { buckets, otherNames, total }
}

/** Daily average × 30. `days` is the number of UTC days the total covers (>= 1). */
export function projectMonthly(total, days) {
  const d = Math.max(1, Number(days) || 1)
  return (total / d) * DAYS_PER_MONTH
}

/** Exit-code decision: 1 when projected spend exceeds the target (strictly greater), else 0. */
export function decideExitCode(projected, target = TARGET_MONTHLY_USD) {
  return round2(projected) > round2(target) ? 1 : 0
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
const usd4 = (n) => `$${(Number(n) || 0).toFixed(4)}`
const usd2 = (n) => `$${round2(Number(n) || 0).toFixed(2)}`

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Build the single output line, e.g.
 * `2026-09-20  total=$1.2914  pro=$0.6452  speedInsightsPlus=$0.6452  webAnalyticsPlus=$0.0000  builds=$0.0000  serving=$0.0011  → projected/mo=$38.74 (target $20.00)  ⚠ OVER`
 */
export function formatLine({ label, buckets, otherNames = [], total, projected, target = TARGET_MONTHLY_USD, noDataDays = [] }) {
  const parts = [
    label,
    `total=${usd4(total)}`,
    `pro=${usd4(buckets.pro)}`,
    `speedInsightsPlus=${usd4(buckets.speedInsightsPlus)}`,
    `webAnalyticsPlus=${usd4(buckets.webAnalyticsPlus)}`,
    `builds=${usd4(buckets.builds)}`,
    `serving=${usd4(buckets.serving)}`,
  ]
  if (buckets.other) parts.push(`other=${usd4(buckets.other)}[${otherNames.join("|")}]`)
  parts.push(`→ projected/mo=${usd2(projected)} (target ${usd2(target)})`)
  parts.push(decideExitCode(projected, target) === 1 ? "⚠ OVER" : "✓ OK")
  if (noDataDays.length) parts.push(`(no data: ${noDataDays.join(",")})`)
  return parts.join("  ")
}

// ---------------------------------------------------------------------------
// Date windows
// ---------------------------------------------------------------------------

const isoDay = (d) => d.toISOString().slice(0, 10)
const utcMidnight = (dayStr) => new Date(`${dayStr}T00:00:00.000Z`)
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000)

/**
 * One window per full UTC day: { day, from, to } with `to` = next day's midnight (== next window's `from`).
 * opts: { date?: "YYYY-MM-DD", days?: N, now?: Date }. Default = yesterday.
 */
export function utcDayWindows({ date, days, now = new Date() } = {}) {
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(utcMidnight(date).getTime())) {
      throw new Error(`--date must be YYYY-MM-DD, got "${date}"`)
    }
    const from = utcMidnight(date)
    return [{ day: date, from: from.toISOString(), to: addDays(from, 1).toISOString() }]
  }
  const n = Math.max(1, Math.floor(Number(days) || 1))
  const todayMidnight = utcMidnight(isoDay(now))
  const windows = []
  for (let i = n; i >= 1; i--) {
    const from = addDays(todayMidnight, -i)
    windows.push({ day: isoDay(from), from: from.toISOString(), to: addDays(from, 1).toISOString() })
  }
  return windows
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { days: undefined, date: undefined, json: false, target: TARGET_MONTHLY_USD, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json") opts.json = true
    else if (a === "--help" || a === "-h") opts.help = true
    else if (a === "--days") opts.days = Number(argv[++i])
    else if (a.startsWith("--days=")) opts.days = Number(a.slice(7))
    else if (a === "--date") opts.date = argv[++i]
    else if (a.startsWith("--date=")) opts.date = a.slice(7)
    else if (a === "--target") opts.target = Number(argv[++i])
    else if (a.startsWith("--target=")) opts.target = Number(a.slice(9))
    else throw new Error(`unknown argument: ${a}`)
  }
  if (opts.days !== undefined && (!Number.isFinite(opts.days) || opts.days < 1)) throw new Error("--days must be a positive integer")
  if (opts.days !== undefined && opts.date) throw new Error("--days and --date are mutually exclusive")
  return opts
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Fetch ONE UTC day of charges. Returns
 *   { ok: true, records, noData: boolean }   on 200 / no-data
 *   { ok: false, status, snippet }           on any other HTTP failure
 * The token is only ever placed in the Authorization header — never logged.
 */
export async function fetchDayCharges({ token, teamId, window, fetchImpl = globalThis.fetch }) {
  const url = `${API_BASE}/v1/billing/charges?teamId=${encodeURIComponent(teamId)}&from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`
  const res = await fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
  const text = await res.text()
  const { records, error } = parseFocusJsonl(text)
  if (res.status === 200) {
    if (error && isNoDataError(res.status, text, error)) return { ok: true, records: [], noData: true }
    if (error) return { ok: false, status: res.status, snippet: text.slice(0, 200) }
    return { ok: true, records, noData: records.length === 0, periodStart: chargePeriodStart(records) }
  }
  if (isNoDataError(res.status, text, error)) return { ok: true, records: [], noData: true }
  return { ok: false, status: res.status, snippet: text.slice(0, 200) }
}

// ---------------------------------------------------------------------------
// Orchestration (pure w.r.t. process: returns { exitCode, stdout, stderr })
// ---------------------------------------------------------------------------

export async function run(argv, { env = process.env, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    return { exitCode: 2, stdout: "", stderr: `vercel-monthly-cost-check: ${e.message}` }
  }
  if (opts.help) {
    return { exitCode: 0, stdout: "usage: vercel-monthly-cost-check.mjs [--days N | --date YYYY-MM-DD] [--json] [--target USD]", stderr: "" }
  }
  const token = env.VERCEL_API_TOKEN
  if (!token) return { exitCode: 2, stdout: "", stderr: "vercel-monthly-cost-check: VERCEL_API_TOKEN is not set (export it in the environment; it is never logged)" }
  const teamId = env.VERCEL_TEAM_ID || DEFAULT_TEAM_ID

  let windows
  try {
    windows = utcDayWindows({ date: opts.date, days: opts.days, now })
  } catch (e) {
    return { exitCode: 2, stdout: "", stderr: `vercel-monthly-cost-check: ${e.message}` }
  }

  const perDay = []
  const noDataDays = []
  const notes = []
  for (const w of windows) {
    let r
    try {
      r = await fetchDayCharges({ token, teamId, window: w, fetchImpl })
    } catch (e) {
      return { exitCode: 2, stdout: "", stderr: `vercel-monthly-cost-check: request failed for ${w.day}: ${e?.message ?? e}` }
    }
    if (!r.ok) {
      return { exitCode: 2, stdout: "", stderr: `vercel-monthly-cost-check: HTTP ${r.status} for ${w.day}: ${r.snippet}` }
    }
    if (r.noData) {
      noDataDays.push(w.day)
      notes.push(`no data for ${w.day} (counted as $0)`)
    }
    perDay.push({ day: w.day, ptDay: r.periodStart ?? null, services: aggregateByService(r.records) })
  }

  const services = mergeServiceMaps(perDay.map((d) => d.services))
  const { buckets, otherNames, total } = bucketize(services)
  const days = windows.length
  const projected = projectMonthly(total, days)
  const exitCode = decideExitCode(projected, opts.target)
  // Label with Vercel's own PT charge days when the API reported them (matches the dashboard/invoice),
  // otherwise with the requested UTC days.
  const first = perDay[0].ptDay ?? windows[0].day
  const last = perDay[days - 1].ptDay ?? windows[days - 1].day
  const tz = perDay.some((d) => d.ptDay) ? " PT" : " UTC"
  const label = days === 1 ? `${first}${tz}` : `${first}..${last} (${days}d${tz})`

  const stdout = opts.json
    ? JSON.stringify({ window: label, days, teamId, services, buckets, otherNames, total, projectedMonthly: round2(projected), target: opts.target, over: exitCode === 1, noDataDays, perDay }, null, 2)
    : formatLine({ label, buckets, otherNames, total, projected, target: opts.target, noDataDays })
  return { exitCode, stdout, stderr: notes.join("\n") }
}

// ---------------------------------------------------------------------------
// CLI entry — only when executed directly (never on import, so tests stay network-free)
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(
    ({ exitCode, stdout, stderr }) => {
      if (stderr) process.stderr.write(stderr + "\n")
      if (stdout) process.stdout.write(stdout + "\n")
      process.exit(exitCode)
    },
    (e) => {
      process.stderr.write(`vercel-monthly-cost-check: ${e?.message ?? e}\n`)
      process.exit(2)
    },
  )
}
