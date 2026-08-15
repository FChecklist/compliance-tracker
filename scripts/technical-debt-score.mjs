#!/usr/bin/env node
// AI Engineering Quality / Technical Debt gap-closure -- "Technical Debt
// Score" finding: debt was tracked only narratively (prose entries in
// ai-os/MASTER-TRACKER.yaml, ai-os/registry/stale-doc-manifest.yaml,
// scripts/check-guardrail-presence.mjs) with no single derived number.
// This does not invent a new debt-tracking mechanism -- it reads the three
// trackers that already exist and already have CI checks of their own
// (check-metadata-index-coverage.mjs / check-doc-quarantine-banner.mjs /
// check-guardrail-presence.mjs) and combines them into one composite
// score, so "is debt trending up or down" has a single number to look at
// across waves instead of three separately-shaped documents.
//
// Composite inputs (all real, computed from files already checked into
// this repo -- nothing here is estimated or hand-maintained):
//   1. Open MASTER-TRACKER items: count of `- id:` entries under
//      ai-os/MASTER-TRACKER.yaml's `open_items:` section.
//   2. Empty-guardrail %: of the REQUIRED_MARKERS entries in
//      scripts/check-guardrail-presence.mjs's manifest, the % whose
//      mustContain array is empty (a registered-but-unspecified guardrail
//      placeholder -- currently 0%, this is a forward-looking gate against
//      a guardrail being added without a real marker, not a claim that any
//      exist today).
//   3. Stale-doc count: number of `- file:` entries across BOTH the
//      `moved:` and `already_archived:` groups in
//      ai-os/registry/stale-doc-manifest.yaml.
//
// Score formula (documented here, not hidden in code): starts at 100 and
// subtracts a capped penalty per input, floor 0. Weights are a starting
// point, not a precision instrument -- the point of this script is a
// single trend-line number to compare wave-over-wave, not a scientifically
// derived debt valuation. Adjust WEIGHTS below (with a comment explaining
// why) if a future wave finds the balance wrong.
//
// Honest limitation, same class as every other check-*.mjs in this repo:
// this is informational (CI job does not fail the build on a low score,
// see .github/workflows/ci.yml) -- it surfaces a number for a human/agent
// to act on, it does not itself gate anything. Wiring a hard failure
// threshold here would require agreeing on a real target score first,
// which is an Owner-level product decision, not something to bake in
// silently.
//
// Usage: node scripts/technical-debt-score.mjs

import { readFileSync } from "node:fs"

const REPO_ROOT = new URL("..", import.meta.url).pathname

function countMatches(text, re) {
  return (text.match(re) ?? []).length
}

// ─── 1. Open MASTER-TRACKER items ───────────────────────────────────────
// Counts `OPEN-*` and `GAP-*` prefixed ids under open_items: -- both are
// genuinely unresolved work. Deliberately excludes `RATIFIED-*` ids in the
// same section: those are settled Owner decisions kept there for their
// documented downstream effects (see e.g. OPEN-05/DEC-03 in
// MASTER-TRACKER.yaml: "This is a real, final decision (not pending)"),
// not open work -- counting them as debt would misrepresent a closed
// decision as an open backlog item.
const trackerText = readFileSync(`${REPO_ROOT}ai-os/MASTER-TRACKER.yaml`, "utf8")
const openSection = trackerText.split(/^closed_priorities:/m)[0]
const openItemCount = countMatches(openSection, /^\s*-\s*id:\s*(OPEN|GAP)-/gm)

// ─── 2. Empty-guardrail % ────────────────────────────────────────────────
const guardrailText = readFileSync(`${REPO_ROOT}scripts/check-guardrail-presence.mjs`, "utf8")
const markerLines = guardrailText.match(/mustContain:\s*\[[^\]]*\]/g) ?? []
const totalMarkers = markerLines.length
const emptyMarkers = markerLines.filter((l) => /mustContain:\s*\[\s*\]/.test(l)).length
const emptyGuardrailPct = totalMarkers > 0 ? (emptyMarkers / totalMarkers) * 100 : 0

// ─── 3. Stale-doc count ──────────────────────────────────────────────────
const staleDocText = readFileSync(`${REPO_ROOT}ai-os/registry/stale-doc-manifest.yaml`, "utf8")
const staleDocCount = countMatches(staleDocText, /^\s*-\s*file:/gm)

// ─── Composite score ─────────────────────────────────────────────────────
const WEIGHTS = {
  // Each open item costs 1 point, capped at 30 points total -- a handful of
  // open items is normal ongoing work, not itself "debt" until the backlog
  // grows large.
  openItems: { perUnit: 1, cap: 30 },
  // Each empty-guardrail percentage point costs 0.5, capped at 20 -- this
  // is a correctness signal (a guardrail with no real marker is close to
  // not existing), weighted heavier per-unit than the other two.
  emptyGuardrailPct: { perUnit: 0.5, cap: 20 },
  // Each stale doc costs 0.5 points, capped at 20 -- stale docs are lower-
  // stakes than open work items or hollow guardrails (they're already
  // quarantined and banner-checked by check-doc-quarantine-banner.mjs;
  // this just tracks the volume trend).
  staleDocs: { perUnit: 0.5, cap: 20 },
}

function penalty(value, { perUnit, cap }) {
  return Math.min(value * perUnit, cap)
}

const openItemsPenalty = penalty(openItemCount, WEIGHTS.openItems)
const emptyGuardrailPenalty = penalty(emptyGuardrailPct, WEIGHTS.emptyGuardrailPct)
const staleDocsPenalty = penalty(staleDocCount, WEIGHTS.staleDocs)

const totalPenalty = openItemsPenalty + emptyGuardrailPenalty + staleDocsPenalty
const score = Math.max(0, Math.round((100 - totalPenalty) * 10) / 10)

const report = {
  score,
  scale: "0-100, higher is better (100 = no measured debt across these 3 trackers)",
  inputs: {
    openMasterTrackerItems: openItemCount,
    emptyGuardrailPct: Math.round(emptyGuardrailPct * 10) / 10,
    staleDocCount: staleDocCount,
  },
  penalties: {
    openItems: Math.round(openItemsPenalty * 10) / 10,
    emptyGuardrailPct: Math.round(emptyGuardrailPenalty * 10) / 10,
    staleDocs: Math.round(staleDocsPenalty * 10) / 10,
  },
}

console.log(`Technical Debt Score: ${score} / 100`)
console.log(`  Open MASTER-TRACKER items: ${openItemCount} (penalty ${report.penalties.openItems})`)
console.log(`  Empty-guardrail %:         ${report.inputs.emptyGuardrailPct}% of ${totalMarkers} markers (penalty ${report.penalties.emptyGuardrailPct})`)
console.log(`  Stale-doc count:           ${staleDocCount} (penalty ${report.penalties.staleDocs})`)
console.log("")
console.log(JSON.stringify(report, null, 2))

// Informational job -- see header comment. Always exits 0.
process.exit(0)
