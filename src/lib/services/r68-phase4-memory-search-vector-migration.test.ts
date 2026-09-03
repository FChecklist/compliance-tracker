/// <reference types="bun-types" />
// R68 Phase 4: asserts the SHAPE of drizzle/0546 against the real file,
// same convention as src/lib/graph/graph-row-cap-migration.test.ts (which
// regex-matches its own migration's text rather than needing a live
// Postgres). The live database was verified separately and directly --
// this test is what keeps the checked-in file from drifting away from what
// was actually applied.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const migrationSql = readFileSync(
  join(process.cwd(), "drizzle", "0546_r68_phase4_memory_records_search_vector.sql"),
  "utf8"
)

describe("drizzle/0546 -- memory_records.search_vector", () => {
  test("adds search_vector as a STORED generated tsvector column", () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE compliance\.memory_records\s+ADD COLUMN IF NOT EXISTS search_vector tsvector\s+GENERATED ALWAYS AS \(to_tsvector\('english'::regconfig, COALESCE\(content, ''::text\)\)\) STORED/
    )
  })

  test("uses the SAME regconfig and COALESCE shape as document_chunk.search_vector, so the same phrase tokenises identically in both corpora", () => {
    // document_chunk.search_vector's live definition, verified against
    // pg_attrdef on pcrjmlpuqsbocqfwoxod:
    //   to_tsvector('english'::regconfig, COALESCE(content, ''::text))
    expect(migrationSql).toContain("to_tsvector('english'::regconfig, COALESCE(content, ''::text))")
  })

  test("creates a GIN index on the new column", () => {
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS memory_records_search_vector_gin\s+ON compliance\.memory_records USING gin \(search_vector\)/
    )
  })

  test("is idempotent (IF NOT EXISTS on both the column and the index)", () => {
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS")
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS")
  })

  test("adds no UPDATE/backfill statement -- a STORED generated column is computed by Postgres itself", () => {
    expect(migrationSql).not.toMatch(/^\s*UPDATE\s+compliance\.memory_records/im)
  })

  test("documents the R-CRR-05 propose-only constraint on the column comment", () => {
    expect(migrationSql).toContain("COMMENT ON COLUMN compliance.memory_records.search_vector")
    expect(migrationSql).toContain("ONLY EXACT MAY EXECUTE")
  })

  test("does not widen what Phase 1's append-only guard permits -- it may DISCUSS the guard in a comment, but must not redefine it", () => {
    // The migration header deliberately reasons about the guard (a STORED
    // generated column is visible to to_jsonb(), so the interaction is a
    // real question worth documenting). What matters is that it never
    // redefines the function, the trigger, or its allowed-keys array.
    expect(migrationSql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+compliance\.fn_memory_records_append_only_guard/i)
    expect(migrationSql).not.toMatch(/DROP\s+FUNCTION[^;]*fn_memory_records_append_only_guard/i)
    expect(migrationSql).not.toMatch(/CREATE\s+TRIGGER\s+trg_memory_records_append_only/i)
    expect(migrationSql).not.toMatch(/DROP\s+TRIGGER[^;]*trg_memory_records_append_only/i)
    expect(migrationSql).not.toMatch(/v_allowed\s*(text\[\])?\s*:=/i)
  })

  test("touches nothing but the new column, its index, and its comment", () => {
    // Strip comment lines; whatever executable SQL remains is the migration's real footprint.
    const executable = migrationSql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
    expect(executable).not.toMatch(/\bDROP\b/i)
    expect(executable).not.toMatch(/\bDELETE\b/i)
    expect(executable).not.toMatch(/\bALTER\s+POLICY\b/i)
    expect(executable).not.toMatch(/\bCREATE\s+POLICY\b/i)
    // The only ALTER TABLE is the ADD COLUMN.
    expect(executable.match(/ALTER TABLE/gi) ?? []).toHaveLength(1)
  })
})
