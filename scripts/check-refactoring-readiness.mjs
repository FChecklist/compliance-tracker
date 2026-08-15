#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
// Debt & Complexity, "Refactoring Readiness" finding (2026-07-18). Gap: test
// coverage limits safe refactoring, with no way to see WHICH files are the
// riskiest to touch without a test net first. This ranks every real
// TypeScript file under src/lib (the service/orchestration layer -- where
// this repo's actual business logic lives, as opposed to src/app's
// route/page glue or src/components' UI) that has no sibling *.test.ts, by
// (line count x commit count touching it): a file that is both large AND
// frequently changed is exactly the "someone WILL need to safely modify
// this soon, and it's currently unprotected" case the recommended approach
// names. src/lib/db/schema.ts is excluded (a table declaration file, not
// orchestration logic -- see knip.json's own ignore list for the same
// exclusion made elsewhere in this PR).
//
// Informational only, same as compute-tech-debt-score.mjs -- there is no
// single defensible "must have N% coverage" gate for a codebase this size
// with hundreds of pre-existing untested files; ratcheting a per-file
// requirement would need per-file baselines this script doesn't attempt to
// set. What it gives instead: a live, ranked TODO list so the NEXT test
// written targets real risk instead of whichever file is easiest.
//
// See src/lib/supabase/auth-guard.test.ts for the first file added off this
// exact list (auth-guard.ts ranked highly on churn and is the single most
// load-bearing gate in the app -- every requireAuth()-protected route
// depends on it -- even though a couple of larger-by-raw-size files ranked
// above it purely on the line-count x commit-count formula below).

import { readFile } from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"
import { execSync } from "node:child_process"

const REPO_ROOT = process.cwd()
const TOP_N = 20

const files = execSync("git ls-files 'src/lib/*.ts' 'src/lib/**/*.ts'", { cwd: REPO_ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.endsWith(".test.ts"))
  .filter((f) => f !== "src/lib/db/schema.ts")

const candidates = []
for (const f of files) {
  const testPath = f.replace(/\.ts$/, ".test.ts")
  if (existsSync(path.resolve(REPO_ROOT, testPath))) continue

  const content = await readFile(path.resolve(REPO_ROOT, f), "utf8")
  const lines = content.split("\n").length
  const commitCount = execSync(`git log --oneline -- "${f}"`, { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean).length

  candidates.push({ file: f, lines, commits: commitCount, score: lines * Math.max(commitCount, 1) })
}

candidates.sort((a, b) => b.score - a.score)

console.log("=== Refactoring Readiness -- untested files ranked by (lines x commits) ===")
console.log(`  ${candidates.length} untested files under src/lib (excluding schema.ts). Top ${TOP_N} by risk:\n`)
for (const c of candidates.slice(0, TOP_N)) {
  console.log(`  ${String(c.lines).padStart(6)} lines  ${String(c.commits).padStart(4)} commits  score=${String(c.score).padStart(6)}  ${c.file}`)
}
console.log("\n  Prioritize adding tests to files at the top of this list before")
console.log("  refactoring them -- this is informational (no CI gate), see this")
console.log("  script's own header for why.")
