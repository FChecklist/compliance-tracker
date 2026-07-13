#!/usr/bin/env node
// Gap closure, 2026-07-13 (Boss directive, metadata/drift investigation):
// same enforcement class as check-asset-registry-coverage.mjs, applied to
// documents instead of database tables. Investigation confirmed this
// project has 8+ separate governance/tracking documents that were never
// centrally indexed anywhere -- ai-os/OS.yaml now carries that index (see
// its own header for why a real merge into one file was rejected). This
// script is what keeps that index honest: every real top-level governance
// file or directory under ai-os/, plus the root-level rule files, must
// appear as a `path:` in one of ai-os/OS.yaml's `index.*` sections or in
// `index.exempted` with a real reason. Neither list -> CI fails.
//
// Deliberately checks TOP-LEVEL items only (files directly in ai-os/, plus
// files directly inside ai-os/boss/, ai-os/sentinel/, ai-os/registry/,
// ai-os/engines/, since OS.yaml indexes those at file granularity) -- not a
// recursive scan of every file in every tree directory (audit-tree/,
// system-tree/, tree4-unified/ are indexed at the directory level in
// OS.yaml, matching how those trees are actually referenced elsewhere in
// this codebase). A tree directory gaining a new numbered file inside it
// is not a new governance surface requiring its own index entry -- the
// directory-level pointer already covers it.
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const OS_YAML = "ai-os/OS.yaml"

// Directories whose CONTENTS are covered by one directory-level index
// entry, not a per-file one -- matches OS.yaml's own granularity.
const DIRECTORY_LEVEL = new Set(["ai-os/audit-tree", "ai-os/system-tree", "ai-os/tree4-unified"])

// Non-governance noise that should never need an index/exempted decision
// -- archive/scratch subfolders inside the tree directories, not top-level
// items themselves.
const IGNORE_NAMES = new Set(["archive", "source-documents", ".DS_Store"])

async function listTopLevel(relDir) {
  const abs = path.resolve(REPO_ROOT, relDir)
  let entries
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => !IGNORE_NAMES.has(e.name))
    .map((e) => `${relDir}/${e.name}`)
}

async function main() {
  const rootLevelRules = ["CLAUDE.md", "AGENTS.md", "PLATFORM_STRATEGY.md"]

  const aiOsTop = await listTopLevel("ai-os")
  const realItems = new Set(rootLevelRules)

  for (const item of aiOsTop) {
    if (DIRECTORY_LEVEL.has(item)) {
      realItems.add(item + "/") // matches OS.yaml's own trailing-slash directory entries
      continue
    }
    const stat = (await readdir(path.resolve(REPO_ROOT, item)).then(() => true).catch(() => false))
    if (stat) {
      // A subdirectory not in DIRECTORY_LEVEL -- index its own top-level
      // files individually (boss/, sentinel/, registry/, engines/).
      const inner = await listTopLevel(item)
      for (const f of inner) realItems.add(f)
    } else {
      realItems.add(item)
    }
  }

  const osYamlRaw = await readFile(path.resolve(REPO_ROOT, OS_YAML), "utf8")
  const osYaml = yaml.load(osYamlRaw)
  const index = osYaml.index ?? {}

  const indexed = new Set()
  const exempted = new Map()
  for (const [section, entries] of Object.entries(index)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (section === "exempted") {
        exempted.set(entry.path, entry.reason)
      } else {
        indexed.add(entry.path)
      }
    }
  }

  const missing = []
  const weakReasons = []
  for (const item of realItems) {
    const normalized = item.replace(/\/$/, "")
    const isIndexed = indexed.has(item) || indexed.has(normalized) || indexed.has(normalized + "/")
    const isExempted = exempted.has(item) || exempted.has(normalized) || exempted.has(normalized + "/")
    if (isExempted) {
      const reason = exempted.get(item) ?? exempted.get(normalized) ?? exempted.get(normalized + "/")
      if (!reason || reason.trim().length < 10) weakReasons.push(item)
      continue
    }
    if (!isIndexed) missing.push(item)
  }

  let failed = false

  if (missing.length > 0) {
    failed = true
    console.error("=== Metadata Index Coverage Check FAILED ===")
    console.error(`${missing.length} governance file(s)/directory(ies) are neither indexed nor exempted in ${OS_YAML}:\n`)
    for (const m of missing) console.error(`  - ${m}`)
    console.error(`\nAdd a real 'path'/'covers' entry to ai-os/OS.yaml's index (or 'exempted' with a`)
    console.error(`real reason if it's genuinely not governance-scoped) -- see OS.yaml's own header`)
    console.error(`for why this exists.`)
  }

  if (weakReasons.length > 0) {
    failed = true
    console.error(`\n${weakReasons.length} exemption(s) have a missing or too-short reason (min 10 chars):\n`)
    for (const w of weakReasons) console.error(`  - ${w}`)
  }

  if (failed) process.exit(1)

  console.log(`Metadata Index Coverage Check passed -- all ${realItems.size} governance items accounted for (${indexed.size} indexed, ${exempted.size} exempted).`)
}

main().catch((err) => {
  console.error("Metadata Index Coverage Check crashed:", err)
  process.exit(1)
})
