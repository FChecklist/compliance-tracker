/// <reference types="bun-types" />
// R67 Part B item 1.8 (Impact Analysis screen). Exercises the actual
// getModuleImpact()/resolveQualifiedTable()/clampImpactDepth() logic,
// mocking only the database layer (@/lib/db) -- same established pattern
// as task-execution-trace-service.test.ts and tenant-isolation.test.ts
// ("mocking only the database layer", not a live Postgres connection: this
// repo's test runner has no reachable DATABASE_URL / Supabase MCP, see
// r48-six-tenant-tables-rls.test.ts's own note).
//
// The fixture rows below are not invented: they are the exact live shape
// captured by running `select * from platform.graph_impact('compliance.
// projects', 2)` against the real database (pcrjmlpuqsbocqfwoxod) before
// writing this file (PART_B_STATUS.md 1.8), including the two real
// node-key prefixes the function returns ("table:schema.name" and
// "asset_type:name") and a real via_column value ("project_id").
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

const realDb = await import("@/lib/db")

const LIVE_FIXTURE_ROWS = [
  { dependent_table: "asset_type:project", depth: 1, via_column: null },
  { dependent_table: "table:compliance.erp_cost_centers", depth: 1, via_column: "project_id" },
  { dependent_table: "table:compliance.pms_budgets", depth: 1, via_column: "project_id" },
  { dependent_table: "table:platform.worker_agents", depth: 1, via_column: "project_id" },
  { dependent_table: "asset_type:document", depth: 2, via_column: null },
]

/** Fakes exactly the three db.execute() calls getModuleImpact() makes, in order: module_registry lookup, information_schema schema resolution, then graph_impact() itself. */
function makeFakeDb(opts: { tableName?: string | null; schema?: string | null; rows?: typeof LIVE_FIXTURE_ROWS }) {
  let call = 0
  return {
    db: {
      execute: async () => {
        call += 1
        if (call === 1) return opts.tableName === undefined ? [{ table_name: "projects" }] : opts.tableName === null ? [] : [{ table_name: opts.tableName }]
        if (call === 2) return opts.schema === undefined ? [{ table_schema: "compliance" }] : opts.schema === null ? [] : [{ table_schema: opts.schema }]
        return opts.rows ?? LIVE_FIXTURE_ROWS
      },
    },
  }
}

beforeEach(async () => {
  await mock.module("@/lib/db", () => makeFakeDb({}))
})

afterEach(async () => {
  await mock.module("@/lib/db", () => realDb)
})

describe("clampImpactDepth -- mirrors platform.graph_impact's own default/hard cap", () => {
  test("null/undefined/NaN default to 2", async () => {
    const { clampImpactDepth, GRAPH_IMPACT_DEFAULT_DEPTH } = await import("./graph-impact-service")
    expect(clampImpactDepth(null)).toBe(GRAPH_IMPACT_DEFAULT_DEPTH)
    expect(clampImpactDepth(undefined)).toBe(GRAPH_IMPACT_DEFAULT_DEPTH)
    expect(clampImpactDepth(NaN)).toBe(GRAPH_IMPACT_DEFAULT_DEPTH)
  })

  test("clamps below 1 up to 1, and above the hard cap down to it", async () => {
    const { clampImpactDepth, GRAPH_IMPACT_MAX_DEPTH } = await import("./graph-impact-service")
    expect(clampImpactDepth(0)).toBe(1)
    expect(clampImpactDepth(-5)).toBe(1)
    expect(clampImpactDepth(99)).toBe(GRAPH_IMPACT_MAX_DEPTH)
  })

  test("passes 1 and the cap itself through unchanged", async () => {
    const { clampImpactDepth } = await import("./graph-impact-service")
    expect(clampImpactDepth(1)).toBe(1)
    expect(clampImpactDepth(2)).toBe(2)
  })
})

describe("getModuleImpact -- real call shape against a live-captured fixture", () => {
  test("resolves module -> schema-qualified table -> dependent rows, mapped to camelCase", async () => {
    await mock.module("@/lib/db", () => makeFakeDb({ tableName: "projects", schema: "compliance" }))
    const { getModuleImpact } = await import("./graph-impact-service")

    const result = await getModuleImpact("projects", 2)

    expect(result.qualifiedTable).toBe("compliance.projects")
    expect(result.depth).toBe(2)
    expect(result.rows).toHaveLength(LIVE_FIXTURE_ROWS.length)
    expect(result.rows[0]).toEqual({ dependentTable: "asset_type:project", depth: 1, viaColumn: null })
    expect(result.rows[2]).toEqual({ dependentTable: "table:compliance.pms_budgets", depth: 1, viaColumn: "project_id" })
  })

  test("a schema-collision tie-break prefers compliance over platform", async () => {
    await mock.module("@/lib/db", () => makeFakeDb({ tableName: "automation_rules", schema: "platform" }))
    const { getModuleImpact } = await import("./graph-impact-service")

    const result = await getModuleImpact("automation_rules", 1)
    expect(result.qualifiedTable).toBe("platform.automation_rules")
  })

  test("an unknown module key throws a 404 ServiceError, never silently returns an empty graph", async () => {
    await mock.module("@/lib/db", () => makeFakeDb({ tableName: null }))
    const { getModuleImpact } = await import("./graph-impact-service")
    const { ServiceError } = await import("./compliance-service")

    await expect(getModuleImpact("no-such-module", 2)).rejects.toThrow(ServiceError)
  })

  test("a table absent from both compliance and platform throws a 404, not a silent empty result", async () => {
    await mock.module("@/lib/db", () => makeFakeDb({ tableName: "orphan_table", schema: null }))
    const { getModuleImpact } = await import("./graph-impact-service")

    await expect(getModuleImpact("orphan_module", 2)).rejects.toThrow("orphan_table")
  })

  test("an out-of-range depth is clamped before being sent to the DB call", async () => {
    await mock.module("@/lib/db", () => makeFakeDb({ tableName: "projects", schema: "compliance" }))
    const { getModuleImpact } = await import("./graph-impact-service")

    const result = await getModuleImpact("projects", 999)
    expect(result.depth).toBe(2)
  })
})
