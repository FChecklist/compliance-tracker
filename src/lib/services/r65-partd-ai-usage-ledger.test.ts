/// <reference types="bun-types" />
// Regression guard for drizzle/0524_r65_partd_ai_usage_ledger.sql (R65 Part
// D -- AI Usage Ledger). Same convention as this repo's other
// migration-SQL regression tests (chunk-policy-rls.test.ts,
// r65-partc-phase1-memory-schema-rls.test.ts): no live Postgres connection
// is available in CI/this sandbox, so this reads the migration SQL that
// ships to production and asserts the exact clauses a live
// information_schema/pg_constraint/pg_indexes check would also require.
//
// This migration is purely additive (ALTER TABLE ADD COLUMN IF NOT EXISTS)
// on an already-RLS-enabled table (compliance.token_usage_ledger, RLS
// turned on by drizzle/0093) -- these tests assert the new columns/
// constraint/indexes exist AND that no RLS/policy/GRANT statement was
// added (the migration's own header explains why: this table's existing
// service_role-only posture, established by 0093, is deliberately left
// unchanged, not silently forgotten).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0524_r65_partd_ai_usage_ledger.sql")
const migrationSql = readFileSync(migrationPath, "utf8")

describe("drizzle/0524_r65_partd_ai_usage_ledger.sql", () => {
  test("targets the existing compliance.token_usage_ledger table (extend, not a new table)", () => {
    expect(migrationSql).toMatch(/ALTER TABLE compliance\.token_usage_ledger/)
    expect(migrationSql).not.toMatch(/CREATE TABLE.*token_usage_ledger/)
    expect(migrationSql).not.toMatch(/CREATE TABLE.*ai_usage_ledger/i)
  })

  test("every new column is added via ADD COLUMN IF NOT EXISTS (idempotent, additive-only)", () => {
    const newColumns = [
      "veridian_id",
      "veridian_product_id",
      "chat_id",
      "task_id",
      "route_id",
      "session_id",
      "level",
      "ai_role",
      "cache_read_tokens",
      "cache_creation_tokens",
      "input_cost",
      "output_cost",
      "cache_cost",
      "provider_cost",
      "allocated_cost",
      "billable_cost",
      "provider_cost_type",
      "subscription_cost",
      "allocation_method",
      "duration_ms",
      "success",
      "failure_reason",
    ]
    for (const col of newColumns) {
      const re = new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`)
      expect(migrationSql).toMatch(re)
    }
  })

  test("does not touch any of the 15 pre-existing columns (no DROP, no RENAME, no type change)", () => {
    expect(migrationSql).not.toMatch(/DROP COLUMN/i)
    expect(migrationSql).not.toMatch(/RENAME COLUMN/i)
    expect(migrationSql).not.toMatch(/ALTER COLUMN/i)
  })

  test("session_id is added -- closes directive non-negotiable rule #21 ('every AI call has a session_id')", () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS session_id text/)
  })

  test("does NOT use the directive's literal 'product_id' or 'cache_write_tokens' names (deliberate collision-avoidance rename, see header)", () => {
    expect(migrationSql).not.toMatch(/ADD COLUMN IF NOT EXISTS product_id\b/)
    expect(migrationSql).not.toMatch(/ADD COLUMN IF NOT EXISTS cache_write_tokens\b/)
  })

  test("does NOT reuse role_key for the directive's new cognitive-step taxonomy (ai_role is a distinct column)", () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS ai_role text/)
    expect(migrationSql).not.toMatch(/ADD COLUMN IF NOT EXISTS role\b/)
  })

  test("provider_cost_type defaults to METERED_API and is CHECK-constrained to exactly the 2 directive values", () => {
    expect(migrationSql).toMatch(/provider_cost_type text NOT NULL DEFAULT 'METERED_API'/)
    expect(migrationSql).toMatch(
      /CHECK \(provider_cost_type IN \('SUBSCRIPTION_ALLOCATED', 'METERED_API'\)\)/
    )
  })

  test("the provider_cost_type CHECK constraint is added idempotently (duplicate_object-tolerant DO block, this repo's established pattern)", () => {
    expect(migrationSql).toMatch(/DO \$\$ BEGIN[\s\S]*ADD CONSTRAINT token_usage_ledger_provider_cost_type_check[\s\S]*EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;/)
  })

  test("success defaults to true (every real call site today only logs after a successful completion)", () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS success boolean NOT NULL DEFAULT true/)
  })

  test("creates indexes on task_id, session_id, and provider_cost_type for R65 Part E's future per-task/per-session cost rollups", () => {
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_task_id ON compliance\.token_usage_ledger\(task_id\)/)
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_session_id ON compliance\.token_usage_ledger\(session_id\)/)
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_provider_cost_type ON compliance\.token_usage_ledger\(provider_cost_type\)/)
  })

  test("does NOT add any RLS/policy/GRANT statement -- this table's existing service_role-only posture (0093) is deliberately left unchanged", () => {
    // Anchored to actual statement position (start of line, optionally
    // indented) rather than a bare substring match -- this migration's own
    // header prose legitimately discusses "RLS policies"/"CREATE POLICY"
    // as a comparison to precedent (e.g. explaining why the idempotent DO
    // block convention is reused for a CHECK constraint instead), which a
    // bare substring match would misfire on.
    expect(migrationSql).not.toMatch(/^\s*ALTER TABLE compliance\.token_usage_ledger ENABLE ROW LEVEL SECURITY/m)
    expect(migrationSql).not.toMatch(/^\s*CREATE POLICY\b/m)
    expect(migrationSql).not.toMatch(/^\s*GRANT\b/m)
  })

  test("does not add a cross-schema FK from compliance.token_usage_ledger into platform.* (route_id is a documented soft reference only)", () => {
    expect(migrationSql).not.toMatch(/REFERENCES platform\./)
  })
})
