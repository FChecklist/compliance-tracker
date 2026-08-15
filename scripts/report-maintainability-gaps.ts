// VERIDIAN Review Framework gap-closure (task-20260718-070005-ai-
// maintainability--ai-safe-change-capab), three findings collapse into one
// tool because they're the same underlying signal viewed three ways:
//
//   (1) [Low] "AI Can Safely Understand Module" -- "Understanding quality
//       varies with file size." Recommended: prioritize splitting the
//       largest files.
//   (2) [Medium] "AI Can Generate Tests for Module" -- "No systematic
//       test-generation tooling." Recommended: a coverage-gap report to
//       prioritize which untested files to target next.
//   (3) [Medium] "AI Can Refactor Module" -- "Refactor safety net is
//       incomplete." Recommended: raise test coverage before large
//       refactors, starting with the highest-traffic untested files.
//
// (1) is a pure file-size signal; (2) and (3) are the same "which untested
// file matters most" question asked from two different reasons (writing
// tests vs. de-risking a refactor) -- both answered by the same size- and
// location-weighted priority score. One script, two report sections.
//
// This is a REPORT/prioritization tool, not a fix -- of 1793 non-test .ts/
// .tsx files in src/ as of this writing, only ~51 are exercised by any
// existing test at all (bun test --coverage confirms this: the other
// ~1742 never even appear in the coverage profile because nothing imports
// them under test). Writing tests for all of them is out of scope for a
// Low/Medium-severity tooling gap; producing an honest, regenerable,
// priority-ordered list of where to start is the actual ask.
//
// Coverage data source: bun's own built-in `bun test --coverage
// --coverage-reporter=lcov` (this repo's test runner is bun:test, not
// vitest -- the framework evaluation's "e.g. via vitest coverage" was an
// example, not a requirement; bun's native lcov output is the equivalent
// tool for this codebase's actual toolchain, same substitution precedent as
// check-terminology-guardrail.mjs porting a .py original to this repo's
// real .mjs/bun stack instead of vendoring the original tool unchanged).
//
// Usage:
//   bun run scripts/report-maintainability-gaps.ts
//     Runs the full bun:test suite with coverage (~15-20s), then prints the
//     report. Requires the same placeholder DATABASE_URL/
//     APP_RUNTIME_DATABASE_URL env vars CI's unit-tests job sets (importing
//     the db client at module load throws without *some* connection string
//     present, even though no query is ever issued) -- pass them via env or
//     rely on your shell's existing values.
//   bun run scripts/report-maintainability-gaps.ts --lcov=coverage/lcov.info
//     Skips re-running tests, reuses an already-generated lcov.info (e.g.
//     from a prior `bun test --coverage --coverage-reporter=lcov` run).
//   ... --out=ai-os/registry/coverage-gap-report.md
//     Also writes the report to a file (used to regenerate the committed
//     snapshot below).
//
// The pure functions below (line counting aside) are unit tested in
// report-maintainability-gaps.test.ts; the live bun-test-and-parse runner
// is not (same "pure functions tested, live runner isn't" split as
// report-cognitive-brain-coverage.ts).

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const REPO_ROOT = process.cwd()

// ─── Pure functions (unit tested) ──────────────────────────────────────────

export type FileLineCount = { path: string; lines: number }

// Sorted descending by line count, top N over the threshold -- the "split
// priority" list for finding (1). A file at or under the threshold isn't
// flagged; this repo's real distribution (see the committed snapshot) has a
// long tail, so a fixed threshold plus a top-N cap keeps the list actionable
// instead of listing hundreds of borderline files.
export function largestFiles(files: FileLineCount[], threshold = 500, top = 20): FileLineCount[] {
  return files
    .filter((f) => f.lines > threshold)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, top)
}

export type LcovSummary = { linesFound: number; linesHit: number }

// Parses bun's `--coverage-reporter=lcov` output. Only SF:/LF:/LH:/
// end_of_record are used -- function- and branch-coverage lines (FNF/FNH/
// BRF/BRH/DA) are present in bun's output but not needed for a per-file
// line-coverage percentage, so they're deliberately ignored rather than
// mis-parsed.
export function parseLcov(lcovText: string): Map<string, LcovSummary> {
  const result = new Map<string, LcovSummary>()
  let currentFile: string | null = null
  let linesFound = 0
  let linesHit = 0
  for (const rawLine of lcovText.split("\n")) {
    const line = rawLine.trim()
    if (line.startsWith("SF:")) {
      currentFile = line.slice("SF:".length)
      linesFound = 0
      linesHit = 0
    } else if (line.startsWith("LF:")) {
      linesFound = Number(line.slice("LF:".length)) || 0
    } else if (line.startsWith("LH:")) {
      linesHit = Number(line.slice("LH:".length)) || 0
    } else if (line === "end_of_record") {
      if (currentFile) result.set(currentFile, { linesFound, linesHit })
      currentFile = null
    }
  }
  return result
}

// Traffic weight: a rough, honestly-documented proxy for "how much this
// untested file matters", not a real usage-telemetry number (no such
// telemetry exists per-file in this codebase today -- same "don't fabricate
// a number with no real computation behind it" discipline
// maintainability-scorecard.md already applies at the org level). Services
// and API routes are directly reachable, security- and data-integrity-
// relevant code paths reused across many callers; lib utilities are next;
// UI components/pages are weighted lowest (highest existing behavioral
// coverage substitute: TypeScript + visible rendering failures).
export function trafficWeight(filePath: string): number {
  if (filePath.startsWith("src/lib/services/")) return 3
  if (filePath.startsWith("src/app/api/") && filePath.endsWith("route.ts")) return 3
  if (filePath.startsWith("src/lib/")) return 2
  return 1
}

export type CoverageGapEntry = {
  path: string
  lines: number
  coveredPercent: number
  priorityScore: number
}

// The core "which untested file matters most" ranking for findings (2)/(3).
// A file with ZERO coverage-profile presence (never imported by any test)
// gets coveredPercent 0, not "unknown" -- bun's own coverage tool has no
// data for it precisely because no test exercises it, which is the honest
// signal this report exists to surface, not treated as a data gap to hide.
export function computeCoverageGaps(
  allFiles: FileLineCount[],
  covered: Map<string, LcovSummary>,
  opts: { minCoveredPercent?: number; top?: number } = {}
): CoverageGapEntry[] {
  const minCoveredPercent = opts.minCoveredPercent ?? 20
  const top = opts.top ?? 30
  const entries: CoverageGapEntry[] = allFiles.map((f) => {
    const cov = covered.get(f.path)
    const coveredPercent = cov && cov.linesFound > 0 ? Math.round((cov.linesHit / cov.linesFound) * 100) : 0
    return {
      path: f.path,
      lines: f.lines,
      coveredPercent,
      priorityScore: f.lines * trafficWeight(f.path),
    }
  })
  return entries
    .filter((e) => e.coveredPercent < minCoveredPercent)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, top)
}

export type MaintainabilityReportInput = {
  generatedAt: string
  totalFiles: number
  coveredFiles: number
  largest: FileLineCount[]
  gaps: CoverageGapEntry[]
}

export function formatMaintainabilityReport(input: MaintainabilityReportInput): string {
  const lines: string[] = []
  lines.push("# AI Maintainability -- Coverage Gap & File-Size Report")
  lines.push("")
  lines.push(`Generated: ${input.generatedAt}`)
  lines.push("")
  lines.push(
    "Regenerate with `bun run report:coverage-gaps` (or " +
      "`bun run scripts/report-maintainability-gaps.ts`). This is a " +
      "point-in-time snapshot, not a live number -- both the file-size " +
      "distribution and test coverage change on every merge; re-run before " +
      "relying on it for a real prioritization decision."
  )
  lines.push("")
  lines.push(
    `Source data: ${input.totalFiles} non-test .ts/.tsx files under src/, ` +
      `${input.coveredFiles} of which appear in the bun:test coverage ` +
      `profile at all (i.e. are imported/exercised by at least one existing test).`
  )
  lines.push("")

  lines.push("## Split-priority: largest files (VERIDIAN Review Framework finding: \"AI Can Safely Understand Module\")")
  lines.push("")
  lines.push(
    "Files over 500 lines, largest first. Understanding quality varies with " +
      "file size (framework finding, Low severity) -- these are the files " +
      "where an AI agent's context window and comprehension are most " +
      "strained, and the first candidates for splitting into smaller, " +
      "single-responsibility modules."
  )
  lines.push("")
  if (input.largest.length === 0) {
    lines.push("_No files over the 500-line threshold._")
  } else {
    lines.push("| Lines | File |")
    lines.push("|---|---|")
    for (const f of input.largest) lines.push(`| ${f.lines} | \`${f.path}\` |`)
  }
  lines.push("")

  lines.push("## Test-coverage-gap priority list (VERIDIAN Review Framework findings: \"AI Can Generate Tests for Module\", \"AI Can Refactor Module\")")
  lines.push("")
  lines.push(
    "Files under 20% line coverage, ranked by `lines x traffic weight` " +
      "(services and API routes weighted highest -- see `trafficWeight()` " +
      "in this report's own script for the exact, documented weighting). " +
      "This is the priority order for both writing new tests (no systematic " +
      "test-generation tooling today) and for building a refactor safety net " +
      "before touching high-traffic code (same recommendation, two framework " +
      "rows)."
  )
  lines.push("")
  if (input.gaps.length === 0) {
    lines.push("_No files below the coverage threshold -- nothing to prioritize._")
  } else {
    lines.push("| Priority score | Lines | Coverage | File |")
    lines.push("|---|---|---|---|")
    for (const g of input.gaps) lines.push(`| ${g.priorityScore} | ${g.lines} | ${g.coveredPercent}% | \`${g.path}\` |`)
  }
  lines.push("")

  return lines.join("\n")
}

// ─── Live runner (not exercised by the unit tests) ─────────────────────────

function listSourceFiles(): string[] {
  const out = execSync(
    `git -C ${JSON.stringify(REPO_ROOT)} ls-files 'src/**/*.ts' 'src/**/*.tsx'`,
    { encoding: "utf8" }
  ).trim()
  return out
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.endsWith(".test.ts") && !p.endsWith(".test.tsx") && !p.endsWith(".d.ts"))
}

function countLines(files: string[]): FileLineCount[] {
  return files.map((p) => {
    const content = readFileSync(path.join(REPO_ROOT, p), "utf8")
    const lines = content.length === 0 ? 0 : content.split("\n").length
    return { path: p, lines }
  })
}

function runTestsAndGetLcov(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "veridian-coverage-"))
  try {
    execSync(
      `bun test --coverage --coverage-reporter=lcov --coverage-dir=${JSON.stringify(dir)}`,
      {
        cwd: REPO_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:placeholder@localhost:5432/postgres",
          APP_RUNTIME_DATABASE_URL:
            process.env.APP_RUNTIME_DATABASE_URL ?? "postgresql://app_runtime:placeholder@localhost:5432/postgres",
        },
      }
    )
    return readFileSync(path.join(dir, "lcov.info"), "utf8")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const lcovFlag = process.argv.find((a) => a.startsWith("--lcov="))
  const outFlag = process.argv.find((a) => a.startsWith("--out="))

  console.log("Scanning src/ for non-test .ts/.tsx files...")
  const files = listSourceFiles()
  const withLines = countLines(files)

  console.log(
    lcovFlag
      ? `Reusing existing lcov report: ${lcovFlag.slice("--lcov=".length)}`
      : "Running `bun test --coverage` (this runs the full suite, ~15-20s)..."
  )
  const lcovText = lcovFlag ? readFileSync(path.resolve(REPO_ROOT, lcovFlag.slice("--lcov=".length)), "utf8") : runTestsAndGetLcov()
  const covered = parseLcov(lcovText)

  const report = formatMaintainabilityReport({
    generatedAt: new Date().toISOString(),
    totalFiles: withLines.length,
    coveredFiles: [...covered.keys()].filter((k) => withLines.some((f) => f.path === k)).length,
    largest: largestFiles(withLines),
    gaps: computeCoverageGaps(withLines, covered),
  })

  console.log(report)

  if (outFlag) {
    const outPath = outFlag.slice("--out=".length)
    writeFileSync(path.resolve(REPO_ROOT, outPath), report)
    console.log(`\nWrote report to ${outPath}`)
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Maintainability gap report crashed:", err)
    process.exit(1)
  })
}
