// R68 (Institutional Memory Graph) Phase 3 -- scope resolver, RLS
// regression guard for drizzle/0542_r68_p3_department_scope_and_personal_flag.sql.
//
// Same reason as this repo's other DB-independent RLS tests (see
// r65-partc-phase1-memory-schema-rls.test.ts's own header): no live
// Postgres connection is available in CI/this sandbox, so this reads the
// migration SQL that ships to production and asserts the exact clauses a
// live `pg_class.relrowsecurity` / `pg_policies` check would also require.
// A live re-verification via Supabase MCP is additionally performed once
// during this PR's own review (see the PR description) -- this file is
// the CI-runnable, always-on regression check, not a replacement for that
// one-time live check.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0542_r68_p3_department_scope_and_personal_flag.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

describe("IMG-012: DEPARTMENT joins memory_records.scope_type (expand-only, AR-11)", () => {
  test("drops the old 8-value CHECK by its exact name", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_records" DROP CONSTRAINT "memory_records_scope_type_check"/)
  })

  test("recreates it with the same name and all 9 values, including DEPARTMENT", () => {
    const m = migrationSql.match(/ALTER TABLE "compliance"\."memory_records" ADD CONSTRAINT "memory_records_scope_type_check"\s*CHECK \("scope_type" IN \(([^)]+)\)\)/)
    expect(m).not.toBeNull()
    const values = (m as RegExpMatchArray)[1].split(",").map((v) => v.trim().replace(/'/g, ""))
    expect(values.sort()).toEqual(
      ["GLOBAL", "INDUSTRY", "ORGANIZATION", "USER", "PROJECT", "TASK", "CONVERSATION", "DOCUMENT", "DEPARTMENT"].sort()
    )
  })

  test("does not add PRODUCT -- deferred per the owner's 2026-09-03 decision, no resolver logic exists for it", () => {
    expect(migrationSql).not.toMatch(/'PRODUCT'/)
  })

  test("every one of the original 8 values survives (expand-only, never a narrowing)", () => {
    for (const value of ["GLOBAL", "INDUSTRY", "ORGANIZATION", "USER", "PROJECT", "TASK", "CONVERSATION", "DOCUMENT"]) {
      expect(migrationSql).toContain(`'${value}'`)
    }
  })
})

describe("IMG-014 / CRR-234 / CRR-235: is_personal, enforced in RLS not application code", () => {
  test("adds is_personal as NOT NULL DEFAULT false (no regression for any pre-existing row)", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "compliance"\."memory_records" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL/)
  })

  test("adds a CHECK anchoring is_personal to USER scope only", () => {
    expect(migrationSql).toMatch(
      /ADD CONSTRAINT "memory_records_personal_requires_user_scope_check"\s*CHECK \(NOT "is_personal" OR \("scope_type" = 'USER' AND "user_id" IS NOT NULL\)\)/
    )
  })

  test("replaces the SELECT policy (DROP POLICY IF EXISTS + CREATE POLICY, not the duplicate_object-guard form -- this migration intends to CHANGE it)", () => {
    expect(migrationSql).toMatch(/DROP POLICY IF EXISTS "app_runtime_org_scoped" ON "compliance"\."memory_records"/)
  })

  test("the new SELECT policy keeps the exact pre-existing org-or-global clause (no regression)", () => {
    expect(migrationSql).toMatch(/org_id = compliance\.current_org_id\(\) OR org_id IS NULL/)
  })

  test("the new SELECT policy adds the personal-exclusion clause: not personal, OR the requesting session is the owning user", () => {
    expect(migrationSql).toMatch(/NOT is_personal OR user_id = compliance\.current_user_id\(\)/)
  })

  test("the personal-exclusion clause is AND-ed with the org-or-global clause, not OR-ed (a personal row of a DIFFERENT org must still never leak)", () => {
    const policyMatch = migrationSql.match(/CREATE POLICY "app_runtime_org_scoped" ON "compliance"\."memory_records" FOR SELECT TO app_runtime USING \(([\s\S]*?)\);/)
    expect(policyMatch).not.toBeNull()
    const body = (policyMatch as RegExpMatchArray)[1]
    expect(body).toMatch(/org_id = compliance\.current_org_id\(\) OR org_id IS NULL[\s\S]*\)\s*AND\s*\(NOT is_personal OR user_id = compliance\.current_user_id\(\)\)/)
  })

  test("does not touch the INSERT/UPDATE/DELETE policies (scoped change only)", () => {
    expect(migrationSql).not.toMatch(/CREATE POLICY "app_runtime_org_scoped_insert"/)
    expect(migrationSql).not.toMatch(/CREATE POLICY "app_runtime_org_scoped_update"/)
    expect(migrationSql).not.toMatch(/CREATE POLICY "app_runtime_org_scoped_delete"/)
  })

  test("no real DDL statement (ALTER/CREATE/DROP) targets memory_sources or memory_versions -- 0520's own header prose mentions them, but no statement does", () => {
    const ddlLines = migrationSql
      .split("\n")
      .filter((line) => /^(ALTER|CREATE|DROP)\b/.test(line.trim()))
    for (const line of ddlLines) {
      expect(line).not.toMatch(/memory_sources|memory_versions/)
    }
  })
})

describe("scope_id remains the polymorphic pointer for DEPARTMENT (no new department_id column, per the owner's 'materially cheaper' framing)", () => {
  test("does not add a department_id (or any other new) column besides is_personal", () => {
    const addColumnStatements = migrationSql.match(/ADD COLUMN "[a-z_]+"/g) ?? []
    expect(addColumnStatements).toEqual([`ADD COLUMN "is_personal"`])
  })
})
