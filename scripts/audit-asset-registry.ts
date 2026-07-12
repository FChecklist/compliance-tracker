// Priority 4 (09-priority4-umr-universal-tracker.yaml, agent 6/domain C):
// the concrete answer to the Owner's "software can... read, write, edit,
// analyze, audit, and maintain the UMR -- automatically, without AI"
// requirement. This file makes ZERO AI/LLM calls anywhere -- every check
// below is a deterministic SQL count/diff or a deterministic string/set
// comparison. (Self-verifiable: `grep -iE "llm|openrouter|groq|prompt"` over
// this file returns nothing beyond this comment block's own English words.)
//
// SAFETY: this script is PURELY DIAGNOSTIC -- it only ever runs SELECT
// queries against compliance.platform_assets / compliance.
// asset_registration_config / compliance.attached_asset_triggers and the
// real source tables named in asset_registration_config. It never writes,
// updates, or deletes a single row anywhere. Fixing a found problem
// (marking a row deleted, re-attaching a missing trigger) is a deliberate,
// separate, reviewable action -- not something this script does silently.
//
// Checks performed:
//   1. Reconciliation: for every table in compliance.asset_registration_config,
//      compare the real source table's row ids against
//      compliance.platform_assets' registered rows for that source_table --
//      flags (a) source rows with no registry row at all (the trigger
//      should have caught this on INSERT and didn't -- a real bug signal)
//      and (b) registry rows whose source row no longer exists but are not
//      status='deleted' (the trigger's DELETE path should have caught this
//      and didn't).
//   2. Trigger attachment: queries compliance.attached_asset_triggers
//      (migration 0152's own read-only audit view) to flag any actively
//      configured table where trigger_attached=false -- someone added a
//      config row but forgot the CREATE TRIGGER statement.
//   3. Coverage: reads ai-os/registry/asset-registry-coverage.yaml and
//      cross-checks it against every table declared in src/lib/db/schema.ts
//      (same declaration regex check-asset-registry-coverage.mjs uses),
//      reporting registered/exempted/uncovered counts. This is INFORMATION
//      here -- the actual CI gate lives in check-asset-registry-coverage.mjs;
//      this script additionally treats a live "uncovered" table as a real
//      problem (exit 1) since a live DB table with no coverage decision at
//      all is exactly the kind of drift this script exists to catch even if
//      CI was somehow bypassed for that commit.
//
// This script needs a live DATABASE_URL to run for real, and per this
// dispatch's own instructions was NOT run against live data by the agent
// that wrote it -- verified instead via `tsc --noEmit` and
// audit-asset-registry.test.ts's coverage of every pure/extractable
// function below (same "written by a subagent, run by the Super Boss"
// discipline as scripts/backfill-platform-assets.ts). Run for real via:
//   bun run scripts/audit-asset-registry.ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"
import { sql } from "drizzle-orm"
import { db, assetRegistrationConfig } from "../src/lib/db"

const REPO_ROOT = process.cwd()
const SCHEMA_FILE = "src/lib/db/schema.ts"
const COVERAGE_FILE = "ai-os/registry/asset-registry-coverage.yaml"
const TABLE_DECL_RE = /complianceSchemaDB\.table\('([a-z_0-9]+)'/g

// ─── Pure functions (unit tested in audit-asset-registry.test.ts) ─────────

// Defense in depth: source_table values are only ever populated by reviewed
// migrations (never by application code at runtime, per asset_registration_
// config's own table comment in 0152), but this script still validates the
// identifier shape before interpolating it into a raw SQL FROM clause --
// the same discipline mdm-quality-service.ts's scanForDuplicates() already
// applies before its own dynamic-table-name queries. A config row that
// somehow fails this check is reported as a problem, not silently trusted.
export function isSafeIdentifier(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name)
}

export type IdSetDiff = { missingFromRegistry: string[]; orphanedInRegistry: string[] }

// sourceIds: real primary-key ids currently in the source table.
// registryIds: platform_assets.source_id values currently registered (non-
// deleted) for that source_table.
//   missingFromRegistry = a source row exists but has no live registry row
//     at all -- the trigger should have upserted one on INSERT and didn't.
//   orphanedInRegistry = a registry row claims a source_id that no longer
//     exists in the source table, but its status isn't 'deleted' -- the
//     trigger's DELETE path should have set that and didn't (or the row
//     was deleted by something that bypassed the trigger entirely, e.g. a
//     TRUNCATE, which does not fire row-level triggers).
export function diffIdSets(sourceIds: string[], registryIds: string[]): IdSetDiff {
  const sourceSet = new Set(sourceIds)
  const registrySet = new Set(registryIds)
  return {
    missingFromRegistry: sourceIds.filter((id) => !registrySet.has(id)),
    orphanedInRegistry: registryIds.filter((id) => !sourceSet.has(id)),
  }
}

export type TableReconciliation = {
  sourceTable: string
  sourceCount: number
  registryCount: number
  missingFromRegistry: string[]
  orphanedInRegistry: string[]
}

export function hasReconciliationProblem(r: TableReconciliation): boolean {
  return r.missingFromRegistry.length > 0 || r.orphanedInRegistry.length > 0
}

export type TriggerAttachmentRow = { source_table: string; registration_active: boolean; trigger_attached: boolean }

// A gap is only a real problem when the config row is ACTIVE -- an
// intentionally deactivated config (is_active=false, the documented "kill
// switch... independent of dropping the trigger" from 0152's own schema
// comment) legitimately has no live trigger requirement.
export function findTriggerGaps(rows: TriggerAttachmentRow[]): string[] {
  return rows.filter((r) => r.registration_active && !r.trigger_attached).map((r) => r.source_table)
}

export type CoverageStats = {
  total: number
  registeredCount: number
  exemptedCount: number
  uncovered: string[]
}

export function computeCoverageStats(declaredTables: Iterable<string>, registered: Iterable<string>, exempted: Iterable<string>): CoverageStats {
  const declared = new Set(declaredTables)
  const registeredSet = new Set(registered)
  const exemptedSet = new Set(exempted)
  const uncovered = [...declared].filter((t) => !registeredSet.has(t) && !exemptedSet.has(t))
  return {
    total: declared.size,
    registeredCount: registeredSet.size,
    exemptedCount: exemptedSet.size,
    uncovered,
  }
}

export type AuditReportInput = {
  reconciliations: TableReconciliation[]
  triggerGaps: string[]
  coverage: CoverageStats
  invalidIdentifiers: string[]
}

// Pure report formatter -- separated from the DB-touching main() so the
// exact report shape is unit-testable without a live database, same
// pattern as backfill-platform-assets.ts's buildXAssetInput() functions.
export function formatReport(input: AuditReportInput): string {
  const lines: string[] = []
  lines.push("=== Universal Metadata Registry Audit ===\n")

  lines.push("--- Reconciliation (source table rows vs. platform_assets rows) ---")
  if (input.reconciliations.length === 0) {
    lines.push("  (no configured tables to reconcile)")
  }
  for (const r of input.reconciliations) {
    const status = hasReconciliationProblem(r) ? "MISMATCH" : "OK"
    lines.push(`  [${status}] ${r.sourceTable}: source=${r.sourceCount} registered=${r.registryCount}`)
    if (r.missingFromRegistry.length > 0) {
      lines.push(`      missing from registry (trigger should have caught these): ${r.missingFromRegistry.slice(0, 10).join(", ")}${r.missingFromRegistry.length > 10 ? ` (+${r.missingFromRegistry.length - 10} more)` : ""}`)
    }
    if (r.orphanedInRegistry.length > 0) {
      lines.push(`      orphaned in registry (should be status='deleted'): ${r.orphanedInRegistry.slice(0, 10).join(", ")}${r.orphanedInRegistry.length > 10 ? ` (+${r.orphanedInRegistry.length - 10} more)` : ""}`)
    }
  }

  lines.push("\n--- Trigger attachment (compliance.attached_asset_triggers) ---")
  if (input.triggerGaps.length === 0) {
    lines.push("  all active configs have their trigger attached")
  } else {
    lines.push(`  ${input.triggerGaps.length} active config(s) missing their trigger:`)
    for (const t of input.triggerGaps) lines.push(`    - ${t}`)
  }

  if (input.invalidIdentifiers.length > 0) {
    lines.push("\n--- Invalid config rows (failed identifier safety check, SKIPPED) ---")
    for (const t of input.invalidIdentifiers) lines.push(`    - ${t}`)
  }

  lines.push("\n--- Coverage (ai-os/registry/asset-registry-coverage.yaml vs schema.ts) ---")
  lines.push(`  total tables in schema.ts: ${input.coverage.total}`)
  lines.push(`  registered: ${input.coverage.registeredCount}`)
  lines.push(`  exempted: ${input.coverage.exemptedCount}`)
  if (input.coverage.uncovered.length === 0) {
    lines.push("  uncovered: 0 (every table has an explicit registry decision)")
  } else {
    lines.push(`  uncovered: ${input.coverage.uncovered.length} table(s) with NO registry decision at all:`)
    for (const t of input.coverage.uncovered) lines.push(`    - ${t}`)
  }

  const problems = determineExitCode(input) === 1
  lines.push(`\n=== Result: ${problems ? "PROBLEMS FOUND" : "CLEAN"} ===`)
  return lines.join("\n")
}

// The single source of truth for "does this run count as a real problem" --
// used both by main()'s process.exit() and by formatReport()'s summary
// line, so the two can never disagree about what "CLEAN" means.
export function determineExitCode(input: { reconciliations: TableReconciliation[]; triggerGaps: string[]; coverage: CoverageStats; invalidIdentifiers: string[] }): 0 | 1 {
  const hasMismatch = input.reconciliations.some(hasReconciliationProblem)
  const hasTriggerGap = input.triggerGaps.length > 0
  const hasUncovered = input.coverage.uncovered.length > 0
  const hasInvalidIdentifiers = input.invalidIdentifiers.length > 0
  return hasMismatch || hasTriggerGap || hasUncovered || hasInvalidIdentifiers ? 1 : 0
}

// ─── Live-DB runner (not exercised by the unit tests, see file header) ────

async function reconcileTable(sourceTable: string): Promise<TableReconciliation> {
  const tableIdent = sql.raw(sourceTable)
  const sourceRows = (await db.execute(sql`SELECT id FROM compliance.${tableIdent}`)) as { id: string }[]
  const registryRows = (await db.execute(sql`
    SELECT source_id FROM compliance.platform_assets
    WHERE source_table = ${sourceTable} AND status != 'deleted'
  `)) as { source_id: string }[]

  const sourceIds = sourceRows.map((r) => r.id)
  const registryIds = registryRows.map((r) => r.source_id)
  const diff = diffIdSets(sourceIds, registryIds)

  return {
    sourceTable,
    sourceCount: sourceIds.length,
    registryCount: registryIds.length,
    ...diff,
  }
}

async function loadCoverageStats(): Promise<CoverageStats> {
  const schemaContent = await readFile(path.resolve(REPO_ROOT, SCHEMA_FILE), "utf8")
  const declaredTables = new Set<string>()
  for (const match of schemaContent.matchAll(TABLE_DECL_RE)) declaredTables.add(match[1])

  const coverageRaw = await readFile(path.resolve(REPO_ROOT, COVERAGE_FILE), "utf8")
  const coverage = yaml.load(coverageRaw) as { registered?: Array<string | { table: string }>; exempted?: Array<{ table: string }> }
  const registered = (coverage.registered ?? []).map((r) => (typeof r === "string" ? r : r.table))
  const exempted = (coverage.exempted ?? []).map((e) => e.table)

  return computeCoverageStats(declaredTables, registered, exempted)
}

async function main() {
  console.log("Running Universal Metadata Registry audit (read-only, no AI, no writes)...\n")

  const configs = await db.select().from(assetRegistrationConfig)

  const invalidIdentifiers: string[] = []
  const validConfigs = configs.filter((c) => {
    if (isSafeIdentifier(c.sourceTable)) return true
    invalidIdentifiers.push(c.sourceTable)
    return false
  })

  const reconciliations = await Promise.all(validConfigs.map((c) => reconcileTable(c.sourceTable)))

  const triggerRows = (await db.execute(sql`
    SELECT source_table, registration_active, trigger_attached
    FROM compliance.attached_asset_triggers
  `)) as TriggerAttachmentRow[]
  const triggerGaps = findTriggerGaps(triggerRows)

  const coverage = await loadCoverageStats()

  const report = formatReport({ reconciliations, triggerGaps, coverage, invalidIdentifiers })
  console.log(report)

  process.exit(determineExitCode({ reconciliations, triggerGaps, coverage, invalidIdentifiers }))
}

// import.meta.main (Bun's entrypoint check, same convention as
// backfill-platform-assets.ts) -- keeps every pure function above
// importable by audit-asset-registry.test.ts without triggering a live DB
// connection.
if (import.meta.main) {
  main().catch((err) => {
    console.error("Asset registry audit crashed:", err)
    process.exit(1)
  })
}
