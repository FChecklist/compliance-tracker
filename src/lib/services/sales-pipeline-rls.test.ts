// Real, DB-independent check that compliance.crm_sales_targets has the same
// DB-level RLS shape as every other org-scoped table in this repo (e.g.
// construction_boq_line_items / construction_boqs in
// drizzle/0101_wave115_construction_boq_progress_diary.sql).
//
// tenant-isolation.test.ts's own header explains why it can't cover this: it
// mocks withTenantContext entirely, so it only proves the app-level "the
// right orgId reaches the DB call" layer, never the DB-level "Postgres
// itself refuses cross-org rows" layer. There is no live Postgres connection
// available in this sandbox (no DATABASE_URL / Supabase MCP), so this test
// reads the actual migration SQL that will be applied and asserts the exact
// clauses a live `pg_policies` / `pg_class.relrowsecurity` check would also
// require -- ENABLE ROW LEVEL SECURITY, both policies (app_runtime scoped by
// compliance.current_org_id(), service_role unconditional bypass), and the
// org_id / (org_id, month) indexes matching
// sales-pipeline-dashboard-service.ts's query patterns. A live DB assertion
// is a natural follow-up, not a replacement for this -- CI runs this on
// every PR regardless of DB availability.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0302_sales_pipeline_dashboard_targets.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

describe("compliance.crm_sales_targets RLS (drizzle/0302_sales_pipeline_dashboard_targets.sql)", () => {
  test("enables Row Level Security on the table", () => {
    expect(migrationSql).toMatch(/ALTER TABLE compliance\.crm_sales_targets ENABLE ROW LEVEL SECURITY/)
  })

  test("has an app_runtime_tenant_isolation policy scoped by compliance.current_org_id()", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY app_runtime_tenant_isolation ON compliance\.crm_sales_targets FOR ALL TO app_runtime[\s\S]*?USING \(org_id = compliance\.current_org_id\(\)\)/
    )
  })

  test("has a service_role_bypass policy allowing unconditional access", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY service_role_bypass_crm_sales_targets ON compliance\.crm_sales_targets FOR ALL TO service_role USING \(true\)/
    )
  })

  test("has an index on org_id", () => {
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS idx_crm_sales_targets_org_id ON compliance\.crm_sales_targets\(org_id\)/)
  })

  test("has a composite index on (org_id, month) matching setSalesTarget's find-or-create query", () => {
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_crm_sales_targets_org_id_month ON compliance\.crm_sales_targets\(org_id, month\)/
    )
  })
})
