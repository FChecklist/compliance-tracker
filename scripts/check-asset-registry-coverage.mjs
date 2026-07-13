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

// Gap closure, 2026-07-13 (Boss directive, UMR follow-up): reduces the
// manual step from "write the migration/YAML from scratch" to "review and
// fill in the judgment fields" -- it does NOT auto-decide asset_type,
// name_column, purpose_column, module_column, or owner_column, all of
// which require understanding what the table actually represents (exactly
// the judgment this repo's own history shows can go wrong if guessed --
// see the employee_profiles precedent in drizzle/0171's own header). The
// one thing safely auto-detected is org_column: every real multi-tenant
// table in this schema either has a literal orgId column or genuinely
// doesn't need tenant scoping (a platform-wide table) -- both are visible
// facts, not judgment calls.
function buildRegistrationBoilerplate(table, schemaContent) {
  const tableBlockMatch = schemaContent.match(
    new RegExp(`complianceSchemaDB\\.table\\('${table}'[\\s\\S]*?\\n\\}\\)`, "m")
  )
  const block = tableBlockMatch ? tableBlockMatch[0] : ""
  const hasOrgColumn = /orgId:\s*text\('org_id'\)/.test(block)
  const orgColumnValue = hasOrgColumn ? "'org_id'" : "NULL -- no org_id column found on this table; confirm whether it's genuinely platform-wide"

  return [
    ``,
    `  --- ${table} ---`,
    `  Suggested drizzle/XXXX_register_${table}.sql (fill in the <FILL_IN> fields, do not guess):`,
    `    INSERT INTO compliance.asset_registration_config`,
    `      (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)`,
    `    VALUES`,
    `      ('${table}', '<FILL_IN: one of report|screen|dashboard|ai_agent|workflow|api|prompt|function|policy|rule|sql_query|email_template|notification|template|project|task|document|decision|automation|role|permission|computation_engine|dynamic_chain|other>',`,
    `       '<FILL_IN: the real display-name column>', <FILL_IN: purpose column or NULL>, <FILL_IN: module column or NULL>, ${orgColumnValue}, <FILL_IN: owner column or NULL>, <FILL_IN: a genuine boolean active column, or NULL>);`,
    ``,
    `    CREATE TRIGGER auto_register_asset_trg`,
    `      AFTER INSERT OR UPDATE OR DELETE ON compliance.${table}`,
    `      FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();`,
    `  OR, if this table is genuinely not a platform asset, add to ${COVERAGE_FILE} exempted:`,
    `    - table: ${table}`,
    `      reason: "<FILL_IN: a real, specific reason>"`,
  ].join("\n")
}

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
    console.error(`\n--- Boilerplate to speed up that decision (not a decision made for you) ---`)
    console.error(`Deliberately does NOT guess which column is the real display name, purpose,`)
    console.error(`or owner -- this repo's own history (employeeCode/jobTitle wrongly considered`)
    console.error(`a display name for employee_profiles, GAP-UMR-TABLE-COVERAGE) is exactly why`)
    console.error(`that judgment call stays a human/agent decision, not a heuristic guess.`)
    for (const t of missing) {
      console.error(buildRegistrationBoilerplate(t, schemaContent))
    }
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
