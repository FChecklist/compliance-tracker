#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, "Refactoring Readiness" finding
// (AI Engineering Quality / Technical Debt & Complexity): "Prioritize
// adding tests to the largest/most-changed untested files before
// refactoring them." This script makes that prioritization concrete and
// re-runnable instead of a one-off manual judgment call: it ranks every
// untested src/lib/**/*.ts file by (line count x commit-change frequency)
// -- the two factors the finding names -- so "which file is riskiest to
// refactor blind" has a reproducible answer.
//
// Scope: src/lib/**/*.ts only (the service/orchestration layer -- where
// this codebase's own scripts/check-guardrail-presence.mjs and
// eslint.config.mjs's new `complexity` rule already show the highest-risk
// logic concentrates), excluding *.test.ts and *.d.ts. src/app/** (routes/
// pages) and src/components/** are deliberately out of scope -- those are
// thinner wrappers around src/lib/ services in this codebase's own
// architecture (CLAUDE.md's own Structure section), and route-level testing
// is a distinct, larger effort (integration/E2E, not unit) from what this
// ranking is meant to prioritize.
//
// "Untested" = no co-located `<basename>.test.ts` in the same directory --
// this codebase's own established test-placement convention (confirmed:
// 153 such files under src/lib/ today). A file WITH a same-name test file
// is excluded even if that test's coverage is thin -- detecting coverage
// *depth* (as opposed to *existence*) needs a coverage-instrumented test
// run, out of scope for this static, fast-to-run ranking tool.
//
// Usage: node scripts/list-refactor-priority-candidates.mjs [--top N]
// Always exits 0 -- this is a prioritization report, not a CI gate.
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const REPO_ROOT = process.cwd()
const topN = (() => {
  const idx = process.argv.indexOf("--top")
  return idx !== -1 ? Number(process.argv[idx + 1]) : 25
})()

// Schema-definition files, not business logic: overwhelmingly large by
// necessity (hundreds of Drizzle table definitions) and frequently touched
// by every wave that adds a table, which would otherwise dominate this
// ranking's top slot by a full order of magnitude and drown out the real
// service-layer signal. "Testing" a column-definition file the way you'd
// test a service's business logic isn't a meaningful readiness signal.
const EXCLUDED_FILES = new Set(["src/lib/db/schema.ts"])

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files", "src/lib/**/*.ts"], { cwd: REPO_ROOT, encoding: "utf8" })
  return out.split("\n").filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .filter((f) => !EXCLUDED_FILES.has(f))
}

function commitCountsByFile() {
  // One `git log` call over all of src/lib/, not one subprocess per file --
  // 361 files x individual `git log` calls would be prohibitively slow.
  const out = execFileSync(
    "git",
    ["log", "--pretty=format:", "--name-only", "--", "src/lib"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
  const counts = new Map()
  for (const line of out.split("\n")) {
    const f = line.trim()
    if (!f) continue
    counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return counts
}

function hasCoLocatedTest(file) {
  const testFile = file.replace(/\.ts$/, ".test.ts")
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${testFile}`], { cwd: REPO_ROOT, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function lineCount(file) {
  try {
    return readFileSync(path.resolve(REPO_ROOT, file), "utf8").split("\n").length
  } catch {
    return 0
  }
}

function main() {
  const files = listTrackedFiles()
  const commitCounts = commitCountsByFile()

  const candidates = files
    .filter((f) => !hasCoLocatedTest(f))
    .map((f) => {
      const loc = lineCount(f)
      const changes = commitCounts.get(f) ?? 0
      return { file: f, loc, changes, priority: loc * changes }
    })
    .sort((a, b) => b.priority - a.priority)

  console.log("=== Refactoring Readiness: Untested-File Priority Ranking ===\n")
  console.log(`${files.length} total src/lib/**/*.ts files, ${candidates.length} have no co-located .test.ts.\n`)
  console.log("Rank  LOC    Commits  Priority(LOC*Commits)  File")
  for (const [i, c] of candidates.slice(0, topN).entries()) {
    console.log(
      `${String(i + 1).padStart(4)}  ${String(c.loc).padStart(5)}  ${String(c.changes).padStart(7)}  ${String(c.priority).padStart(21)}  ${c.file}`
    )
  }
  console.log(
    "\nThese are the files most worth adding real test coverage to BEFORE\n" +
    "refactoring them -- large + frequently-touched + zero tests is exactly\n" +
    "the combination where a refactor is most likely to silently break\n" +
    "something and least likely to have a test catch it. Not a CI gate --\n" +
    "a prioritization tool to consult before starting refactor work."
  )
}

main()
