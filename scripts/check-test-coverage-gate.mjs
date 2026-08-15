#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (task-20260718-070005-ai-
// maintainability--ai-safe-change-capab), finding: [Medium] "AI Can Safely
// Modify Module" -- "CI gate does not include comprehensive behavioral test
// coverage." Recommended approach: "Require a minimum test-coverage delta
// (or at least one new test) on PRs touching previously-untested files."
//
// Same enforcement class as check-migration-collision.mjs / check-
// terminology-guardrail.mjs: a reviewable-diff ratchet enforced in CI, not
// a runtime-unbypassable lock -- named honestly, not oversold.
//
// What this implements: the "(or at least one new test)" arm only, not a
// full coverage-delta computation. A real before/after coverage-delta gate
// would mean running the full `bun test --coverage` suite twice per PR
// (once against the base ref, once against HEAD) and diffing lcov output --
// roughly double this repo's CI time for a Medium-severity tooling gap.
// The literal recommendation offers "(or at least one new test)" as a
// lighter-weight alternative specifically because of that cost; this script
// takes it. See scripts/report-maintainability-gaps.ts for the companion
// coverage-gap PRIORITY report (a different, non-blocking tool -- "which
// untested file should I test next", not a merge gate).
//
// Scope: NOT every file under src/ -- that would block nearly every PR in
// this repo today (bun test --coverage shows only ~51 of 1793 non-test
// src/ files are exercised by any existing test at all as of this writing;
// a repo-wide gate would be a de facto blanket freeze with no owner
// sign-off, a much bigger behavior change than a Medium-severity CI-gate
// finding calls for). Scoped instead to the two directories where this
// repo's OWN existing tests already establish a real, live convention --
// src/lib/services/**/*.ts and src/app/api/**/route.ts (grep confirms every
// existing *.test.ts in this repo sits beside exactly one of these two
// shapes: <name>-service.test.ts next to <name>-service.ts, or route.test.ts
// next to route.ts). Extending this gate to more directories as their own
// test convention matures is expected and welcome -- narrowing it below
// this scope needs the sign-off AGENTS.md Rule 9 requires for any named
// guardrail.
//
// Rule: for each changed/added file in that scope, if it had NO sibling
// test file (<name>.test.ts next to <name>.ts, or route.test.ts next to
// route.ts) at the merge-base commit, this PR must add or already have one
// at HEAD. A file that already had a test in the base branch is untouched
// by this gate (the recommendation is scoped to "PRs touching
// previously-untested files", not "every PR must update every test").
//
// Usage:
//   node scripts/check-test-coverage-gate.mjs [--base <ref>]
//   BASE_REF=origin/main node scripts/check-test-coverage-gate.mjs
// Exit code 0 = no previously-untested in-scope file was touched without a
// test, 1 = at least one was.

import { execSync } from "child_process"
import { existsSync } from "fs"

function resolveBaseRef() {
  const argIdx = process.argv.indexOf("--base")
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]
  if (process.env.BASE_REF && process.env.BASE_REF.trim()) return process.env.BASE_REF.trim()
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" })
  } catch {
    // offline/shallow/no-remote -- fall through to whatever origin/main we already have
  }
  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" })
    return "origin/main"
  } catch {
    // no origin/main locally, fall through
  }
  try {
    execSync("git rev-parse --verify main", { stdio: "ignore" })
    return "main"
  } catch {
    // no local main either, fall through
  }
  return "HEAD~1"
}

function mergeBaseWith(ref) {
  try {
    return execSync(`git merge-base HEAD ${ref} 2>/dev/null`, { encoding: "utf8" }).trim()
  } catch {
    return "HEAD~1"
  }
}

// In scope: src/lib/services/*.ts (not .test.ts) and src/app/api/**/route.ts
function inScope(filePath) {
  if (filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx")) return false
  if (filePath.startsWith("src/lib/services/") && filePath.endsWith(".ts")) return true
  if (filePath.startsWith("src/app/api/") && filePath.endsWith("/route.ts")) return true
  return false
}

function siblingTestPath(filePath) {
  return filePath.replace(/\.ts$/, ".test.ts")
}

// Shell-quotes a path for safe interpolation into an execSync command --
// Next.js route paths routinely contain [id]/(group) segments, which are
// shell-meaningful but shell-safe as long as they're single-quoted (no
// single quotes ever appear in this repo's real file paths).
function shQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function fileExistsAtRef(ref, filePath) {
  try {
    execSync(`git cat-file -e ${shQuote(`${ref}:${filePath}`)}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const baseRef = resolveBaseRef()
const mergeBase = mergeBaseWith(baseRef)

let changedFiles = []
try {
  const output = execSync(`git diff --name-only --diff-filter=ACMR ${mergeBase} HEAD -- src/`, {
    encoding: "utf8",
  }).trim()
  const untracked = execSync(`git ls-files --others --exclude-standard -- src/`, { encoding: "utf8" }).trim()
  changedFiles = [...output.split("\n"), ...untracked.split("\n")].filter(Boolean)
} catch (err) {
  console.error(`ERROR: could not compute diff against ${mergeBase}: ${err.message}`)
  process.exit(1)
}

const inScopeChanged = [...new Set(changedFiles)].filter(inScope)

if (inScopeChanged.length === 0) {
  console.log(`OK: no changed files under src/lib/services/**/*.ts or src/app/api/**/route.ts (base: ${baseRef}).`)
  process.exit(0)
}

const violations = []
for (const filePath of inScopeChanged) {
  const testPath = siblingTestPath(filePath)
  const hadTestAtBase = fileExistsAtRef(mergeBase, testPath)
  if (hadTestAtBase) continue // already had a safety net -- gate doesn't require touching it further
  const hasTestAtHead = existsSync(testPath)
  if (!hasTestAtHead) violations.push({ filePath, testPath })
}

if (violations.length > 0) {
  console.error("ERROR: previously-untested file(s) changed without adding a test!")
  console.error(
    "Framework finding \"AI Can Safely Modify Module\": PRs touching a " +
      "previously-untested service/route file must add at least one new test."
  )
  for (const { filePath, testPath } of violations) {
    console.error(`  ${filePath}`)
    console.error(`    -> expected a sibling test at ${testPath} (none existed on ${baseRef}, none added here)`)
  }
  console.error("\nAdd the sibling *.test.ts file above (even a minimal real test), or if this")
  console.error("file is genuinely untestable/generated, say so in the PR description --")
  console.error("this is a reviewable-diff gate, not a mechanical exemption list.")
  process.exit(1)
}

console.log(
  `OK: ${inScopeChanged.length} in-scope file(s) changed, all either already had a test on ${baseRef} or have one now.`
)
