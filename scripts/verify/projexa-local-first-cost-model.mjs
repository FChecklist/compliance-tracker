#!/usr/bin/env node
// PROJEXA local-first COST MODEL (package lf-b4-runbook). Plain node, no dependencies, no network.
//
// The owner's top priority is cost near zero. This script turns a handful of assumptions (users, projects per user, rows, session hours, sync intervals,
// peer share) into an estimate of the monthly load on every FREE-TIER limit of the stack and says which limit binds first and at how many users.
//
//   node scripts/verify/projexa-local-first-cost-model.mjs                       # defaults, 50 users
//   node scripts/verify/projexa-local-first-cost-model.mjs --users 500 --projectsPerUser 5 --peerShare 0.7
//   node scripts/verify/projexa-local-first-cost-model.mjs --json                # machine-readable
//   (every assumption and every limit is a --name value flag; unknown names are refused)
//
// DERIVATION of the per-action call counts (read from supabase/functions/projexa-sync/handler.ts, ROUTES, and projexa/docs/local-first/CONTRACT.md).
// A "call" is one HTTP request to the projexa-sync Edge function = ONE Edge Function invocation (a push also invokes ai-work-link-exec once per op).
//   K = 28 synced kinds (SYNC_KINDS), P = projects the person may read.
//   app open ............ GET /release/current (1) + GET /manifest (1) per session; POST /attest 1 per attestation TTL (ATTEST_TTL_SECONDS = 86400 -> 1 a day)
//   steady sync tick .... POST /changes once per POLLED project (CHANGES_LIMIT_MAX 1000: one page). A changed row is fetched with POST /pull {ids}, at most
//                         PULL_IDS_MAX = 200 ids per call, one call per touched kind. Peers never deliver tombstones, so /changes is polled even when peers
//                         deliver rows: peerShare lowers pull-by-ids calls and row egress, not /changes calls.
//   id repair ........... POST /ids {project, kind}: P x K x ceil(rows/IDS_LIMIT_MAX 5000), "at most once per project and kind per day" (contract section 1).
//                         THE BIGGEST FIXED COST per active user: P x 28 calls a day. Lowering it (weekly, or only for kinds with deletes) is the first lever.
//   first full sync ..... P x K x ceil(rows/PULL_LIMIT_MAX 500) pull pages + P /changes head reads, once per NEW user (newUserShare of users each month).
//   push ................ POST /push carries <= PUSH_OPS_MAX 50 ops; the laptop flushes its outbox in batches (pushBatchOps), and EVERY op is run by one
//                         ai-work-link-exec /sync-run call (execRun in index.ts): invocations = ceil(ops/batch) + ops.
//   jobs ................ POST /jobs/claim every jobsPollSec while the laptop is online (0 = never poll).
//   install ............. POST /install once per release update per laptop.
//   Realtime ............ peer announcements: each is delivered to (peersOnline - 1) other laptops; the model counts sent + delivered copies (conservative:
//                         whether Supabase counts delivered copies is TO VERIFY).
//   Vercel .............. the app is static; vercelFnPerUserDay defaults to 0 (the laptop serves itself). Static bandwidth = bundleMB x installs.
//
// FREE-TIER LIMITS (parameters; sources checked 2026-10-02 from memory of the vendor pages, NOT fetched by this script: re-verify before relying on them):
//   Supabase free plan: https://supabase.com/pricing  and  https://supabase.com/docs/guides/functions/limits
//     500,000 Edge Function invocations / month; 5 GB egress / month; https://supabase.com/docs/guides/realtime/limits : 200 concurrent connections, 2,000,000 messages / month.
//     Egress here = bytes the sync functions send back to laptops (all sync data leaves the database through the functions).
//   Vercel Hobby: https://vercel.com/docs/limits  100 GB fast data transfer / month (to verify); function invocations cap 1,000,000 / month (TO VERIFY, the
//     number is not certain). Hobby is also "non-commercial use" in the terms (to verify) - a licensing point, not a metered one.
//   Cloudflare Pages: https://developers.cloudflare.com/pages/platform/limits/  static bandwidth unlimited (the fallback host for the static bundle).

export const DEFAULT_ASSUMPTIONS = {
  users: 50, // total people with a laptop
  newUserShare: 0.1, // share of users doing their first full sync in a month
  activeDaysPerMonth: 22,
  projectsPerUser: 3, // P
  kinds: 28, // K, SYNC_KINDS.length
  rowsPerKind: 200, // average rows of one kind in one project
  avgRowBytes: 1500, // JSON of one row as pulled
  sigOverheadBytes: 220, // sig + version + envelope per item
  sessionsPerDay: 2,
  sessionHoursPerDay: 6, // online time with the app open
  syncIntervalMin: 10, // /changes poll interval
  projectsPolledPerTick: 1, // projects polled each tick (the open one)
  changedRowsPerDay: 40, // rows changed by others that this person must receive
  kindsTouchedPerDay: 4,
  idsRepairsPerDay: 1, // contract maximum
  pushOpsPerDay: 30,
  pushBatchOps: 5, // ops per outbox flush
  jobsPollSec: 300, // /jobs/claim interval while online (0 = off)
  peerShare: 0.5, // share of changed rows delivered laptop-to-laptop
  peersOnline: 5, // laptops of the same organisation online together (Realtime fan-out)
  peakConcurrentShare: 0.5, // share of users online at the same time (Realtime connections)
  releasesPerMonth: 8,
  bundleMB: 15,
  vercelFnPerUserDay: 0,
  manifestBytes: 20000,
  changeBytes: 70,
  idBytes: 45,
  smallCallBytes: 600, // /attest, /release/current, /install, /jobs/claim, /push result (per op)
}

export const DEFAULT_LIMITS = {
  supabaseEdgeInvocations: 500_000,
  supabaseEgressGB: 5,
  realtimeConcurrent: 200,
  realtimeMessages: 2_000_000,
  vercelFunctionInvocations: 1_000_000, // TO VERIFY
  vercelBandwidthGB: 100,
}

const GB = 1_000_000_000
const ceil = (a, b) => Math.ceil(a / b)

/** Monthly load of ONE active user, split by resource. Pure. */
export function perUserMonthly(a) {
  const P = a.projectsPerUser
  const K = a.kinds
  const days = a.activeDaysPerMonth
  const ticks = a.syncIntervalMin > 0 ? (a.sessionHoursPerDay * 60) / a.syncIntervalMin : 0
  const polled = Math.min(P, a.projectsPolledPerTick)

  const open = a.sessionsPerDay * 2 + 1 // release/current + manifest per session, one attest a day
  const changes = ticks * polled
  const kindsTouched = Math.max(0, Math.min(K, a.kindsTouchedPerDay))
  const serverRows = a.changedRowsPerDay * (1 - a.peerShare)
  const pullIds = kindsTouched > 0 && serverRows > 0 ? kindsTouched * ceil(serverRows / kindsTouched, 200) : 0
  const idsRepair = a.idsRepairsPerDay * P * K * ceil(a.rowsPerKind, 5000)
  const jobs = a.jobsPollSec > 0 ? (a.sessionHoursPerDay * 3600) / a.jobsPollSec : 0
  const pushCalls = a.pushOpsPerDay > 0 ? ceil(a.pushOpsPerDay, Math.min(50, Math.max(1, a.pushBatchOps))) : 0
  const execCalls = a.pushOpsPerDay
  const syncCallsPerDay = open + changes + pullIds + idsRepair + jobs + pushCalls + execCalls

  const firstSyncCalls = P * K * ceil(a.rowsPerKind, 500) + P
  const installCalls = a.releasesPerMonth
  const edgeInvocations = days * syncCallsPerDay + a.newUserShare * firstSyncCalls + installCalls

  const rowBytes = a.avgRowBytes + a.sigOverheadBytes
  const egressDay =
    a.sessionsPerDay * a.manifestBytes +
    changes * a.changeBytes +
    serverRows * rowBytes +
    idsRepair * a.rowsPerKind * a.idBytes + // each repair call returns the ids of one (project, kind)
    (jobs + pushCalls + execCalls + 1) * a.smallCallBytes
  const firstSyncBytes = P * K * a.rowsPerKind * rowBytes
  const egressBytes = days * egressDay + a.newUserShare * firstSyncBytes + installCalls * a.smallCallBytes

  const announce = a.changedRowsPerDay * a.peerShare + a.sessionsPerDay * 2 // row announcements + join/leave
  const realtimeMessages = days * announce * (1 + Math.max(0, a.peersOnline - 1))
  const realtimeConcurrent = a.peerShare > 0 ? a.peakConcurrentShare : 0

  const vercelFunctions = days * a.vercelFnPerUserDay
  const vercelBandwidthBytes = a.releasesPerMonth * a.bundleMB * 1_000_000 * 0.15 + a.newUserShare * a.bundleMB * 1_000_000 // an update moves ~15% of the bundle (changed files only); a new laptop the whole bundle

  return { edgeInvocations, egressBytes, realtimeMessages, realtimeConcurrent, vercelFunctions, vercelBandwidthBytes, breakdownPerDay: { open, changes, pullIds, idsRepair, jobs, pushCalls, execCalls } }
}

const RESOURCES = [
  { key: "supabaseEdgeInvocations", label: "Supabase Edge invocations / month", per: (u) => u.edgeInvocations, unit: "" },
  { key: "supabaseEgressGB", label: "Supabase egress (GB / month)", per: (u) => u.egressBytes / GB, unit: "GB" },
  { key: "realtimeMessages", label: "Realtime messages / month", per: (u) => u.realtimeMessages, unit: "" },
  { key: "realtimeConcurrent", label: "Realtime concurrent connections (peak)", per: (u) => u.realtimeConcurrent, unit: "" },
  { key: "vercelFunctionInvocations", label: "Vercel function invocations / month", per: (u) => u.vercelFunctions, unit: "" },
  { key: "vercelBandwidthGB", label: "Vercel static bandwidth (GB / month)", per: (u) => u.vercelBandwidthBytes / GB, unit: "GB" },
]

/** Estimate at `a.users` users against `limits`; every resource is linear in users, so the break-even user count is limit / per-user. */
export function estimate(a = DEFAULT_ASSUMPTIONS, limits = DEFAULT_LIMITS) {
  const u = perUserMonthly(a)
  const rows = RESOURCES.map((r) => {
    const perUser = r.per(u)
    const total = perUser * a.users
    const limit = limits[r.key]
    return { key: r.key, label: r.label, perUser, total, limit, ratio: limit > 0 ? total / limit : Infinity, maxUsers: perUser > 0 ? Math.floor(limit / perUser) : Infinity }
  })
  const finite = rows.filter((r) => r.maxUsers !== Infinity)
  const binding = finite.length ? finite.reduce((m, r) => (r.maxUsers < m.maxUsers ? r : m)) : null
  return { users: a.users, perUser: u, rows, binding, withinFreeTier: rows.every((r) => r.ratio <= 1) }
}

const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(1) : n.toFixed(3))

export function report(e) {
  const lines = [`PROJEXA local-first cost model, ${e.users} users`, ""]
  lines.push(["resource".padEnd(42), "per user".padStart(12), "total".padStart(14), "limit".padStart(12), "used".padStart(7), "max users".padStart(10)].join(" "))
  for (const r of e.rows) lines.push([r.label.padEnd(42), fmt(r.perUser).padStart(12), fmt(r.total).padStart(14), fmt(r.limit).padStart(12), `${(r.ratio * 100).toFixed(1)}%`.padStart(7), (r.maxUsers === Infinity ? "n/a" : fmt(r.maxUsers)).padStart(10)].join(" "))
  const b = e.perUser.breakdownPerDay
  lines.push("", `Edge calls per user per active day: open ${fmt(b.open)}, /changes ${fmt(b.changes)}, pull-by-ids ${fmt(b.pullIds)}, /ids repair ${fmt(b.idsRepair)}, jobs ${fmt(b.jobs)}, push ${fmt(b.pushCalls)}, exec ${fmt(b.execCalls)}`)
  lines.push(e.binding ? `BINDING CONSTRAINT: ${e.binding.label}, reached at about ${fmt(e.binding.maxUsers)} users.` : "No resource is consumed by these assumptions.")
  lines.push(e.withinFreeTier ? `VERDICT: ${e.users} users fit inside every free-tier limit.` : `VERDICT: ${e.users} users EXCEED a free-tier limit: ${e.rows.filter((r) => r.ratio > 1).map((r) => r.label).join("; ")}.`)
  return lines.join("\n")
}

export function parseArgs(argv, defaults = { ...DEFAULT_ASSUMPTIONS, ...DEFAULT_LIMITS }) {
  const out = { assumptions: { ...DEFAULT_ASSUMPTIONS }, limits: { ...DEFAULT_LIMITS }, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json") { out.json = true; continue }
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`)
    const name = a.slice(2)
    if (!(name in defaults)) throw new Error(`unknown option --${name}`)
    const v = Number(argv[++i])
    if (!Number.isFinite(v) || v < 0) throw new Error(`--${name} needs a non-negative number`)
    if (name in DEFAULT_LIMITS) out.limits[name] = v
    else out.assumptions[name] = v
  }
  return out
}

import { pathToFileURL } from "node:url"
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { assumptions, limits, json } = parseArgs(process.argv.slice(2))
    const e = estimate(assumptions, limits)
    console.log(json ? JSON.stringify(e, null, 2) : report(e))
    process.exit(e.withinFreeTier ? 0 : 1)
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    process.exit(2)
  }
}
