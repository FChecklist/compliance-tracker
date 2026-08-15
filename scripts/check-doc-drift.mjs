#!/usr/bin/env node
// AI Documentation / Documentation Lifecycle gap-closure (VERIDIAN Review
// Framework, 2026-08-01): "Automatic Documentation Generation" and
// "Documentation Accuracy" findings both point at the same root cause --
// ai-os/system-tree/ (the architecture/DB/API/UI docs) is a manual,
// point-in-time snapshot with no mechanism that flags when it has drifted
// from the live codebase. Only API docs (a separate, narrower surface) are
// truly auto-generated.
//
// This is deliberately NOT a full doc-regeneration tool (that requires the
// same judgment-heavy synthesis the original 5-agent system-tree pass used
// -- see ai-os/system-tree/00-INDEX.md's own "Methodology" section) and
// NOT an exact-match check (schema.ts/API routes/pages change on nearly
// every PR in this fast-moving repo; requiring the baseline to be updated
// on every one of those PRs would make this check noise nobody keeps
// green, the same failure mode ai-os/boss/BOARD.yaml's own "stale, stopped
// 2026-06-29" note warns about for un-maintained tracking docs).
//
// Instead: cheap, mechanically-verifiable counts (tables/enums/API
// routes/pages/components) are compared against a checked-in baseline
// (ai-os/system-tree/doc-counts-baseline.yaml, recorded at the last real
// system-tree regeneration/count-refresh) with a tolerance band. Drift
// beyond the tolerance fails CI with an explicit instruction: refresh the
// counts in ai-os/system-tree/*.yaml's headers (or do a fuller
// re-synthesis pass if the drift is large) and update the baseline file in
// the same PR. This is the "lighter-weight automated diff-check" the
// Review Framework finding recommended -- it flags *that* system-tree
// needs attention, it does not (and cannot, without another judgment-heavy
// agent pass) verify the domain-level content is still accurate.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const SCHEMA_FILE = "src/lib/db/schema.ts"
const BASELINE_FILE = "ai-os/system-tree/doc-counts-baseline.yaml"

async function countMatches(file, re) {
  const content = await readFile(path.resolve(REPO_ROOT, file), "utf8")
  return (content.match(re) ?? []).length
}

async function countGitFiles(pattern) {
  const { execFileSync } = await import("node:child_process")
  const out = execFileSync("git", ["ls-files", pattern], { cwd: REPO_ROOT, encoding: "utf8" })
  return out.split("\n").filter(Boolean).length
}

async function main() {
  const baselineRaw = await readFile(path.resolve(REPO_ROOT, BASELINE_FILE), "utf8")
  const baseline = yaml.load(baselineRaw)

  const actual = {
    tables: await countMatches(SCHEMA_FILE, /complianceSchemaDB\.table\(/g),
    enums: await countMatches(SCHEMA_FILE, /complianceSchemaDB\.enum\(/g),
    api_routes: await countGitFiles("src/app/api/**/route.ts"),
    app_pages: await countGitFiles("src/app/(app)/**/page.tsx"),
    components: await countGitFiles("src/components/**/*.tsx"),
  }

  const tolerancePct = baseline.tolerance_pct ?? 10
  const drifted = []

  for (const [metric, actualCount] of Object.entries(actual)) {
    const baselineCount = baseline.counts?.[metric]
    if (typeof baselineCount !== "number") {
      console.error(`Baseline file ${BASELINE_FILE} is missing counts.${metric} -- cannot check drift for it.`)
      process.exit(1)
    }
    const drift = baselineCount === 0 ? (actualCount === 0 ? 0 : 100) : (Math.abs(actualCount - baselineCount) / baselineCount) * 100
    if (drift > tolerancePct) {
      drifted.push({ metric, baselineCount, actualCount, drift })
    }
  }

  if (drifted.length > 0) {
    console.error(`Doc drift check FAILED -- ${drifted.length} metric(s) have moved more than ${tolerancePct}% away from the recorded ${BASELINE_FILE} baseline:\n`)
    for (const d of drifted) {
      console.error(`  - ${d.metric}: baseline ${d.baselineCount} -> actual ${d.actualCount} (${d.drift.toFixed(1)}% drift)`)
    }
    console.error(
      `\nThis means ai-os/system-tree/ (the architecture/DB/API/UI docs) is likely stale. To fix:\n` +
        `  1. Refresh the affected counts/content in ai-os/system-tree/*.yaml (11-*.yaml for api_routes, 12-*.yaml for tables/enums, 13-*.yaml for app_pages/components) -- a full re-synthesis pass for large drift, a header-count update for small drift.\n` +
        `  2. Update ${BASELINE_FILE} to the new actual counts in the same PR, so this check reflects the refreshed baseline.\n` +
        `If the drift is expected and system-tree has already been refreshed to match, this check failing means only step 2 was missed.`,
    )
    process.exit(1)
  }

  console.log(`Doc drift check passed -- all ${Object.keys(actual).length} tracked metrics within ${tolerancePct}% of the ${BASELINE_FILE} baseline.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
