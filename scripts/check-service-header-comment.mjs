#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (2026-08-01), "AI Engineering
// Quality" -- Low: "Code Readability for AI: comment discipline not
// enforced by tooling." Confirmed before writing this: grepping every
// non-test file in src/lib/services/ found the header-comment convention
// (a narrative // block above the imports explaining WHY the file exists --
// what gap it closes, what it deliberately does NOT do) already followed
// by 299 of 300 files. That convention was real but unenforced -- nothing
// stopped a new file from skipping it. This script is the mechanical half:
// same enforcement class as check-terminology-guardrail.mjs
// (reviewable-diff ratchet on NEW files only, via --diff-only), not a
// runtime-unbypassable lock.
//
// Scope: src/lib/services/*.ts, excluding *.test.ts (tests conventionally
// open with a short "what this covers" line or a `/// <reference>`
// directive, a different genre this script doesn't police). Only files
// ADDED in this diff are checked -- existing files are grandfathered in,
// matching this repo's established "new debt only" ratchet pattern rather
// than retroactively failing CI for pre-existing files.
//
// A "header comment" here means: the file's first non-blank line is a
// `//` or `/*` comment, and the contiguous leading comment block totals at
// least MIN_HEADER_CHARS of actual text -- long enough to carry real
// context, not just a one-word stub like `// TODO`.
//
// Usage:
//   node scripts/check-service-header-comment.mjs --diff-only
//   node scripts/check-service-header-comment.mjs --file <path> [--file <path> ...]
// Exit code: 0 if every checked file has a qualifying header comment, 1 otherwise.
import { readFile, access } from "node:fs/promises"
import { execSync } from "node:child_process"
import path from "node:path"

const REPO_ROOT = process.cwd()
const BASE_BRANCH = process.env.GITHUB_BASE_REF || "main"
const SERVICE_FILE_RE = /^src\/lib\/services\/[^/]+\.ts$/
const MIN_HEADER_CHARS = 40

function getAddedFiles() {
  try {
    execSync(`git fetch origin ${BASE_BRANCH} --depth=100`, { stdio: "ignore" })
  } catch {
    // best-effort, matching check-terminology-guardrail.mjs's own precedent
  }
  let mergeBase = null
  for (const ref of [`origin/${BASE_BRANCH}`, BASE_BRANCH]) {
    try {
      mergeBase = execSync(`git merge-base HEAD ${ref}`, { encoding: "utf8" }).trim()
      if (mergeBase) break
    } catch {
      // try next ref candidate
    }
  }
  if (!mergeBase) {
    try {
      mergeBase = execSync(`git rev-parse HEAD~1`, { encoding: "utf8" }).trim()
    } catch {
      return null
    }
  }

  const tracked = execSync(`git diff --name-only --diff-filter=A ${mergeBase} HEAD`, { encoding: "utf8" }).trim()
  const untracked = execSync(`git ls-files --others --exclude-standard`, { encoding: "utf8" }).trim()

  const files = new Set()
  for (const f of [...tracked.split("\n"), ...untracked.split("\n")]) {
    if (f) files.add(f)
  }
  return [...files]
}

function hasQualifyingHeaderComment(text) {
  const lines = text.split("\n")
  let i = 0
  while (i < lines.length && lines[i].trim() === "") i++
  if (i >= lines.length) return false

  const first = lines[i].trim()
  if (!first.startsWith("//") && !first.startsWith("/*")) return false

  let headerChars = 0
  if (first.startsWith("//")) {
    while (i < lines.length && lines[i].trim().startsWith("//")) {
      headerChars += lines[i].trim().replace(/^\/\//, "").trim().length
      i++
    }
  } else {
    // block comment: accumulate until the closing */
    while (i < lines.length) {
      headerChars += lines[i].replace(/\/\*|\*\/|^\s*\*/g, "").trim().length
      if (lines[i].includes("*/")) break
      i++
    }
  }
  return headerChars >= MIN_HEADER_CHARS
}

async function main() {
  const args = process.argv.slice(2)
  const diffOnly = args.includes("--diff-only")
  const explicitFiles = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") explicitFiles.push(args[++i])
  }

  let candidates
  if (diffOnly) {
    candidates = getAddedFiles()
    if (candidates === null) {
      console.error("Could not determine a diff base (no merge-base, no HEAD~1) -- failing closed.")
      process.exit(1)
    }
  } else if (explicitFiles.length > 0) {
    candidates = explicitFiles
  } else {
    console.error("Usage: check-service-header-comment.mjs --diff-only | --file <path> [...]")
    process.exit(1)
  }

  const newServiceFiles = candidates.filter((f) => SERVICE_FILE_RE.test(f) && !f.endsWith(".test.ts"))

  const missing = []
  for (const relPath of newServiceFiles) {
    const abs = path.resolve(REPO_ROOT, relPath)
    try {
      await access(abs)
    } catch {
      continue // deleted before this check ran, nothing to scan
    }
    const text = await readFile(abs, "utf8")
    if (!hasQualifyingHeaderComment(text)) missing.push(relPath)
  }

  if (missing.length === 0) {
    console.log(`check-service-header-comment: OK (${newServiceFiles.length} new service file(s) checked).`)
    process.exit(0)
  }

  console.error("check-service-header-comment: NEW service file(s) missing a header comment:\n")
  for (const f of missing) {
    console.error(`  - ${f}`)
  }
  console.error(
    `\nEvery new file directly under src/lib/services/ must open with a // or /* header comment ` +
      `(at least ${MIN_HEADER_CHARS} characters of real text) explaining WHY the file exists -- what ` +
      `gap it closes, what it deliberately does not do. See any existing file in that directory for the ` +
      `established convention. This is a reviewable-diff ratchet on NEW files only (VERIDIAN Review ` +
      `Framework gap-closure, 2026-08-01, AI Engineering Quality / Code Readability for AI) -- existing ` +
      `files are not retroactively checked.`
  )
  process.exit(1)
}

main()
