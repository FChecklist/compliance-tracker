// P2.6 (W-ENV, R81-ADDENDUM-B phase S5) regression guard for
// drizzle/0577_p2_6_task_capabilities_registry_write_lockdown.sql.
//
// Same reason as the established precedents in this repo
// (r48-six-tenant-tables-rls.test.ts, crr-p2-schema-rls.test.ts,
// sales-pipeline-rls.test.ts): there is no live Postgres connection
// available in CI/this sandbox, so this reads the migration SQL that ships
// to production and asserts the exact clauses a live pg_policies check
// would also require. The actual behavioural proof -- an app_runtime write
// of a platform-wide row refused, a service_role write of the same row
// succeeding, nothing persisted -- was run once, live, inside
// BEGIN...ROLLBACK against pcrjmlpuqsbocqfwoxod (see the migration file's
// own header for the transcript); that dry run cannot be replayed here
// without a live connection, so this test guards the SQL text that dry run
// was run against instead.
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
  "0577_p2_6_task_capabilities_registry_write_lockdown.sql"
)
const migrationSql = readFileSync(migrationPath, "utf8")

describe("P2.6 fix: platform.task_capabilities no longer lets app_runtime write platform-wide (registry) rows", () => {
  test("RLS is enabled", () => {
    expect(migrationSql).toMatch(/ALTER TABLE platform\.task_capabilities ENABLE ROW LEVEL SECURITY/)
  })

  test("the old public/ALL/org-or-null policy is dropped", () => {
    expect(migrationSql).toMatch(
      /DROP POLICY IF EXISTS "app_runtime_org_scoped_or_platform_default" ON platform\.task_capabilities/
    )
  })

  test("app_runtime keeps FOR ALL access, but ONLY on its own org's rows -- no OR org_id IS NULL branch", () => {
    const re =
      /CREATE POLICY "app_runtime_org_scoped" ON platform\.task_capabilities\s+FOR ALL TO app_runtime\s+USING \(org_id = compliance\.current_org_id\(\)\)\s+WITH CHECK \(org_id = compliance\.current_org_id\(\)\)/
    expect(migrationSql).toMatch(re)
  })

  test("does not weaken the fix into a permissive org_id IS NULL branch on the app_runtime ALL policy", () => {
    // Guards against a future edit re-adding "OR (org_id IS NULL)" (or any
    // IS NULL check at all) to the FOR ALL policy's USING/WITH CHECK --
    // that is the exact hole this migration closes.
    const allPolicyMatch = migrationSql.match(
      /CREATE POLICY "app_runtime_org_scoped" ON platform\.task_capabilities[\s\S]*?;/
    )
    expect(allPolicyMatch).not.toBeNull()
    expect(allPolicyMatch![0]).not.toMatch(/IS NULL/)
    expect(allPolicyMatch![0]).not.toMatch(/\bpublic\b/)
  })

  test("app_runtime gets a SEPARATE, SELECT-only policy for platform-wide (org_id IS NULL) rows -- read but not write", () => {
    const re =
      /CREATE POLICY "app_runtime_read_platform_defaults" ON platform\.task_capabilities\s+FOR SELECT TO app_runtime\s+USING \(org_id IS NULL\)/
    expect(migrationSql).toMatch(re)
  })

  test("the platform-default policy is SELECT only, never INSERT/UPDATE/DELETE/ALL", () => {
    const platformDefaultMatch = migrationSql.match(
      /CREATE POLICY "app_runtime_read_platform_defaults" ON platform\.task_capabilities[\s\S]*?;/
    )
    expect(platformDefaultMatch).not.toBeNull()
    expect(platformDefaultMatch![0]).toMatch(/FOR SELECT/)
    expect(platformDefaultMatch![0]).not.toMatch(/WITH CHECK/)
  })

  test("service_role keeps unconditional bypass (service pipelines and the audit process still need full access)", () => {
    const re =
      /CREATE POLICY "service_role_bypass_task_capabilities" ON platform\.task_capabilities\s+FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/
    expect(migrationSql).toMatch(re)
  })

  test("no policy on this table targets the public pseudo-role (the original defect)", () => {
    // "public" as a bare word anywhere in a CREATE POLICY ... TO clause --
    // deliberately checked across the whole file, not just the app_runtime
    // policies above, in case a future edit adds a new policy the same way.
    const policyBlocks = migrationSql.match(/CREATE POLICY[\s\S]*?;/g) ?? []
    expect(policyBlocks.length).toBeGreaterThan(0)
    for (const block of policyBlocks) {
      expect(block).not.toMatch(/\bTO public\b/)
    }
  })
})
