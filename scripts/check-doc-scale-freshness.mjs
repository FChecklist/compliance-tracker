#!/usr/bin/env node
// VERIDIAN Review Framework gap closure (task-20260801-173750, AI-Readable
// Architecture/Database Documentation): docs/master/ARCHITECTURE.md and
// MODULE_MAP.md are hand-written snapshots, not continuously synced --
// their "Scale at time of writing" line (migrations/tables/services/
// routes/pages counts) drifts as the codebase grows and nothing previously
// caught it. Confirmed real drift before this check existed: the line
// documented in this repo as of 2026-07-09 (115 migrations, 460+ tables,
// 114 services, 573+ routes, 145+ pages) vs. live counts on 2026-08-01
// (282, 468, 211, 991, 187) -- migrations/services/routes had drifted
// 30-95%, tables had barely moved. This is the lighter continuous
// diff-check the finding's own recommended approach asked for (as an
// alternative to a full periodic Explore-agent re-run), same enforcement
// class as the other scripts/check-*.mjs gates: a reviewable-diff
// guarantee via PR/CI, not a runtime-unbypassable lock -- named honestly,
// not oversold. It does NOT verify the prose elsewhere in either doc is
// still accurate (e.g. "25 engine files, ~15 wired" claims), only the one
// numeric line each doc states its counts came from.
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const REPO_ROOT = process.cwd()
const SCHEMA_FILE = "src/lib/db/schema.ts"
const MODULE_MAP_FILE = "docs/master/MODULE_MAP.md"

// How far live counts may exceed the documented "+" floor before this is
// treated as a real, actionable drift rather than noise -- the documented
// numbers are written as a floor ("573+ API route files"), so only the
// live count growing meaningfully past that floor is flagged.
const DRIFT_THRESHOLD = 0.20

async function countFilesRecursive(relDir, matches) {
  let count = 0
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(path.resolve(REPO_ROOT, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) {
        await walk(rel)
      } else if (matches(e.name)) {
        count++
      }
    }
  }
  await walk(relDir)
  return count
}

async function countMigrations() {
  const entries = await readdir(path.resolve(REPO_ROOT, "drizzle"), { withFileTypes: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith(".sql")).length
}

async function countTables() {
  const raw = await readFile(path.resolve(REPO_ROOT, SCHEMA_FILE), "utf8")
  const re = /(?:complianceSchemaDB|platformSchemaDB)\.table\(/g
  return (raw.match(re) ?? []).length
}

async function countServices() {
  return countFilesRecursive("src/lib/services", (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
}

async function countRoutes() {
  return countFilesRecursive("src/app/api", (name) => name === "route.ts")
}

async function countPages() {
  return countFilesRecursive("src/app", (name) => name === "page.tsx")
}

// Parses the one documented line in MODULE_MAP.md this check holds to
// account, e.g.:
//   "**Scale at time of writing:** 115 migrations, 460+ tables (`compliance`
//   schema), 114 files in `src/lib/services/`, 573+ API route files, 145+
//   page files, ~61K lines of TS/TSX."
function parseDocumentedScale(raw) {
  const line = raw.split(/\r?\n/).find((l) => l.includes("Scale at time of writing"))
  if (!line) return null
  const grab = (re) => {
    const m = line.match(re)
    return m ? Number(m[1]) : null
  }
  return {
    line,
    migrations: grab(/(\d+)\+?\s*migrations/),
    tables: grab(/(\d+)\+?\s*tables/),
    services: grab(/(\d+)\+?\s*files in `src\/lib\/services\/`/),
    routes: grab(/(\d+)\+?\s*API route files/),
    pages: grab(/(\d+)\+?\s*page files/),
  }
}

async function main() {
  const moduleMapRaw = await readFile(path.resolve(REPO_ROOT, MODULE_MAP_FILE), "utf8")
  const documented = parseDocumentedScale(moduleMapRaw)
  if (!documented) {
    console.error(`=== Doc Scale Freshness Check FAILED ===`)
    console.error(`Could not find a "Scale at time of writing" line in ${MODULE_MAP_FILE} to check against.`)
    console.error(`If that line was intentionally removed, update this script; if it was accidentally`)
    console.error(`deleted, restore it.`)
    process.exit(1)
  }

  const live = {
    migrations: await countMigrations(),
    tables: await countTables(),
    services: await countServices(),
    routes: await countRoutes(),
    pages: await countPages(),
  }

  const drifted = []
  for (const key of Object.keys(live)) {
    const doc = documented[key]
    if (doc == null) continue // this doc's line doesn't state this metric -- nothing to compare
    const ratio = (live[key] - doc) / doc
    if (ratio > DRIFT_THRESHOLD) {
      drifted.push({ key, documented: doc, live: live[key], pct: Math.round(ratio * 100) })
    }
  }

  if (drifted.length > 0) {
    console.error("=== Doc Scale Freshness Check FAILED ===")
    console.error(`${MODULE_MAP_FILE}'s "Scale at time of writing" line has drifted >${DRIFT_THRESHOLD * 100}% from live counts:\n`)
    for (const d of drifted) {
      console.error(`  - ${d.key}: documented ${d.documented}, live ${d.live} (+${d.pct}%)`)
    }
    console.error(`\nUpdate the "Scale at time of writing" line in ${MODULE_MAP_FILE} with current counts`)
    console.error(`(and re-check any other prose in ARCHITECTURE.md/MODULE_MAP.md that cites a count),`)
    console.error(`then re-run. This does not mean re-writing the whole doc -- just the numbers.`)
    process.exit(1)
  }

  console.log(`Doc Scale Freshness Check passed -- live counts within ${DRIFT_THRESHOLD * 100}% of ${MODULE_MAP_FILE}'s documented scale:`)
  for (const key of Object.keys(live)) {
    console.log(`  - ${key}: documented ${documented[key] ?? "n/a"}, live ${live[key]}`)
  }
}

main().catch((err) => {
  console.error("Doc Scale Freshness Check crashed:", err)
  process.exit(1)
})
