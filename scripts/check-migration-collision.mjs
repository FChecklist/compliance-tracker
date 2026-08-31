#!/usr/bin/env node
// CI guard: fails if two or more NEW (uncommitted or changed in the latest
// commit) migration files in drizzle/ share the same leading number prefix.
// This catches the repeated problem where two people create a migration file
// with the same number at the same time (e.g. both create 0224_*.sql), which
// causes drizzle-kit apply confusion and silent schema drift.
//
// Only checks files that are new or modified (not already in the base branch),
// so historical collisions that are already applied to production DBs don't
// cause CI to fail on every PR.
//
// Base ref resolution (fixed 2026-07-30 -- see PR discussion "stale local
// main ref" incident): in shared checkouts/worktrees, the local `main` ref
// is frequently stale relative to `origin/main` (e.g. an old worktree still
// has `main` checked out and can't be fast-forwarded from another worktree).
// A stale merge-base makes this script report pre-existing/historical
// collisions as new, or miss real new ones -- false signal either way.
// Resolution order, highest priority first:
//   1. --base <ref> CLI argument
//   2. BASE_REF environment variable
//   3. origin/main (fetched fresh, best-effort, non-fatal if it fails --
//      e.g. offline/shallow clone)
//   4. local main
//   5. HEAD~1
//
// Usage: node scripts/check-migration-collision.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-migration-collision.mjs
// Exit code 0 = no new collisions, 1 = new collision detected.

import { readdirSync } from "fs"
import { basename } from "path"
import { execSync } from "child_process"

const drizzleDir = new URL("../drizzle", import.meta.url).pathname

function resolveBaseRef() {
  // 1. Explicit --base <ref> CLI flag
  const argIdx = process.argv.indexOf("--base")
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1]
  }

  // 2. Explicit BASE_REF env var (lets CI / other agents pass the correct
  // ref without relying on ambient local-branch state)
  if (process.env.BASE_REF && process.env.BASE_REF.trim()) {
    return process.env.BASE_REF.trim()
  }

  // 3. origin/main, refreshed best-effort. `git fetch` failure (offline,
  // no remote, shallow clone with no network) is non-fatal -- we just fall
  // through to whatever origin/main ref we already have, or further down
  // the chain.
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" })
  } catch {
    // ignore -- use whatever origin/main we already have, if anything
  }
  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" })
    return "origin/main"
  } catch {
    // origin/main not available locally at all, fall through
  }

  // 4. local main
  try {
    execSync("git rev-parse --verify main", { stdio: "ignore" })
    return "main"
  } catch {
    // no local main either, fall through
  }

  // 5. last resort
  return "HEAD~1"
}

const baseRef = resolveBaseRef()

function mergeBaseWith(ref) {
  try {
    return execSync(`git merge-base HEAD ${ref} 2>/dev/null`, { encoding: "utf8" }).trim()
  } catch {
    return "HEAD~1"
  }
}

// Get list of SQL files changed or added (not deleted) relative to the
// resolved base ref
let changedFiles = []
try {
  const mergeBase = mergeBaseWith(baseRef)
  const output = execSync(
    `git diff --name-only --diff-filter=d ${mergeBase} HEAD -- drizzle/ 2>/dev/null | head -100`,
    { encoding: "utf8" }
  ).trim()
  // Also check untracked (not yet committed) files
  const untracked = execSync(
    `git ls-files --others --exclude-standard -- drizzle/ 2>/dev/null | head -100`,
    { encoding: "utf8" }
  ).trim()
  changedFiles = [...output.split("\n"), ...untracked.split("\n")].filter(Boolean).map(f => basename(f))
} catch {
  // If git commands fail (e.g. shallow clone), fall back to checking all files
  try {
    changedFiles = readdirSync(drizzleDir).filter(f => f.endsWith(".sql"))
  } catch {
    process.exit(0)
  }
}

// Among the changed files, check for number collisions. `drizzle/down/*.down.sql`
// files (rollback scripts, see docs/ROLLBACK_RUNBOOK.md) are excluded: they are
// deliberately named after the forward migration they reverse (e.g.
// drizzle/down/0217_x.down.sql pairs with drizzle/0217_x.sql), so sharing that
// number is correct by convention, not a collision.
const sqlFiles = changedFiles.filter(f => f.endsWith(".sql") && !f.endsWith(".down.sql"))
if (sqlFiles.length === 0) process.exit(0)

const numberMap = new Map()
for (const file of sqlFiles) {
  const match = file.match(/^(\d+)_/)
  if (!match) continue
  const num = match[1]
  if (!numberMap.has(num)) numberMap.set(num, [])
  numberMap.get(num).push(file)
}

const collisions = [...numberMap.entries()].filter(([, files]) => files.length > 1)

if (collisions.length > 0) {
  console.error("ERROR: Migration number collision detected among new/changed files!")
  for (const [num, files] of collisions) {
    console.error(`  Number ${num} is used by multiple files:`)
    for (const f of files) console.error(`    - drizzle/${f}`)
  }
  console.error("\nTwo migration files share the same number prefix. This causes")
  console.error("drizzle-kit apply confusion. Rename one to the next available number.")
  process.exit(1)
}

// Also check: does a new file's number collide with an EXISTING (already-committed) file?
// This catches the case where PR A adds 0224_foo.sql and PR B independently adds 0224_bar.sql
let allExistingFiles = []
try {
  const mergeBase = mergeBaseWith(baseRef)
  const existing = execSync(
    `git ls-tree -r --name-only ${mergeBase} -- drizzle/ 2>/dev/null`,
    { encoding: "utf8" }
  ).trim()
  allExistingFiles = existing.split("\n").filter(Boolean).map(f => basename(f))
} catch {
  // Can't determine existing files, skip cross-check
  process.exit(0)
}

const existingNumbers = new Map()
for (const file of allExistingFiles) {
  const match = file.match(/^(\d+)_/)
  if (!match) continue
  existingNumbers.set(match[1], file)
}

const crossCollisions = []
for (const file of sqlFiles) {
  const match = file.match(/^(\d+)_/)
  if (!match) continue
  const num = match[1]
  const existing = existingNumbers.get(num)
  if (existing && existing !== file) {
    // This new file's number already exists in main under a different filename
    // But only flag it if another NEW file also has this number (real collision)
    // OR if the new file's name differs from the existing one (number reuse)
    crossCollisions.push({ num, newFile: file, existingFile: existing })
  }
}

if (crossCollisions.length > 0) {
  console.error("ERROR: New migration file reuses a number that already exists on main!")
  for (const { num, newFile, existingFile } of crossCollisions) {
    console.error(`  Number ${num}:`)
    console.error(`    Existing: drizzle/${existingFile}`)
    console.error(`    New:      drizzle/${newFile}`)
  }
  console.error("\nA new migration file reuses a number already on the base branch.")
  console.error("Rename the new file to the next available number after the highest on main.")
  process.exit(1)
}

console.log(`OK: ${sqlFiles.length} new/changed migration files checked, no number collisions (base: ${baseRef}).`)
