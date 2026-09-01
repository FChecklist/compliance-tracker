// R65 Part C Phase 1: persistent-memory schema foundation RLS regression
// guard (memory_records / memory_sources / memory_versions,
// drizzle/0520_r65_partc_phase1_memory_schema.sql).
//
// Same reason as this repo's other DB-independent RLS tests
// (r48-six-tenant-tables-rls.test.ts, sales-pipeline-rls.test.ts,
// crr-p2-schema-rls.test.ts): there is no live Postgres connection
// available in CI/this sandbox (no DATABASE_URL / Supabase MCP reachable
// from a test runner here), so this reads the migration SQL that ships to
// production and asserts the exact clauses a live
// `pg_class.relrowsecurity` / `pg_policies` check would also require. A
// live RLS re-verification via Supabase MCP was additionally performed
// once during this PR's own review (see PROGRESS.md / the PR description)
// -- this file is the CI-runnable, always-on regression check, not a
// replacement for that one-time live check.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0520_r65_partc_phase1_memory_schema.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

describe("compliance.memory_records RLS (modified Pattern A -- own org OR global read)", () => {
  test("has ENABLE ROW LEVEL SECURITY", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_records" ENABLE ROW LEVEL SECURITY/)
  })

  test("has FORCE ROW LEVEL SECURITY", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_records" FORCE ROW LEVEL SECURITY/)
  })

  test("has a SELECT policy that allows the requesting org's own rows OR org_id IS NULL (GLOBAL/INDUSTRY)", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_org_scoped" ON "compliance"\."memory_records" FOR SELECT TO app_runtime USING \(org_id = compliance\.current_org_id\(\) OR org_id IS NULL\)/
    )
  })

  test("has an INSERT policy that only allows the requesting org's own org_id (never NULL)", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_org_scoped_insert" ON "compliance"\."memory_records" FOR INSERT TO app_runtime WITH CHECK \(org_id = compliance\.current_org_id\(\)\)/
    )
  })

  test("has an UPDATE policy scoped to the requesting org's own org_id", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_org_scoped_update" ON "compliance"\."memory_records" FOR UPDATE TO app_runtime USING \(org_id = compliance\.current_org_id\(\)\) WITH CHECK \(org_id = compliance\.current_org_id\(\)\)/
    )
  })

  test("has a DELETE policy scoped to the requesting org's own org_id", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_org_scoped_delete" ON "compliance"\."memory_records" FOR DELETE TO app_runtime USING \(org_id = compliance\.current_org_id\(\)\)/
    )
  })

  test("has a service_role bypass policy allowing unconditional access", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "service_role_bypass_memory_records" ON "compliance"\."memory_records" FOR ALL TO service_role USING \(true\)/
    )
  })

  test("does not weaken app_runtime write access into an unconditional USING (true) / WITH CHECK (true) policy", () => {
    expect(migrationSql).not.toMatch(/"app_runtime_org_scoped_insert"[\s\S]{0,120}WITH CHECK \(true\)/)
    expect(migrationSql).not.toMatch(/"app_runtime_org_scoped_update"[\s\S]{0,160}USING \(true\)/)
    expect(migrationSql).not.toMatch(/"app_runtime_org_scoped_delete"[\s\S]{0,120}USING \(true\)/)
  })

  test("has an index on content_hash", () => {
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_memory_records_content_hash" ON "compliance"\."memory_records" \("content_hash"\)/)
  })

  test("has a composite index on (org_id, scope_type)", () => {
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_memory_records_org_id_scope_type" ON "compliance"\."memory_records" \("org_id", "scope_type"\)/)
  })

  test("enforces org_id/scope_type consistency (NULL only for GLOBAL/INDUSTRY) via a CHECK constraint", () => {
    expect(migrationSql).toMatch(/CONSTRAINT "memory_records_org_id_scope_consistency_check" CHECK/)
  })
})

describe("compliance.memory_sources RLS (child table, EXISTS-join through memory_records)", () => {
  test("has ENABLE ROW LEVEL SECURITY", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_sources" ENABLE ROW LEVEL SECURITY/)
  })

  test("has FORCE ROW LEVEL SECURITY", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_sources" FORCE ROW LEVEL SECURITY/)
  })

  test("has an app_runtime policy that resolves org via an EXISTS join to memory_records, gated by compliance.current_org_id() (or a global parent)", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_org_scoped" ON "compliance"\."memory_sources" FOR ALL TO app_runtime\s*\n\s*USING \(EXISTS \(SELECT 1 FROM compliance\.memory_records mr WHERE mr\.id = memory_sources\.memory_record_id AND \(mr\.org_id = compliance\.current_org_id\(\) OR mr\.org_id IS NULL\)\)\)/
    )
  })

  test("has a service_role bypass policy", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "service_role_bypass_memory_sources" ON "compliance"\."memory_sources" FOR ALL TO service_role USING \(true\)/
    )
  })

  test("has an index on memory_record_id", () => {
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_memory_sources_memory_record_id" ON "compliance"\."memory_sources" \("memory_record_id"\)/)
  })

  test("memory_record_id is a NOT NULL foreign key with ON DELETE CASCADE", () => {
    expect(migrationSql).toMatch(
      /"memory_record_id" text NOT NULL REFERENCES "compliance"\."memory_records"\("id"\) ON DELETE CASCADE/
    )
  })
})

describe("compliance.memory_versions RLS (append-only child table, EXISTS-join through memory_records)", () => {
  test("has ENABLE ROW LEVEL SECURITY", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_versions" ENABLE ROW LEVEL SECURITY/)
  })

  test("has FORCE ROW LEVEL SECURITY", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_versions" FORCE ROW LEVEL SECURITY/)
  })

  test("has a SELECT policy scoped via EXISTS join to memory_records (own org or global parent)", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_org_scoped_select" ON "compliance"\."memory_versions" FOR SELECT TO app_runtime\s*\n\s*USING \(EXISTS \(SELECT 1 FROM compliance\.memory_records mr WHERE mr\.id = memory_versions\.memory_record_id AND \(mr\.org_id = compliance\.current_org_id\(\) OR mr\.org_id IS NULL\)\)\)/
    )
  })

  test("has an INSERT policy scoped via EXISTS join to memory_records (own org only, never a global/null-org parent)", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "app_runtime_org_scoped_insert" ON "compliance"\."memory_versions" FOR INSERT TO app_runtime\s*\n\s*WITH CHECK \(EXISTS \(SELECT 1 FROM compliance\.memory_records mr WHERE mr\.id = memory_versions\.memory_record_id AND mr\.org_id = compliance\.current_org_id\(\)\)\)/
    )
  })

  test("has a service_role bypass policy", () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY "service_role_bypass_memory_versions" ON "compliance"\."memory_versions" FOR ALL TO service_role USING \(true\)/
    )
  })

  test("does NOT define an UPDATE or DELETE policy for app_runtime (append-only, DB-enforced)", () => {
    expect(migrationSql).not.toMatch(/CREATE POLICY "app_runtime[^"]*" ON "compliance"\."memory_versions" FOR UPDATE/)
    expect(migrationSql).not.toMatch(/CREATE POLICY "app_runtime[^"]*" ON "compliance"\."memory_versions" FOR DELETE/)
  })

  test("does NOT grant UPDATE or DELETE to app_runtime on memory_versions", () => {
    expect(migrationSql).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON "compliance"\."memory_versions" TO app_runtime/)
    expect(migrationSql).not.toMatch(/GRANT[^;]*DELETE[^;]*ON "compliance"\."memory_versions" TO app_runtime/)
  })

  test("grants only SELECT, INSERT to app_runtime on memory_versions", () => {
    expect(migrationSql).toMatch(/GRANT SELECT, INSERT ON "compliance"\."memory_versions" TO app_runtime/)
  })

  test("has a unique constraint on (memory_record_id, version_number)", () => {
    expect(migrationSql).toMatch(/CONSTRAINT "memory_versions_record_version_unique" UNIQUE \("memory_record_id", "version_number"\)/)
  })

  test("has an index on memory_record_id", () => {
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_memory_versions_memory_record_id" ON "compliance"\."memory_versions" \("memory_record_id"\)/)
  })
})

describe("R65 Part C Phase 1: all 3 tables are wrapped in idempotent DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$ blocks", () => {
  const tables = ["memory_records", "memory_sources", "memory_versions"]

  test("every CREATE POLICY statement in this migration is inside a duplicate_object-tolerant DO block", () => {
    const policyStatements = migrationSql.match(/CREATE POLICY "[^"]+" ON "compliance"\."memory_(records|sources|versions)"[^;]*;/g) ?? []
    expect(policyStatements.length).toBeGreaterThan(0)
    for (const stmt of policyStatements) {
      const idx = migrationSql.indexOf(stmt)
      const precedingBlock = migrationSql.slice(Math.max(0, idx - 200), idx)
      expect(precedingBlock).toMatch(/DO \$\$ BEGIN\s*$/)
    }
  })

  test("finds all 3 tables named by this phase", () => {
    for (const table of tables) {
      expect(migrationSql).toContain(`"compliance"."${table}"`)
    }
  })

  test("Universal Metadata Registry: memory_records is registered in asset_registration_config with a trigger attached", () => {
    expect(migrationSql).toMatch(/INSERT INTO compliance\.asset_registration_config[\s\S]*?'memory_records'/)
    expect(migrationSql).toMatch(
      /CREATE TRIGGER auto_register_asset_trg\s+AFTER INSERT OR UPDATE OR DELETE ON compliance\.memory_records\s+FOR EACH ROW EXECUTE FUNCTION compliance\.auto_register_asset\(\)/
    )
  })

  test("does not add a registry entry or trigger for memory_sources/memory_versions (child/detail tables, same convention as erp_sales_invoice_items not having its own UMR row)", () => {
    expect(migrationSql).not.toMatch(/'memory_sources'.*asset_registration_config|asset_registration_config[\s\S]*?'memory_sources'/)
    expect(migrationSql).not.toMatch(/AFTER INSERT OR UPDATE OR DELETE ON compliance\.memory_sources/)
    expect(migrationSql).not.toMatch(/AFTER INSERT OR UPDATE OR DELETE ON compliance\.memory_versions/)
  })
})
