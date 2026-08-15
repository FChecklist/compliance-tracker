// VERIDIAN Review Framework gap-closure, retry 2 (2026-08-15): "AI Can
// Generate Tests for Module" (Medium -- "No systematic test-generation
// tooling") and "AI Can Refactor Module" (Medium -- "Refactor safety net is
// incomplete") both point at the same missing piece: nothing in this repo
// tells a human or an AI agent WHICH untested files matter most. This
// script is that report -- read-only, zero AI/LLM calls, deterministic from
// git-tracked files alone (same "no fabricated numbers" discipline as
// scripts/report-cognitive-brain-coverage.ts).
//
// Two ranked lists, matching two distinct findings from the same review:
//   1. Largest files ("AI Can Safely Understand Module", Low -- "Understanding
//      quality varies with file size"). Splitting these first is the
//      recommended mitigation; this list is the prioritization input for
//      that follow-up work, not the split itself.
//   2. Highest-traffic UNTESTED files (the shared "raise coverage starting
//      with the highest-traffic untested files" recommendation on both the
//      "AI Can Generate Tests" and "AI Can Refactor" findings). "Traffic" is
//      approximated by relative-import fan-in (how many other files import
//      this one) -- a real proxy, not runtime telemetry this repo doesn't
//      collect. Honest limitation, stated once here rather than reasserted
//      per finding: two files that share a basename in different
//      directories (e.g. two unrelated route.ts files) have their fan-in
//      counts conflated, since the count is keyed by basename, not a
//      resolved absolute path. Good enough to rank "matters more vs less",
//      not precise enough to cite as an exact call-graph edge count.
//
// Coverage convention this repo already follows (confirmed by reading
// src/lib/*.test.ts, src/app/api/**/route.test.ts, scripts/*.test.ts before
// writing this): a source file "has a test" iff a colocated
// `<basename>.test.ts`/`.test.tsx` file exists next to it. That is the same
// convention scripts/check-test-coverage-delta.mjs (the CI gate half of
// this same gap-closure PR) enforces going forward.
//
// Usage: bun run scripts/report-test-coverage-gap.ts [--top=20] [--write=<path>]

import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"

const REPO_ROOT = process.cwd()
const SCAN_ROOTS = ["src", "scripts"]
const DEFAULT_TOP_N = 20

// ─── Pure functions (unit tested in report-test-coverage-gap.test.ts) ──────

export function isTestPath(p: string): boolean {
  return /\.test\.tsx?$/.test(p)
}

export function isSourcePath(p: string): boolean {
  return /\.tsx?$/.test(p) && !isTestPath(p) && !p.endsWith(".d.ts")
}

export function colocatedTestPath(srcPath: string): string {
  if (srcPath.endsWith(".tsx")) return `${srcPath.slice(0, -".tsx".length)}.test.tsx`
  if (srcPath.endsWith(".ts")) return `${srcPath.slice(0, -".ts".length)}.test.ts`
  return `${srcPath}.test.ts`
}

export type CoveragePartition = { tested: string[]; untested: string[] }

export function partitionCoverage(sourceFiles: string[], testFiles: string[]): CoveragePartition {
  const testSet = new Set(testFiles)
  const tested: string[] = []
  const untested: string[] = []
  for (const f of sourceFiles) {
    if (testSet.has(colocatedTestPath(f))) tested.push(f)
    else untested.push(f)
  }
  return { tested, untested }
}

export type RankedBySize = { path: string; lines: number }

export function rankBySizeDesc(files: RankedBySize[], topN: number): RankedBySize[] {
  return [...files].sort((a, b) => b.lines - a.lines).slice(0, topN)
}

export function basenameNoExt(p: string): string {
  const base = p.split("/").pop() ?? p
  return base.replace(/\.tsx?$/, "")
}

// Only relative specifiers ("./foo", "../foo/bar") count -- a bare
// specifier ("react", "@/lib/db") is either a package or resolved via a
// path alias this pure function deliberately doesn't try to resolve.
const RELATIVE_IMPORT_RE = /from\s+["'](\.[^"']+)["']/g

export function countImportFanIn(fileContentsByPath: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const content of fileContentsByPath.values()) {
    for (const match of content.matchAll(RELATIVE_IMPORT_RE)) {
      const specifier = match[1]
      const base = basenameNoExt(specifier)
      if (!base) continue
      counts.set(base, (counts.get(base) ?? 0) + 1)
    }
  }
  return counts
}

export type RankedByFanIn = { path: string; importedBy: number }

export function rankUntestedByFanInDesc(untested: string[], fanIn: Map<string, number>, topN: number): RankedByFanIn[] {
  return untested
    .map((path) => ({ path, importedBy: fanIn.get(basenameNoExt(path)) ?? 0 }))
    .sort((a, b) => b.importedBy - a.importedBy)
    .slice(0, topN)
}

export type CoverageGapReportInput = {
  generatedAt: string
  totalSourceFiles: number
  totalTestFiles: number
  untestedCount: number
  largestFiles: RankedBySize[]
  highestTrafficUntested: RankedByFanIn[]
}

export function formatCoverageGapReport(input: CoverageGapReportInput): string {
  const lines: string[] = []
  lines.push("# VERIDIAN Test Coverage Gap Report")
  lines.push("")
  lines.push(`Generated: ${input.generatedAt}`)
  lines.push("")
  const testedCount = input.totalSourceFiles - input.untestedCount
  const pct = input.totalSourceFiles === 0 ? 0 : Math.round((testedCount / input.totalSourceFiles) * 100)
  lines.push(
    `Colocated-test coverage: ${testedCount}/${input.totalSourceFiles} source files (${pct}%) have a colocated ` +
      `\`*.test.ts\`/\`*.test.tsx\` file; ${input.totalTestFiles} test files exist total.`
  )
  lines.push("")
  lines.push("## Largest files (split-priority order)")
  lines.push("")
  lines.push(
    "AI Maintainability finding \"AI Can Safely Understand Module\": understanding quality varies with file " +
      "size. These are the files to split first."
  )
  lines.push("")
  for (const f of input.largestFiles) lines.push(`- ${f.lines} lines -- \`${f.path}\``)
  lines.push("")
  lines.push("## Highest-traffic untested files (test-generation priority order)")
  lines.push("")
  lines.push(
    "AI Maintainability findings \"AI Can Generate Tests for Module\" / \"AI Can Refactor Module\": no untested " +
      "file is a good place to start, but these are imported by the most other files in this codebase, so " +
      "covering them first buys the most safety net per test written. \"Imported by\" is a relative-import " +
      "fan-in heuristic keyed by basename, not an exact call-graph count -- see this script's header comment."
  )
  lines.push("")
  for (const f of input.highestTrafficUntested) lines.push(`- imported by ~${f.importedBy} files -- \`${f.path}\``)
  lines.push("")
  return lines.join("\n")
}

// ─── CLI runner (not exercised by the unit tests) ──────────────────────────

function gitLsFiles(root: string): string[] {
  const out = execSync(`git ls-files -- ${root}`, { cwd: REPO_ROOT, encoding: "utf8" })
  return out.split("\n").filter(Boolean)
}

async function main() {
  const topArg = process.argv.find((a) => a.startsWith("--top="))
  const topN = topArg ? Number.parseInt(topArg.slice("--top=".length), 10) : DEFAULT_TOP_N
  const writeArg = process.argv.find((a) => a.startsWith("--write="))

  const allTracked = SCAN_ROOTS.flatMap(gitLsFiles)
  const sourceFiles = allTracked.filter(isSourcePath)
  const testFiles = allTracked.filter(isTestPath)

  const { untested } = partitionCoverage(sourceFiles, testFiles)

  const sized: RankedBySize[] = sourceFiles.map((p) => ({
    path: p,
    lines: readFileSync(`${REPO_ROOT}/${p}`, "utf8").split("\n").length,
  }))

  const contentsByPath = new Map<string, string>()
  for (const p of allTracked) {
    if (p.endsWith(".ts") || p.endsWith(".tsx")) contentsByPath.set(p, readFileSync(`${REPO_ROOT}/${p}`, "utf8"))
  }
  const fanIn = countImportFanIn(contentsByPath)

  const report = formatCoverageGapReport({
    generatedAt: new Date().toISOString(),
    totalSourceFiles: sourceFiles.length,
    totalTestFiles: testFiles.length,
    untestedCount: untested.length,
    largestFiles: rankBySizeDesc(sized, topN),
    highestTrafficUntested: rankUntestedByFanInDesc(untested, fanIn, topN),
  })

  console.log(report)
  if (writeArg) {
    const outPath = writeArg.slice("--write=".length)
    writeFileSync(`${REPO_ROOT}/${outPath}`, report)
    console.log(`\nWritten to ${outPath}`)
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Test coverage gap report crashed:", err)
    process.exit(1)
  })
}
