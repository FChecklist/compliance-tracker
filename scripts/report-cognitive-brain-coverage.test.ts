// Priority 6 (2026-07-12): unit tests for report-cognitive-brain-coverage.ts's
// pure/extractable logic -- same discipline as audit-asset-registry.test.ts
// (the live-DB queries are not exercised here; every case below drives a
// deterministic pure function with plain fixture data). No AI/LLM call is
// exercised or referenced anywhere in this file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  summarizePlatformAssetCounts,
  formatUmrSection,
  formatComputationEngineSection,
  formatSoftwareOrchestratorSection,
  formatCognitiveBrainReport,
  parseCognitiveBrainSnapshot,
  type AssetTypeStatusCount,
  type CognitiveBrainReportInput,
} from "./report-cognitive-brain-coverage"
import type { CoverageStats } from "./audit-asset-registry"
import type { CoverageStats as SoftwareCoverageStats } from "../src/lib/services/capability-learning-service"

describe("summarizePlatformAssetCounts", () => {
  test("sums counts per assetType across multiple statuses", () => {
    const rows: AssetTypeStatusCount[] = [
      { assetType: "ai_agent", status: "draft", count: 5 },
      { assetType: "ai_agent", status: "active", count: 22 },
      { assetType: "task", status: "active", count: 1899 },
    ]
    const summary = summarizePlatformAssetCounts(rows)
    expect(summary.totalAssets).toBe(1926)
    expect(summary.byType).toEqual({ ai_agent: 27, task: 1899 })
  })

  test("empty input yields zero totals", () => {
    const summary = summarizePlatformAssetCounts([])
    expect(summary.totalAssets).toBe(0)
    expect(summary.byType).toEqual({})
  })
})

describe("formatUmrSection", () => {
  const coverage: CoverageStats = { total: 391, registeredCount: 29, exemptedCount: 362, uncovered: [] }

  test("reports table coverage and asset totals when assets exist", () => {
    const section = formatUmrSection(coverage, { totalAssets: 2794, byType: { task: 1899, prompt: 215 } })
    expect(section).toContain("29 registered / 362 exempted / 0 uncovered")
    expect(section).toContain("2794 total rows")
    expect(section).toContain("task=1899")
  })

  test("reports empty registry honestly when there are zero assets", () => {
    const section = formatUmrSection(coverage, { totalAssets: 0, byType: {} })
    expect(section).toContain("registry is empty, nothing to report")
  })

  test("surfaces uncovered table count when coverage isn't clean", () => {
    const dirty: CoverageStats = { ...coverage, uncovered: ["mystery_table"] }
    const section = formatUmrSection(dirty, { totalAssets: 1, byType: { task: 1 } })
    expect(section).toContain("29 registered") // unaffected fields still correct
    expect(section).toContain("1 uncovered")
  })
})

describe("formatComputationEngineSection", () => {
  test("reports the real implemented/partial/not_started breakdown with percentages", () => {
    const section = formatComputationEngineSection({ implemented: 211, partial: 23, notStarted: 13 })
    expect(section).toContain("211/247 implemented (85%)")
    expect(section).toContain("23 partial (9%)")
    expect(section).toContain("13 not started (5%)")
  })

  test("reports honestly when zero engines are registered", () => {
    const section = formatComputationEngineSection({ implemented: 0, partial: 0, notStarted: 0 })
    expect(section).toContain("0 engines registered -- nothing to report")
  })
})

describe("formatSoftwareOrchestratorSection", () => {
  const zeroStats: SoftwareCoverageStats = { total: 0, fullSoftwarePercent: 0, packageAvailablePercent: 0, novelPercent: 0 }

  test("reports honest zero when task_capabilities has no rows at all", () => {
    const section = formatSoftwareOrchestratorSection(0, zeroStats)
    expect(section).toContain("0 rows -- no live classification history yet")
    expect(section).toContain("genuine 0, not a fabricated percentage")
  })

  test("reports honest zero-occurrences when rows exist but nothing has been classified yet", () => {
    const section = formatSoftwareOrchestratorSection(5, zeroStats)
    expect(section).toContain("5 capabilities tracked, but 0 classified occurrences recorded yet")
  })

  test("reports real X/Y/A/B percentages when live classification history exists", () => {
    const stats: SoftwareCoverageStats = { total: 40, fullSoftwarePercent: 50, packageAvailablePercent: 30, novelPercent: 20 }
    const section = formatSoftwareOrchestratorSection(12, stats)
    expect(section).toContain("12 capabilities tracked, 40 classified occurrences")
    expect(section).toContain("FULL_SOFTWARE 50%")
    expect(section).toContain("PACKAGE_AVAILABLE 30%")
    expect(section).toContain("NOVEL 20%")
  })
})

describe("formatCognitiveBrainReport", () => {
  const cleanCoverage: CoverageStats = { total: 391, registeredCount: 29, exemptedCount: 362, uncovered: [] }
  const baseInput: CognitiveBrainReportInput = {
    generatedAt: "2026-07-12T00:00:00Z",
    umrCoverage: cleanCoverage,
    umrAssets: { totalAssets: 2794, byType: { task: 1899 } },
    computationEngines: { implemented: 211, partial: 23, notStarted: 13 },
    softwareOrchestratorRowCount: 0,
    softwareOrchestratorStats: { total: 0, fullSoftwarePercent: 0, packageAvailablePercent: 0, novelPercent: 0 },
  }

  test("matches the real 2026-07-12 run: UMR wired, engines mostly built, orchestrator still at zero -- 'partially wired' verdict", () => {
    const report = formatCognitiveBrainReport(baseInput)
    expect(report).toContain("VERIDIAN Cognitive Brain Coverage Report")
    expect(report).toContain("29 registered / 362 exempted / 0 uncovered")
    expect(report).toContain("211/247 implemented")
    expect(report).toContain("no live classification history yet")
    expect(report).toContain('Partially wired, not fully "one brain" yet')
    expect(report).toContain("Software Orchestrator has zero live classification history")
    // the other two conditions are healthy, so they must NOT appear as gaps
    expect(report).not.toContain("UMR has uncovered tables")
    expect(report).not.toContain("fewer than half of computation engines")
  })

  test("declares fully wired only when all three signals are healthy", () => {
    const healthy: CognitiveBrainReportInput = {
      ...baseInput,
      softwareOrchestratorRowCount: 12,
      softwareOrchestratorStats: { total: 40, fullSoftwarePercent: 50, packageAvailablePercent: 30, novelPercent: 20 },
    }
    const report = formatCognitiveBrainReport(healthy)
    expect(report).toContain("functioning as one connected system with real data flowing through it")
  })

  test("flags UMR gap when there are uncovered tables even if assets exist", () => {
    const dirty: CognitiveBrainReportInput = { ...baseInput, umrCoverage: { ...cleanCoverage, uncovered: ["mystery_table"] } }
    const report = formatCognitiveBrainReport(dirty)
    expect(report).toContain("UMR has uncovered tables or zero registered assets")
  })

  test("flags UMR gap when coverage is clean but zero assets are registered", () => {
    const empty: CognitiveBrainReportInput = { ...baseInput, umrAssets: { totalAssets: 0, byType: {} } }
    const report = formatCognitiveBrainReport(empty)
    expect(report).toContain("UMR has uncovered tables or zero registered assets")
  })

  test("flags engine gap when fewer than half are implemented", () => {
    const mostlyUnbuilt: CognitiveBrainReportInput = { ...baseInput, computationEngines: { implemented: 10, partial: 10, notStarted: 80 } }
    const report = formatCognitiveBrainReport(mostlyUnbuilt)
    expect(report).toContain("fewer than half of computation engines are implemented")
  })
})

describe("parseCognitiveBrainSnapshot", () => {
  const validSnapshot = {
    generatedAt: "2026-07-12T00:00:00Z",
    umrAssets: [{ assetType: "task", status: "active", count: 1899 }],
    computationEngines: { implemented: 211, partial: 23, notStarted: 13 },
    softwareOrchestrator: { rowCount: 0, fullSoftwareCount: 0, packageAvailableCount: 0, novelCount: 0 },
  }

  test("parses a well-formed snapshot", () => {
    const snapshot = parseCognitiveBrainSnapshot(validSnapshot)
    expect(snapshot.umrAssets).toEqual(validSnapshot.umrAssets)
    expect(snapshot.computationEngines).toEqual(validSnapshot.computationEngines)
    expect(snapshot.softwareOrchestrator).toEqual(validSnapshot.softwareOrchestrator)
  })

  test("tolerates an extra provenance field like 'method'", () => {
    const snapshot = parseCognitiveBrainSnapshot({ ...validSnapshot, method: "gathered via Supabase MCP execute_sql" })
    expect(snapshot.umrAssets.length).toBe(1)
  })

  test("defaults generatedAt to 'unknown' when missing", () => {
    const { generatedAt, ...rest } = validSnapshot
    expect(parseCognitiveBrainSnapshot(rest).generatedAt).toBe("unknown")
  })

  test("throws when the top level isn't an object", () => {
    expect(() => parseCognitiveBrainSnapshot(null)).toThrow("Snapshot must be a JSON object")
    expect(() => parseCognitiveBrainSnapshot([1, 2])).toThrow("Snapshot must be a JSON object")
  })

  test("throws when umrAssets[] is missing", () => {
    const { umrAssets, ...rest } = validSnapshot
    expect(() => parseCognitiveBrainSnapshot(rest)).toThrow("Snapshot missing umrAssets[]")
  })

  test("throws naming the exact field when computationEngines is malformed", () => {
    expect(() => parseCognitiveBrainSnapshot({ ...validSnapshot, computationEngines: { implemented: -1, partial: 23, notStarted: 13 } })).toThrow(
      "computationEngines.implemented must be a non-negative number"
    )
  })

  test("throws naming the exact field when softwareOrchestrator is malformed", () => {
    expect(() => parseCognitiveBrainSnapshot({ ...validSnapshot, softwareOrchestrator: { rowCount: "zero", fullSoftwareCount: 0, packageAvailableCount: 0, novelCount: 0 } })).toThrow(
      "softwareOrchestrator.rowCount must be a non-negative number"
    )
  })

  test("throws naming the exact field when a umrAssets row is malformed", () => {
    expect(() => parseCognitiveBrainSnapshot({ ...validSnapshot, umrAssets: [{ assetType: "task", status: "active", count: -5 }] })).toThrow(
      "umrAssets[0].count must be a non-negative number"
    )
  })
})
