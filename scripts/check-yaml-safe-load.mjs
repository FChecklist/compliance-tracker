#!/usr/bin/env node
// PM decision, 2026-08-03 (UMR-20260803-140106-6307 / UMR-20260802-165606-4413
// OCID-020), following PR #818 (real `ai-os/boss/ACTIVE-CLAIMS.yaml`
// YAML ParserError from a malformed duplicate entry, fixed by hand): same
// enforcement class as the other scripts/check-*.mjs guardrails (a
// reviewable-diff / fail-the-build guarantee, not a runtime-unbypassable
// lock) -- applied here to the governance YAML files this repo's own
// CLAUDE.md "Read Before Starting Work" list names as depended-on before
// any session picks up work. A malformed entry in any of these can no
// longer silently sit on `main` until a session happens to read the file
// and hit the parse error itself; CI now fails immediately with the exact
// file and the parser's own line/column.
//
// Deliberately a fixed, explicit list rather than a recursive scan of every
// `.yaml`/`.yml` under `ai-os/` -- the PM decision that authorized this
// check scoped it to `ai-os/boss/ACTIVE-CLAIMS.yaml` "and any other real
// governance YAML files this session depends on", which is this repo's own
// CLAUDE.md list, not every YAML file in the tree. Widening this list to
// more governance YAML files later is a small, welcome addition here; it
// does not require a new script.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()

const TARGET_FILES = [
  "ai-os/boss/ACTIVE-CLAIMS.yaml",
  "ai-os/CONSTITUTION.yaml",
  "ai-os/OS.yaml",
  "ai-os/MASTER-TRACKER.yaml",
]

async function main() {
  const failures = []

  for (const file of TARGET_FILES) {
    const abs = path.resolve(REPO_ROOT, file)
    let raw
    try {
      raw = await readFile(abs, "utf8")
    } catch (err) {
      failures.push(`${file}: could not read file (${err.message})`)
      continue
    }

    try {
      yaml.load(raw)
    } catch (err) {
      if (err instanceof yaml.YAMLException) {
        failures.push(`${file}: ${err.reason} at ${err.mark ? `line ${err.mark.line + 1}, column ${err.mark.column + 1}` : "unknown position"}\n${err.message}`)
      } else {
        failures.push(`${file}: ${err.message}`)
      }
    }
  }

  if (failures.length > 0) {
    console.error("YAML Safe Load Check FAILED -- the following governance YAML file(s) do not parse:\n")
    for (const failure of failures) {
      console.error(`- ${failure}\n`)
    }
    console.error(
      `A file in this list must be valid YAML at all times: this repo's own CLAUDE.md ` +
      `"Read Before Starting Work" list requires every session to read these files before ` +
      `picking up any task, so a parse error here blocks every session, not just one PR ` +
      `(see PR #818 for the real incident this check exists to catch before merge).`
    )
    process.exit(1)
  }

  console.log(`YAML Safe Load Check passed -- ${TARGET_FILES.length} governance YAML file(s) parse cleanly.`)
}

main().catch((err) => {
  console.error("YAML Safe Load Check crashed unexpectedly:", err)
  process.exit(1)
})
