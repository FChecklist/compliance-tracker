#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, "Dead Code Detection" finding
// (AI Engineering Quality / Technical Debt & Complexity): "Add a dead-code
// scan (e.g. knip) to CI, matching the existing check-*.mjs guardrail
// pattern." Same enforcement class as check-terminology-guardrail.mjs's own
// count ratchet: a reviewable-diff guarantee via PR/CI, not a
// runtime-unbypassable lock -- named honestly, not oversold.
//
// Runs knip (config: knip.json, repo root) and fails CI only if a
// category's total issue count EXCEEDS the max recorded in
// ai-os/registry/dead-code-baseline.yaml. This is a ratchet, not a
// zero-tolerance gate: knip's static analysis has real false positives on
// this codebase (dynamic, string-keyed dispatch -- roster.ts role keys,
// capability-registry lookups -- that a static import graph can't trace),
// so gating on "zero unused exports" from day one would fail every future
// PR on pre-existing, unverified debt rather than catching new debt. See
// dead-code-baseline.yaml's own header for the fuller honest-limitation
// note (count ratchet, not fingerprint ratchet).
//
// Usage: node scripts/check-dead-code.mjs
// Exit code: 0 if no category's issue count exceeds its recorded max, 1
// otherwise (or if knip itself crashes).
import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const BASELINE_FILE = "ai-os/registry/dead-code-baseline.yaml"
const KNIP_BIN = path.resolve(REPO_ROOT, "node_modules/.bin/knip")

// Same field list knip's own JSON reporter uses per-issue-type; matches
// the issue-type names knip's --include/--exclude flags accept (see
// `knip --help`).
const ISSUE_FIELDS = [
  "files", "dependencies", "devDependencies", "unlisted", "unresolved",
  "exports", "types", "nsExports", "nsTypes", "duplicates", "enumMembers",
  "namespaceMembers", "binaries", "optionalPeerDependencies", "catalog",
  "catalogReferences",
]

function runKnip() {
  try {
    const stdout = execFileSync(
      KNIP_BIN,
      ["--no-progress", "--reporter", "json"],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    )
    return JSON.parse(stdout)
  } catch (err) {
    // knip exits non-zero whenever it finds ANY issue -- that's expected
    // and not a crash. execFileSync throws on non-zero exit, but still
    // populates err.stdout with the JSON reporter's output in that case.
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout)
      } catch {
        // fall through to the crash report below
      }
    }
    console.error("Dead Code Check: knip itself failed to run (not a findings failure):")
    console.error(err.stderr || err.message)
    process.exit(1)
  }
}

async function main() {
  const baselineRaw = await readFile(path.resolve(REPO_ROOT, BASELINE_FILE), "utf8")
  const baseline = yaml.load(baselineRaw)
  const maxIssues = baseline?.max_issues ?? {}

  const report = runKnip()
  const issues = report.issues ?? []

  const counts = Object.fromEntries(ISSUE_FIELDS.map((f) => [f, 0]))
  for (const issue of issues) {
    for (const field of ISSUE_FIELDS) {
      if (issue[field]?.length) counts[field] += issue[field].length
    }
  }

  const regressions = []
  for (const [category, count] of Object.entries(counts)) {
    const max = maxIssues[category] ?? 0
    if (count > max) {
      regressions.push({ category, count, max })
    }
  }

  const totalFindings = Object.values(counts).reduce((a, b) => a + b, 0)

  if (regressions.length > 0) {
    console.error("=== Dead Code Check FAILED ===")
    console.error(`knip found MORE issues than ${BASELINE_FILE} allows for these categories:\n`)
    for (const r of regressions) {
      console.error(`  - ${r.category}: ${r.count} found, max allowed is ${r.max}`)
    }
    console.error(
      `\nEither remove the newly-introduced dead code, or -- if this is a genuine\n` +
      `false positive (see ${BASELINE_FILE}'s header) -- raise that category's\n` +
      `max_issues value with a comment explaining why. Full findings:\n`
    )
    console.error(`node_modules/.bin/knip --reporter compact`)
    process.exit(1)
  }

  console.log(
    `Dead Code Check passed -- ${totalFindings} total knip findings, all within ` +
    `${BASELINE_FILE}'s recorded baseline.`
  )
  const improved = Object.entries(counts).filter(([cat, count]) => count < (maxIssues[cat] ?? 0))
  if (improved.length > 0) {
    console.log(
      `Note: some categories are now BELOW their recorded max (` +
      improved.map(([cat, count]) => `${cat}: ${count} < ${maxIssues[cat]}`).join(", ") +
      `) -- consider lowering ${BASELINE_FILE} to lock in the improvement.`
    )
  }
}

main().catch((err) => {
  console.error("Dead Code Check crashed:", err)
  process.exit(1)
})
