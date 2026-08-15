#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
// Debt & Complexity, "Technical Debt Score" finding (2026-07-18). Prior
// state: debt was tracked narratively (MASTER-TRACKER.yaml prose, PROGRESS
// files, PR descriptions) with no single number to watch trend over time.
// This derives a SIMPLE composite score from three trackers that already
// exist and are already real (not new bookkeeping this script invents):
//
//   1. Open MASTER-TRACKER items -- ai-os/MASTER-TRACKER.yaml's
//      open_items.owner_blocked + needs_owner_decision + real_gaps_not_yet_built
//      (NOT ratified_do_not_build -- those are closed decisions, not open debt).
//   2. Empty-guardrail % -- of the guardrail LEAF constants exported by
//      src/lib/guardrail-registrations.ts, the % that have zero call sites
//      anywhere else in src/ or scripts/ (registered but never actually
//      gated at a real chokepoint -- the exact "opt-in framework only 4
//      leaves ever query" problem check-guardrail-presence.mjs's own
//      comments describe). Computed live via ripgrep-equivalent search each
//      run, not hardcoded, so it can't silently go stale the way a written-
//      down snapshot would.
//   3. Stale-doc count -- total entries across every list in
//      ai-os/registry/stale-doc-manifest.yaml (moved + already_archived):
//      docs the repo itself has already flagged as superseded.
//
// Honest limitation, same class as this repo's other check-*.mjs scripts:
// this is a coarse, directional signal for "is debt trending up or down
// across PRs", not a certified/peer-reviewed software metric, and the
// weights below are a starting point, not a tuned model. It is NOT wired
// into CI as a hard gate (no defensible pass/fail threshold exists yet for
// a first-run composite) -- it prints a report; CI runs it informationally
// so the number is visible on every PR without blocking anyone on a
// threshold nobody has agreed to yet.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { execSync } from "node:child_process"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()

async function loadYaml(relPath) {
  const raw = await readFile(path.resolve(REPO_ROOT, relPath), "utf8")
  return yaml.load(raw)
}

async function countOpenTrackerItems() {
  const tracker = await loadYaml("ai-os/MASTER-TRACKER.yaml")
  const oi = tracker.open_items ?? {}
  const buckets = ["owner_blocked", "needs_owner_decision", "real_gaps_not_yet_built"]
  let total = 0
  const breakdown = {}
  for (const b of buckets) {
    const n = Array.isArray(oi[b]) ? oi[b].length : 0
    breakdown[b] = n
    total += n
  }
  return { total, breakdown }
}

async function countEmptyGuardrailPercent() {
  const regFile = "src/lib/guardrail-registrations.ts"
  const src = await readFile(path.resolve(REPO_ROOT, regFile), "utf8")
  const leaves = [...src.matchAll(/export const ([A-Z0-9_]+_LEAF) = /g)].map((m) => m[1])
  if (leaves.length === 0) return { total: 0, empty: 0, percent: 0, emptyLeaves: [] }

  const emptyLeaves = []
  for (const leaf of leaves) {
    let out
    try {
      out = execSync(`git grep -l -- "${leaf}" -- 'src/**' 'scripts/**'`, { cwd: REPO_ROOT, encoding: "utf8" })
    } catch {
      out = "" // git grep exits 1 with no output when there are zero matches
    }
    const filesWithMatch = out.split("\n").filter(Boolean).filter((f) => f !== regFile)
    if (filesWithMatch.length === 0) emptyLeaves.push(leaf)
  }
  const percent = Math.round((emptyLeaves.length / leaves.length) * 100)
  return { total: leaves.length, empty: emptyLeaves.length, percent, emptyLeaves }
}

async function countStaleDocs() {
  const manifest = await loadYaml("ai-os/registry/stale-doc-manifest.yaml")
  let total = 0
  const breakdown = {}
  for (const [key, val] of Object.entries(manifest)) {
    if (Array.isArray(val)) {
      breakdown[key] = val.length
      total += val.length
    }
  }
  return { total, breakdown }
}

const [openItems, guardrails, staleDocs] = await Promise.all([
  countOpenTrackerItems(),
  countEmptyGuardrailPercent(),
  countStaleDocs(),
])

// Simple composite, weighted by how directly each input reflects "will this
// slow down or risk a future change": an open real gap is weighted highest
// (2x) since it's work definitely still owed; empty-guardrail % and stale
// docs are weighted 1x as secondary signals of drift/rot rather than
// outstanding work.
const WEIGHTS = { openItems: 2, emptyGuardrailPercent: 1, staleDocs: 1 }
const debtScore =
  openItems.total * WEIGHTS.openItems +
  guardrails.percent * WEIGHTS.emptyGuardrailPercent +
  staleDocs.total * WEIGHTS.staleDocs

console.log("=== Technical Debt Score (composite, informational -- not a CI gate) ===")
console.log(`  Open MASTER-TRACKER items : ${openItems.total}  (${JSON.stringify(openItems.breakdown)})`)
console.log(`  Empty-guardrail %         : ${guardrails.percent}%  (${guardrails.empty}/${guardrails.total} leaves with zero call sites)`)
if (guardrails.emptyLeaves.length) console.log(`    -> ${guardrails.emptyLeaves.join(", ")}`)
console.log(`  Stale-doc count           : ${staleDocs.total}  (${JSON.stringify(staleDocs.breakdown)})`)
console.log(`  Weights                   : openItems x${WEIGHTS.openItems}, emptyGuardrail% x${WEIGHTS.emptyGuardrailPercent}, staleDocs x${WEIGHTS.staleDocs}`)
console.log(`\n  TECH DEBT SCORE: ${debtScore}`)
console.log("\n  Lower is better. Track this number's trend across PRs/waves -- a single")
console.log("  reading in isolation is not meaningful, and no pass/fail threshold is")
console.log("  enforced yet (see this script's own header for why).")
