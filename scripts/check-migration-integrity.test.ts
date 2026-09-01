/// <reference types="bun-types" />
// Real automated test for the AR-12 / E-102 migration-integrity check
// (platform.r43_faults fault_id E102_MIGRATION_LEDGER_LINE_ENDING_HASH_SPLIT).
// Proves, against the actual pure functions the CI job calls (no mocked
// internals), that:
//   1. The exact E-102 scenario -- same file content, hashed under a
//      different line-ending convention than what's currently on disk --
//      is correctly recognized as NOT drift.
//   2. A genuinely different file (real content drift, not a line-ending
//      artifact) is correctly caught and reported as a mismatch. This is
//      the "would have caught this exact drift" proof: had the ledger
//      split actually been caused by real content changes instead of line
//      endings, this check would have failed the build on it.
//   3. reconcile()'s surrounding bookkeeping (not-yet-applied entries,
//      documented known exceptions, missing files) behaves correctly, since
//      those are exactly the states real drizzle/*.sql migrations are in
//      today (verified live against platform pcrjmlpuqsbocqfwoxod,
//      2026-08-28: 295 agree, 2 not-yet-applied, 3 known exceptions, 0
//      unexplained mismatches).
import { describe, test, expect } from "bun:test"
import {
  sha256Hex,
  normalizeToLF,
  normalizeToCRLF,
  recordedHashMatchesFile,
  reconcile,
  gitattributesForcesConsistentEol,
} from "./check-migration-integrity.mjs"

describe("gitattributesForcesConsistentEol", () => {
  test("recognizes this repo's actual .gitattributes rule", () => {
    expect(gitattributesForcesConsistentEol("drizzle/*.sql text eol=lf\n")).toBe(true)
  })
  test("recognizes the rule alongside a comment header, any whitespace", () => {
    expect(
      gitattributesForcesConsistentEol("# comment\n\ndrizzle/*.sql   text eol=lf\n\nother/*.ts text\n")
    ).toBe(true)
  })
  test("accepts eol=crlf too -- either explicit convention is a real fix", () => {
    expect(gitattributesForcesConsistentEol("drizzle/*.sql text eol=crlf\n")).toBe(true)
  })
  test("REGRESSION: an empty .gitattributes (file removed or never existed) is flagged", () => {
    expect(gitattributesForcesConsistentEol("")).toBe(false)
  })
  test("REGRESSION: a bare `text` with no eol= does not count -- doesn't force ONE convention", () => {
    expect(gitattributesForcesConsistentEol("drizzle/*.sql text\n")).toBe(false)
  })
  test("REGRESSION: a rule for an unrelated path doesn't count", () => {
    expect(gitattributesForcesConsistentEol("*.sql text eol=lf\nsrc/**/*.ts text eol=lf\n")).toBe(false)
  })
})

const CRLF_CONTENT = "CREATE TABLE foo (\r\n  id serial primary key\r\n);\r\n"
const LF_CONTENT = "CREATE TABLE foo (\n  id serial primary key\n);\n"

describe("normalizeToLF / normalizeToCRLF", () => {
  test("normalizeToLF collapses CRLF to LF", () => {
    expect(normalizeToLF(CRLF_CONTENT)).toBe(LF_CONTENT)
  })
  test("normalizeToLF is a no-op on already-LF content", () => {
    expect(normalizeToLF(LF_CONTENT)).toBe(LF_CONTENT)
  })
  test("normalizeToCRLF expands LF to CRLF", () => {
    expect(normalizeToCRLF(LF_CONTENT)).toBe(CRLF_CONTENT)
  })
  test("normalizeToCRLF is idempotent on already-CRLF content", () => {
    expect(normalizeToCRLF(CRLF_CONTENT)).toBe(CRLF_CONTENT)
  })
})

describe("recordedHashMatchesFile -- the exact E-102 scenario is NOT flagged as drift", () => {
  test("file on disk is CRLF, ledger hash was recorded from an LF checkout -- matches via lf-normalized", () => {
    const recordedHash = sha256Hex(LF_CONTENT) // e.g. a Linux CI runner ran db:migrate
    const result = recordedHashMatchesFile(CRLF_CONTENT, recordedHash) // e.g. this repo's Windows dev checkout
    expect(result.matched).toBe(true)
    expect(result.via).toBe("lf-normalized")
  })

  test("file on disk is LF, ledger hash was recorded from a CRLF checkout -- matches via crlf-normalized", () => {
    const recordedHash = sha256Hex(CRLF_CONTENT) // e.g. a Windows dev checkout ran db:migrate (this repo's actual root cause)
    const result = recordedHashMatchesFile(LF_CONTENT, recordedHash) // e.g. a Linux CI runner's checkout
    expect(result.matched).toBe(true)
    expect(result.via).toBe("crlf-normalized")
  })

  test("file and ledger hash use the same convention -- matches via raw, no normalization needed", () => {
    const recordedHash = sha256Hex(CRLF_CONTENT)
    const result = recordedHashMatchesFile(CRLF_CONTENT, recordedHash)
    expect(result.matched).toBe(true)
    expect(result.via).toBe("raw")
  })
})

describe("recordedHashMatchesFile -- REGRESSION: genuine content drift IS still caught", () => {
  test("a file whose content actually changed (not just line endings) does not match any normalized form", () => {
    const recordedHash = sha256Hex(LF_CONTENT)
    // Same statement, but a real edit: an added NOT NULL column. This is
    // exactly the shape of drift AR-12 exists to catch -- an applied
    // migration whose file no longer reflects what was actually run.
    const drifted = "CREATE TABLE foo (\n  id serial primary key,\n  name text not null\n);\n"
    const result = recordedHashMatchesFile(drifted, recordedHash)
    expect(result.matched).toBe(false)
  })

  test("CRLF-normalizing a genuinely different file still does not produce a false match", () => {
    const recordedHash = sha256Hex(CRLF_CONTENT)
    const drifted = "CREATE TABLE foo (\r\n  id serial primary key,\r\n  extra_column int\r\n);\r\n"
    const result = recordedHashMatchesFile(drifted, recordedHash)
    expect(result.matched).toBe(false)
  })
})

describe("reconcile() -- full pipeline against realistic journal/applied-row/file shapes", () => {
  const journalEntries = [
    { tag: "0001_ok_raw", when: 1000 },
    { tag: "0002_ok_line_ending_only", when: 1001 },
    { tag: "0003_real_drift", when: 1002 },
    { tag: "0004_not_yet_applied", when: 1003 },
    { tag: "0005_known_exception", when: 1004 },
    { tag: "0006_file_missing", when: 1005 },
  ]

  const files: Record<string, string> = {
    "0001_ok_raw": CRLF_CONTENT,
    "0002_ok_line_ending_only": CRLF_CONTENT, // ledger recorded LF, disk has CRLF -- benign
    "0003_real_drift": "ALTER TABLE bar ADD COLUMN totally_different int;\n", // genuinely different from what was recorded
    "0005_known_exception": "post-hoc-corrected content, differs from what was applied\n",
    // 0004 and 0006 deliberately absent / not applicable
  }

  const appliedRowsByCreatedAt = new Map<string, { hash: string }>([
    ["1000", { hash: sha256Hex(CRLF_CONTENT) }], // 0001: exact raw match
    ["1001", { hash: sha256Hex(LF_CONTENT) }], // 0002: E-102-shaped benign line-ending split
    ["1002", { hash: sha256Hex("ALTER TABLE bar ADD COLUMN original int;\n") }], // 0003: real drift
    // 1003 intentionally has no applied row -- "not yet applied"
    ["1004", { hash: sha256Hex("original applied content, since post-hoc corrected\n") }], // 0005
    ["1005", { hash: sha256Hex("irrelevant\n") }], // 0006: file missing on disk
  ])

  const readFile = (tag: string) => {
    if (!(tag in files)) throw new Error(`ENOENT: ${tag}`)
    return files[tag]
  }

  const result = reconcile(journalEntries, appliedRowsByCreatedAt, readFile, new Set(["0005_known_exception"]))

  test("benign raw match is OK", () => {
    expect(result.ok.map((o) => o.tag)).toContain("0001_ok_raw")
  })

  test("the E-102-shaped line-ending-only split is OK, not reported as drift", () => {
    expect(result.ok.map((o) => o.tag)).toContain("0002_ok_line_ending_only")
    const entry = result.ok.find((o) => o.tag === "0002_ok_line_ending_only")
    expect(entry?.via).toBe("lf-normalized")
  })

  test("REGRESSION: genuine content drift is reported as a mismatch, not silently absorbed as a line-ending difference", () => {
    expect(result.mismatched.map((m) => m.tag)).toContain("0003_real_drift")
  })

  test("a journal entry with no applied row yet is 'not yet applied', not a failure", () => {
    expect(result.notYetApplied).toContain("0004_not_yet_applied")
  })

  test("a tag in the known-exceptions allowlist is absorbed, not reported as a new mismatch", () => {
    expect(result.knownExceptionsSeen).toContain("0005_known_exception")
    expect(result.mismatched.map((m) => m.tag)).not.toContain("0005_known_exception")
  })

  test("a missing file (journal entry + applied row exist, but no .sql file) is a mismatch, not silently skipped", () => {
    expect(result.mismatched.map((m) => m.tag)).toContain("0006_file_missing")
  })

  test("exactly one real, unexplained mismatch survives (0003) -- the check's actual pass/fail signal", () => {
    const unexplained = result.mismatched.filter((m) => m.tag !== "0006_file_missing")
    expect(unexplained.map((m) => m.tag)).toEqual(["0003_real_drift"])
  })
})
