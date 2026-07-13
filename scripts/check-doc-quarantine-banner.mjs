#!/usr/bin/env node
// GAP-UNIFIED-SOT-REMAINDER (b) (ai-os/MASTER-TRACKER.yaml): the mechanical
// half of the root-level stale-doc quarantine pass, same enforcement class
// as check-asset-registry-coverage.mjs and check-guardrail-presence.mjs (a
// reviewable-diff guarantee via PR/CI, not a runtime-unbypassable lock --
// named honestly, not oversold).
//
// Every file listed in ai-os/registry/stale-doc-manifest.yaml (both the
// `moved` and `already_archived` groups) MUST contain the exact quarantine
// banner. This does NOT verify a file that should be in the manifest but
// isn't (there is no reliable, generic way to detect "this doc is stale"
// from content alone) -- it only verifies that every file someone already
// judged stale enough to list stays visibly marked as such, so the banner
// can never silently be dropped by a later edit.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const MANIFEST_FILE = "ai-os/registry/stale-doc-manifest.yaml"

const BANNER_MD =
  "> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status."
const BANNER_YAML = [
  "# ARCHIVED / STALE — do not treat as current.",
  "# See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.",
].join("\n")

function expectedBannerFor(file) {
  return file.endsWith(".yaml") || file.endsWith(".yml") ? BANNER_YAML : BANNER_MD
}

async function main() {
  const manifestRaw = await readFile(path.resolve(REPO_ROOT, MANIFEST_FILE), "utf8")
  const manifest = yaml.load(manifestRaw)

  const entries = [...(manifest.moved ?? []), ...(manifest.already_archived ?? [])]

  if (entries.length === 0) {
    console.error(`No entries found in ${MANIFEST_FILE} -- the manifest may have drifted from its documented shape. Failing closed rather than silently passing with zero files checked.`)
    process.exit(1)
  }

  const missingBanner = []
  const weakReasons = []
  const missingFile = []

  for (const entry of entries) {
    const file = typeof entry === "string" ? entry : entry.file
    const reason = typeof entry === "string" ? undefined : entry.reason

    if (!reason || reason.trim().length < 10) {
      weakReasons.push(file)
    }

    let content
    try {
      content = await readFile(path.resolve(REPO_ROOT, file), "utf8")
    } catch {
      missingFile.push(file)
      continue
    }

    // Normalize CRLF -> LF before comparing: several archived .yaml files on
    // this Windows checkout have CRLF line endings, and BANNER_YAML's `\n`
    // join would otherwise silently fail the match even though the banner
    // text is genuinely present -- caught during audit 2026-07-13 (all 13
    // .yaml entries falsely reported missing).
    const normalizedContent = content.replace(/\r\n/g, "\n")
    const expected = expectedBannerFor(file)
    if (!normalizedContent.includes(expected)) {
      missingBanner.push(file)
    }
  }

  let failed = false

  if (missingFile.length > 0) {
    failed = true
    console.error(`=== Doc Quarantine Banner Check FAILED ===`)
    console.error(`${missingFile.length} manifest-listed file(s) do not exist on disk (moved, renamed, or deleted without updating ${MANIFEST_FILE}):\n`)
    for (const f of missingFile) console.error(`  - ${f}`)
  }

  if (missingBanner.length > 0) {
    failed = true
    console.error(`\n${missingBanner.length} manifest-listed file(s) are missing the exact quarantine banner:\n`)
    for (const f of missingBanner) console.error(`  - ${f}`)
    console.error(`\nRequired banner (.md files):\n  ${BANNER_MD}`)
    console.error(`\nRequired banner (.yaml/.yml files, as leading comment lines):\n  ${BANNER_YAML.split("\n").map((l) => "  " + l).join("\n")}`)
  }

  if (weakReasons.length > 0) {
    failed = true
    console.error(`\n${weakReasons.length} manifest entry(ies) have a missing or too-short quarantine reason (min 10 chars):\n`)
    for (const f of weakReasons) console.error(`  - ${f}`)
  }

  if (failed) process.exit(1)

  console.log(
    `Doc Quarantine Banner Check passed -- all ${entries.length} manifest-listed files carry the banner (${(manifest.moved ?? []).length} moved, ${(manifest.already_archived ?? []).length} already-archived).`
  )
}

main().catch((err) => {
  console.error("Doc Quarantine Banner Check crashed:", err)
  process.exit(1)
})
