// R48 six-tenant-tables RLS regression guard
// (platform.r43_faults fault_id R48_RLS_DISABLED_ON_SIX_TENANT_TABLES_01).
//
// R48-UAT-S2 found 6 of 461 compliance base tables live with RLS switched
// OFF (relrowsecurity=false) and zero rows in pg_policies:
// construction_site_instructions, incident_log, memory_store, reuse_cache,
// ticket_intelligence_items (each carries an org_id column) and
// ticket_intelligence_action_items (no org_id of its own -- exposed through
// its parent ticket_intelligence_items). R56 (2026-08-27) enabled RLS and
// added the app_runtime_tenant_isolation / service_role_bypass policy pair
// directly against the live database (pcrjmlpuqsbocqfwoxod), applied
// outside this repo's tracked migration history at the time.
//
// R62 B7 (2026-08-28) live-re-verified via Supabase MCP that all 6 tables
// still have relrowsecurity=true with exactly the policy shapes below
// (pg_class.relrowsecurity / pg_policies queried directly against
// pcrjmlpuqsbocqfwoxod), then added drizzle/0329_r62_b7_rls_six_tenant_tables_sync.sql
// to bring this repo's migration history in sync with that live state --
// same technique PR #1397 used for CRR-068
// (drizzle/0327_crr_p2_schema_drizzle_sync.sql).
//
// Same reason as the two existing precedents in this repo
// (crr-p2-schema-rls.test.ts, sales-pipeline-rls.test.ts): there is no live
// Postgres connection available in CI/this sandbox (no DATABASE_URL /
// Supabase MCP reachable from a test runner here), so this reads the
// migration SQL that ships to production and asserts the exact clauses a
// live `pg_class.relrowsecurity` / `pg_policies` check would also require.
// This is the CI-runnable regression check requested for R62 B7 -- extending
// the established mechanism rather than inventing a new one.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0329_r62_b7_rls_six_tenant_tables_sync.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

// The 5 tables that carry their own org_id column and are scoped directly.
const orgScopedTables = [
  "construction_site_instructions",
  "incident_log",
  "memory_store",
  "reuse_cache",
  "ticket_intelligence_items",
]

describe("R48 fix regression: the 5 org_id-bearing tables have RLS enabled and org-scoped", () => {
  for (const table of orgScopedTables) {
    test(`compliance.${table} has ENABLE ROW LEVEL SECURITY`, () => {
      const re = new RegExp(`ALTER TABLE "compliance"\\."${table}" ENABLE ROW LEVEL SECURITY`)
      expect(migrationSql).toMatch(re)
    })

    test(`compliance.${table} has an app_runtime_tenant_isolation policy scoped by compliance.current_org_id()`, () => {
      const re = new RegExp(
        `CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"\\."${table}" FOR ALL TO app_runtime USING \\(org_id = compliance\\.current_org_id\\(\\)\\)`
      )
      expect(migrationSql).toMatch(re)
    })

    test(`compliance.${table} has a service_role bypass policy (service pipelines still need unconditional access)`, () => {
      const re = new RegExp(
        `CREATE POLICY "service_role_bypass_${table}" ON "compliance"\\."${table}" FOR ALL TO service_role USING \\(true\\)`
      )
      expect(migrationSql).toMatch(re)
    })
  }
})

describe("R48 fix regression: ticket_intelligence_action_items (no org_id of its own) is scoped through its parent", () => {
  test("compliance.ticket_intelligence_action_items has ENABLE ROW LEVEL SECURITY", () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE "compliance"\."ticket_intelligence_action_items" ENABLE ROW LEVEL SECURITY/
    )
  })

  test("compliance.ticket_intelligence_action_items has an app_runtime policy that resolves org_id via an EXISTS join to ticket_intelligence_items, gated by compliance.current_org_id()", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"\."ticket_intelligence_action_items" FOR ALL TO app_runtime USING \(EXISTS \(SELECT 1 FROM compliance\.ticket_intelligence_items p WHERE \(p\.id = ticket_intelligence_action_items\.ticket_intelligence_item_id\) AND \(p\.org_id = compliance\.current_org_id\(\)\)\)\)/
    )
  })

  test("compliance.ticket_intelligence_action_items has a service_role bypass policy", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "service_role_bypass_ticket_intelligence_action_items" ON "compliance"\."ticket_intelligence_action_items" FOR ALL TO service_role USING \(true\)/
    )
  })
})

describe("R48 fix regression: sanity, all 6 tables named by the fault row are covered by this migration", () => {
  const allSixTables = [...orgScopedTables, "ticket_intelligence_action_items"]

  test("finds all 6 tables the fault row named", () => {
    expect(allSixTables.length).toBe(6)
    for (const table of allSixTables) {
      expect(migrationSql).toContain(`"compliance"."${table}"`)
    }
  })

  test("does not weaken the fix into a permissive USING (true) app_runtime policy on any of the 6 tables", () => {
    // Guards against a future edit accidentally replacing the org-scoped
    // qual with an unconditional one for the app_runtime role specifically
    // (service_role's own USING (true) bypass policies are expected and
    // unaffected by this check).
    for (const table of allSixTables) {
      const permissiveAppRuntimeRe = new RegExp(
        `CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"\\."${table}" FOR ALL TO app_runtime USING \\(true\\)`
      )
      expect(migrationSql).not.toMatch(permissiveAppRuntimeRe)
    }
  })
})
