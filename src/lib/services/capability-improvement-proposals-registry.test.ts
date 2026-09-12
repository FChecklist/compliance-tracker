// P2.6 follow-up (C-14, external review 2026-09-10 / F-2026-0910-006)
// regression guard for drizzle/0578_p2_6_capability_improvement_proposals_registry.sql.
//
// Same reason as task-capabilities-registry-lockdown.test.ts and the
// established precedents in this repo: no live Postgres connection in
// CI/this sandbox, so this reads the migration SQL and asserts the exact
// clauses a live pg_policies check would also require. The behavioural
// proof (app_runtime SELECT succeeds, app_runtime INSERT refused,
// service_role INSERT succeeds with a real FK, nothing persisted) was run
// once, live, inside BEGIN...ROLLBACK against pcrjmlpuqsbocqfwoxod.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "drizzle",
  "0578_p2_6_capability_improvement_proposals_registry.sql"
)
const migrationSql = readFileSync(migrationPath, "utf8")

describe("P2.6 follow-up: platform.capability_improvement_proposals gets an app_runtime read policy, stays write-locked", () => {
  test("RLS is enabled", () => {
    expect(migrationSql).toMatch(/ALTER TABLE platform\.capability_improvement_proposals ENABLE ROW LEVEL SECURITY/)
  })

  test("app_runtime gets a SELECT-only policy, unconditional (no org_id column exists on this table)", () => {
    const re =
      /CREATE POLICY "app_runtime_read_capability_improvement_proposals" ON platform\.capability_improvement_proposals\s+FOR SELECT TO app_runtime\s+USING \(true\)/
    expect(migrationSql).toMatch(re)
  })

  test("the app_runtime policy is SELECT only, never INSERT/UPDATE/DELETE/ALL", () => {
    const block = migrationSql.match(/CREATE POLICY "app_runtime_read_capability_improvement_proposals"[\s\S]*?;/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/FOR SELECT/)
    expect(block![0]).not.toMatch(/WITH CHECK/)
  })

  test("service_role keeps unconditional bypass", () => {
    const re =
      /CREATE POLICY "service_role_bypass_capability_improvement_proposals" ON platform\.capability_improvement_proposals\s+FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/
    expect(migrationSql).toMatch(re)
  })

  test("no policy on this table targets the public pseudo-role", () => {
    const policyBlocks = migrationSql.match(/CREATE POLICY[\s\S]*?;/g) ?? []
    expect(policyBlocks.length).toBeGreaterThan(0)
    for (const block of policyBlocks) {
      expect(block).not.toMatch(/\bTO public\b/)
    }
  })
})
