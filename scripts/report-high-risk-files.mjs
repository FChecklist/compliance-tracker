#!/usr/bin/env node
// Review Framework gap-closure, "AI Modification Readiness" (Medium): "No
// single readiness score; depends heavily on which file." Building a real
// per-file readiness *score* (weighting test coverage, churn, complexity,
// blast radius, etc.) is a genuinely larger project than this gap warrants
// -- this script instead produces the lightweight signal the recommended
// approach actually asked for: which files are both LARGE (an agent has to
// hold a lot of context to change them safely) and UNTESTED (no colocated
// *.test.ts/*.test.tsx to catch a regression), the two cheapest-to-compute
// proxies for "an AI agent editing this file has the least safety net."
// CLAUDE.md's "High-Risk Files" section is a snapshot of this script's
// output, not a live query -- rerun this after a wave that adds tests or
// splits a large file, and update that section if the list changed.
//
// Honest limitation: line count and "has a same-named *.test.ts" are crude
// proxies, not a real risk model -- a short file with gnarly multi-tenant
// RLS logic can be riskier than a long, mechanical CRUD service, and a
// file can have real indirect coverage (exercised via another file's
// tests, or E2E) that this purely-textual check can't see. This is a
// starting-point flag ("apply extra caution"), not a verdict.
//
// Usage: node scripts/report-high-risk-files.mjs [--min-lines=N] [--json]

import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"

const REPO_ROOT = process.cwd()
const SCAN_ROOTS = ["src/lib", "src/app/api", "src/components"]
const DEFAULT_MIN_LINES = 400

function gitLsFiles(root) {
  return execFileSync("git", ["ls-files", root], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

function parseArgs(argv) {
  let minLines = DEFAULT_MIN_LINES
  let json = false
  for (const arg of argv) {
    if (arg.startsWith("--min-lines=")) minLines = Number(arg.split("=")[1])
    if (arg === "--json") json = true
  }
  return { minLines, json }
}

async function main() {
  const { minLines, json } = parseArgs(process.argv.slice(2))

  const candidates = []
  for (const root of SCAN_ROOTS) {
    for (const f of gitLsFiles(root)) {
      if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue
      if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue
      if (f.endsWith(".d.ts")) continue
      candidates.push(f)
    }
  }

  const testFiles = new Set(
    gitLsFiles("src").filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
  )
  const hasColocatedTest = (f) => {
    const base = f.replace(/\.(ts|tsx)$/, "")
    for (const t of testFiles) {
      if (t.startsWith(`${base}.test.`)) return true
    }
    return false
  }

  const results = []
  for (const f of candidates) {
    const source = await readFile(f, "utf8")
    const lineCount = source.split("\n").length
    results.push({ file: f, lines: lineCount, tested: hasColocatedTest(f) })
  }

  const highRisk = results
    .filter((r) => r.lines >= minLines && !r.tested)
    .sort((a, b) => b.lines - a.lines)

  if (json) {
    console.log(JSON.stringify({ minLines, count: highRisk.length, files: highRisk }, null, 2))
    return
  }

  console.log(`High-risk files (>= ${minLines} lines AND no colocated *.test.ts/*.test.tsx), scanned ${SCAN_ROOTS.join(", ")}:`)
  console.log(`${highRisk.length} of ${results.length} scanned files match.\n`)
  for (const r of highRisk) {
    console.log(`  ${String(r.lines).padStart(6)}  ${r.file}`)
  }
}

main().catch((err) => {
  console.error("report-high-risk-files: script error:", err)
  process.exit(1)
})
