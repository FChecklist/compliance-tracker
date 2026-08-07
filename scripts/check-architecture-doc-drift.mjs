#!/usr/bin/env node
// Gap closure, 2026-08-07 (VERIDIAN Review Framework, AI Documentation --
// UMR-20260801-170930-2080 sub-task): closes the [Low] "AI-Readable
// Architecture Documentation" and [Low] "AI-Readable Database
// Documentation" findings, which share one root cause -- `ai-os/system-tree/`
// is a manual, point-in-time snapshot (last full regen 2026-07-26) with no
// signal that a re-sync is due. Re-running the full 5-parallel-Explore-agent
// methodology that built the tree is real, multi-hour work, not something
// to do on every commit. This script is the cheap, continuous half of the
// fix: it counts the same three real things `ai-os/system-tree/00-INDEX.md`
// cites (API routes, DB tables, DB enums) and warns -- does not fail the
// build, matching both findings' Low severity -- once live counts drift
// more than DRIFT_THRESHOLD_PCT from the recorded baseline.
//
// Honest limitation, same class as this repo's other check-*.mjs scripts:
// this only counts compliance-tracker's own three numbers. It cannot see
// projexa/veda-advisors (separate repos the tree also documents) drifting,
// and a warn-only check can be ignored -- it's a signal that a re-sync is
// due, not a guarantee one happens.
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const BASELINE_PATH = "ai-os/system-tree/DRIFT-BASELINE.yaml"
const SCHEMA_PATH = "src/lib/db/schema.ts"
const API_ROUTES_DIR = "src/app/api"
const DRIFT_THRESHOLD_PCT = 10

async function countApiRoutes() {
  let count = 0
  async function walk(dir) {
    const entries = await readdir(path.resolve(REPO_ROOT, dir), { withFileTypes: true })
    for (const entry of entries) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(rel)
      else if (entry.isFile() && entry.name === "route.ts") count++
    }
  }
  await walk(API_ROUTES_DIR)
  return count
}

async function countSchemaDeclarations() {
  const src = await readFile(path.resolve(REPO_ROOT, SCHEMA_PATH), "utf8")
  const tables = (src.match(/\.table\(/g) || []).length
  const enums = (src.match(/\.enum\('/g) || []).length
  return { tables, enums }
}

function pctDrift(live, baseline) {
  if (baseline === 0) return live === 0 ? 0 : Infinity
  return Math.abs(live - baseline) / baseline * 100
}

async function main() {
  const baselineRaw = await readFile(path.resolve(REPO_ROOT, BASELINE_PATH), "utf8")
  const baseline = yaml.load(baselineRaw)

  const [apiRoutes, schemaCounts] = await Promise.all([countApiRoutes(), countSchemaDeclarations()])

  const live = { api_routes: apiRoutes, db_tables: schemaCounts.tables, db_enums: schemaCounts.enums }

  const warnings = []
  for (const [key, liveValue] of Object.entries(live)) {
    const baselineValue = baseline.counts[key]
    const drift = pctDrift(liveValue, baselineValue)
    if (drift > DRIFT_THRESHOLD_PCT) {
      warnings.push(
        `${key}: baseline=${baselineValue} (recorded ${baseline.recorded_date}) live=${liveValue} ` +
        `(${drift.toFixed(1)}% drift, threshold ${DRIFT_THRESHOLD_PCT}%)`
      )
    }
  }

  console.log("Architecture/database doc drift check (ai-os/system-tree/):")
  console.log(`  live: api_routes=${live.api_routes} db_tables=${live.db_tables} db_enums=${live.db_enums}`)
  console.log(`  baseline (${baseline.recorded_date}): api_routes=${baseline.counts.api_routes} ` +
    `db_tables=${baseline.counts.db_tables} db_enums=${baseline.counts.db_enums}`)

  if (warnings.length === 0) {
    console.log("OK: all counts within threshold of the recorded baseline.")
    return
  }

  console.log(
    "\n::warning::ai-os/system-tree/ has drifted from its recorded baseline -- a re-sync " +
    "(re-run the 5-parallel-Explore-agent methodology, or at minimum refresh " +
    "ai-os/system-tree/DRIFT-BASELINE.yaml + 00-INDEX.md's counts) is due:"
  )
  for (const w of warnings) console.log(`  - ${w}`)
  console.log(
    "\nThis is a non-blocking warning by design (Low severity, matches the finding this " +
    "check closes) -- it does not fail the build."
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
