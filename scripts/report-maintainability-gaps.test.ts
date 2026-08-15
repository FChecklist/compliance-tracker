import { describe, expect, test } from "bun:test"
import {
  largestFiles,
  parseLcov,
  trafficWeight,
  computeCoverageGaps,
  formatMaintainabilityReport,
  type FileLineCount,
} from "./report-maintainability-gaps"

describe("largestFiles", () => {
  test("filters to files over the threshold and sorts descending", () => {
    const files: FileLineCount[] = [
      { path: "a.ts", lines: 100 },
      { path: "b.ts", lines: 900 },
      { path: "c.ts", lines: 501 },
      { path: "d.ts", lines: 500 },
    ]
    expect(largestFiles(files, 500, 20)).toEqual([
      { path: "b.ts", lines: 900 },
      { path: "c.ts", lines: 501 },
    ])
  })

  test("caps at `top`", () => {
    const files: FileLineCount[] = Array.from({ length: 10 }, (_, i) => ({
      path: `f${i}.ts`,
      lines: 1000 + i,
    }))
    expect(largestFiles(files, 0, 3)).toHaveLength(3)
    expect(largestFiles(files, 0, 3)[0].path).toBe("f9.ts")
  })

  test("empty input returns empty list", () => {
    expect(largestFiles([])).toEqual([])
  })
})

describe("parseLcov", () => {
  test("parses SF/LF/LH per-file blocks", () => {
    const lcov = [
      "TN:",
      "SF:src/a.ts",
      "DA:1,3",
      "LF:10",
      "LH:5",
      "end_of_record",
      "SF:src/b.ts",
      "LF:20",
      "LH:20",
      "end_of_record",
    ].join("\n")
    const result = parseLcov(lcov)
    expect(result.get("src/a.ts")).toEqual({ linesFound: 10, linesHit: 5 })
    expect(result.get("src/b.ts")).toEqual({ linesFound: 20, linesHit: 20 })
    expect(result.size).toBe(2)
  })

  test("empty input returns empty map", () => {
    expect(parseLcov("").size).toBe(0)
  })

  test("a record without end_of_record is dropped, not half-recorded", () => {
    const lcov = ["SF:src/a.ts", "LF:10", "LH:5"].join("\n")
    expect(parseLcov(lcov).size).toBe(0)
  })
})

describe("trafficWeight", () => {
  test("services weighted highest", () => {
    expect(trafficWeight("src/lib/services/foo-service.ts")).toBe(3)
  })

  test("API route.ts weighted highest", () => {
    expect(trafficWeight("src/app/api/foo/route.ts")).toBe(3)
  })

  test("a non-route file under app/api is not weighted as a route", () => {
    expect(trafficWeight("src/app/api/foo/helpers.ts")).toBe(1)
  })

  test("other lib files weighted medium", () => {
    expect(trafficWeight("src/lib/llm-client.ts")).toBe(2)
  })

  test("components/pages weighted lowest", () => {
    expect(trafficWeight("src/components/AppSidebar.tsx")).toBe(1)
    expect(trafficWeight("src/app/(app)/dashboard/page.tsx")).toBe(1)
  })
})

describe("computeCoverageGaps", () => {
  test("excludes well-covered files, ranks the rest by lines x traffic weight", () => {
    const files: FileLineCount[] = [
      { path: "src/lib/services/big-untested-service.ts", lines: 1000 },
      { path: "src/components/small-untested.tsx", lines: 100 },
      { path: "src/lib/services/well-tested-service.ts", lines: 1000 },
    ]
    const covered = new Map([
      ["src/lib/services/well-tested-service.ts", { linesFound: 1000, linesHit: 950 }],
    ])
    const gaps = computeCoverageGaps(files, covered, { minCoveredPercent: 20, top: 10 })
    expect(gaps.map((g) => g.path)).toEqual([
      "src/lib/services/big-untested-service.ts",
      "src/components/small-untested.tsx",
    ])
    expect(gaps[0].priorityScore).toBe(1000 * 3)
    expect(gaps[0].coveredPercent).toBe(0)
  })

  test("a file with zero linesFound is treated as 0% covered, not divide-by-zero NaN", () => {
    const files: FileLineCount[] = [{ path: "src/lib/empty.ts", lines: 0 }]
    const covered = new Map([["src/lib/empty.ts", { linesFound: 0, linesHit: 0 }]])
    const gaps = computeCoverageGaps(files, covered, { minCoveredPercent: 100 })
    expect(gaps[0].coveredPercent).toBe(0)
  })

  test("respects top cap", () => {
    const files: FileLineCount[] = Array.from({ length: 50 }, (_, i) => ({
      path: `src/lib/services/f${i}.ts`,
      lines: 100 + i,
    }))
    expect(computeCoverageGaps(files, new Map(), { top: 5 })).toHaveLength(5)
  })
})

describe("formatMaintainabilityReport", () => {
  test("renders both sections with data", () => {
    const report = formatMaintainabilityReport({
      generatedAt: "2026-08-15T00:00:00.000Z",
      totalFiles: 100,
      coveredFiles: 10,
      largest: [{ path: "src/big.ts", lines: 900 }],
      gaps: [{ path: "src/lib/services/x.ts", lines: 500, coveredPercent: 0, priorityScore: 1500 }],
    })
    expect(report).toContain("src/big.ts")
    expect(report).toContain("src/lib/services/x.ts")
    expect(report).toContain("100 non-test .ts/.tsx files")
    expect(report).toContain("2026-08-15T00:00:00.000Z")
  })

  test("renders honest empty-state text, not an empty table", () => {
    const report = formatMaintainabilityReport({
      generatedAt: "2026-08-15T00:00:00.000Z",
      totalFiles: 0,
      coveredFiles: 0,
      largest: [],
      gaps: [],
    })
    expect(report).toContain("No files over the 500-line threshold")
    expect(report).toContain("nothing to prioritize")
  })
})
