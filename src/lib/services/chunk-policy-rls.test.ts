// Regression guard for a Supabase advisor CRITICAL finding (project
// pcrjmlpuqsbocqfwoxod / verdian-ai): compliance.chunk_policy was the only
// table in the compliance schema left with RLS disabled entirely --
// 0327_crr_p2_schema_drizzle_sync.sql created the table but deliberately
// skipped RLS on it (its own comment: "all except chunk_policy, which is
// shared platform config"), because chunk_policy has no org_id column and
// is genuine platform-wide reference data (3 rows: generic/construction/
// india_compliance business-object types), not tenant data.
//
// drizzle/0522_chunk_policy_rls.sql closes the gap using this repo's
// established "platform-wide reference table" RLS pattern (Pattern A) --
// the same shape as gst_gstin_master/gst_hsn_master
// (drizzle/0100_gst_reconciliation_engine.sql) and platform_billing_plans
// (drizzle/0400_platform_billing_plans_invoices.sql): RLS enabled + FORCED,
// a SELECT-only app_runtime_read_all policy (USING (true)) so every org's
// unfiltered read in document-extraction-service.ts's
// chunkAndEmbedSourceObject() keeps working, and the standard unconditional
// service_role_bypass policy. Deliberately NOT the bare
// `ENABLE ROW LEVEL SECURITY` with zero policies the advisor's own generic
// remediation suggests -- that would default-deny every org's read and
// break document ingestion platform-wide.
//
// Same reason as this repo's other RLS regression tests
// (r48-six-tenant-tables-rls.test.ts, sales-pipeline-rls.test.ts,
// crr-p2-schema-rls.test.ts): there is no live Postgres connection
// available in CI/this sandbox (no DATABASE_URL / Supabase MCP reachable
// from a test runner here), so this reads the migration SQL that ships to
// production and asserts the exact clauses a live `pg_class.relrowsecurity`
// / `pg_policies` check would also require.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0522_chunk_policy_rls.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

describe("compliance.chunk_policy RLS (drizzle/0522_chunk_policy_rls.sql)", () => {
  test("enables Row Level Security on the table", () => {
    expect(migrationSql).toMatch(/ALTER TABLE compliance\.chunk_policy ENABLE ROW LEVEL SECURITY/)
  })

  test("forces Row Level Security (so even the table owner is subject to policies)", () => {
    expect(migrationSql).toMatch(/ALTER TABLE compliance\.chunk_policy FORCE ROW LEVEL SECURITY/)
  })

  test("has a SELECT-only app_runtime_read_all policy with USING (true) -- platform-wide reference data must stay readable to every org", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY app_runtime_read_all ON compliance\.chunk_policy FOR SELECT TO app_runtime USING \(true\)/
    )
  })

  test("has a service_role_bypass policy allowing unconditional access", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY service_role_bypass_chunk_policy ON compliance\.chunk_policy FOR ALL TO service_role USING \(true\)/
    )
  })

  test("grants app_runtime SELECT only (no write grant -- chunk_policy is owner/admin-edited config, not app-user-writable)", () => {
    expect(migrationSql).toMatch(/GRANT SELECT ON compliance\.chunk_policy TO app_runtime;/)
    expect(migrationSql).not.toMatch(/GRANT[^;]*\bINSERT\b[^;]*ON compliance\.chunk_policy TO app_runtime/)
    expect(migrationSql).not.toMatch(/GRANT[^;]*\bUPDATE\b[^;]*ON compliance\.chunk_policy TO app_runtime/)
    expect(migrationSql).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*ON compliance\.chunk_policy TO app_runtime/)
  })

  test("grants service_role full CRUD", () => {
    expect(migrationSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON compliance\.chunk_policy TO service_role;/
    )
  })

  test("does not weaken the fix into a permissive ALL/write policy for app_runtime", () => {
    expect(migrationSql).not.toMatch(
      /CREATE POLICY app_runtime_read_all ON compliance\.chunk_policy FOR ALL TO app_runtime/
    )
  })
})
