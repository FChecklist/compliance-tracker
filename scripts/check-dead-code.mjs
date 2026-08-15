#!/usr/bin/env node
// AI Engineering Quality / Technical Debt gap-closure -- "Dead Code
// Detection" finding: no automated dead-code detection existed anywhere in
// CI before this. Uses knip (config: knip.json) as the actual detector,
// wrapped the same way check-migration-collision.mjs wraps drizzle-kit's
// migration-number check -- a thin script that turns a general-purpose
// tool's output into a scoped, CI-actionable pass/fail.
//
// Deliberately scoped to NEW/CHANGED files only (same pattern as
// check-migration-collision.mjs's `git diff <merge-base> HEAD`), not the
// whole existing tree: a first real run of knip against this ~1600-file
// codebase found 18 pre-existing fully-unused files and 65 unused exports
// -- retroactively gating the FIRST PR to touch this check on 18 files it
// didn't create would be exactly the kind of "big-bang gate on day one"
// that gets disabled within a week. What this DOES guarantee: a PR cannot
// ADD a brand-new file that knip considers 100% dead on arrival (zero
// imports anywhere in the entry-point graph defined in knip.json).
//
// Honest limitation, same class as every other check-*.mjs in this repo:
// knip's reachability analysis is static (import-graph based) -- a file
// that's only ever loaded via a fully dynamic `import(computedPath)` or a
// non-JS loader (e.g. read as raw text, spawned as a subprocess) can read
// as "dead" when it isn't. That's exactly why this only fails on NEW files
// (a human/agent decision, reviewable in the PR diff) rather than silently
// deleting anything -- the existing 18-file backlog is left for a separate,
// deliberate cleanup pass, not swept up here.
//
// Usage: node scripts/check-dead-code.mjs
// Exit code 0 = no newly-added dead files, 1 = a new file this PR adds is
// unreachable from every real entry point.

import { execSync } from "node:child_process"

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }).trim()
  } catch (err) {
    return (err.stdout ?? "").toString().trim()
  }
}

const mergeBase = sh("git merge-base HEAD main 2>/dev/null") || sh("git rev-parse HEAD~1 2>/dev/null") || "HEAD"

const addedTracked = sh(`git diff --name-only --diff-filter=A ${mergeBase} HEAD -- 'src/**/*.ts' 'src/**/*.tsx' 2>/dev/null`)
  .split("\n").filter(Boolean)
const addedUntracked = sh(`git ls-files --others --exclude-standard -- 'src/**/*.ts' 'src/**/*.tsx' 2>/dev/null`)
  .split("\n").filter(Boolean)
const newFiles = [...new Set([...addedTracked, ...addedUntracked])]

if (newFiles.length === 0) {
  console.log("check-dead-code: no new src/**/*.ts(x) files added in this PR -- nothing to check.")
  process.exit(0)
}

let knipOutput
try {
  knipOutput = execSync("bunx knip --reporter json 2>/dev/null", { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 })
} catch (err) {
  // knip's CLI exits non-zero whenever it finds ANY issue (that's the
  // point) -- its JSON report is still on stdout in that case.
  knipOutput = (err.stdout ?? "").toString()
}

let report
try {
  report = JSON.parse(knipOutput)
} catch {
  console.warn("check-dead-code: could not parse knip output as JSON -- skipping (fail-open, matching this repo's posture for non-critical guardrail lookups). Raw output:")
  console.warn(knipOutput.slice(0, 2000))
  process.exit(0)
}

const unusedFiles = new Set((report.files ?? []).map((f) => (typeof f === "string" ? f : f.file)))

const newlyDead = newFiles.filter((f) => unusedFiles.has(f))

if (newlyDead.length > 0) {
  console.error("ERROR: this PR adds a new file that knip's import-graph analysis finds unreachable from every real entry point (see knip.json):")
  for (const f of newlyDead) console.error(`  - ${f}`)
  console.error("\nIf this file IS genuinely used (e.g. only via a dynamic import knip can't see statically), add it to knip.json's `ignore` list with a comment explaining how it's actually reached. Otherwise, this looks like dead code on arrival -- wire it up or remove it.")
  process.exit(1)
}

console.log(`check-dead-code: ${newFiles.length} new file(s) checked, none are dead on arrival.`)
process.exit(0)
