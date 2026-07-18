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
// Usage: node scripts/check-migration-collision.mjs
// Exit code 0 = no new collisions, 1 = new collision detected.

import { readdirSync } from "fs"
import { basename, join } from "path"
import { execSync } from "child_process"

const drizzleDir = new URL("../drizzle", import.meta.url).pathname

// Get list of SQL files changed or added (not deleted) relative to main
let changedFiles = []
try {
  const mergeBase = execSync("git merge-base HEAD main 2>/dev/null || echo HEAD~1", { encoding: "utf8" }).trim()
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

// Among the changed files, check for number collisions
const sqlFiles = changedFiles.filter(f => f.endsWith(".sql"))
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
  const mergeBase = execSync("git merge-base HEAD main 2>/dev/null || echo HEAD~1", { encoding: "utf8" }).trim()
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

console.log(`OK: ${sqlFiles.length} new/changed migration files checked, no number collisions.`)
process.exit(0)