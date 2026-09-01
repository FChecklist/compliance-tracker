#!/usr/bin/env node
// GAP-ACTIVE-CLAIMS-YAML-PARSE-ERROR (ai-os/MASTER-TRACKER.yaml): the
// mechanical guardrail requested after a real, pre-existing YAML syntax
// error was found on `main` itself in ai-os/boss/ACTIVE-CLAIMS.yaml (a
// stray malformed 0-indent list entry broke yaml.safe_load parsing for
// the whole file, fixed in PR #818). Same enforcement class as
// check-guardrail-presence.mjs/check-doc-quarantine-banner.mjs -- a
// reviewable-diff guarantee via PR/CI, not a runtime-unbypassable lock.
//
// Honest limitation, stated up front: this only catches a file that fails
// to PARSE as YAML at all. It says nothing about whether the parsed
// content is semantically correct (a well-formed but wrong claim entry
// would pass this check) -- that is out of scope for a mechanical syntax
// guardrail.
//
// UPDATE (2026-08-31, PR #821 finding incorporated): previously loaded with
// `json: true` (js-yaml's permissive/JSON-superset mode, matching PyYAML's
// default tolerant behavior), which deliberately did NOT fail on duplicate
// mapping keys. That tolerance was a real, separate gap: it silently let a
// genuine duplicate-mapping-key structural defect stand, undetected, in
// ai-os/boss/ACTIVE-CLAIMS.yaml on `main` (three separate merge points where
// an earlier automated squash-merge had dropped a `- session_label:`
// list-item boundary, leaving one entry's `claimed_at`/`claim` keys
// silently overwriting a sibling entry's same-named keys instead of
// throwing -- found and fixed directly in that file as part of this same
// change). `json`'s only documented effect is that duplicate-key tolerance
// (js-yaml README: "If true, then duplicate keys in a mapping will override
// values rather than throwing an error") -- confirmed by testing all 5
// files below both with and without it before removing it, so dropping it
// changes nothing else about how these 5 files parse. The option is now
// OFF (plain `yaml.load(raw)`), so a duplicate mapping key is treated the
// same as any other structural YAML defect: this check fails on it.
//
// Covers the real governance YAML files this session's own protocol names
// as load-bearing (CLAUDE.md's "Read Before Starting Work" list, items 1-3
// + 5, plus COMPLETED.yaml, ACTIVE-CLAIMS.yaml's own documented closed-work
// counterpart per AGENTS.md Rule 3): every session's zero-duplication
// check, the constitution, the governance-file index, the open-work
// tracker, and the closed-work log all depend on these files parsing.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()

const GOVERNANCE_YAML_FILES = [
  "ai-os/boss/ACTIVE-CLAIMS.yaml",
  "ai-os/boss/COMPLETED.yaml",
  "ai-os/CONSTITUTION.yaml",
  "ai-os/OS.yaml",
  "ai-os/MASTER-TRACKER.yaml",
]

async function main() {
  const failures = []

  for (const file of GOVERNANCE_YAML_FILES) {
    const abs = path.resolve(REPO_ROOT, file)
    let raw
    try {
      raw = await readFile(abs, "utf8")
    } catch (err) {
      failures.push({ file, error: `File not readable: ${err.message}` })
      continue
    }

    try {
      // No `json: true` here (see header comment): duplicate mapping keys
      // must throw, not silently last-value-win.
      yaml.load(raw)
    } catch (err) {
      failures.push({ file, error: err.message })
    }
  }

  if (failures.length > 0) {
    console.error(`=== Governance YAML Parse Check FAILED ===`)
    console.error(
      `${failures.length} of ${GOVERNANCE_YAML_FILES.length} governance YAML file(s) do not parse. Every session's own zero-duplication check and gap tracking depends on these files being valid YAML -- fix the syntax error below before merging.\n`
    )
    for (const { file, error } of failures) {
      console.error(`  - ${file}`)
      console.error(`    ${error.split("\n").join("\n    ")}\n`)
    }
    process.exit(1)
  }

  console.log(
    `Governance YAML Parse Check passed -- all ${GOVERNANCE_YAML_FILES.length} governance YAML files parse cleanly.`
  )
}

main().catch((err) => {
  console.error("Governance YAML Parse Check crashed:", err)
  process.exit(1)
})
