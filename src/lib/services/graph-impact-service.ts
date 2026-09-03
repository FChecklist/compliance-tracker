// R67 Part B item 1.8 (Impact Analysis screen, PART_B_STATUS.md "1.8 --
// Impact Analysis screen (not started, no blocker)"). UI-facing wrapper
// only -- no new graph logic. The query already exists and is already
// gated on the live database (Phase 1/1.6, PART_B_STATUS.md): the DB
// function is
//
//   platform.graph_impact(p_table text, p_max_depth integer DEFAULT 2)
//     RETURNS TABLE(dependent_table text, depth integer, via_column text)
//
// a thin SQL wrapper over platform.graph_ancestors(). Verified directly
// against the live database (pcrjmlpuqsbocqfwoxod) before writing this
// file: `select * from platform.graph_impact('compliance.projects', 2)`
// returns real rows shaped exactly as above (e.g. dependent_table
// "table:compliance.pms_budgets", depth 1, via_column "project_id").
//
// module_registry.table_name is a BARE table name ("projects", not
// "compliance.projects") and does not itself record which schema the
// table lives in -- most modules resolve to compliance.*, but a few
// (automation_rules, fde_requests, ...) resolve to platform.* instead, so
// the schema is resolved with a live information_schema lookup rather
// than assumed. Global-read, no org scoping -- same posture as
// module-registry-service.ts's own listModules() (module_registry and the
// graph tables are platform-tier catalog data, not tenant content; see
// PART_B_STATUS.md's G4 tenant-proof section for the graph tables'
// RLS posture).
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"

// Matches platform.graph_impact's own p_max_depth default AND hard cap
// (platform.graph_ancestors enforces this ceiling internally) -- clamping
// here is defense in depth, not a new limit.
export const GRAPH_IMPACT_DEFAULT_DEPTH = 2
export const GRAPH_IMPACT_MAX_DEPTH = 2

export type ImpactRow = { dependentTable: string; depth: number; viaColumn: string | null }
export type ImpactResult = { moduleKey: string; qualifiedTable: string; depth: number; rows: ImpactRow[] }

/** Clamps to [1, GRAPH_IMPACT_MAX_DEPTH], defaulting anything missing/invalid to GRAPH_IMPACT_DEFAULT_DEPTH. Exported standalone so it's testable without a DB. */
export function clampImpactDepth(requested: number | null | undefined): number {
  if (requested === null || requested === undefined || !Number.isFinite(requested)) return GRAPH_IMPACT_DEFAULT_DEPTH
  return Math.min(Math.max(1, Math.trunc(requested)), GRAPH_IMPACT_MAX_DEPTH)
}

async function resolveModuleTableName(moduleKey: string): Promise<string> {
  const rows = (await db.execute(sql`
    SELECT table_name FROM platform.module_registry WHERE module_key = ${moduleKey} LIMIT 1
  `)) as { table_name: string }[]
  const tableName = rows[0]?.table_name
  if (!tableName) throw new ServiceError(`Unknown module '${moduleKey}'`, 404)
  return tableName
}

/** module_registry does not record schema; prefer compliance.* (the overwhelming majority) over platform.* when a bare name collides in both -- verified live that no such collision exists today, but the tie-break is deterministic either way. */
async function resolveQualifiedTable(bareTableName: string): Promise<string> {
  const rows = (await db.execute(sql`
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = ${bareTableName} AND table_schema IN ('compliance', 'platform')
    ORDER BY CASE table_schema WHEN 'compliance' THEN 0 ELSE 1 END
    LIMIT 1
  `)) as { table_schema: string }[]
  const schema = rows[0]?.table_schema
  if (!schema) throw new ServiceError(`No table named '${bareTableName}' found in the compliance or platform schema`, 404)
  return `${schema}.${bareTableName}`
}

/** The one call this whole file exists to make: resolve a module_registry entry to its schema-qualified table, then ask platform.graph_impact() what depends on it. */
export async function getModuleImpact(moduleKey: string, requestedDepth?: number | null): Promise<ImpactResult> {
  const depth = clampImpactDepth(requestedDepth)
  const bareTableName = await resolveModuleTableName(moduleKey)
  const qualifiedTable = await resolveQualifiedTable(bareTableName)

  const rows = (await db.execute(sql`
    SELECT dependent_table, depth, via_column FROM platform.graph_impact(${qualifiedTable}, ${depth})
  `)) as { dependent_table: string; depth: number; via_column: string | null }[]

  return {
    moduleKey,
    qualifiedTable,
    depth,
    rows: rows.map((r) => ({ dependentTable: r.dependent_table, depth: r.depth, viaColumn: r.via_column })),
  }
}
