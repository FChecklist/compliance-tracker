#!/usr/bin/env node
// Audit198 gap closure, 2026-07-21 (INTEGRATIONS_API_GOVERNANCE category --
// ARTICLE-079 "Every deprecated feature shall include a planned retirement
// schedule."). Same enforcement class as check-doc-quarantine-banner.mjs /
// check-asset-registry-coverage.mjs / check-guardrail-presence.mjs: a
// reviewable-diff guarantee via PR/CI, not a runtime-unbypassable lock --
// named honestly, not oversold.
//
// Fails the build if a `@deprecated` marker exists in src/ with no
// matching entry in ai-os/registry/deprecations.yaml (a code comment alone
// is not a tracked retirement schedule), OR if a registry entry's `file`
// no longer contains an `@deprecated` marker (stale registry entry -- the
// feature was removed/un-deprecated without updating this file).
import { readFile } from "node:fs/promises"
import path from "node:path"
import { execSync } from "node:child_process"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const REGISTRY_FILE = "ai-os/registry/deprecations.yaml"

function grepDeprecatedMarkers() {
  // Same grep -rIn convention evidence-engine.mjs uses elsewhere in this
  // repo's own audit tooling -- real command output, never fabricated.
  let out
  try {
    out = execSync(
      `grep -rIn "@deprecated" src --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude-dir=node_modules`,
      { cwd: REPO_ROOT, encoding: "utf8" }
    )
  } catch (err) {
    // grep exits non-zero on zero matches -- that's a real "no deprecations
    // exist" result, not a tool failure.
    out = err.stdout ?? ""
  }
  const files = new Set(
    out
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(":")[0])
  )
  return files
}

async function main() {
  const markerFiles = grepDeprecatedMarkers()

  const registryRaw = await readFile(path.resolve(REPO_ROOT, REGISTRY_FILE), "utf8")
  const registry = yaml.load(registryRaw)
  const entries = registry?.entries ?? []
  const registryFiles = new Map(entries.map((e) => [e.file, e]))

  const missingFromRegistry = [...markerFiles].filter((f) => !registryFiles.has(f))
  const staleRegistryEntries = entries.filter((e) => !markerFiles.has(e.file))
  const missingRetirementFields = entries.filter(
    (e) => !e.deprecated_since || !e.replacement || !e.retirement_date
  )

  let failed = false

  if (missingFromRegistry.length > 0) {
    failed = true
    console.error(`=== Deprecation Registry Coverage Check FAILED ===`)
    console.error(`${missingFromRegistry.length} file(s) have an @deprecated marker with no matching entry in ${REGISTRY_FILE}:\n`)
    for (const f of missingFromRegistry) console.error(`  - ${f}`)
    console.error(`\nAdd an entry to ${REGISTRY_FILE} with feature/deprecated_since/replacement/retirement_date, in the SAME PR that added the @deprecated marker.`)
  }

  if (staleRegistryEntries.length > 0) {
    failed = true
    console.error(`\n${staleRegistryEntries.length} ${REGISTRY_FILE} entry(ies) reference a file with no @deprecated marker (feature removed, or un-deprecated, without updating the registry):\n`)
    for (const e of staleRegistryEntries) console.error(`  - ${e.file}`)
  }

  if (missingRetirementFields.length > 0) {
    failed = true
    console.error(`\n${missingRetirementFields.length} ${REGISTRY_FILE} entry(ies) are missing a required field (deprecated_since/replacement/retirement_date):\n`)
    for (const e of missingRetirementFields) console.error(`  - ${e.file}`)
  }

  if (failed) process.exit(1)

  console.log(
    `Deprecation Registry Coverage Check passed -- ${markerFiles.size} @deprecated marker(s) in src/, all tracked in ${REGISTRY_FILE}.`
  )
}

main().catch((err) => {
  console.error("Deprecation Registry Coverage Check crashed:", err)
  process.exit(1)
})
