#!/usr/bin/env node
// Review Framework gap-closure, "Code Readability for AI" (Low): "Comment
// discipline not enforced by tooling" -- src/lib/services/*.ts has an
// almost-universal real convention of a leading header comment explaining
// a file's provenance/purpose (grep the directory: 183/184 non-test files
// already do this as of this check's introduction), but nothing enforced
// it, so a new service file could silently ship with zero context for the
// next agent that has to modify it. This makes that convention a real CI
// gate instead of a habit -- same enforcement class as the other
// scripts/check-*.mjs jobs in .github/workflows/ci.yml.
//
// What counts as a header comment: a `//` or `/* */` comment block that
// appears before the first real code statement, after skipping only
// leading blank lines and `import`/`export type {...} from` lines (so the
// common "imports first, then an explanatory comment right above the
// first export" shape -- see src/lib/services/context.ts -- passes, not
// just a comment glued to line 1). The block must total at least
// MIN_COMMENT_CHARS characters of actual comment text, so a lone `// TODO`
// or `// eslint-disable` doesn't satisfy this.
//
// Honest limitation, same class as this repo's other check-*.mjs scripts:
// this verifies a comment of *some* minimum length exists, not that it is
// accurate, useful, or actually describes the file -- it can't stop a
// lazy "// this file has services in it" from passing. It converts "no
// header comment at all" from silent to a build failure; it doesn't
// grade prose quality.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

const REPO_ROOT = process.cwd()
const SERVICES_DIR = "src/lib/services"
const MIN_COMMENT_CHARS = 40

function listServiceFiles() {
  const out = execFileSync("git", ["ls-files", SERVICES_DIR], { cwd: REPO_ROOT, encoding: "utf8" })
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".ts") && !l.endsWith(".test.ts") && !l.endsWith(".d.ts"))
}

// Returns the number of comment characters found in the header block, or 0
// if the first real statement is reached with no qualifying comment.
function headerCommentChars(source) {
  const lines = source.split("\n")
  let i = 0
  let commentChars = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    if (line === "") { i++; continue }
    if (line.startsWith("import ") || line.startsWith("import{")) { i++; continue }
    if (line.startsWith("/// <reference")) { i++; continue }

    if (line.startsWith("//")) {
      commentChars += line.length
      i++
      continue
    }

    if (line.startsWith("/*")) {
      commentChars += line.length
      i++
      while (i < lines.length && !lines[i - 1].includes("*/")) {
        commentChars += lines[i].trim().length
        i++
      }
      continue
    }

    // First non-blank, non-import, non-comment line -- header block ends here.
    break
  }

  return commentChars
}

async function main() {
  const files = listServiceFiles()
  const failures = []

  for (const rel of files) {
    const abs = path.join(REPO_ROOT, rel)
    const source = await readFile(abs, "utf8")
    const chars = headerCommentChars(source)
    if (chars < MIN_COMMENT_CHARS) {
      failures.push(rel)
    }
  }

  if (failures.length > 0) {
    console.error(`Service Header Comment Check: FAILED -- ${failures.length} file(s) in ${SERVICES_DIR} have no header comment (or fewer than ${MIN_COMMENT_CHARS} chars of one) before their first real statement:\n`)
    for (const f of failures) console.error(`  - ${f}`)
    console.error(`\nAdd a leading // (or /* */) comment explaining what the file does and why it exists -- see any other file in ${SERVICES_DIR} for the established style (provenance/wave, what it's for, real design tradeoffs). Imports may come first; the comment just needs to appear before the first type/function/export statement.`)
    process.exit(1)
  }

  console.log(`Service Header Comment Check: OK -- ${files.length} file(s) in ${SERVICES_DIR} all have a header comment.`)
}

main().catch((err) => {
  console.error("Service Header Comment Check: script error:", err)
  process.exit(1)
})
