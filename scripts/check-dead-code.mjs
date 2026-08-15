#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
// Debt & Complexity, "Dead Code Detection" finding (2026-07-18). Prior state:
// no automated dead-code detection tool existed at all -- unused files/
// exports/dependencies could only be found by manual review. Wraps knip
// (config: knip.json, tuned with explicit `entry` globs for this repo's
// Next.js App Router pages/routes, scripts/*.{mjs,ts} invoked only from CI
// workflows or package.json, and the various *.config.* files knip's
// defaults don't reliably auto-detect here).
//
// Honest limitation, same class as check-guardrail-presence.mjs's and the
// other check-*.mjs scripts' own stated limitations: a fresh `knip` run on
// this repo (before entry-tuning) reported 158 "unused files" -- most of
// them false positives (scripts only ever invoked by a GitHub Actions
// workflow step or another script, not imported by any TS module knip
// walks). Tuning knip.json's `entry` array cut that to 38, but static
// analysis still can't perfectly resolve every dynamic import / CI-only
// entry point in a codebase this size. Rather than hand-triage all 38+223+
// 106+29+2+11 remaining findings before shipping any detection at all, this
// is a RATCHET: it fails CI only if a category's count goes UP from the
// baseline recorded in scripts/dead-code-baseline.json, i.e. it catches new
// dead code being introduced without requiring the existing backlog be
// cleared first. Real cleanup that lowers a count should lower the baseline
// number in the same PR (see that file's own comment).
//
// Run `bunx knip` directly (no --reporter json) for the full human-readable
// report when triaging a category's findings.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

const REPO_ROOT = process.cwd()
const BASELINE_PATH = path.resolve(REPO_ROOT, "scripts/dead-code-baseline.json")
const CATEGORIES = ["files", "exports", "types", "dependencies", "devDependencies", "unlisted"]

const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"))

let raw
try {
  raw = execFileSync("bunx", ["knip", "--reporter", "json"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
} catch (err) {
  // knip exits non-zero whenever it finds ANY issue (that's its own CLI
  // contract, unrelated to our ratchet) -- its json report is still on
  // stdout in that case, so recover it rather than treating this as our
  // own failure.
  raw = err.stdout ? err.stdout.toString() : null
  if (!raw) {
    console.error("Dead Code Check: knip did not produce parseable output.")
    console.error(err.stderr ? err.stderr.toString() : String(err))
    process.exit(1)
  }
}

const report = JSON.parse(raw)
const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]))
for (const entry of report.issues ?? []) {
  for (const category of CATEGORIES) {
    if (Array.isArray(entry[category])) counts[category] += entry[category].length
  }
}
// "unused files" are entries with no per-symbol findings at all (knip
// reports the whole file as the issue, not a list under one of the above
// keys) -- count those separately as "files".
counts.files = (report.issues ?? []).filter((e) =>
  CATEGORIES.slice(1).every((c) => !Array.isArray(e[c]) || e[c].length === 0)
).length

let failed = false
console.log("=== Dead Code Check (knip, ratchet vs scripts/dead-code-baseline.json) ===")
for (const category of CATEGORIES) {
  const current = counts[category]
  const base = baseline[category] ?? 0
  const status = current > base ? "REGRESSION" : current < base ? "improved (update baseline!)" : "ok"
  console.log(`  ${category.padEnd(16)} current=${String(current).padEnd(4)} baseline=${String(base).padEnd(4)} ${status}`)
  if (current > base) failed = true
}

if (failed) {
  console.error("\nDead Code Check FAILED: new dead code introduced above the recorded")
  console.error("baseline in scripts/dead-code-baseline.json. Run `bunx knip` for the full")
  console.error("report, fix the new finding, or -- if it's a real false positive -- add an")
  console.error("explicit entry/ignore rule to knip.json (not a baseline bump, which would")
  console.error("silently raise the bar for everyone else).")
  process.exit(1)
}

console.log("\nDead Code Check passed -- no category exceeds its baseline.")
