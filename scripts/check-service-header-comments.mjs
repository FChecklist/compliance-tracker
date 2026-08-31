#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure: AI Engineering Quality -- "Code
// Readability for AI" ([Low], comment discipline not enforced by tooling).
// Same enforcement class as check-doc-quarantine-banner.mjs / check-asset-
// registry-coverage.mjs (a reviewable-diff guarantee via PR/CI, not a
// runtime-unbypassable lock -- named honestly, not oversold): fails the
// build if a file under src/lib/services/ has no leading header comment.
//
// Rationale (why this file class specifically): src/lib/services/*.ts is
// where most of this codebase's real business logic lives, and it already
// has a widely-followed informal convention of opening each file with a
// `//` or `/**` block naming the gap/wave it closes and the reasoning
// behind its design -- exactly the kind of context an AI agent modifying
// the file later needs and can't recover from the code alone. This check
// makes that convention mechanical instead of a habit.
//
// Scope, deliberately narrow: src/lib/services/*.ts (a flat directory, no
// subdirectories as of this check's introduction), excluding
// `*.test.ts` (tests document themselves via `describe`/`test` names, not
// file-header prose) and re-export-only barrel files (`index.ts` with no
// other statements) are exempt. This does NOT check comment quality/
// accuracy, only presence -- a one-word comment technically passes. It also
// does not (and structurally cannot) restrict itself to "new" files only;
// per this codebase's other coverage checks (asset-registry, metadata-
// index, doc-cross-references) enforcement is "every file in scope, every
// PR", not diff-only -- narrower than diff-only would let an already-
// undocumented existing file merge further undocumented changes forever.
// As of this check's introduction every real (non-exempt) file in
// src/lib/services/ already carries a header comment, so this is a
// zero-fixup gate on day one, not a retroactive cleanup demand.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

const REPO_ROOT = process.cwd()
const SERVICES_DIR = "src/lib/services"

function listServiceFiles() {
  const out = execFileSync("git", ["ls-files", `${SERVICES_DIR}/*.ts`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts"))
}

// A header comment is one or more `//` line-comments, or a `/*`/`/**` block
// comment, appearing before the first real statement -- a leading
// `/// <reference .../>` triple-slash directive (used by a few *.test.ts
// files in this repo) does not itself count as the header, but is skipped
// over so a real header comment following it is still found.
function hasHeaderComment(source) {
  const lines = source.split("\n")
  let i = 0
  while (i < lines.length && lines[i].trim() === "") i++
  if (i >= lines.length) return false

  const first = lines[i].trim()
  if (first.startsWith("///")) {
    i++
    while (i < lines.length && lines[i].trim() === "") i++
    if (i >= lines.length) return false
  }

  const line = lines[i].trim()
  return line.startsWith("//") || line.startsWith("/*")
}

function isBarrelFile(file, source) {
  if (path.basename(file) !== "index.ts") return false
  const codeLines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))
  return codeLines.every((l) => l.startsWith("export ") || l.startsWith("import "))
}

async function main() {
  const files = listServiceFiles()

  if (files.length === 0) {
    console.error(`No files found under ${SERVICES_DIR}/ -- the glob may have drifted from the real directory layout. Failing closed rather than silently passing with zero files checked.`)
    process.exit(1)
  }

  const missing = []

  for (const file of files) {
    const source = await readFile(path.resolve(REPO_ROOT, file), "utf8")
    if (isBarrelFile(file, source)) continue
    if (!hasHeaderComment(source)) missing.push(file)
  }

  if (missing.length > 0) {
    console.error(`=== Service Header Comment Check FAILED ===`)
    console.error(`${missing.length} file(s) under ${SERVICES_DIR}/ have no leading header comment explaining what the file does and why (a \`//\` or \`/**\` block before the first statement):\n`)
    for (const f of missing) console.error(`  - ${f}`)
    console.error(`\nAdd a short header comment: what gap/task this file closes (or its purpose, if pre-dating that convention), and any non-obvious design reasoning a later agent modifying this file would need. See any other file in ${SERVICES_DIR}/ for the established pattern.`)
    process.exit(1)
  }

  console.log(`Service Header Comment Check passed -- all ${files.length} file(s) under ${SERVICES_DIR}/ carry a header comment.`)
}

main().catch((err) => {
  console.error("Service Header Comment Check crashed:", err)
  process.exit(1)
})
