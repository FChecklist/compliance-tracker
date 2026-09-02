#!/usr/bin/env node
// R67 lane I (WS-I item I-01) -- "a debug label can never be served to a
// customer again", enforced in CI.
//
// THE REAL INCIDENT: compliance.screen_definitions is the M28 screen registry
// PROJEXA renders its list/dashboard column headers from. Two rows shipped
// with a debugging label baked into their `columns` jsonb -- the dashboard KPI
// row a018f269-8375-44a5-a9ed-1060bf4d3efc, whose org_id is NULL (the GLOBAL
// row, so it leaked into every tenant), and the schedule.timeline row whose
// first column read "Activity (HARD-STOP TEST)". Nothing checked for it, so it
// was served to real customers until a human read it on a screenshot.
// drizzle/0528_r67_i01_screen_definition_labels.sql and
// drizzle/0531_r67_i04_schedule_boq_link_and_label_fix.sql correct the data;
// this job stops it recurring.
//
// THE RULE lives in src/lib/services/screen-definitions-labels.ts (unit-tested,
// imported by app code). This script cannot import that module -- it runs under
// plain `node` with no TypeScript build step, exactly like every other
// scripts/check-*.mjs here -- so it carries its own copy of the same one-line
// rule. That duplication is deliberate and is itself guarded:
// scripts/check-screen-definition-labels.test.ts reads the TypeScript module's
// source and asserts the two copies are character-for-character identical, so
// they cannot silently drift.
//
// WHY /test/i AND NOT SOMETHING NARROWER, and why an allowlist rather than a
// looser pattern: see that TypeScript module's header. Short version -- the
// bluntness is the point, and a genuine label containing "test" is registered
// as a reviewed exception, never handled by weakening the rule (AGENTS.md
// Rule 9).
//
// WHAT THIS DOES NOT DO: it does not run without a live database. The labels
// being checked are rows, not repo content -- there is no way to verify them
// from the checkout alone. With no DATABASE_URL (a fork, or a context where
// the secret is not exposed) it warns and exits 0, and it treats an
// unreachable database the same way, for the identical reason
// scripts/check-migration-integrity.mjs documents: production downtime must
// not block every PR in the repo from merging. A REACHABLE database with a
// leaked label DOES fail the build -- that is the guarantee this job provides.
//
// Usage: DATABASE_URL=... node scripts/check-screen-definition-labels.mjs
// Exit code 0 = clean (or DB unavailable, warned), 1 = a debug label is live.

import { pathToFileURL } from "url"

// *** MIRROR OF src/lib/services/screen-definitions-labels.ts's
// TEST_LABEL_PATTERN_SOURCE / TEST_LABEL_PATTERN_FLAGS. Keep both in step --
// scripts/check-screen-definition-labels.test.ts fails if they diverge. ***
export const TEST_LABEL_PATTERN_SOURCE = "test"
export const TEST_LABEL_PATTERN_FLAGS = "i"

// Mirror of ALLOWED_TEST_LABELS in that same module: labels reviewed as real
// customer wording rather than a debug artefact. Empty on introduction.
export const ALLOWED_TEST_LABELS = new Set([])

/** Pulls {index, label} for every element of a `columns` jsonb value, tolerating malformed/legacy rows. */
export function extractColumnLabels(columns) {
  if (!Array.isArray(columns)) return []
  const out = []
  columns.forEach((element, index) => {
    if (!element || typeof element !== "object") return
    const label = element.label
    if (typeof label !== "string") return
    out.push({ index, label })
  })
  return out
}

/** Every column label across `rows` that trips the debug-label rule and is not a registered exception. */
export function findLeakedTestLabels(rows) {
  const pattern = new RegExp(TEST_LABEL_PATTERN_SOURCE, TEST_LABEL_PATTERN_FLAGS)
  const leaks = []
  for (const row of rows) {
    for (const { index, label } of extractColumnLabels(row.columns)) {
      if (!pattern.test(label)) continue
      if (ALLOWED_TEST_LABELS.has(label)) continue
      leaks.push({ id: row.id, functionId: row.functionId, orgId: row.orgId, columnIndex: index, label })
    }
  }
  return leaks
}

/** Human-readable failure report -- everything needed to write the corrective UPDATE without another query. */
export function formatLeakedTestLabelReport(leaks) {
  if (leaks.length === 0) return "compliance.screen_definitions: no debug labels found."
  const lines = leaks.map(
    (l) =>
      `  - ${l.functionId} (row ${l.id}, ${l.orgId === null ? "GLOBAL -- leaks into every tenant" : `org ${l.orgId}`}) columns[${l.columnIndex}].label = ${JSON.stringify(l.label)}`
  )
  return [
    `compliance.screen_definitions: ${leaks.length} debug label(s) would be served to customers:`,
    ...lines,
  ].join("\n")
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL not set -- skipping the screen_definitions label scan.")
    console.warn("The labels this checks are database rows, not repo content; there is nothing to verify offline.")
    process.exit(0)
  }

  let sql
  try {
    const postgres = (await import("postgres")).default
    sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 5 })
    const rows = await sql`select id, function_id, org_id, columns from compliance.screen_definitions`
    const normalized = rows.map((r) => ({
      id: r.id,
      functionId: r.function_id,
      orgId: r.org_id ?? null,
      columns: r.columns,
    }))
    const leaks = findLeakedTestLabels(normalized)

    console.log(`Screen-definition label check: ${normalized.length} registry row(s) scanned, ${leaks.length} debug label(s) found.`)
    if (leaks.length > 0) {
      console.error("")
      console.error("ERROR: " + formatLeakedTestLabelReport(leaks))
      console.error("")
      console.error("Fix the DATA (an UPDATE in a new drizzle/*.sql migration, applied through Supabase),")
      console.error("not this check. If a label genuinely belongs in the product and merely contains the")
      console.error("word 'test', register the exact string in ALLOWED_TEST_LABELS here AND in")
      console.error("src/lib/services/screen-definitions-labels.ts, in its own reviewed PR, with a citation.")
      await sql.end({ timeout: 5 })
      process.exit(1)
    }

    await sql.end({ timeout: 5 })
    process.exit(0)
  } catch (err) {
    console.warn(`WARNING: could not complete the screen_definitions label scan (${err.message ?? err}).`)
    console.warn("Not failing CI on this -- an unreachable database is an infrastructure condition, not proof of a leak.")
    try { await sql?.end({ timeout: 1 }) } catch { /* best-effort cleanup */ }
    process.exit(0)
  }
}

// Only run main() when executed directly (not when imported for its pure
// functions by the test file) -- pathToFileURL handles both POSIX and Windows
// argv[1] paths correctly, unlike a manual string comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
