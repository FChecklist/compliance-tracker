// Unit tests for report-test-coverage-gap.mjs's pure logic -- same
// discipline as report-cognitive-brain-coverage.test.ts (no fs access is
// exercised here; every case drives buildStats()/renderReport() with plain
// fixture data). No AI/LLM call is exercised or referenced anywhere in
// this file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildStats, renderReport, SERVICES_LABEL } from "./report-test-coverage-gap.mjs"

describe("buildStats", () => {
  test("classifies files with a sibling *.test.ts as tested", () => {
    const files = ["alpha.ts", "alpha.test.ts", "beta.ts"]
    const stats = buildStats(files, { "alpha.ts": 100, "beta.ts": 50 })
    expect(stats.total).toBe(2)
    expect(stats.testedCount).toBe(1)
    expect(stats.untested).toEqual([{ file: `${SERVICES_LABEL}/beta.ts`, lines: 50, hasTest: false }])
  })

  test("sorts untested files by line count descending", () => {
    const files = ["small.ts", "big.ts", "medium.ts"]
    const stats = buildStats(files, { "small.ts": 10, "big.ts": 900, "medium.ts": 300 })
    expect(stats.untested.map((r) => r.file)).toEqual([
      `${SERVICES_LABEL}/big.ts`,
      `${SERVICES_LABEL}/medium.ts`,
      `${SERVICES_LABEL}/small.ts`,
    ])
  })

  test("breaks line-count ties by filename ascending, regardless of input order", () => {
    // Regression test for a real bug (found 2026-08-30, PR #1472's CI): with
    // no tiebreaker, two files sharing a line count sorted in whatever order
    // readdirSync() (OS/filesystem-dependent) happened to hand them in, so a
    // report generated on Windows could commit a different tie order than
    // the same content regenerated on CI's Linux runner would produce --
    // making --check spuriously report a byte-identical doc as "stale".
    const filesInOneOrder = ["zeta.ts", "alpha.ts", "beta.ts"]
    const filesInReverseOrder = ["beta.ts", "alpha.ts", "zeta.ts"]
    const lineCounts = { "zeta.ts": 100, "alpha.ts": 100, "beta.ts": 100 }
    const statsA = buildStats(filesInOneOrder, lineCounts)
    const statsB = buildStats(filesInReverseOrder, lineCounts)
    const expected = [
      `${SERVICES_LABEL}/alpha.ts`,
      `${SERVICES_LABEL}/beta.ts`,
      `${SERVICES_LABEL}/zeta.ts`,
    ]
    expect(statsA.untested.map((r) => r.file)).toEqual(expected)
    expect(statsB.untested.map((r) => r.file)).toEqual(expected)
  })

  test("empty directory yields zero totals", () => {
    const stats = buildStats([], {})
    expect(stats).toEqual({ total: 0, testedCount: 0, untested: [] })
  })

  test("a file with no line-count entry defaults to 0 lines rather than throwing", () => {
    const stats = buildStats(["orphan.ts"], {})
    expect(stats.untested).toEqual([{ file: `${SERVICES_LABEL}/orphan.ts`, lines: 0, hasTest: false }])
  })

  test("ignores non-.ts files and does not misclassify a .test.ts as untested", () => {
    const files = ["alpha.ts", "alpha.test.ts", "README.md"]
    const stats = buildStats(files, { "alpha.ts": 20 })
    expect(stats.total).toBe(1)
    expect(stats.untested).toEqual([])
  })
})

describe("renderReport", () => {
  test("reports summary percentage and top-N untested files", () => {
    const stats = {
      total: 4,
      testedCount: 1,
      untested: [
        { file: "src/lib/services/big.ts", lines: 900, hasTest: false },
        { file: "src/lib/services/medium.ts", lines: 300, hasTest: false },
        { file: "src/lib/services/small.ts", lines: 10, hasTest: false },
      ],
    }
    const report = renderReport(stats, 2)
    expect(report).toContain("**Summary:** 1/4 service files have a sibling test file (25.0%).")
    expect(report).toContain("## Top 2 untested files by size (highest priority first)")
    expect(report).toContain("| 1 | `src/lib/services/big.ts` | 900 |")
    expect(report).toContain("| 2 | `src/lib/services/medium.ts` | 300 |")
    expect(report).not.toContain("small.ts")
    expect(report).toContain("_Total untested files (all sizes): 3. Showing top 2._")
  })

  test("handles zero total files without dividing by zero", () => {
    const report = renderReport({ total: 0, testedCount: 0, untested: [] }, 20)
    expect(report).toContain("**Summary:** 0/0 service files have a sibling test file (0.0%).")
  })

  test("100% coverage renders correctly with an empty untested table", () => {
    const report = renderReport({ total: 5, testedCount: 5, untested: [] }, 20)
    expect(report).toContain("**Summary:** 5/5 service files have a sibling test file (100.0%).")
    expect(report).toContain("_Total untested files (all sizes): 0. Showing top 0._")
  })
})
