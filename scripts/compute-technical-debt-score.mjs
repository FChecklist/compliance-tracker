#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, "Technical Debt Score" finding (AI
// Engineering Quality / Technical Debt & Complexity): "Derive a simple
// composite debt score from existing trackers (open MASTER-TRACKER items +
// empty-guardrail % + stale-doc count)." Deliberately NOT a new tracker --
// this reads three real, already-maintained sources of truth and combines
// them, matching this codebase's own "don't invent a new schema when an
// existing one can be enhanced" discipline (see e.g. OCID-063's handoff-
// envelope decision in ai-os/MASTER-TRACKER.yaml).
//
// The three inputs, exactly as the finding names them:
//   1. Open MASTER-TRACKER items -- every entry with an `id` field nested
//      anywhere under ai-os/MASTER-TRACKER.yaml's `open_items:` key
//      (owner_blocked, needs_owner_decision, and any other open_items
//      sub-category alike -- structurally counted, not by category name,
//      so a renamed/added sub-category is still counted correctly).
//   2. Empty-guardrail % -- the % of domains in
//      ai-os/system-tree/50-merged-tree.yaml with a missing or empty
//      `guardrails:` field. This is an established, already-narrated metric
//      in this codebase (see SYSTEM-AUDIT-ROUND-2.md's "48/94 (51%)") --
//      this script is what makes it live-computed instead of hand-counted
//      prose.
//   3. Stale-doc count -- total entries (`moved` + `already_archived`) in
//      ai-os/registry/stale-doc-manifest.yaml, the same manifest
//      check-doc-quarantine-banner.mjs already enforces banner coverage
//      for.
//
// Composite score: a plain, undisguised sum of the three raw numbers
// (open-item count + empty-guardrail percentage-points + stale-doc count).
// Deliberately NOT a weighted/normalized formula dressed up as more
// rigorous than it is -- "simple composite," as the finding asks for, one
// a reader can recompute by hand from the printed breakdown. Honest
// limitation: this is a debt INDICATOR for trend-watching (is it rising or
// falling release over release), not a calibrated severity metric -- one
// open Critical-severity item and one open Low-severity item both count as
// "1" here, matching MASTER-TRACKER.yaml's own open_items shape, which
// doesn't carry a numeric severity field to weight by.
//
// Usage: node scripts/compute-technical-debt-score.mjs
// Always exits 0 -- this is a reporting tool, not a CI gate (see this
// script's own header for why a debt *score* isn't the kind of thing a
// pass/fail threshold fits honestly; contrast with check-dead-code.mjs and
// check-duplicate-code.mjs, which DO gate, on narrower, ratchet-able
// metrics).
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const TRACKER_FILE = "ai-os/MASTER-TRACKER.yaml"
const SYSTEM_TREE_FILE = "ai-os/system-tree/50-merged-tree.yaml"
const STALE_DOC_MANIFEST_FILE = "ai-os/registry/stale-doc-manifest.yaml"

function countIdItems(node) {
  let n = 0
  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === "object" && "id" in item) n += 1
      n += countIdItems(item)
    }
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) n += countIdItems(v)
  }
  return n
}

async function loadYaml(file) {
  const raw = await readFile(path.resolve(REPO_ROOT, file), "utf8")
  // json:true tolerates duplicate mapping keys (last-wins) instead of
  // throwing -- ai-os/system-tree/50-merged-tree.yaml has a known
  // pre-existing duplicate `count_of_domains:` key, unrelated to this
  // script; failing closed on that would make a reporting tool crash on a
  // problem it isn't the one responsible for fixing.
  return yaml.load(raw, { json: true })
}

async function main() {
  const tracker = await loadYaml(TRACKER_FILE)
  const openItemCount = countIdItems(tracker.open_items)

  const tree = await loadYaml(SYSTEM_TREE_FILE)
  const domains = tree.domains ?? []
  const emptyGuardrailDomains = domains.filter((d) => !d.guardrails || d.guardrails.length === 0)
  const emptyGuardrailPct = domains.length > 0
    ? Math.round((1000 * emptyGuardrailDomains.length) / domains.length) / 10
    : 0

  const staleDocManifest = await loadYaml(STALE_DOC_MANIFEST_FILE)
  const staleDocCount = (staleDocManifest.moved ?? []).length + (staleDocManifest.already_archived ?? []).length

  const debtScore = openItemCount + emptyGuardrailPct + staleDocCount

  console.log("=== VERIDIAN Technical Debt Score ===\n")
  console.log(`Open MASTER-TRACKER items     : ${openItemCount}  (${TRACKER_FILE}, open_items:)`)
  console.log(`Empty-guardrail domains       : ${emptyGuardrailDomains.length}/${domains.length} (${emptyGuardrailPct}%)  (${SYSTEM_TREE_FILE})`)
  console.log(`Stale-doc count               : ${staleDocCount}  (${STALE_DOC_MANIFEST_FILE})`)
  console.log(`\nComposite debt score (sum)    : ${debtScore}`)
  console.log(
    "\nThis is a trend indicator, not a calibrated severity metric -- watch it\n" +
    "move release over release (falling = real debt paid down, rising = new\n" +
    "debt outpacing cleanup), don't treat the absolute number as meaningful\n" +
    "on its own. See this script's own header for the full honest-limitation note."
  )
}

main().catch((err) => {
  console.error("Technical Debt Score computation crashed:", err)
  process.exit(1)
})
