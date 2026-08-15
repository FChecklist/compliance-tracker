#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, retry 2 (2026-08-15): "AI Can
// Safely Modify Module" (Medium -- "CI gate does not include comprehensive
// behavioral test coverage"). Recommended approach, taken literally: require
// a minimum test-coverage delta (or at least one new test) on PRs touching
// previously-untested files -- so a change to a file with zero behavioral
// safety net can't merge without adding at least one.
//
// Same enforcement class as the other check-*.mjs gates in this repo
// (check-migration-collision.mjs, check-asset-registry-coverage.mjs, etc.):
// a reviewable-diff guarantee via PR/CI, not a runtime-unbypassable lock.
// Honest limitations, stated up front:
//   - Only checks that the PR touches SOME test file, not that the test
//     actually exercises the changed behavior. A trivial/unrelated test
//     edit satisfies this gate. That's the literal "at least one new test"
//     bar the recommendation asked for, not a coverage-percentage gate.
//   - Scoped to `.ts` files only, deliberately excluding `.tsx`. Confirmed
//     by reading package.json before writing this: no
//     @testing-library/react or jsdom/happy-dom is installed, and zero
//     `*.test.tsx` files exist anywhere in this repo (git ls-files
//     '*.test.tsx' -- empty). Every existing test in this repo is a
//     bun:test unit test over plain TypeScript logic (services, API route
//     handlers, scripts) -- gating React page/component files the same way
//     would require standing up a whole new testing stack first, which is
//     out of scope for this gap-closure PR and would immediately block
//     unrelated future frontend PRs. If/when React component testing is
//     added, extend isRelevantSourcePath below rather than widening this
//     gate blindly.
//   - "Previously untested" = no colocated `<basename>.test.ts` existed at
//     the PR's merge-base with main. A file that already has a colocated
//     test, and that test isn't touched by this PR, is NOT flagged --
//     this gate targets the *first* test for a file, not every subsequent
//     change to an already-tested one (that's a broader coverage-ratchet
//     policy this repo hasn't adopted).
//
// Usage: node scripts/check-test-coverage-delta.mjs
// Exit code 0 = pass (or nothing to check), 1 = previously-untested file(s)
// touched with zero test files added/modified in this PR.

import { execSync } from "node:child_process"

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

function fileExistsAtRef(ref, path) {
  try {
    execSync(`git cat-file -e ${ref}:${path}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function isTestPath(p) {
  return /\.test\.ts$/.test(p)
}

// Deliberately `.ts` only -- see header comment.
function isRelevantSourcePath(p) {
  return p.endsWith(".ts") && !isTestPath(p) && !p.endsWith(".d.ts")
}

function colocatedTestPath(p) {
  return `${p.slice(0, -".ts".length)}.test.ts`
}

let mergeBase = run("git merge-base HEAD origin/main")
if (!mergeBase) mergeBase = run("git merge-base HEAD main")
if (!mergeBase) {
  console.log(
    "Test Coverage Delta Check: could not determine a merge-base against main (shallow clone, detached history, " +
      "or no main ref reachable) -- skipping, same fallback precedent as check-migration-collision.mjs."
  )
  process.exit(0)
}

const changedRaw = run(`git diff --name-only --diff-filter=d ${mergeBase} HEAD -- src scripts`)
const changedFiles = changedRaw ? changedRaw.split("\n").filter(Boolean) : []

const changedSourceFiles = changedFiles.filter(isRelevantSourcePath)
const changedTestFiles = changedFiles.filter(isTestPath)

if (changedSourceFiles.length === 0) {
  console.log("Test Coverage Delta Check: no relevant .ts source files changed in this PR -- nothing to check.")
  process.exit(0)
}

const untestedTouched = changedSourceFiles.filter((f) => !fileExistsAtRef(mergeBase, colocatedTestPath(f)))

if (untestedTouched.length === 0) {
  console.log(
    "Test Coverage Delta Check: every changed .ts source file already had a colocated test before this PR. Pass."
  )
  process.exit(0)
}

if (changedTestFiles.length > 0) {
  console.log(
    `Test Coverage Delta Check: PR touches ${untestedTouched.length} previously-untested file(s) but also adds/` +
      `modifies ${changedTestFiles.length} test file(s) in this PR -- satisfies the "at least one new test" ` +
      "minimum. Pass."
  )
  process.exit(0)
}

console.error("ERROR: Test Coverage Delta Check failed.")
console.error("")
console.error(
  "This PR modifies file(s) that had NO colocated test (*.test.ts) before this change, and adds/modifies zero " +
    "test files:"
)
for (const f of untestedTouched) console.error(`  - ${f}`)
console.error("")
console.error(
  'AI Maintainability finding (VERIDIAN Review Framework, "AI Can Safely Modify Module"): a PR touching a ' +
    "previously-untested file must add at least one test, so a regression there has a behavioral safety net " +
    "to be caught by."
)
console.error(
  `Add at least one test file (e.g. ${colocatedTestPath(untestedTouched[0])}) covering the change, or any other ` +
    "test in this PR, then push again."
)
process.exit(1)
