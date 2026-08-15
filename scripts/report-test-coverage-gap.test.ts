/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  basenameNoExt,
  colocatedTestPath,
  countImportFanIn,
  formatCoverageGapReport,
  isSourcePath,
  isTestPath,
  partitionCoverage,
  rankBySizeDesc,
  rankUntestedByFanInDesc,
} from "./report-test-coverage-gap"

describe("isTestPath / isSourcePath", () => {
  test("recognizes .test.ts and .test.tsx as test files", () => {
    expect(isTestPath("src/lib/foo.test.ts")).toBe(true)
    expect(isTestPath("src/components/Bar.test.tsx")).toBe(true)
    expect(isTestPath("src/lib/foo.ts")).toBe(false)
  })

  test("source files exclude test files and .d.ts files", () => {
    expect(isSourcePath("src/lib/foo.ts")).toBe(true)
    expect(isSourcePath("src/components/Bar.tsx")).toBe(true)
    expect(isSourcePath("src/lib/foo.test.ts")).toBe(false)
    expect(isSourcePath("src/lib/types.d.ts")).toBe(false)
    expect(isSourcePath("src/lib/foo.json")).toBe(false)
  })
})

describe("colocatedTestPath", () => {
  test("maps .ts -> .test.ts and .tsx -> .test.tsx", () => {
    expect(colocatedTestPath("src/lib/foo.ts")).toBe("src/lib/foo.test.ts")
    expect(colocatedTestPath("src/components/Bar.tsx")).toBe("src/components/Bar.test.tsx")
  })
})

describe("partitionCoverage", () => {
  test("splits source files into tested/untested by colocated test existence", () => {
    const result = partitionCoverage(
      ["src/lib/a.ts", "src/lib/b.ts", "src/components/C.tsx"],
      ["src/lib/a.test.ts"]
    )
    expect(result.tested).toEqual(["src/lib/a.ts"])
    expect(result.untested).toEqual(["src/lib/b.ts", "src/components/C.tsx"])
  })

  test("empty source list yields empty partition", () => {
    expect(partitionCoverage([], ["src/lib/a.test.ts"])).toEqual({ tested: [], untested: [] })
  })
})

describe("rankBySizeDesc", () => {
  test("sorts descending by line count and respects topN", () => {
    const files = [
      { path: "small.ts", lines: 10 },
      { path: "large.ts", lines: 1000 },
      { path: "medium.ts", lines: 100 },
    ]
    expect(rankBySizeDesc(files, 2)).toEqual([
      { path: "large.ts", lines: 1000 },
      { path: "medium.ts", lines: 100 },
    ])
  })

  test("does not mutate the input array", () => {
    const files = [
      { path: "a.ts", lines: 1 },
      { path: "b.ts", lines: 2 },
    ]
    const original = [...files]
    rankBySizeDesc(files, 10)
    expect(files).toEqual(original)
  })
})

describe("basenameNoExt", () => {
  test("strips directory and .ts/.tsx extension", () => {
    expect(basenameNoExt("src/lib/services/foo-service.ts")).toBe("foo-service")
    expect(basenameNoExt("../components/Bar.tsx")).toBe("Bar")
    expect(basenameNoExt("./foo")).toBe("foo")
  })
})

describe("countImportFanIn", () => {
  test("counts relative import specifiers by basename, ignores package imports", () => {
    const contents = new Map([
      ["src/lib/a.ts", `import { x } from "./foo-service"\nimport React from "react"`],
      ["src/lib/b.ts", `import { y } from "../services/foo-service"`],
      ["src/lib/c.ts", `import { z } from "@/lib/other"`],
    ])
    const counts = countImportFanIn(contents)
    expect(counts.get("foo-service")).toBe(2)
    expect(counts.has("react")).toBe(false)
    expect(counts.has("other")).toBe(false)
  })
})

describe("rankUntestedByFanInDesc", () => {
  test("ranks untested files by fan-in, unreferenced files rank last with 0", () => {
    const fanIn = new Map([
      ["foo-service", 5],
      ["bar-service", 1],
    ])
    const result = rankUntestedByFanInDesc(
      ["src/lib/bar-service.ts", "src/lib/foo-service.ts", "src/lib/unused.ts"],
      fanIn,
      10
    )
    expect(result).toEqual([
      { path: "src/lib/foo-service.ts", importedBy: 5 },
      { path: "src/lib/bar-service.ts", importedBy: 1 },
      { path: "src/lib/unused.ts", importedBy: 0 },
    ])
  })

  test("respects topN", () => {
    const result = rankUntestedByFanInDesc(["a.ts", "b.ts", "c.ts"], new Map(), 2)
    expect(result).toHaveLength(2)
  })
})

describe("formatCoverageGapReport", () => {
  test("includes coverage percentage and both ranked sections", () => {
    const report = formatCoverageGapReport({
      generatedAt: "2026-08-15T00:00:00.000Z",
      totalSourceFiles: 10,
      totalTestFiles: 3,
      untestedCount: 7,
      largestFiles: [{ path: "src/lib/big.ts", lines: 500 }],
      highestTrafficUntested: [{ path: "src/lib/hot.ts", importedBy: 9 }],
    })
    expect(report).toContain("3/10 source files (30%)")
    expect(report).toContain("500 lines -- `src/lib/big.ts`")
    expect(report).toContain("imported by ~9 files -- `src/lib/hot.ts`")
  })

  test("handles zero source files without dividing by zero", () => {
    const report = formatCoverageGapReport({
      generatedAt: "2026-08-15T00:00:00.000Z",
      totalSourceFiles: 0,
      totalTestFiles: 0,
      untestedCount: 0,
      largestFiles: [],
      highestTrafficUntested: [],
    })
    expect(report).toContain("0/0 source files (0%)")
  })
})
