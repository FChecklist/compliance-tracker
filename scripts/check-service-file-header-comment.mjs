#!/usr/bin/env node
// Review Framework gap-closure: AI Engineering Quality -- "Code Readability
// for AI" (Low). Gap: comment discipline on service files (the module every
// route handler and MCP tool calls into -- exactly the code an AI agent
// reads first when asked to modify business logic) was a real, near-
// universal convention (183/184 existing src/lib/services/*.ts files carry
// a header comment explaining *why* the module exists, e.g. wave/gap-id
// provenance) but was enforced by nothing -- a new file could silently skip
// it and nobody would notice until a future agent had to reverse-engineer
// intent from code alone.
//
// Same enforcement class as check-doc-quarantine-banner.mjs and
// check-migration-collision.mjs (reviewable-diff guarantee via PR/CI, not a
// runtime-unbypassable lock -- named honestly, not oversold): only checks
// files NEW in this PR/branch relative to main, so it never fails CI on the
// pre-existing 183/184 files retroactively -- it just stops the convention
// from silently eroding going forward.
//
// What counts as a header comment: a `//` or `/*` comment block appearing
// before the first real code statement, allowing for a leading `import` /
// `/// <reference>` line (context.ts's real pattern: import first, then a
// comment explaining the type below it) -- this deliberately does NOT
// require the comment to be the literal first line.
//
// Scope: src/lib/services/**/*.ts, excluding *.test.ts (tests document
// themselves via `describe`/`test` names, not this convention) and *.d.ts.
//
// Usage: node scripts/check-service-file-header-comment.mjs
// Exit code 0 = no new service file is missing a header comment, 1 = fail.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { execSync } from "node:child_process"

const REPO_ROOT = process.cwd()
const SERVICE_DIR_PREFIX = "src/lib/services/"

function getNewServiceFiles() {
  let mergeBase
  try {
    mergeBase = execSync("git merge-base HEAD main 2>/dev/null || echo HEAD~1", {
      encoding: "utf8",
    }).trim()
  } catch {
    return []
  }

  let changed = []
  let untracked = []
  try {
    changed = execSync(
      `git diff --name-only --diff-filter=A ${mergeBase} HEAD -- ${SERVICE_DIR_PREFIX} 2>/dev/null`,
      { encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean)
  } catch {
    // ignore -- e.g. shallow clone without merge-base; fall through with
    // whatever untracked files turn up below
  }
  try {
    untracked = execSync(
      `git ls-files --others --exclude-standard -- ${SERVICE_DIR_PREFIX} 2>/dev/null`,
      { encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean)
  } catch {
    // ignore
  }

  const all = [...new Set([...changed, ...untracked])]
  return all.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
}

function hasHeaderComment(content) {
  const lines = content.split("\n")
  let i = 0
  // Allow up to a couple of leading non-comment lines that are just
  // imports / triple-slash reference directives / blank lines before we
  // require a comment -- matches context.ts's real, legitimate pattern.
  while (i < lines.length && i < 6) {
    const line = lines[i].trim()
    if (line === "") {
      i++
      continue
    }
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
      return true
    }
    if (line.startsWith("import ") || line.startsWith("export type") || line.startsWith("/// <reference")) {
      i++
      continue
    }
    // First substantive, non-import, non-comment line -- no header found.
    return false
  }
  return false
}

async function main() {
  const newFiles = getNewServiceFiles()

  if (newFiles.length === 0) {
    console.log("Service File Header Comment Check passed -- no new src/lib/services/*.ts files in this branch.")
    return
  }

  const missing = []
  for (const file of newFiles) {
    let content
    try {
      content = await readFile(path.resolve(REPO_ROOT, file), "utf8")
    } catch {
      // file was deleted/renamed since diff was computed -- not our concern
      continue
    }
    if (!hasHeaderComment(content)) {
      missing.push(file)
    }
  }

  if (missing.length > 0) {
    console.error("=== Service File Header Comment Check FAILED ===")
    console.error(
      `${missing.length} new service file(s) are missing a header comment explaining why the module exists:\n`
    )
    for (const f of missing) console.error(`  - ${f}`)
    console.error(
      "\nEvery other file in src/lib/services/ carries a short header comment (wave/gap-id, what problem it solves, key design decisions) -- this is what lets an AI agent understand intent without re-deriving it from code. Add one to the top of the file (a leading `import` line is fine before it, see src/lib/services/context.ts for the pattern)."
    )
    process.exit(1)
  }

  console.log(
    `Service File Header Comment Check passed -- all ${newFiles.length} new service file(s) carry a header comment.`
  )
}

main().catch((err) => {
  console.error("Service File Header Comment Check crashed:", err)
  process.exit(1)
})
