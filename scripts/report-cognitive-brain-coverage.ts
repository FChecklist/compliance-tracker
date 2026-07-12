// Priority 6 (2026-07-12): the "one brain" health/coverage report the
// Owner asked for -- "at backend it should work as one brain". This pulls
// together, in one place, the three coverage signals that actually exist
// today and answers "is FChecklist working as one connected system right
// now, with real numbers" rather than presenting a vanity dashboard:
//
//   (a) UMR coverage -- reuses audit-asset-registry.ts's own
//       computeCoverageStats()/CoverageStats (registered vs exempted vs
//       uncovered tables against ai-os/registry/asset-registry-coverage.yaml),
//       plus a live compliance.platform_assets asset-type breakdown.
//   (b) Software Orchestrator coverage -- reuses
//       capability-learning-service.ts's OWN computeCoverageStats(), a
//       DIFFERENT function with the same name that operates over
//       compliance.task_capabilities/instruction_packages (the X/Y/A/B
//       FULL_SOFTWARE/PACKAGE_AVAILABLE/NOVEL classification), not
//       platform_assets. Reported honestly when there's no live
//       classification history yet, never fabricated.
//   (c) Computation Engines (VCEL) -- live implemented/partial/not_started
//       breakdown from compliance.computation_engines.status.
//
// Zero AI/LLM calls -- every number below is a deterministic SQL count or a
// pure aggregation over already-fetched rows (same discipline as
// audit-asset-registry.ts's own header comment).
//
// Same DB-access story as audit-asset-registry.ts: the sandbox's bash tool
// cannot reach the live Postgres pooler directly (verified: raw TCP connect
// to aws-1-ap-south-1.pooler.supabase.com:6543 times out), but the
// Supabase MCP's execute_sql tool can. This script supports the identical
// --from-json=<path> pattern audit-asset-registry.ts introduced, fed by a
// snapshot gathered the same way. The real 2026-07-12 run used
// scripts/report-cognitive-brain-coverage.snapshot-2026-07-12.json --
// regenerate that report deterministically via:
//   bun run scripts/report-cognitive-brain-coverage.ts --from-json=scripts/report-cognitive-brain-coverage.snapshot-2026-07-12.json
//
// Two ways to run this for real:
//   1. Live DB, when reachable: bun run scripts/report-cognitive-brain-coverage.ts
//   2. Blocked live DB, MCP available: gather a snapshot via the Supabase
//      MCP's execute_sql tool, write it to a JSON file shaped like
//      CognitiveBrainSnapshot (see parseCognitiveBrainSnapshot), then run
//      with --from-json=<path>. The three live queries:
//        SELECT asset_type, status, count(*)::int AS count
//          FROM compliance.platform_assets GROUP BY asset_type, status;
//        SELECT status, count(*)::int AS count
//          FROM compliance.computation_engines GROUP BY status;
//        SELECT count(*)::int AS row_count,
//          COALESCE(sum(full_software_count),0)::int AS full_software_count,
//          COALESCE(sum(package_available_count),0)::int AS package_available_count,
//          COALESCE(sum(novel_count),0)::int AS novel_count
//          FROM compliance.task_capabilities;
//      UMR coverage is always computed from the local schema.ts/coverage.yaml
//      files -- no DB needed for that half either way.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"
import { sql } from "drizzle-orm"
import { db } from "../src/lib/db"
import { computeCoverageStats as computeUmrCoverageStats, type CoverageStats as UmrCoverageStats } from "./audit-asset-registry"
import { computeCoverageStats as computeSoftwareCoverageStats, type CoverageStats as SoftwareCoverageStats } from "../src/lib/services/capability-learning-service"

const REPO_ROOT = process.cwd()
const SCHEMA_FILE = "src/lib/db/schema.ts"
const COVERAGE_FILE = "ai-os/registry/asset-registry-coverage.yaml"
const TABLE_DECL_RE = /complianceSchemaDB\.table\('([a-z_0-9]+)'/g

// ─── Pure functions (unit tested in report-cognitive-brain-coverage.test.ts) ───

export type AssetTypeStatusCount = { assetType: string; status: string; count: number }
export type UmrAssetSummary = { totalAssets: number; byType: Record<string, number> }

// Collapses the live GROUP BY asset_type, status rows into a per-type total
// -- status is real live data (draft/active/archived/deleted) but this
// report cares about "how many assets of each kind exist", not their
// individual lifecycle state, so it's summed away here rather than dropped
// upstream (callers who want the status split can read AssetTypeStatusCount[]
// directly).
export function summarizePlatformAssetCounts(rows: AssetTypeStatusCount[]): UmrAssetSummary {
  const byType: Record<string, number> = {}
  let totalAssets = 0
  for (const r of rows) {
    byType[r.assetType] = (byType[r.assetType] ?? 0) + r.count
    totalAssets += r.count
  }
  return { totalAssets, byType }
}

export function formatUmrSection(coverage: UmrCoverageStats, assets: UmrAssetSummary): string {
  const lines: string[] = []
  lines.push("--- Universal Metadata Registry (UMR) ---")
  lines.push(`  Table coverage: ${coverage.registeredCount} registered / ${coverage.exemptedCount} exempted / ${coverage.uncovered.length} uncovered (of ${coverage.total} tables declared in schema.ts)`)
  if (assets.totalAssets === 0) {
    lines.push("  platform_assets: 0 rows -- registry is empty, nothing to report")
  } else {
    const typeLines = Object.entries(assets.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}=${count}`)
      .join(", ")
    lines.push(`  platform_assets: ${assets.totalAssets} total rows (${typeLines})`)
  }
  return lines.join("\n")
}

export type ComputationEngineBreakdown = { implemented: number; partial: number; notStarted: number }

export function formatComputationEngineSection(b: ComputationEngineBreakdown): string {
  const total = b.implemented + b.partial + b.notStarted
  const lines: string[] = ["--- Computation Engines (VCEL) ---"]
  if (total === 0) {
    lines.push("  0 engines registered -- nothing to report")
    return lines.join("\n")
  }
  const pct = (n: number) => Math.round((n / total) * 100)
  lines.push(`  ${b.implemented}/${total} implemented (${pct(b.implemented)}%), ${b.partial} partial (${pct(b.partial)}%), ${b.notStarted} not started (${pct(b.notStarted)}%)`)
  return lines.join("\n")
}

// rawRowCount is compliance.task_capabilities's real row count -- kept
// separate from `stats.total` (which is a sum of the 3 rolling occurrence
// counters, not the row count) so a capability that exists but has never
// been exercised (all 3 counters still 0) is distinguishable from "no
// capabilities recorded at all".
export function formatSoftwareOrchestratorSection(rawRowCount: number, stats: SoftwareCoverageStats): string {
  const lines: string[] = ["--- Software Orchestrator (capability learning) ---"]
  if (rawRowCount === 0) {
    lines.push("  task_capabilities: 0 rows -- no live classification history yet. This is a genuine 0, not a fabricated percentage: the learning loop exists (capability-learning-service.ts) but hasn't been exercised in production.")
    return lines.join("\n")
  }
  if (stats.total === 0) {
    lines.push(`  ${rawRowCount} capabilities tracked, but 0 classified occurrences recorded yet (every capability's fullSoftwareCount/packageAvailableCount/novelCount is still 0)`)
    return lines.join("\n")
  }
  lines.push(`  ${rawRowCount} capabilities tracked, ${stats.total} classified occurrences -- FULL_SOFTWARE ${stats.fullSoftwarePercent}%, PACKAGE_AVAILABLE ${stats.packageAvailablePercent}%, NOVEL ${stats.novelPercent}%`)
  return lines.join("\n")
}

export type CognitiveBrainReportInput = {
  generatedAt: string
  umrCoverage: UmrCoverageStats
  umrAssets: UmrAssetSummary
  computationEngines: ComputationEngineBreakdown
  softwareOrchestratorRowCount: number
  softwareOrchestratorStats: SoftwareCoverageStats
}

// The single "is this actually one brain, concretely, right now" verdict.
// Deliberately conservative and deliberately NOT the same question as "is
// everything 100% built" -- a computation-engine or Software-Orchestrator
// gap is a real, separately-labeled fact, not evidence the UMR plumbing
// itself is broken. "one brain" here means: the pieces that are supposed
// to feed each other actually have real data flowing through them.
export function formatCognitiveBrainReport(input: CognitiveBrainReportInput): string {
  const lines: string[] = []
  lines.push("=== VERIDIAN Cognitive Brain Coverage Report ===")
  lines.push(`Generated: ${input.generatedAt}\n`)

  lines.push(formatUmrSection(input.umrCoverage, input.umrAssets))
  lines.push("")
  lines.push(formatComputationEngineSection(input.computationEngines))
  lines.push("")
  lines.push(formatSoftwareOrchestratorSection(input.softwareOrchestratorRowCount, input.softwareOrchestratorStats))
  lines.push("")

  lines.push("--- Verdict ---")
  const umrWired = input.umrCoverage.uncovered.length === 0 && input.umrAssets.totalAssets > 0
  const engineTotal = input.computationEngines.implemented + input.computationEngines.partial + input.computationEngines.notStarted
  const enginesMostlyBuilt = engineTotal > 0 && input.computationEngines.implemented / engineTotal >= 0.5
  const orchestratorLive = input.softwareOrchestratorRowCount > 0

  if (umrWired && enginesMostlyBuilt && orchestratorLive) {
    lines.push("  UMR plumbing is wired and populated, most computation engines are implemented, and the Software Orchestrator has live classification history -- the backend is functioning as one connected system with real data flowing through it.")
  } else {
    const gaps: string[] = []
    if (!umrWired) gaps.push("UMR has uncovered tables or zero registered assets")
    if (!enginesMostlyBuilt) gaps.push("fewer than half of computation engines are implemented")
    if (!orchestratorLive) gaps.push("Software Orchestrator has zero live classification history (task_capabilities is empty)")
    lines.push(`  Partially wired, not fully "one brain" yet: ${gaps.join("; ")}.`)
  }

  return lines.join("\n")
}

// ─── JSON snapshot support (unit tested) ───────────────────────────────────

export type CognitiveBrainSnapshot = {
  generatedAt: string
  umrAssets: AssetTypeStatusCount[]
  computationEngines: ComputationEngineBreakdown
  softwareOrchestrator: { rowCount: number; fullSoftwareCount: number; packageAvailableCount: number; novelCount: number }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === "number" && v >= 0
}

function validateAssetTypeStatusCount(row: unknown, index: number): AssetTypeStatusCount {
  if (!isPlainObject(row)) throw new Error(`umrAssets[${index}] is not an object`)
  const { assetType, status, count } = row
  if (typeof assetType !== "string" || assetType.length === 0) throw new Error(`umrAssets[${index}].assetType must be a non-empty string`)
  if (typeof status !== "string" || status.length === 0) throw new Error(`umrAssets[${index}].status must be a non-empty string`)
  if (!isNonNegativeNumber(count)) throw new Error(`umrAssets[${index}].count must be a non-negative number`)
  return { assetType, status, count }
}

function validateComputationEngineBreakdown(raw: unknown): ComputationEngineBreakdown {
  if (!isPlainObject(raw)) throw new Error("computationEngines must be an object")
  const { implemented, partial, notStarted } = raw
  if (!isNonNegativeNumber(implemented)) throw new Error("computationEngines.implemented must be a non-negative number")
  if (!isNonNegativeNumber(partial)) throw new Error("computationEngines.partial must be a non-negative number")
  if (!isNonNegativeNumber(notStarted)) throw new Error("computationEngines.notStarted must be a non-negative number")
  return { implemented, partial, notStarted }
}

function validateSoftwareOrchestrator(raw: unknown): CognitiveBrainSnapshot["softwareOrchestrator"] {
  if (!isPlainObject(raw)) throw new Error("softwareOrchestrator must be an object")
  const { rowCount, fullSoftwareCount, packageAvailableCount, novelCount } = raw
  if (!isNonNegativeNumber(rowCount)) throw new Error("softwareOrchestrator.rowCount must be a non-negative number")
  if (!isNonNegativeNumber(fullSoftwareCount)) throw new Error("softwareOrchestrator.fullSoftwareCount must be a non-negative number")
  if (!isNonNegativeNumber(packageAvailableCount)) throw new Error("softwareOrchestrator.packageAvailableCount must be a non-negative number")
  if (!isNonNegativeNumber(novelCount)) throw new Error("softwareOrchestrator.novelCount must be a non-negative number")
  return { rowCount, fullSoftwareCount, packageAvailableCount, novelCount }
}

// Pure validator (unit tested) -- same "hand-rolled, no schema library"
// precedent as audit-asset-registry.ts's parseAuditSnapshot().
export function parseCognitiveBrainSnapshot(raw: unknown): CognitiveBrainSnapshot {
  if (!isPlainObject(raw)) throw new Error("Snapshot must be a JSON object")
  if (!Array.isArray(raw.umrAssets)) throw new Error("Snapshot missing umrAssets[]")
  return {
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "unknown",
    umrAssets: raw.umrAssets.map((r, i) => validateAssetTypeStatusCount(r, i)),
    computationEngines: validateComputationEngineBreakdown(raw.computationEngines),
    softwareOrchestrator: validateSoftwareOrchestrator(raw.softwareOrchestrator),
  }
}

// ─── Shared local-file loader (no DB needed, used by both modes) ──────────

async function loadUmrCoverage(): Promise<UmrCoverageStats> {
  const schemaContent = await readFile(path.resolve(REPO_ROOT, SCHEMA_FILE), "utf8")
  const declaredTables = new Set<string>()
  for (const match of schemaContent.matchAll(TABLE_DECL_RE)) declaredTables.add(match[1])

  const coverageRaw = await readFile(path.resolve(REPO_ROOT, COVERAGE_FILE), "utf8")
  const coverage = yaml.load(coverageRaw) as { registered?: Array<string | { table: string }>; exempted?: Array<{ table: string }> }
  const registered = (coverage.registered ?? []).map((r) => (typeof r === "string" ? r : r.table))
  const exempted = (coverage.exempted ?? []).map((e) => e.table)

  return computeUmrCoverageStats(declaredTables, registered, exempted)
}

// ─── Live-DB runner (not exercised by the unit tests) ──────────────────────

async function loadPlatformAssetCountsLive(): Promise<AssetTypeStatusCount[]> {
  const rows = (await db.execute(sql`
    SELECT asset_type, status, count(*)::int AS count
    FROM compliance.platform_assets
    GROUP BY asset_type, status
  `)) as { asset_type: string; status: string; count: number }[]
  return rows.map((r) => ({ assetType: r.asset_type, status: r.status, count: r.count }))
}

async function loadComputationEngineBreakdownLive(): Promise<ComputationEngineBreakdown> {
  const rows = (await db.execute(sql`
    SELECT status, count(*)::int AS count FROM compliance.computation_engines GROUP BY status
  `)) as { status: string; count: number }[]
  const find = (s: string) => rows.find((r) => r.status === s)?.count ?? 0
  return { implemented: find("implemented"), partial: find("partial"), notStarted: find("not_started") }
}

async function loadSoftwareOrchestratorDataLive(): Promise<{ rowCount: number; stats: SoftwareCoverageStats }> {
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS row_count,
      COALESCE(sum(full_software_count),0)::int AS full_software_count,
      COALESCE(sum(package_available_count),0)::int AS package_available_count,
      COALESCE(sum(novel_count),0)::int AS novel_count
    FROM compliance.task_capabilities
  `)) as { row_count: number; full_software_count: number; package_available_count: number; novel_count: number }[]
  const row = rows[0] ?? { row_count: 0, full_software_count: 0, package_available_count: 0, novel_count: 0 }
  const stats = computeSoftwareCoverageStats(row.full_software_count, row.package_available_count, row.novel_count)
  return { rowCount: row.row_count, stats }
}

async function runFromSnapshot(snapshotPath: string) {
  console.log(`Running Cognitive Brain coverage report from snapshot: ${snapshotPath}\n`)

  const raw = JSON.parse(await readFile(path.resolve(REPO_ROOT, snapshotPath), "utf8"))
  const snapshot = parseCognitiveBrainSnapshot(raw)
  console.log(`Snapshot generated at: ${snapshot.generatedAt}\n`)

  const umrCoverage = await loadUmrCoverage()
  const umrAssets = summarizePlatformAssetCounts(snapshot.umrAssets)
  const softwareOrchestratorStats = computeSoftwareCoverageStats(
    snapshot.softwareOrchestrator.fullSoftwareCount,
    snapshot.softwareOrchestrator.packageAvailableCount,
    snapshot.softwareOrchestrator.novelCount
  )

  const report = formatCognitiveBrainReport({
    generatedAt: snapshot.generatedAt,
    umrCoverage,
    umrAssets,
    computationEngines: snapshot.computationEngines,
    softwareOrchestratorRowCount: snapshot.softwareOrchestrator.rowCount,
    softwareOrchestratorStats,
  })
  console.log(report)
}

async function main() {
  const jsonFlag = process.argv.find((a) => a.startsWith("--from-json="))
  if (jsonFlag) {
    await runFromSnapshot(jsonFlag.slice("--from-json=".length))
    return
  }

  console.log("Running VERIDIAN Cognitive Brain coverage report (read-only, no AI, no writes)...\n")

  const [umrCoverage, umrAssetRows, computationEngines, softwareOrchestrator] = await Promise.all([
    loadUmrCoverage(),
    loadPlatformAssetCountsLive(),
    loadComputationEngineBreakdownLive(),
    loadSoftwareOrchestratorDataLive(),
  ])

  const report = formatCognitiveBrainReport({
    generatedAt: new Date().toISOString(),
    umrCoverage,
    umrAssets: summarizePlatformAssetCounts(umrAssetRows),
    computationEngines,
    softwareOrchestratorRowCount: softwareOrchestrator.rowCount,
    softwareOrchestratorStats: softwareOrchestrator.stats,
  })
  console.log(report)
}

// import.meta.main (Bun's entrypoint check, same convention as
// audit-asset-registry.ts) -- keeps every pure function above importable by
// report-cognitive-brain-coverage.test.ts without triggering a live DB
// connection.
if (import.meta.main) {
  main().catch((err) => {
    console.error("Cognitive Brain coverage report crashed:", err)
    process.exit(1)
  })
}
