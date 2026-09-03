/// <reference types="bun-types" />
// Tests for the pure helpers of the E-103 from-empty replay harness
// (platform.r43_faults fault_id E103_MIGRATION_REPLAY_EMPTY_DB_BREAK).
//
// The harness's value depends entirely on its output being trustworthy: it
// exists because four previous triage passes reasoned about the migration
// folder instead of running it, and reached three different wrong answers.
// So the parts that decide WHAT gets executed (statement splitting), what
// gets silently altered (the pgvector shim), and how results are reported
// (summarize) are tested directly -- a harness that quietly mangles SQL or
// under-reports failures would be worse than no harness at all.
import { describe, test, expect } from "bun:test"
import {
  splitStatements,
  applyPgvectorShim,
  summarize,
  SUPABASE_BASELINE_SQL,
} from "./replay-migrations-from-empty.mjs"

describe("splitStatements -- must match drizzle-orm's own split", () => {
  test("splits on the breakpoint marker, as generated migrations use", () => {
    expect(splitStatements("CREATE TABLE a();--> statement-breakpoint\nCREATE TABLE b();")).toEqual([
      "CREATE TABLE a();",
      "\nCREATE TABLE b();",
    ])
  })
  test("a hand-authored file with no marker stays ONE multi-statement chunk", () => {
    // Every hand-authored migration in this repo (0003, 0245, ...) is in this
    // shape. Splitting them on semicolons instead would change failure
    // granularity and stop mirroring what db:migrate actually does.
    const sql = "ALTER TABLE x ENABLE ROW LEVEL SECURITY;\nCREATE POLICY p ON x FOR ALL TO r USING (true);"
    expect(splitStatements(sql)).toEqual([sql])
  })
  test("drops empty chunks so a trailing marker does not send an empty command", () => {
    expect(splitStatements("SELECT 1;--> statement-breakpoint\n   \n")).toEqual(["SELECT 1;"])
  })
  test("an empty file yields no statements", () => {
    expect(splitStatements("")).toEqual([])
  })
})

describe("applyPgvectorShim", () => {
  test("rewrites a vector column to real[] and says so", () => {
    const { sql, changes } = applyPgvectorShim(
      "ALTER TABLE compliance.embeddings ADD COLUMN IF NOT EXISTS embedding vector(1536);",
      "0037_x",
    )
    expect(sql).toContain("embedding real[]")
    expect(sql).not.toContain("vector(1536)")
    expect(changes).toHaveLength(1)
    expect(changes[0]).toContain("0037_x")
  })

  test("removes an hnsw index entirely rather than faking one", () => {
    const { sql, changes } = applyPgvectorShim(
      "CREATE INDEX IF NOT EXISTS i ON t USING hnsw (embedding vector_cosine_ops) WITH (m = 16);",
      "0083_x",
    )
    expect(sql).not.toContain("hnsw")
    expect(sql).toContain("pgvector index skipped")
    expect(changes).toHaveLength(1)
  })

  test("removes an ivfflat index too", () => {
    const { changes } = applyPgvectorShim(
      "CREATE INDEX i ON t USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);",
      "0037_x",
    )
    expect(changes).toHaveLength(1)
  })

  test("REGRESSION: leaves migrations with no pgvector usage completely untouched", () => {
    // The shim must be inert on the other 356 files. If it were not, the
    // replay would be testing rewritten SQL rather than the repo's own.
    const original = "CREATE TABLE compliance.foo (id text PRIMARY KEY, name text);"
    const { sql, changes } = applyPgvectorShim(original, "0001_x")
    expect(sql).toBe(original)
    expect(changes).toEqual([])
  })

  test("REGRESSION: does not mangle an unrelated CREATE INDEX", () => {
    const original = "CREATE INDEX idx_foo ON compliance.foo (name);"
    const { sql, changes } = applyPgvectorShim(original, "0002_x")
    expect(sql).toBe(original)
    expect(changes).toEqual([])
  })
})

describe("summarize", () => {
  const failures = [
    { arrayPosition: 3, idx: 3, tag: "0003_rls", statement: 1, statementCount: 1, message: 'relation "compliance.challans" does not exist' },
    { arrayPosition: 5, idx: 5, tag: "0005_hier", statement: 1, statementCount: 1, message: "function compliance.current_org_id() does not exist" },
    { arrayPosition: 6, idx: 6, tag: "0006_grc", statement: 1, statementCount: 1, message: "function compliance.current_org_id() does not exist" },
    { arrayPosition: 6, idx: 6, tag: "0006_grc", statement: 2, statementCount: 2, message: "function compliance.current_org_id() does not exist" },
  ]

  test("counts failing ENTRIES and failing STATEMENTS separately", () => {
    // 0006 fails twice; that is one broken migration, not two. Conflating
    // them would overstate how much of the folder is actually broken.
    const s = summarize(360, failures)
    expect(s.failingEntries).toBe(3)
    expect(s.failingStatements).toBe(4)
    expect(s.passingEntries).toBe(357)
  })

  test("reports the FIRST failure -- the point a real single-transaction run aborts", () => {
    expect(summarize(360, failures).firstFailure?.tag).toBe("0003_rls")
  })

  test("ranks error messages by frequency, which is what identifies the root cause", () => {
    const [top] = summarize(360, failures).topMessages
    expect(top[0]).toBe("function compliance.current_org_id() does not exist")
    expect(top[1]).toBe(3)
  })

  test("a clean replay reports no failures and no first failure", () => {
    const s = summarize(360, [])
    expect(s.failingEntries).toBe(0)
    expect(s.passingEntries).toBe(360)
    expect(s.firstFailure).toBeNull()
  })
})

describe("SUPABASE_BASELINE_SQL", () => {
  test("provides every Supabase-supplied object the migrations reference", () => {
    // These are the objects that exist in a fresh Supabase project but not in
    // drizzle/. Omitting one would produce failures that look like migration
    // defects but are really harness gaps -- the exact miscount this file
    // exists to prevent.
    for (const needed of [
      "CREATE ROLE anon",
      "CREATE ROLE authenticated",
      "CREATE ROLE service_role",
      "CREATE ROLE app_runtime",
      "CREATE SCHEMA IF NOT EXISTS extensions",
      "CREATE SCHEMA IF NOT EXISTS auth",
      "pgcrypto",
      "pg_trgm",
      "auth.users",
      "auth.mfa_factors",
      "auth.mfa_challenges",
      "auth.uid()",
    ]) {
      expect(SUPABASE_BASELINE_SQL).toContain(needed)
    }
  })

  test("creates nothing in the compliance or platform schemas", () => {
    // The baseline must never pre-create anything the migration folder is
    // supposed to build itself, or the replay would prove nothing.
    expect(SUPABASE_BASELINE_SQL).not.toContain("compliance.")
    expect(SUPABASE_BASELINE_SQL).not.toContain("platform.")
  })
})
