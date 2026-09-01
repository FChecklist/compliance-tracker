#!/usr/bin/env node
// Gap closure, 2026-08-07 (VERIDIAN Review Framework, AI Documentation --
// UMR-20260801-170930-2080 sub-task): closes the [Medium] "AI-Readable
// Configuration Documentation" finding. Same enforcement class as this
// repo's other check-*.mjs scripts (asset-registry-coverage,
// metadata-index-coverage): fails the build if a real `process.env.X`
// reference exists in `src/` with no matching row in
// `docs/master/CONFIGURATION.md`.
//
// Deliberately scoped to `src/` only, not `scripts/` -- CI/tooling scripts
// change independently of the app's own runtime config surface and are
// lower-stakes to miss; see CONFIGURATION.md's own "Maintaining this
// file" section for the same note. Honest limitation, same class as this
// repo's other check-*.mjs scripts: this verifies a row EXISTS for the
// var name, not that its description is accurate.
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const REPO_ROOT = process.cwd()
const SRC_DIR = "src"
const CONFIG_DOC = "docs/master/CONFIGURATION.md"
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"])

async function findEnvVarsInSrc() {
  const found = new Map() // var -> first file it appears in
  async function walk(dir) {
    const entries = await readdir(path.resolve(REPO_ROOT, dir), { withFileTypes: true })
    for (const entry of entries) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(rel)
        continue
      }
      if (!EXTENSIONS.has(path.extname(entry.name))) continue
      const content = await readFile(path.resolve(REPO_ROOT, rel), "utf8")
      for (const m of content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (!found.has(m[1])) found.set(m[1], rel)
      }
    }
  }
  await walk(SRC_DIR)
  return found
}

async function main() {
  const [envVars, docContent] = await Promise.all([
    findEnvVarsInSrc(),
    readFile(path.resolve(REPO_ROOT, CONFIG_DOC), "utf8"),
  ])

  const missing = []
  for (const [varName, file] of envVars) {
    // Documented as a backtick-wrapped literal anywhere in the doc -- table cells may
    // list several vars per row (comma-separated), so this doesn't require the var to
    // be alone in its own cell, only that it's backtick-wrapped (not a false-match
    // substring of a longer var name, since the exact backticks must bound it).
    const pattern = new RegExp("`" + varName + "`")
    if (!pattern.test(docContent)) missing.push({ varName, file })
  }

  if (missing.length === 0) {
    console.log(`OK: all ${envVars.size} process.env vars referenced in src/ are documented in ${CONFIG_DOC}.`)
    return
  }

  console.error(`${CONFIG_DOC} is missing ${missing.length} env var(s) referenced in src/:`)
  for (const { varName, file } of missing) console.error(`  - ${varName} (first seen in ${file})`)
  console.error(`\nAdd a row for each to the appropriate table in ${CONFIG_DOC}.`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
