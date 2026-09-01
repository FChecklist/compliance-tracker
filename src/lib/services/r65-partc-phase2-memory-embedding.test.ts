// R65 Part C Phase 2: vector embedding layer regression guard
// (drizzle/0523_r65_partc_phase2_memory_embedding.sql).
//
// Same reason as r65-partc-phase1-memory-schema-rls.test.ts and this
// repo's other DB-independent migration tests: there is no live Postgres
// connection available in CI/this sandbox, so this reads the migration SQL
// that ships to production and asserts the exact clauses a live
// `\d compliance.memory_records` / `\di compliance.idx_memory_records_*`
// check would also require.
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
  "0523_r65_partc_phase2_memory_embedding.sql"
)
const migrationSql = readFileSync(migrationPath, "utf8")

describe("R65 Part C Phase 2: compliance.memory_records.embedding column + HNSW index", () => {
  test("adds a vector(1536) embedding column, matching compliance.embeddings/embedding_cache's own dimension", () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE compliance\.memory_records ADD COLUMN IF NOT EXISTS embedding vector\(1536\)/
    )
  })

  test("adds an HNSW / vector_cosine_ops index, matching this repo's own existing HNSW precedent (m=16, ef_construction=64)", () => {
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_hnsw ON compliance\.memory_records\s+USING hnsw \(embedding vector_cosine_ops\) WITH \(m = 16, ef_construction = 64\)/
    )
  })

  test("does not touch memory_sources or memory_versions (Phase 2 is memory_records-only)", () => {
    expect(migrationSql).not.toMatch(/compliance\.memory_sources/)
    expect(migrationSql).not.toMatch(/compliance\.memory_versions/)
  })

  test("is registered in the drizzle migration journal", () => {
    const journalPath = join(import.meta.dir, "..", "..", "..", "drizzle", "meta", "_journal.json")
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] }
    expect(journal.entries.some((e) => e.tag === "0523_r65_partc_phase2_memory_embedding")).toBe(true)
  })
})
