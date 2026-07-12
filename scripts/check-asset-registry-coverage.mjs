#!/usr/bin/env node
// Priority 4 (09-priority4-umr-universal-tracker.yaml): the mechanical half
// of the Owner's "software ensures... non-negotiable" requirement for the
// Universal Metadata Registry, same enforcement class as
// check-guardrail-presence.mjs (a reviewable-diff guarantee via PR/CI, not
// a runtime-unbypassable lock -- named honestly, not oversold).
//
// Every table declared in src/lib/db/schema.ts (`complianceSchemaDB.table(
// 'x', ...)`) must appear in EXACTLY ONE of the two lists in
// ai-os/registry/asset-registry-coverage.yaml:
//   - `registered`: has a compliance.asset_registration_config row + the
//     auto_register_asset trigger attached (drizzle/0152's mechanism) --
//     this check does NOT verify the trigger actually exists in the live
//     database (that's what scripts/check-registry-coverage.ts's
//     deterministic audit does, against real DB state); this check only
//     verifies the table made a REVIEWED, VISIBLE decision to register.
//   - `exempted`: a real, specific reason this table is deliberately not
//     an asset in the UMR sense, e.g. a join table or an append-only log.
//
// A table in NEITHER list fails CI. This is what makes "non-negotiable"
// real: a new table cannot silently ship without someone making (and
// writing down, in a reviewable PR diff) an explicit registry decision.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const SCHEMA_FILE = "src/lib/db/schema.ts"
const COVERAGE_FILE = "ai-os/registry/asset-registry-coverage.yaml"

const TABLE_DECL_RE = /complianceSchemaDB\.table\('([a-z_0-9]+)'/g

async function main() {
  const schemaContent = await readFile(path.resolve(REPO_ROOT, SCHEMA_FILE), "utf8")
  const declaredTables = new Set()
  for (const match of schemaContent.matchAll(TABLE_DECL_RE)) {
    declaredTables.add(match[1])
  }

  if (declaredTables.size === 0) {
    console.error(`No tables found via ${TABLE_DECL_RE} in ${SCHEMA_FILE} -- the pattern itself may have drifted from schema.ts's real declaration style. Failing closed rather than silently passing with zero coverage checked.`)
    process.exit(1)
  }

  const coverageRaw = await readFile(path.resolve(REPO_ROOT, COVERAGE_FILE), "utf8")
  const coverage = yaml.load(coverageRaw)

  const registered = new Set((coverage.registered ?? []).map((r) => (typeof r === "string" ? r : r.table)))
  const exempted = new Map((coverage.exempted ?? []).map((e) => [e.table, e.reason]))

  const missing = []
  const inBothLists = []

  for (const table of declaredTables) {
    const isRegistered = registered.has(table)
    const isExempted = exempted.has(table)
    if (isRegistered && isExempted) {
      inBothLists.push(table)
    } else if (!isRegistered && !isExempted) {
      missing.push(table)
    }
  }

  // Real reasons are required, not placeholder text -- an exemption with a
  // blank or trivially short reason defeats the point of forcing a real
  // decision.
  const weakReasons = []
  for (const [table, reason] of exempted) {
    if (!reason || reason.trim().length < 10) {
      weakReasons.push(table)
    }
  }

  let failed = false

  if (missing.length > 0) {
    failed = true
    console.error(`=== Asset Registry Coverage Check FAILED ===`)
    console.error(`${missing.length} table(s) in ${SCHEMA_FILE} are neither registered nor exempted in ${COVERAGE_FILE}:\n`)
    for (const t of missing) console.error(`  - ${t}`)
    console.error(`\nEvery table must make an explicit choice: add it to the "registered" list`)
    console.error(`(with a compliance.asset_registration_config row + auto_register_asset`)
    console.error(`trigger, see drizzle/0152_priority4_umr_auto_registration.sql's pattern) or`)
    console.error(`the "exempted" list with a real, specific reason it is not a platform asset.`)
  }

  if (inBothLists.length > 0) {
    failed = true
    console.error(`\n${inBothLists.length} table(s) appear in BOTH registered and exempted -- pick one:\n`)
    for (const t of inBothLists) console.error(`  - ${t}`)
  }

  if (weakReasons.length > 0) {
    failed = true
    console.error(`\n${weakReasons.length} exemption(s) have a missing or too-short reason (min 10 chars):\n`)
    for (const t of weakReasons) console.error(`  - ${t}`)
  }

  if (failed) process.exit(1)

  console.log(
    `Asset Registry Coverage Check passed -- all ${declaredTables.size} tables accounted for (${registered.size} registered, ${exempted.size} exempted).`
  )
}

main().catch((err) => {
  console.error("Asset Registry Coverage Check crashed:", err)
  process.exit(1)
})
