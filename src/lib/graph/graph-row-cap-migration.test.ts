/// <reference types="bun-types" />
// R68 Phase 2, item 1 (row cap). Same established mechanism as
// r48-six-tenant-tables-rls.test.ts / crr-p2-schema-rls.test.ts /
// sales-pipeline-rls.test.ts: there is no live Postgres connection
// available in CI/this sandbox (no DATABASE_URL / Supabase MCP reachable
// from a test runner here), so this reads the migration SQL that ships to
// production and asserts the exact clauses a live call against
// pcrjmlpuqsbocqfwoxod would also require. The real, live fanout proof
// (seed a node with more children than the cap, confirm exactly
// p_max_rows rows come back) is run directly via the Supabase MCP and
// reported in this PR's description -- it cannot run here for the same
// reason every other live-DB proof in this repo has no CI-runnable twin.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationPath = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "drizzle",
  "0543_r68_phase2_graph_row_cap_and_semantic_edges.sql"
)
const migrationSql = readFileSync(migrationPath, "utf8")

const dropMigrationPath = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "drizzle",
  "0544_r68_phase2_drop_old_traversal_signatures.sql"
)
const dropMigrationSql = readFileSync(dropMigrationPath, "utf8")

describe("R68 Phase 2 item 1: p_max_rows added to all three traversal functions, default 500", () => {
  test("graph_descendants gains p_max_rows integer DEFAULT 500 as a new trailing parameter", () => {
    expect(migrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION platform\.graph_descendants\(p_start text, p_max_depth integer DEFAULT 3, p_exclude_hubs boolean DEFAULT true, p_max_rows integer DEFAULT 500\)/
    )
  })

  test("graph_ancestors gains p_max_rows integer DEFAULT 500 as a new trailing parameter", () => {
    expect(migrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION platform\.graph_ancestors\(p_start text, p_max_depth integer DEFAULT 3, p_exclude_hubs boolean DEFAULT true, p_max_rows integer DEFAULT 500\)/
    )
  })

  test("graph_impact gains p_max_rows integer DEFAULT 500 as a new trailing parameter", () => {
    expect(migrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION platform\.graph_impact\(p_table text, p_max_depth integer DEFAULT 2, p_max_rows integer DEFAULT 500\)/
    )
  })

  test("existing depth-cap parameters (p_max_depth, p_exclude_hubs) are preserved unchanged, not replaced", () => {
    expect(migrationSql).toContain("p_max_depth integer DEFAULT 3, p_exclude_hubs boolean DEFAULT true")
    expect(migrationSql).toContain("p_max_depth integer DEFAULT 2")
  })

  test("all three functions apply LIMIT p_max_rows to their final SELECT", () => {
    const limitCount = (migrationSql.match(/LIMIT p_max_rows/g) ?? []).length
    // descendants + ancestors + impact's own final SELECT = 3. impact's
    // internal call to graph_ancestors also passes p_max_rows through
    // (not counted here -- that's a call-site occurrence, not a LIMIT).
    expect(limitCount).toBeGreaterThanOrEqual(3)
  })

  test("graph_impact passes p_max_rows through to the graph_ancestors() call it wraps", () => {
    expect(migrationSql).toMatch(/graph_ancestors\('table:'\|\|p_table, p_max_depth, true, p_max_rows\)/)
  })

  test("the return signature (TABLE columns) of all three functions is unchanged -- this is a backward-compatible addition, not a redefinition", () => {
    expect(migrationSql).toContain("RETURNS TABLE(node_key text, depth integer, path text[])")
    expect(migrationSql).toContain("RETURNS TABLE(node_key text, depth integer, path text[], via_role text)")
    expect(migrationSql).toContain("RETURNS TABLE(dependent_table text, depth integer, via_column text)")
  })

  test("does not weaken the depth cap while adding the row cap (both guards must coexist)", () => {
    expect(migrationSql).toContain("WHERE w.depth < p_max_depth")
  })
})

describe("R68 Phase 2 items 2+3: edge_type vocabulary documented on the column, not silently dropped", () => {
  test("documents all 7 net-new instance-tier edge_type values", () => {
    for (const edgeType of [
      "person_holds_role",
      "role_made_decision",
      "decision_cites_document",
      "document_has_chunk",
      "supersedes",
      "amends",
      "contradicts",
    ]) {
      expect(migrationSql).toContain(edgeType)
    }
  })

  test("explicitly does not repurpose 'references' for the new semantic meaning", () => {
    expect(migrationSql).toMatch(/Deliberately NOT reusing "references"/)
  })

  test("documents the held_from/held_to attrs shape and the effective_from/effective_to-style window predicate", () => {
    expect(migrationSql).toContain("held_from")
    expect(migrationSql).toContain("held_to")
    expect(migrationSql).toMatch(/attrs->>'held_from'/)
  })

  test("documents constraint_name as the graph_edge_uq discriminator for repeat tenures of the same (person, role) pair", () => {
    expect(migrationSql).toMatch(/constraint_name.*MUST carry a distinguishing value/)
  })

  test("is schema/vocabulary only -- explicitly disclaims a UI or bulk-populate job for this phase", () => {
    expect(migrationSql).toMatch(/SCHEMA\/VOCABULARY ONLY/)
  })
})

describe("R68 Phase 2 follow-up migration (0544): CREATE OR REPLACE cannot add a new parameter to an existing function -- it overloads instead, so the stale pre-p_max_rows signatures must be dropped explicitly", () => {
  test("drops the exact old 3-arg graph_descendants signature", () => {
    expect(dropMigrationSql).toContain("DROP FUNCTION IF EXISTS platform.graph_descendants(text, integer, boolean);")
  })

  test("drops the exact old 3-arg graph_ancestors signature", () => {
    expect(dropMigrationSql).toContain("DROP FUNCTION IF EXISTS platform.graph_ancestors(text, integer, boolean);")
  })

  test("drops the exact old 2-arg graph_impact signature", () => {
    expect(dropMigrationSql).toContain("DROP FUNCTION IF EXISTS platform.graph_impact(text, integer);")
  })

  test("does not drop the new p_max_rows-bearing signatures (no 4-arg or 3-arg-with-p_max_rows DROP present)", () => {
    expect(dropMigrationSql).not.toMatch(/DROP FUNCTION.*p_max_rows/)
  })
})
