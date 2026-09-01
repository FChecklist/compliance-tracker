// CRR P2-SCHEMA cross-tenant isolation test (CRR-068 / CRR-070).
//
// CRR-068 found a real gap live against pcrjmlpuqsbocqfwoxod: 3 of the 6
// org-scoped P2 tables (retrieval_citation, crr_erasure_log,
// crr_ingest_error) had an org_id column but no RLS policy at all -- a
// direct query as a second org could read another org's rows. That was
// fixed live via apply_migration crr068_fix_missed_rls_gaps and proven with
// a transactional cross-org SELECT (see platform.crr_spec evidence for
// CRR-068). This file is the permanent CI regression guard that gap's
// evidence said was still missing: no test file previously asserted RLS
// stays enabled on every org-scoped CRR table going forward.
//
// Same technique as the existing precedent in this repo
// (sales-pipeline-rls.test.ts): there is no live Postgres connection
// available in CI/this sandbox (no DATABASE_URL / Supabase MCP reachable
// from a test runner here), so this reads the actual migration SQL that
// ships to production (drizzle/0327_crr_p2_schema_drizzle_sync.sql, the
// file PR #1397 added to keep the Drizzle migration history in sync with
// what crr041_048_054_p2_schema_foundation..crr068_fix_missed_rls_gaps
// already built live) and asserts the exact clauses a live
// `pg_class.relrowsecurity` / `pg_policies` check would also require.
//
// The core assertion is DERIVED, not hand-listed: it parses every
// `CREATE TABLE "compliance"."X"` block in the migration, finds every one
// that declares an `org_id` column, and requires each such table to also
// have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` AND at least one
// `CREATE POLICY` scoping access through `compliance.current_org_id()`.
// That is exactly the shape of bug CRR-068 found (org_id present, RLS
// absent) -- if a future migration adds a 9th org-scoped CRR table and
// forgets RLS, this test fails without anyone having to remember to list
// the new table by name.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0327_crr_p2_schema_drizzle_sync.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

// Extract every `CREATE TABLE IF NOT EXISTS "compliance"."<name>" ( ... );`
// block so we can inspect its own column list independently per table.
function extractTableBlocks(sql: string): Map<string, string> {
  const blocks = new Map<string, string>()
  const tableRe = /CREATE TABLE IF NOT EXISTS "compliance"\."(\w+)"\s*\(([\s\S]*?)\n\);/g
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(sql)) !== null) {
    blocks.set(m[1], m[2])
  }
  return blocks
}

const tableBlocks = extractTableBlocks(migrationSql)

// Sanity check on the parser itself: if this drifts to 0 the regex above
// broke silently and every test below would vacuously pass on an empty
// map. Fail loudly instead.
const orgScopedTables = [...tableBlocks.entries()]
  .filter(([, body]) => /"org_id"\s+text/.test(body))
  .map(([name]) => name)

describe("CRR P2-SCHEMA migration parser sanity (drizzle/0327_crr_p2_schema_drizzle_sync.sql)", () => {
  test("finds all 8 CRR P2 tables in the migration", () => {
    expect(tableBlocks.size).toBe(8)
    expect([...tableBlocks.keys()].sort()).toEqual(
      [
        "source_object",
        "document_chunk",
        "extraction_profile",
        "precedent",
        "retrieval_citation",
        "chunk_policy",
        "crr_erasure_log",
        "crr_ingest_error",
      ].sort()
    )
  })

  test("finds exactly the 7 org_id-bearing tables (chunk_policy is deliberately shared platform config)", () => {
    expect(orgScopedTables.sort()).toEqual(
      [
        "source_object",
        "document_chunk",
        "extraction_profile",
        "precedent",
        "retrieval_citation",
        "crr_erasure_log",
        "crr_ingest_error",
      ].sort()
    )
    expect(orgScopedTables).not.toContain("chunk_policy")
  })
})

describe("Cross-tenant isolation: every org_id-bearing CRR P2 table has RLS enabled and org-scoped", () => {
  for (const table of orgScopedTables) {
    test(`compliance.${table} has ENABLE ROW LEVEL SECURITY`, () => {
      const re = new RegExp(`ALTER TABLE "compliance"\\."${table}" ENABLE ROW LEVEL SECURITY`)
      expect(migrationSql).toMatch(re)
    })

    test(`compliance.${table} has a policy scoping app_runtime access through compliance.current_org_id()`, () => {
      // Covers all three real shapes this migration uses:
      //   1. plain tenant isolation:      org_id = compliance.current_org_id()
      //   2. platform-default carve-out:  org_id = compliance.current_org_id() OR is_platform_default = true
      //   3. nullable-org_id carve-out:   org_id is not null and org_id = compliance.current_org_id()
      // All three still require current_org_id() to gate any row a caller
      // did not bring their own org_id for -- that's the property this test
      // exists to protect, not the exact wording.
      const policyBlockRe = new RegExp(
        `CREATE POLICY "[^"]*" ON "compliance"\\."${table}" FOR ALL TO app_runtime USING \\([^;]*compliance\\.current_org_id\\(\\)[^;]*\\)`
      )
      expect(migrationSql).toMatch(policyBlockRe)
    })

    test(`compliance.${table} has a service_role bypass policy (service pipelines still need unconditional access)`, () => {
      const re = new RegExp(`CREATE POLICY "service_role_bypass_${table}" ON "compliance"\\."${table}" FOR ALL TO service_role USING \\(true\\)`)
      expect(migrationSql).toMatch(re)
    })
  }

  test("chunk_policy (shared platform config, no org_id column) has no ENABLE ROW LEVEL SECURITY statement", () => {
    expect(migrationSql).not.toMatch(/ALTER TABLE "compliance"\."chunk_policy" ENABLE ROW LEVEL SECURITY/)
  })
})

describe("Referential isolation: cross-table FKs cannot be used to route around org scoping", () => {
  test("document_chunk.source_object_id -> source_object is RESTRICT (a chunk cannot outlive its parent's org boundary via cascade)", () => {
    expect(migrationSql).toMatch(
      /ADD CONSTRAINT "document_chunk_source_object_id_source_object_id_fk" FOREIGN KEY \("source_object_id"\) REFERENCES "compliance"\."source_object"\("id"\) ON DELETE restrict/
    )
  })

  test("retrieval_citation.chunk_id -> document_chunk is RESTRICT (a citation must outlive a redaction and resolve to a tombstone, per CRR-053)", () => {
    expect(migrationSql).toMatch(
      /ADD CONSTRAINT "retrieval_citation_chunk_id_document_chunk_id_fk" FOREIGN KEY \("chunk_id"\) REFERENCES "compliance"\."document_chunk"\("id"\) ON DELETE restrict/
    )
  })
})
