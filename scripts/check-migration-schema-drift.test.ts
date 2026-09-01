/// <reference types="bun-types" />
// Real automated test for GAP-MIGRATION-APPLY-NOT-AUTOMATED's schema-drift
// check (ai-os/MASTER-TRACKER.yaml, closed 2026-08-30, R1-R64 recheck).
// Proves, against the actual pure functions the CI job calls (no mocked
// internals), that:
//   1. The parser correctly extracts CREATE TABLE and (multi-clause) ALTER
//      TABLE ADD COLUMN targets -- including the exact shape of the real
//      0264/helpdesk incident's own migration (a single ALTER TABLE with
//      three comma-separated ADD COLUMN clauses).
//   2. A later DROP correctly cancels an earlier ADD, so a legitimately
//      removed table/column is never flagged as drift.
//   3. findDrift() is schema-agnostic on purpose -- a table/column that
//      exists live under a DIFFERENT schema than its migration named (the
//      real, confirmed compliance.worker_agents -> platform.worker_agents
//      move) is not flagged as missing.
//   4. A genuinely missing table/column -- the actual failure mode this
//      check exists to catch -- IS reported.
//   5. Verified against real production data before landing (see this
//      script's own header): 458 expected tables + 356 expected columns
//      parsed from all 305 real migration files in this repo, zero missing
//      live.
import { describe, test, expect } from "bun:test"
import { parseMigrationDdl, computeExpectedArtifacts, findDrift } from "./check-migration-schema-drift.mjs"

describe("parseMigrationDdl", () => {
  test("parses a simple CREATE TABLE, quoted schema.table", () => {
    const ddl = parseMigrationDdl('CREATE TABLE "compliance"."foo" (\n  id text primary key\n);\n')
    expect([...ddl.addedTables]).toEqual(["compliance.foo"])
  })

  test("parses CREATE TABLE IF NOT EXISTS, bare schema.table", () => {
    const ddl = parseMigrationDdl("CREATE TABLE IF NOT EXISTS compliance.foo (\n  id text primary key\n);\n")
    expect([...ddl.addedTables]).toEqual(["compliance.foo"])
  })

  test("REGRESSION: the exact real 0264/helpdesk incident shape -- one ALTER TABLE, three comma-separated ADD COLUMN clauses", () => {
    const sql = `ALTER TABLE compliance.tickets
  ADD COLUMN IF NOT EXISTS team_id text,
  ADD COLUMN IF NOT EXISTS sla_policy_id text,
  ADD COLUMN IF NOT EXISTS requester_email text;

CREATE TABLE IF NOT EXISTS compliance.ticket_teams (
  id text PRIMARY KEY
);
`
    const ddl = parseMigrationDdl(sql)
    expect([...ddl.addedColumns].sort()).toEqual([
      "compliance.tickets.requester_email",
      "compliance.tickets.sla_policy_id",
      "compliance.tickets.team_id",
    ])
    expect([...ddl.addedTables]).toEqual(["compliance.ticket_teams"])
  })

  test("ignores DDL mentioned only inside a SQL comment", () => {
    const ddl = parseMigrationDdl("-- CREATE TABLE compliance.should_not_count (id text);\nALTER TABLE compliance.real_one ADD COLUMN IF NOT EXISTS x text;\n")
    expect([...ddl.addedTables]).toEqual([])
    expect([...ddl.addedColumns]).toEqual(["compliance.real_one.x"])
  })

  test("parses DROP TABLE and DROP COLUMN", () => {
    const ddl = parseMigrationDdl("DROP TABLE IF EXISTS compliance.gone;\nALTER TABLE compliance.foo DROP COLUMN IF EXISTS bar;\n")
    expect([...ddl.droppedTables]).toEqual(["compliance.gone"])
    expect([...ddl.droppedColumns]).toEqual(["compliance.foo.bar"])
  })
})

describe("computeExpectedArtifacts -- replays add/drop in journal order", () => {
  test("a later DROP cancels an earlier ADD -- not flagged as still-expected", () => {
    const entries = [{ tag: "0001_add" }, { tag: "0002_drop" }]
    const files: Record<string, string> = {
      "0001_add": "CREATE TABLE compliance.temp_table (id text);\nALTER TABLE compliance.foo ADD COLUMN IF NOT EXISTS temp_col text;\n",
      "0002_drop": "DROP TABLE compliance.temp_table;\nALTER TABLE compliance.foo DROP COLUMN temp_col;\n",
    }
    const { expectedTables, expectedColumns } = computeExpectedArtifacts(entries, (tag) => files[tag])
    expect(expectedTables.has("compliance.temp_table")).toBe(false)
    expect(expectedColumns.has("compliance.foo.temp_col")).toBe(false)
  })

  test("a table/column added and never dropped stays expected, attributed to the migration that added it", () => {
    const entries = [{ tag: "0001_add" }]
    const files: Record<string, string> = {
      "0001_add": "CREATE TABLE compliance.permanent (id text);\n",
    }
    const { expectedTables } = computeExpectedArtifacts(entries, (tag) => files[tag])
    expect(expectedTables.get("compliance.permanent")).toBe("0001_add")
  })
})

describe("findDrift -- schema-agnostic matching (the real worker_agents case)", () => {
  test("REGRESSION: a table that legitimately relocated to a different live schema is NOT flagged as missing", () => {
    // compliance.worker_agents was migrated as such, but confirmed live
    // (2026-08-30) to now actually live at platform.worker_agents -- a
    // real, deliberate schema move (same class as the already-documented
    // product_branches move), not drift.
    const expectedTables = new Map([["compliance.worker_agents", "0013_wave16_worker_agent_governance"]])
    const expectedColumns = new Map([["compliance.worker_agents.lifecycle_status", "0013_wave16_worker_agent_governance"]])
    const liveTables = new Set(["worker_agents"]) // bare name, as queried live -- lives under platform now
    const liveColumns = new Set(["worker_agents.lifecycle_status"])
    const { missingTables, missingColumns } = findDrift(expectedTables, expectedColumns, liveTables, liveColumns)
    expect(missingTables).toEqual([])
    expect(missingColumns).toEqual([])
  })

  test("a genuinely missing table -- the real failure mode this check exists to catch -- IS reported", () => {
    const expectedTables = new Map([["compliance.ticket_teams", "0264_helpdesk_tiered_sla_team_routing"]])
    const liveTables = new Set([]) // never actually created live, despite the ledger saying applied
    const { missingTables } = findDrift(expectedTables, new Map(), liveTables, new Set())
    expect(missingTables).toEqual([{ table: "compliance.ticket_teams", tag: "0264_helpdesk_tiered_sla_team_routing" }])
  })

  test("a genuinely missing column is reported the same way", () => {
    const expectedColumns = new Map([["compliance.tickets.team_id", "0264_helpdesk_tiered_sla_team_routing"]])
    const { missingColumns } = findDrift(new Map(), expectedColumns, new Set(), new Set())
    expect(missingColumns).toEqual([{ column: "compliance.tickets.team_id", tag: "0264_helpdesk_tiered_sla_team_routing" }])
  })

  test("a documented known exception is not reported even if missing live", () => {
    const expectedTables = new Map([["compliance.intentionally_removed", "0099_some_migration"]])
    const { missingTables } = findDrift(expectedTables, new Map(), new Set(), new Set(), new Set(["compliance.intentionally_removed"]))
    expect(missingTables).toEqual([])
  })
})
