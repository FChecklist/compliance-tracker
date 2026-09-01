#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, 2026-08-15: "AI Can Safely Modify
// Module" flagged "CI gate does not include comprehensive behavioral test
// coverage" (recommended approach: "Require a minimum test-coverage delta
// (or at least one new test) on PRs touching previously-untested files").
// This is that gate -- the enforced half; scripts/report-test-coverage-
// gap.mjs is the triage/reporting half the same wave's "AI Can Generate
// Tests for Module" finding asked for.
//
// Scope: src/lib/services/*.ts, same scope as that report script (see its
// header for why -- this is where the sibling-<name>.test.ts convention is
// actually established in this repo; expanding this gate repo-wide before a
// test convention exists elsewhere would just be un-satisfiable noise, not
// a real safety net).
//
// Rule: if this PR (diff against merge-base with main) modifies or adds a
// src/lib/services/*.ts file that had NO sibling *.test.ts at merge-base
// (i.e. it was "previously untested" before this PR), the PR must also
// add or modify at least one *.test.ts file somewhere in the repo. This is
// deliberately the lenient "(or at least one new test)" branch of the
// finding's own recommended approach, not a strict per-file coverage-delta
// threshold -- bun test --coverage can measure a real percentage, but only
// for files a test actually imports, so it cannot be the enforcement
// mechanism for files that start at zero tests (nothing to instrument).
// Honest limitation, same class as this repo's other check-*.mjs gates
// (see check-guardrail-presence.mjs's header): this verifies *a* test file
// changed, not that it meaningfully exercises the previously-untested file,
// and a PR that only touches already-tested services is unaffected either
// way.
//
// Usage: node scripts/check-new-test-coverage.mjs
// Exit code 0 = no previously-untested service file touched without a new
// test / already compliant, 1 = violation found.
//
// filterPreviouslyUntested()/decideGate() below are pure (no git/fs access)
// so they're unit tested directly with fixture data in
// check-new-test-coverage.test.ts -- only the top-level script body does
// real git calls.

import { execSync } from "node:child_process"
import path from "node:path"

/**
 * Pure: given the service files this PR changed and a predicate for
 * "did this file already have a sibling test at merge-base", returns the
 * subset that were previously untested.
 */
export function filterPreviouslyUntested(changedServiceFiles, hadSiblingTestAtMergeBase) {
  return changedServiceFiles.filter((f) => !hadSiblingTestAtMergeBase(f))
}

/**
 * Pure: the actual gate decision. Returns { ok, message } -- caller maps
 * this to a process exit code / console output.
 */
export function decideGate(previouslyUntested, changedTestFiles) {
  if (previouslyUntested.length === 0) {
    return { ok: true, message: "every touched service file already had a sibling test file before this PR." }
  }
  if (changedTestFiles.length > 0) {
    return {
      ok: true,
      message:
        `${previouslyUntested.length} previously-untested service file(s) touched, but this PR also ` +
        `changes ${changedTestFiles.length} test file(s) -- coverage-delta requirement satisfied.`,
    }
  }
  return {
    ok: false,
    message:
      "this PR touches previously-untested service file(s) without adding any test.\n\n" +
      "Previously-untested files touched (no sibling *.test.ts existed on main):\n" +
      previouslyUntested.map((f) => `  - ${f}`).join("\n") +
      "\n\nVERIDIAN Review Framework gap ('AI Can Safely Modify Module'): PRs touching a file with " +
      "zero existing test coverage must add at least one test (ideally a sibling " +
      "<name>.test.ts for the file itself). Add one, or if this change is genuinely " +
      "untestable (e.g. pure config/type re-export), note why in the PR description.",
  }
}

// --- top-level script body (real git calls; not exercised by unit tests) ---
const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href
if (isMain) {
  const REPO_ROOT = new URL("..", import.meta.url).pathname

  const sh = (cmd) => execSync(cmd, { encoding: "utf8", cwd: REPO_ROOT }).trim()
  const shLines = (cmd) => {
    const out = sh(cmd)
    return out ? out.split("\n").filter(Boolean) : []
  }

  // Prefer origin/main (what CI's checkout actually has a remote-tracking
  // ref for) over a local `main` branch, which in a long-lived worktree/
  // sandbox checkout can silently be stale relative to the real main. Falls
  // through to local `main`, then gives up cleanly rather than crashing CI
  // on a shallow/single-commit clone that genuinely can't compute this.
  let mergeBase = null
  for (const ref of ["origin/main", "main"]) {
    try {
      mergeBase = sh(`git merge-base HEAD ${ref} 2>/dev/null`)
      if (mergeBase) break
    } catch {
      // try next ref
    }
  }

  if (!mergeBase) {
    console.log("OK: could not determine a merge-base against main (shallow clone or single-commit repo); skipping.")
    process.exit(0)
  }

  // Files this PR touches (modified or added, not deleted) in the service layer.
  const changedServiceFiles = shLines(
    `git diff --name-only --diff-filter=d ${mergeBase} HEAD -- 'src/lib/services/*.ts' 2>/dev/null`
  ).filter((f) => !f.endsWith(".test.ts"))

  if (changedServiceFiles.length === 0) {
    console.log("OK: no src/lib/services/*.ts files touched in this diff.")
    process.exit(0)
  }

  function hadSiblingTestAtMergeBase(serviceFile) {
    const dir = path.dirname(serviceFile)
    const base = path.basename(serviceFile, ".ts")
    const testFile = `${dir}/${base}.test.ts`
    try {
      sh(`git cat-file -e ${mergeBase}:${testFile} 2>/dev/null`)
      return true
    } catch {
      return false
    }
  }

  const previouslyUntested = filterPreviouslyUntested(changedServiceFiles, hadSiblingTestAtMergeBase)

  const changedTestFiles = shLines(
    `git diff --name-only --diff-filter=d ${mergeBase} HEAD -- '*.test.ts' '*.test.tsx' 2>/dev/null`
  )

  const result = decideGate(previouslyUntested, changedTestFiles)
  if (result.ok) {
    console.log(`OK: ${result.message}`)
    process.exit(0)
  }
  console.error(`ERROR: ${result.message}`)
  process.exit(1)
}
