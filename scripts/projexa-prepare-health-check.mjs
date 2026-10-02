#!/usr/bin/env node
// PROJEXA prepare monitor: "which laptops are not at 100%, and why". Reads public.projexa_prepare_health() (drizzle/0688) through PostgREST with the
// service role and exits NON-ZERO when anything needs a human (so a scheduled run goes red and GitHub tells the owner):
//   * a laptop STALLED (it was preparing and stopped reporting),
//   * a laptop STUCK (it still reports, but its stage / percentage has not moved for 5 minutes),
//   * a laptop FAILING (failed, or retried three times) with its reason class,
//   * a laptop that NEVER FINISHED (started long ago, still not done),
//   * or the monitor itself unreachable (silence from the whole system is also a problem: we cannot see anyone).
// Nothing is changed by this script. Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/projexa-prepare-health-check.mjs [--stall=3] [--never=15] [--stuck=5] [--json]
// It prints the summary and one line per problem, and writes a GitHub step summary when GITHUB_STEP_SUMMARY is set.

import { appendFileSync } from "node:fs"

const arg = (name, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split("=")[1]) : d
}
const stall = arg("stall", 3)
const never = arg("never", 15)
const stuck = arg("stuck", 5)
const asJson = process.argv.includes("--json")

const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "")
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
if (!url || !key) {
  console.error("projexa-prepare-health-check: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
  process.exit(2)
}

async function call() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  try {
    const res = await fetch(`${url}/rest/v1/rpc/projexa_prepare_health`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Accept-Profile": "public", "Content-Profile": "public" },
      body: JSON.stringify({ p_stall_minutes: stall, p_never_minutes: never, p_stuck_minutes: stuck }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

const summary = (lines) => {
  const text = lines.join("\n")
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`) } catch { /* the console line is enough */ }
  }
}

let h
try {
  h = await call()
} catch (e) {
  summary(["## PROJEXA prepare monitor: UNREACHABLE", `We could not read the monitor (${e instanceof Error ? e.message : String(e)}). While this is red we cannot see whether laptops are downloading.`])
  process.exit(1)
}

if (asJson) console.log(JSON.stringify(h))
const problems = Array.isArray(h.problems) ? h.problems : []
const lines = [
  `## PROJEXA prepare monitor: ${problems.length === 0 ? "all clear" : `${problems.length} laptop(s) need attention`}`,
  `laptops ${h.laptops} | done ${h.done} | in progress ${h.in_progress} | STALLED ${h.stalled} | STUCK ${h.stuck} | FAILING ${h.failing} | NEVER FINISHED ${h.never_finished}  (checked ${h.checked_at})`,
]
for (const p of problems) {
  lines.push(
    `- ${String(p.health).toUpperCase()}: person ${p.user_id} (org ${p.org_id}), device ${p.device_id}, release ${p.release ?? "?"} -- stopped in "${p.stage}" at ${p.percent}% (${p.status}, attempt ${p.attempts}), ` +
      `silent ${p.silent_minutes} min, no progress ${p.no_progress_minutes} min${p.error_class ? `, reason: ${p.error_class}${p.error_detail ? ` (${p.error_detail})` : ""}` : ""}`,
  )
}
summary(lines)
process.exit(problems.length === 0 ? 0 : 1)
