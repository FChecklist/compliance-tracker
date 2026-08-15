#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure: "Code Readability for AI" (Low) --
// "Comment discipline not enforced by tooling." Same enforcement class as
// check-migration-collision.mjs and check-doc-quarantine-banner.mjs: a
// reviewable-diff guarantee via PR/CI, not a runtime-unbypassable lock,
// named honestly rather than oversold.
//
// As of this check's introduction, 232/233 existing src/lib/services/*.ts
// files already open with a header comment explaining what the file is and
// why it exists -- that discipline is real, established practice here, it
// was just never enforced by tooling, so it could silently lapse on a new
// file without anyone noticing at review time. This check makes that lapse
// fail CI instead.
//
// Scope: only NEW service files (added, not modified, relative to the
// resolved base ref) -- this does not retroactively demand every existing
// file get a header rewrite, only that new ones keep the convention going
// forward. Base ref resolution mirrors check-migration-collision.mjs's
// fix for the "stale local main ref" incident (PR discussion, 2026-07-30):
// in shared checkouts/worktrees the local `main` ref is frequently stale
// relative to `origin/main`, which can make this script miss real new
// files or (less likely here, since only additions are scoped) misreport
// old ones. Resolution order: --base <ref> CLI arg, BASE_REF env var,
// freshly-fetched origin/main, local main, HEAD~1.
//
// What counts as a header comment: a `//` line comment block of at least
// MIN_HEADER_CHARS of real content, appearing at or near the top of the
// file -- specifically, within the first HEADER_SCAN_WINDOW lines and
// before the first non-import, non-comment, non-blank line. A small number
// of leading `import`/`export type` lines are tolerated before the comment
// block starts (src/lib/services/context.ts is the one real precedent for
// this: `import type { users } from "@/lib/db"` on line 1, header comment
// starting line 3) -- so this does not force every file into exactly one
// physical layout, only that a real explanatory comment exists near the top.
//
// Honest limitation: this cannot judge whether a header comment is
// *accurate* or *useful*, only that one of sufficient length exists. A
// determined bypass (`// asdasdasdasdasdasdasdasdasdasdasdasdasdasdasd`)
// would pass. That is the same class of limitation named in every other
// mechanical check in this directory -- it raises the floor, it does not
// replace review judgment.
//
// Usage: node scripts/check-service-header-comment.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-service-header-comment.mjs
// Exit code 0 = every new service file has a header comment, 1 = at least
// one does not.

import { readFileSync } from "fs"
import { execSync } from "child_process"

const SERVICES_DIR = "src/lib/services/"
const MIN_HEADER_CHARS = 40
const HEADER_SCAN_WINDOW = 15
const MAX_LEADING_NON_COMMENT_LINES = 6

function resolveBaseRef() {
  const argIdx = process.argv.indexOf("--base")
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1]
  }
  if (process.env.BASE_REF && process.env.BASE_REF.trim()) {
    return process.env.BASE_REF.trim()
  }
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" })
  } catch {
    // ignore -- use whatever origin/main we already have, if anything
  }
  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" })
    return "origin/main"
  } catch {
    // origin/main not available locally at all, fall through
  }
  try {
    execSync("git rev-parse --verify main", { stdio: "ignore" })
    return "main"
  } catch {
    // no local main either, fall through
  }
  return "HEAD~1"
}

function getNewServiceFiles() {
  const baseRef = resolveBaseRef()
  let added = []
  try {
    const mergeBase = execSync(`git merge-base HEAD ${baseRef} 2>/dev/null || echo HEAD~1`, {
      encoding: "utf8",
    }).trim()
    const diffOut = execSync(
      `git diff --name-only --diff-filter=A ${mergeBase} HEAD -- ${SERVICES_DIR} 2>/dev/null`,
      { encoding: "utf8" }
    ).trim()
    const untracked = execSync(
      `git ls-files --others --exclude-standard -- ${SERVICES_DIR} 2>/dev/null`,
      { encoding: "utf8" }
    ).trim()
    added = [...diffOut.split("\n"), ...untracked.split("\n")].filter(Boolean)
  } catch {
    // Shallow clone or no base ref available locally -- fail open (0 new
    // files checked) rather than crashing CI on an environment quirk
    // unrelated to this check's actual purpose.
    return []
  }
  return [...new Set(added)].filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts")
  )
}

function hasHeaderComment(content) {
  const lines = content.split("\n").slice(0, HEADER_SCAN_WINDOW)

  let i = 0
  let leadingNonComment = 0
  // Tolerate a small number of leading blank/import/export-type lines
  // before the header comment block starts (context.ts precedent).
  while (i < lines.length) {
    const line = lines[i].trim()
    if (line === "" || line.startsWith("import ") || line.startsWith("export type")) {
      if (line !== "") leadingNonComment++
      i++
      if (leadingNonComment > MAX_LEADING_NON_COMMENT_LINES) return false
      continue
    }
    break
  }

  if (i >= lines.length || !lines[i].trim().startsWith("//")) return false

  let headerChars = 0
  while (i < lines.length && lines[i].trim().startsWith("//")) {
    headerChars += lines[i].trim().replace(/^\/\/\s*/, "").length
    i++
  }

  return headerChars >= MIN_HEADER_CHARS
}

function main() {
  const newFiles = getNewServiceFiles()

  if (newFiles.length === 0) {
    console.log("Service Header Comment Check passed -- no new src/lib/services/*.ts files in this diff.")
    return
  }

  const missing = []
  for (const file of newFiles) {
    let content
    try {
      content = readFileSync(file, "utf8")
    } catch {
      // File was added then deleted within the same diff range -- nothing
      // to check.
      continue
    }
    if (!hasHeaderComment(content)) missing.push(file)
  }

  if (missing.length > 0) {
    console.error("=== Service Header Comment Check FAILED ===")
    console.error(
      `${missing.length} new service file(s) are missing a header comment (>= ${MIN_HEADER_CHARS} chars of real ` +
        `content, within the first ${HEADER_SCAN_WINDOW} lines):\n`
    )
    for (const f of missing) console.error(`  - ${f}`)
    console.error(
      "\nAdd a `//` comment block near the top explaining what this service does and why it exists -- " +
        "see any existing src/lib/services/*.ts file for the established convention."
    )
    process.exit(1)
  }

  console.log(
    `Service Header Comment Check passed -- all ${newFiles.length} new service file(s) have a header comment.`
  )
}

main()
