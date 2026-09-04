#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, AI Maintainability / Change Risk
// Management -- [High] "Rollback Readiness": "Rollback relies on generic
// git/CI mechanisms, not a dedicated capability. Recommended approach: Add
// down-migration scripts for Drizzle changes and document a rollback
// runbook for high-risk deploys." (See docs/ROLLBACK_RUNBOOK.md for the
// runbook half.)
//
// Investigated before writing this: 231 migrations exist in drizzle/ as of
// this wave. Writing a mechanical reverse-SQL down-migration for every one
// of them would misrepresent the real risk surface -- the overwhelming
// majority are `ADD COLUMN IF NOT EXISTS ...` (additive, idempotent, and
// already effectively self-rolling-back: old code that doesn't know about
// the new column just ignores it, so reverting the CODE via a normal git
// revert / Vercel rollback is a complete rollback with zero DB action
// needed). Retrofitting all 231 would be both infeasible in one pass and
// dishonest about which ones actually need a hand-written reverse path.
//
// So this is the DECISION tool, not a blanket mandate: it scans every
// migration for genuinely non-additive SQL (DROP TABLE/COLUMN, RENAME,
// ALTER COLUMN ... TYPE, SET NOT NULL) -- the operations a plain code
// revert cannot undo, because the data or structure they destroy is gone
// -- and reports which of those "risky" migrations do/don't have a
// corresponding hand-written down-migration in drizzle/down/. Purely
// additive migrations are reported separately as informational (no down
// migration needed, self-rollback via code revert) rather than silently
// ignored, so the report is honest about what "reversible" actually means
// here rather than just counting files.
//
// This is NOT wired into any CI workflow (deliberately) -- turning this
// into a hard PR gate for all 231 existing migrations (5 of which are
// already-applied production history with no realistic path to a
// retroactive down file) would break unrelated in-flight work under
// AGENTS.md Rule 6/9's "no guardrail added without weighing the cost"
// spirit, without a real safety win (those migrations are long since
// applied in production; a rollback of them today is not a routine
// operation). It's report/advisory tooling for a human (or an agent
// reviewing a new migration) to run before or during a high-risk change --
// see docs/ROLLBACK_RUNBOOK.md's "before you ship" checklist for where
// this fits into the actual workflow.
//
// Usage: node scripts/check-migration-reversibility.mjs [--risky-only]
// Exit code: always 0 (report-only, not a gate) unless it cannot read
// drizzle/ at all.

import { readdirSync, existsSync } from "fs"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const DRIZZLE_DIR = path.join(REPO_ROOT, "drizzle")
const DOWN_DIR = path.join(DRIZZLE_DIR, "down")

// Patterns that a plain `git revert` of application code CANNOT undo,
// because they destroy data/structure rather than add to it. Deliberately
// excludes `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` /
// `ADD CONSTRAINT` / plain `CREATE TABLE`, which are additive.
const NON_ADDITIVE_PATTERNS = [
  { re: /\bDROP\s+TABLE\b/i, label: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, label: "DROP COLUMN" },
  { re: /\bRENAME\b/i, label: "RENAME" },
  { re: /\bALTER\s+COLUMN\s+"?\w+"?\s+TYPE\b/i, label: "ALTER COLUMN ... TYPE" },
  { re: /\bSET\s+NOT\s+NULL\b/i, label: "SET NOT NULL" },
  { re: /\bDROP\s+TYPE\b/i, label: "DROP TYPE" },
]

export function classifyMigration(sql) {
  const matched = NON_ADDITIVE_PATTERNS.filter((p) => p.re.test(sql)).map((p) => p.label)
  return { risky: matched.length > 0, reasons: matched }
}

export function downMigrationPathFor(migrationFileName) {
  const base = migrationFileName.replace(/\.sql$/, "")
  return `${base}.down.sql`
}

function main() {
  const riskyOnly = process.argv.includes("--risky-only")

  let files
  try {
    files = readdirSync(DRIZZLE_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".sql"))
      .map((e) => e.name)
      .sort()
  } catch (err) {
    console.error(`Cannot read ${DRIZZLE_DIR}: ${err.message}`)
    process.exit(1)
  }

  const risky = []
  const additiveOnly = []

  for (const file of files) {
    const sql = readFileSync(path.join(DRIZZLE_DIR, file), "utf8")
    const { risky: isRisky, reasons } = classifyMigration(sql)
    if (isRisky) {
      const downPath = downMigrationPathFor(file)
      const hasDown = existsSync(path.join(DOWN_DIR, downPath))
      risky.push({ file, reasons, hasDown, downPath })
    } else {
      additiveOnly.push(file)
    }
  }

  console.log(`Scanned ${files.length} migration(s) in drizzle/.\n`)

  console.log(`Non-additive (need a real down path or documented rollback decision): ${risky.length}`)
  for (const r of risky) {
    const status = r.hasDown ? "has down-migration" : "NO down-migration"
    console.log(`  - ${r.file} [${r.reasons.join(", ")}] -- ${status} (drizzle/down/${r.downPath})`)
  }

  if (!riskyOnly) {
    console.log(`\nPurely additive (self-rollback via code revert, no down migration needed): ${additiveOnly.length}`)
  }

  const missingDown = risky.filter((r) => !r.hasDown)
  if (missingDown.length > 0) {
    console.log(
      `\n${missingDown.length} non-additive migration(s) have no down-migration yet. See docs/ROLLBACK_RUNBOOK.md for the convention and decision tree before writing one (some of these are old, already-applied production history where a retroactive down file may not be the right call -- use judgment, this is advisory, not a gate).`
    )
  }

  // Report-only: never fails CI. See header comment for why this is
  // deliberately not a hard gate.
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
