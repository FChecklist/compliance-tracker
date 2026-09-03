// R68 (Institutional Memory Graph) Phase 1: bitemporal enforcement
// regression guard (compliance.memory_records / compliance.memory_versions,
// drizzle/0541_r68_phase1_bitemporal_enforcement.sql).
//
// Same reason as r65-partc-phase1-memory-schema-rls.test.ts and this
// repo's other DB-independent migration-regression tests: no live Postgres
// connection is available in CI/this sandbox, so this reads the migration
// SQL that ships to production and asserts the exact clauses a live check
// would also require. The REAL live proof for this phase (the append-only
// trigger genuinely raising on a `content` UPDATE and genuinely allowing
// an `effective_to`-only UPDATE, the CHECK constraint genuinely rejecting
// a pointerless SUPERSEDED row, and the as-of window query genuinely
// resolving the right row at three different instants) was run directly
// against the live migrated schema via the Supabase MCP as part of this
// PR's own review -- see the PR description for the exact statements and
// results. This file is the CI-runnable, always-on regression check, not a
// replacement for that one-time live proof.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0541_r68_phase1_bitemporal_enforcement.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

describe("item 1: append-only guard trigger on compliance.memory_records", () => {
  test("defines fn_memory_records_append_only_guard as a real plpgsql trigger function", () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION compliance\.fn_memory_records_append_only_guard\(\)\s*\nRETURNS trigger AS \$\$/)
  })

  test("only enforces for current_user = 'app_runtime' (service_role/postgres exempt, see this file's own header)", () => {
    expect(migrationSql).toMatch(/IF current_user <> 'app_runtime' THEN\s*\n\s*RETURN NEW;/)
  })

  test("allows exactly effective_to, superseded_by_id, lifecycle_state, updated_at, and metadata to change", () => {
    expect(migrationSql).toMatch(
      /v_allowed text\[\] := ARRAY\['effective_to', 'superseded_by_id', 'lifecycle_state', 'updated_at', 'metadata'\];/
    )
  })

  test("raises on any other column change, via to_jsonb comparison (fail-safe against future column drift)", () => {
    expect(migrationSql).toMatch(/v_old := to_jsonb\(OLD\);/)
    expect(migrationSql).toMatch(/v_new := to_jsonb\(NEW\);/)
    expect(migrationSql).toMatch(/IF v_old IS DISTINCT FROM v_new THEN\s*\n\s*RAISE EXCEPTION/)
  })

  test("has a fixed, non-mutable search_path (compliance, pg_temp)", () => {
    expect(migrationSql).toMatch(/\$\$ LANGUAGE plpgsql\s*\nSET search_path = compliance, pg_temp;/)
  })

  test("is wired as a real BEFORE UPDATE trigger on compliance.memory_records", () => {
    expect(migrationSql).toMatch(
      /CREATE TRIGGER trg_memory_records_append_only\s*\n\s*BEFORE UPDATE ON compliance\.memory_records\s*\n\s*FOR EACH ROW EXECUTE FUNCTION compliance\.fn_memory_records_append_only_guard\(\);/
    )
  })

  test("drops any prior version of the trigger first (idempotent re-apply)", () => {
    expect(migrationSql).toMatch(/DROP TRIGGER IF EXISTS trg_memory_records_append_only ON compliance\.memory_records;/)
  })
})

describe("item 2: SUPERSEDED-requires-superseded_by_id CHECK constraint", () => {
  test("adds memory_records_superseded_requires_pointer_check with no role exemption (a plain CHECK, unlike item 1's trigger)", () => {
    expect(migrationSql).toMatch(
      /ADD CONSTRAINT "memory_records_superseded_requires_pointer_check"\s*\n\s*CHECK \("lifecycle_state" <> 'SUPERSEDED' OR "superseded_by_id" IS NOT NULL\);/
    )
  })

  test("targets compliance.memory_records specifically", () => {
    const idx = migrationSql.indexOf("memory_records_superseded_requires_pointer_check")
    const precedingBlock = migrationSql.slice(Math.max(0, idx - 200), idx)
    expect(precedingBlock).toMatch(/ALTER TABLE "compliance"\."memory_records"/)
  })
})

describe("item 4: model_id / prompt_hash columns on compliance.memory_versions", () => {
  test("adds both columns, nullable (no NOT NULL, no DEFAULT)", () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE "compliance"\."memory_versions"\s*\n\s*ADD COLUMN "model_id" text,\s*\n\s*ADD COLUMN "prompt_hash" text;/
    )
  })
})

describe("items 3 and 5 are deliberately NOT SQL in this migration", () => {
  test("does not define a SQL function for as-of recall (implemented in TypeScript per memory-service.ts's own convention)", () => {
    expect(migrationSql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION compliance\.\w*as_?of\w*/i)
  })

  test("does not define a SQL function for erasure/redaction (implemented in TypeScript, extending no fabricated CRR-201 cascade)", () => {
    expect(migrationSql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION compliance\.\w*(erasure|redact)\w*/i)
  })

  test("explicitly documents that no callable CRR-201 erasure cascade was found in this codebase", () => {
    expect(migrationSql).toMatch(/no callable "CRR-201" erasure/)
  })
})

describe("safety preconditions this migration's own header claims", () => {
  test("documents that both tables were verified at 0 rows live immediately before writing this file", () => {
    expect(migrationSql).toMatch(/Both tables are still at 0 rows in production/)
    expect(migrationSql).toMatch(/verified live via the Supabase MCP immediately before/)
  })

  test("discloses the metadata-column deviation from the originating directive's literal 4-column list", () => {
    expect(migrationSql).toMatch(/Disclosed, deliberate deviation from the literal 4-column list/)
  })
})
