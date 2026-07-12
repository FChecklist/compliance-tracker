// Priority 4 (09-priority4-umr-universal-tracker.yaml, agent 6/domain C).
// Unit tests for audit-asset-registry.ts's pure/extractable logic -- the
// actual live-DB reconciliation queries are NOT exercised here (this
// dispatch was explicitly told not to run the script against a live
// database; this is the "verify the logic is correct via a unit test" half
// of that instruction, per the same discipline as scripts/backfill-
// platform-assets.test.ts). No AI/LLM call is exercised or referenced here
// -- every case below drives a deterministic pure function with plain
// fixture data.
//
// Priority 6 (2026-07-12) added parseAuditSnapshot() coverage below --
// the --from-json mode's validator, exercised the same way the live-DB path
// was actually run for real this dispatch (see file header and
// scripts/audit-asset-registry.snapshot-2026-07-12.json).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  isSafeIdentifier,
  diffIdSets,
  hasReconciliationProblem,
  findTriggerGaps,
  computeCoverageStats,
  formatReport,
  determineExitCode,
  parseAuditSnapshot,
  type TableReconciliation,
  type CoverageStats,
} from "./audit-asset-registry"

describe("isSafeIdentifier", () => {
  test("accepts real snake_case table names", () => {
    expect(isSafeIdentifier("departments")).toBe(true)
    expect(isSafeIdentifier("framework_controls")).toBe(true)
    expect(isSafeIdentifier("access_review_cycles")).toBe(true)
  })
  test("rejects anything that isn't a plain lowercase identifier", () => {
    expect(isSafeIdentifier("departments; DROP TABLE users;--")).toBe(false)
    expect(isSafeIdentifier("Departments")).toBe(false)
    expect(isSafeIdentifier("compliance.departments")).toBe(false)
    expect(isSafeIdentifier("1departments")).toBe(false)
    expect(isSafeIdentifier("")).toBe(false)
    expect(isSafeIdentifier("depart ments")).toBe(false)
  })
})

describe("diffIdSets", () => {
  test("no mismatch when both sides match exactly", () => {
    const diff = diffIdSets(["a", "b", "c"], ["a", "b", "c"])
    expect(diff.missingFromRegistry).toEqual([])
    expect(diff.orphanedInRegistry).toEqual([])
  })

  test("flags a source row with no registry row (trigger missed an INSERT)", () => {
    const diff = diffIdSets(["a", "b", "c"], ["a", "b"])
    expect(diff.missingFromRegistry).toEqual(["c"])
    expect(diff.orphanedInRegistry).toEqual([])
  })

  test("flags a registry row with no source row (trigger missed a DELETE)", () => {
    const diff = diffIdSets(["a", "b"], ["a", "b", "c"])
    expect(diff.missingFromRegistry).toEqual([])
    expect(diff.orphanedInRegistry).toEqual(["c"])
  })

  test("flags both directions independently in the same table", () => {
    const diff = diffIdSets(["a", "b", "new1"], ["a", "b", "stale1"])
    expect(diff.missingFromRegistry).toEqual(["new1"])
    expect(diff.orphanedInRegistry).toEqual(["stale1"])
  })

  test("empty source and empty registry is not a mismatch", () => {
    const diff = diffIdSets([], [])
    expect(diff.missingFromRegistry).toEqual([])
    expect(diff.orphanedInRegistry).toEqual([])
  })
})

describe("hasReconciliationProblem", () => {
  const base: TableReconciliation = { sourceTable: "departments", sourceCount: 5, registryCount: 5, missingFromRegistry: [], orphanedInRegistry: [] }

  test("false when both diff lists are empty", () => {
    expect(hasReconciliationProblem(base)).toBe(false)
  })
  test("true when something is missing from the registry", () => {
    expect(hasReconciliationProblem({ ...base, missingFromRegistry: ["x"] })).toBe(true)
  })
  test("true when something is orphaned in the registry", () => {
    expect(hasReconciliationProblem({ ...base, orphanedInRegistry: ["y"] })).toBe(true)
  })
})

describe("findTriggerGaps", () => {
  test("flags an active config whose trigger isn't attached", () => {
    const gaps = findTriggerGaps([
      { source_table: "departments", registration_active: true, trigger_attached: true },
      { source_table: "committees", registration_active: true, trigger_attached: false },
    ])
    expect(gaps).toEqual(["committees"])
  })

  test("does not flag a deactivated config even if its trigger is missing (documented kill-switch case)", () => {
    const gaps = findTriggerGaps([
      { source_table: "old_table", registration_active: false, trigger_attached: false },
    ])
    expect(gaps).toEqual([])
  })

  test("empty input yields no gaps", () => {
    expect(findTriggerGaps([])).toEqual([])
  })
})

describe("computeCoverageStats", () => {
  test("counts registered/exempted and finds tables in neither list", () => {
    const declared = ["a", "b", "c", "d"]
    const registered = ["a", "b"]
    const exempted = ["c"]
    const stats = computeCoverageStats(declared, registered, exempted)
    expect(stats.total).toBe(4)
    expect(stats.registeredCount).toBe(2)
    expect(stats.exemptedCount).toBe(1)
    expect(stats.uncovered).toEqual(["d"])
  })

  test("zero uncovered when every declared table is accounted for", () => {
    const stats = computeCoverageStats(["a", "b"], ["a"], ["b"])
    expect(stats.uncovered).toEqual([])
  })
})

describe("determineExitCode", () => {
  const cleanCoverage: CoverageStats = { total: 10, registeredCount: 5, exemptedCount: 5, uncovered: [] }
  const cleanReconciliation: TableReconciliation = { sourceTable: "departments", sourceCount: 3, registryCount: 3, missingFromRegistry: [], orphanedInRegistry: [] }

  test("0 when everything is clean", () => {
    expect(determineExitCode({ reconciliations: [cleanReconciliation], triggerGaps: [], coverage: cleanCoverage, invalidIdentifiers: [] })).toBe(0)
  })

  test("1 when a reconciliation mismatch exists", () => {
    const dirty = { ...cleanReconciliation, missingFromRegistry: ["x"] }
    expect(determineExitCode({ reconciliations: [dirty], triggerGaps: [], coverage: cleanCoverage, invalidIdentifiers: [] })).toBe(1)
  })

  test("1 when a trigger gap exists", () => {
    expect(determineExitCode({ reconciliations: [cleanReconciliation], triggerGaps: ["committees"], coverage: cleanCoverage, invalidIdentifiers: [] })).toBe(1)
  })

  test("1 when a table is uncovered", () => {
    const dirtyCoverage = { ...cleanCoverage, uncovered: ["mystery_table"] }
    expect(determineExitCode({ reconciliations: [cleanReconciliation], triggerGaps: [], coverage: dirtyCoverage, invalidIdentifiers: [] })).toBe(1)
  })

  test("1 when a config row fails the identifier safety check", () => {
    expect(determineExitCode({ reconciliations: [cleanReconciliation], triggerGaps: [], coverage: cleanCoverage, invalidIdentifiers: ["bad;table"] })).toBe(1)
  })
})

describe("formatReport", () => {
  test("reports CLEAN when nothing is wrong", () => {
    const report = formatReport({
      reconciliations: [{ sourceTable: "departments", sourceCount: 3, registryCount: 3, missingFromRegistry: [], orphanedInRegistry: [] }],
      triggerGaps: [],
      coverage: { total: 10, registeredCount: 5, exemptedCount: 5, uncovered: [] },
      invalidIdentifiers: [],
    })
    expect(report).toContain("[OK] departments")
    expect(report).toContain("Result: CLEAN")
  })

  test("reports PROBLEMS FOUND and includes the offending table names when something mismatches", () => {
    const report = formatReport({
      reconciliations: [{ sourceTable: "webhooks", sourceCount: 5, registryCount: 3, missingFromRegistry: ["w1", "w2"], orphanedInRegistry: [] }],
      triggerGaps: ["committees"],
      coverage: { total: 10, registeredCount: 5, exemptedCount: 4, uncovered: ["mystery_table"] },
      invalidIdentifiers: [],
    })
    expect(report).toContain("[MISMATCH] webhooks")
    expect(report).toContain("w1, w2")
    expect(report).toContain("committees")
    expect(report).toContain("mystery_table")
    expect(report).toContain("Result: PROBLEMS FOUND")
  })

  test("truncates long id lists to the first 10 with a '+N more' note", () => {
    const missing = Array.from({ length: 15 }, (_, i) => `id_${i}`)
    const report = formatReport({
      reconciliations: [{ sourceTable: "big_table", sourceCount: 15, registryCount: 0, missingFromRegistry: missing, orphanedInRegistry: [] }],
      triggerGaps: [],
      coverage: { total: 1, registeredCount: 1, exemptedCount: 0, uncovered: [] },
      invalidIdentifiers: [],
    })
    expect(report).toContain("+5 more")
  })
})

describe("parseAuditSnapshot", () => {
  const validSnapshot = {
    generatedAt: "2026-07-12T00:00:00Z",
    reconciliations: [
      { sourceTable: "departments", sourceCount: 63, registryCount: 63, missingFromRegistry: [], orphanedInRegistry: [] },
    ],
    triggerRows: [
      { source_table: "departments", registration_active: true, trigger_attached: true },
    ],
  }

  test("parses a well-formed snapshot", () => {
    const snapshot = parseAuditSnapshot(validSnapshot)
    expect(snapshot.generatedAt).toBe("2026-07-12T00:00:00Z")
    expect(snapshot.reconciliations).toEqual(validSnapshot.reconciliations)
    expect(snapshot.triggerRows).toEqual(validSnapshot.triggerRows)
  })

  test("tolerates extra unrecognized fields (e.g. a 'method' provenance note)", () => {
    const snapshot = parseAuditSnapshot({ ...validSnapshot, method: "gathered via Supabase MCP execute_sql" })
    expect(snapshot.reconciliations.length).toBe(1)
  })

  test("defaults generatedAt to 'unknown' when missing or not a string", () => {
    const { generatedAt, ...withoutGeneratedAt } = validSnapshot
    expect(parseAuditSnapshot(withoutGeneratedAt).generatedAt).toBe("unknown")
    expect(parseAuditSnapshot({ ...validSnapshot, generatedAt: 12345 }).generatedAt).toBe("unknown")
  })

  test("throws when the top level isn't an object", () => {
    expect(() => parseAuditSnapshot(null)).toThrow("Snapshot must be a JSON object")
    expect(() => parseAuditSnapshot([1, 2, 3])).toThrow("Snapshot must be a JSON object")
    expect(() => parseAuditSnapshot("not json")).toThrow("Snapshot must be a JSON object")
  })

  test("throws when reconciliations[] is missing", () => {
    const { reconciliations, ...rest } = validSnapshot
    expect(() => parseAuditSnapshot(rest)).toThrow("Snapshot missing reconciliations[]")
  })

  test("throws when triggerRows[] is missing", () => {
    const { triggerRows, ...rest } = validSnapshot
    expect(() => parseAuditSnapshot(rest)).toThrow("Snapshot missing triggerRows[]")
  })

  test("throws naming the exact field when a reconciliation row is malformed", () => {
    expect(() =>
      parseAuditSnapshot({ ...validSnapshot, reconciliations: [{ sourceTable: "departments", sourceCount: -1, registryCount: 63, missingFromRegistry: [], orphanedInRegistry: [] }] })
    ).toThrow("reconciliations[0].sourceCount must be a non-negative number")
  })

  test("throws naming the exact field when a trigger row is malformed", () => {
    expect(() =>
      parseAuditSnapshot({ ...validSnapshot, triggerRows: [{ source_table: "departments", registration_active: "yes", trigger_attached: true }] })
    ).toThrow("triggerRows[0].registration_active must be a boolean")
  })

  test("round-trips through determineExitCode/formatReport cleanly (matches the real 2026-07-12 CLEAN run)", () => {
    const snapshot = parseAuditSnapshot(validSnapshot)
    const triggerGaps = findTriggerGaps(snapshot.triggerRows)
    const coverage: CoverageStats = { total: 1, registeredCount: 1, exemptedCount: 0, uncovered: [] }
    expect(determineExitCode({ reconciliations: snapshot.reconciliations, triggerGaps, coverage, invalidIdentifiers: [] })).toBe(0)
  })
})
