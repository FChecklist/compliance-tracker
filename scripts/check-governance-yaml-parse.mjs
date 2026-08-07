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
// guardrail. Loaded with `json: true` (js-yaml's permissive/JSON-superset
// mode, matching PyYAML's default tolerant behavior): this deliberately
// does NOT fail on duplicate mapping keys, a real, separate, pre-existing
// condition found elsewhere in ai-os/boss/ACTIVE-CLAIMS.yaml while building
// this check -- out of scope for this specific guardrail (which targets
// the structural ParserError class fixed in PR #818, not key-uniqueness
// style issues) and not fixed here per explicit PM instruction not to
// expand scope beyond this guardrail addition.
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
      yaml.load(raw, { json: true })
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
