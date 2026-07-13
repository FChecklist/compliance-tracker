#!/usr/bin/env bun
// PLATFORM_STRATEGY.md §31.4 Phase A item 3: a live-computed, always-current
// counterpart to ai-os/STATUS-REPORT.md's point-in-time, manually-reconciled
// "% completed" figure, and to the three-separate-files problem behind
// "what's open, what's closed, reviewed by, audited by" (§31.1 rows 3/7/8).
//
// Read-only: parses ai-os/MASTER-TRACKER.yaml's open_items (owner_blocked +
// needs_owner_decision + real_gaps_not_yet_built, explicitly EXCLUDING
// ratified_do_not_build -- those are final decisions not to build, not
// pending work) and ai-os/boss/COMPLETED.yaml's entries. Never writes to
// either file, never replaces or forks them.
//
// All counting/extraction logic lives in src/lib/status-source-of-truth.ts,
// shared with (not duplicated by) the `sourceOfTruth` field on
// GET /api/ai/team/governance-health.
//
// Written as TypeScript run via `bun run`, matching this repo's other
// src/lib-importing scripts (scripts/validate-audit-verdict.ts,
// scripts/report-cognitive-brain-coverage.ts) rather than the
// self-contained check-*.mjs CI-gate scripts, which have no shared-module
// dependency to satisfy.
//
// Usage: bun run scripts/compute-status.ts
import { loadStatusSourceOfTruth, METHODOLOGY_DISCLAIMER } from "../src/lib/status-source-of-truth"

function pct(n: number): string {
  return `${n.toFixed(1)}%`
}

async function main() {
  const status = await loadStatusSourceOfTruth()

  console.log("=".repeat(78))
  console.log("VERIDIAN AI OS -- Live-Computed Status (shallow, always-current)")
  console.log("=".repeat(78))
  console.log(`Computed at: ${status.lastComputed}`)
  console.log("")
  console.log("Open items by subcategory (ai-os/MASTER-TRACKER.yaml open_items):")
  console.log(`  owner_blocked:            ${status.openBreakdown.owner_blocked}`)
  console.log(`  needs_owner_decision:     ${status.openBreakdown.needs_owner_decision}`)
  console.log(`  real_gaps_not_yet_built:  ${status.openBreakdown.real_gaps_not_yet_built}`)
  console.log(`  -------------------------------`)
  console.log(`  TOTAL OPEN (pending):     ${status.openCount}`)
  console.log(`  ratified_do_not_build (excluded from the pending count -- deliberate NOT-going-to-build decisions, not pending work): ${status.ratifiedExcludedCount}`)
  console.log("")
  console.log(`Closed items (ai-os/boss/COMPLETED.yaml entries): ${status.closedCount}`)
  console.log("")
  console.log(`percentComplete = closedCount / (closedCount + openCount) * 100`)
  console.log(`                = ${status.closedCount} / (${status.closedCount} + ${status.openCount}) * 100`)
  console.log(`                = ${pct(status.percentComplete)}`)
  console.log("")
  console.log("-".repeat(78))
  console.log("DISCLAIMER -- read before quoting this number anywhere:")
  console.log("-".repeat(78))
  console.log(METHODOLOGY_DISCLAIMER)
  console.log("=".repeat(78))
}

main().catch((err) => {
  console.error("compute-status crashed:", err)
  process.exit(1)
})
