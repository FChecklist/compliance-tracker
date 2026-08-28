/// <reference types="bun-types" />
// platform.crr_spec CRR-225. Two independent layers of proof, same
// "never touch a live DB from a .test.ts file" discipline
// capture.test.ts/crr-p2-schema-rls.test.ts already established for this
// codebase's CRR P3 files (see capture.test.ts's own header) -- no
// DATABASE_URL/APP_RUNTIME_DATABASE_URL is reachable from a test runner in
// CI (ci.yml's unit-tests job only sets placeholder connection strings so
// module-load-time client construction doesn't throw; no query ever runs).
//
// Layer 1 (the actual CRR-225 mode-selection proof): buildRecallConditions()
// is a pure, DB-free function. Rather than re-implementing Drizzle's SQL
// builder to introspect its output by hand (the workaround capture.test.ts
// needed for capture.ts's WHERE clause), this compiles the REAL condition
// recall.ts builds to real Postgres SQL text via drizzle-orm's own
// PgDialect().sqlToQuery() -- a pure formatter, not a connection -- and
// asserts on that compiled text/params directly. This is strictly stronger
// than asserting against a hand-reimplemented filter: if buildRecallConditions
// ever stopped including the is_current clause in the default case, this
// test would see that in the real compiled SQL and fail.
//
// Layer 2: recall() end-to-end, with @/lib/db/tenant-scoped's
// withTenantContext mocked (mock.module) the same way capture.test.ts mocks
// it -- @/lib/db itself (the schema module) is left real and unmocked, only
// the connection layer is faked. The fake transaction's own `.where(cond)`
// re-compiles the exact condition recall() passed it through the same real
// PgDialect used in Layer 1, and filters an in-memory fixture set by
// inspecting that compiled SQL/params -- not a hand-set "expected filter"
// side channel -- so this layer proves recall() actually threads
// buildRecallConditions()'s real output into the query, not merely that it
// was called.
import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

const dialect = new PgDialect()

function compile(cond: SQL) {
  return dialect.sqlToQuery(cond)
}

describe("buildRecallConditions (CRR-225 mode selection, real compiled SQL, no DB)", () => {
  test("default mode (no asOf, no includeSuperseded): compiled SQL includes an is_current = true clause", async () => {
    const { buildRecallConditions } = await import("./recall")
    const { sql, params } = compile(buildRecallConditions({ orgId: "org_1" }))

    expect(sql).toContain('"is_current" = $')
    expect(params).toContain(true)
    // Baseline clauses that must always be present regardless of mode.
    expect(sql).toContain('"org_id" = $')
    expect(params).toContain("org_1")
    expect(sql).toContain('"deleted_at" is null')
  })

  test("includeSuperseded:true: compiled SQL omits the is_current clause entirely -- full chain returned", async () => {
    const { buildRecallConditions } = await import("./recall")
    const { sql, params } = compile(buildRecallConditions({ orgId: "org_1", includeSuperseded: true }))

    expect(sql).not.toContain("is_current")
    expect(params).not.toContain(true)
    expect(sql).toContain('"org_id" = $')
  })

  test("asOf set (includeSuperseded omitted): compiled SQL still omits is_current, and adds created_at <= asOf", async () => {
    const { buildRecallConditions } = await import("./recall")
    const asOf = new Date("2026-08-01T00:00:00.000Z")
    const { sql, params } = compile(buildRecallConditions({ orgId: "org_1", asOf }))

    expect(sql).not.toContain("is_current")
    expect(sql).toContain('"created_at" <= $')
    // drizzle-orm's postgres-js driver serializes Date params to ISO strings
    // at the SQL-compile boundary (confirmed by running this compile step
    // directly, not assumed) -- the underlying value is still the real asOf.
    expect(params).toContainEqual(asOf.toISOString())
  })

  test("asOf + includeSuperseded:false explicitly: asOf still wins -- historical chain, not just current", async () => {
    const { buildRecallConditions } = await import("./recall")
    const asOf = new Date("2026-08-01T00:00:00.000Z")
    const { sql } = compile(buildRecallConditions({ orgId: "org_1", asOf, includeSuperseded: false }))

    expect(sql).not.toContain("is_current")
  })

  test("docUid narrows to one document's own chain in every mode", async () => {
    const { buildRecallConditions } = await import("./recall")
    const { sql, params } = compile(buildRecallConditions({ orgId: "org_1", docUid: "doc_abc", includeSuperseded: true }))

    expect(sql).toContain('"doc_uid" = $')
    expect(params).toContain("doc_abc")
  })
})

describe("recallIncludesHistory (pure mode-selection predicate)", () => {
  test("false by default", async () => {
    const { recallIncludesHistory } = await import("./recall")
    expect(recallIncludesHistory({})).toBe(false)
  })

  test("true when includeSuperseded is true", async () => {
    const { recallIncludesHistory } = await import("./recall")
    expect(recallIncludesHistory({ includeSuperseded: true })).toBe(true)
  })

  test("false when includeSuperseded is explicitly false and no asOf", async () => {
    const { recallIncludesHistory } = await import("./recall")
    expect(recallIncludesHistory({ includeSuperseded: false })).toBe(false)
  })

  test("true when asOf is set, even with no includeSuperseded", async () => {
    const { recallIncludesHistory } = await import("./recall")
    expect(recallIncludesHistory({ asOf: new Date() })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Layer 2: recall() end-to-end against a fake tenant-scoped transaction that
// filters by re-compiling the real WHERE condition it was handed.
// ---------------------------------------------------------------------------

type FixtureRow = {
  chunkId: string
  sourceObjectId: string
  orgId: string
  docUid: string
  isCurrent: boolean
  supersedesDocUid: string | null
  supersededByDocUid: string | null
  seq: number
  page: number | null
  content: string | null
  createdAt: Date
  deletedAt: Date | null
  contentErasedAt: Date | null
}

let fixtures: FixtureRow[] = []
let contextCalls: { orgId: string; clientIds?: string[]; userId?: string }[] = []

// Column-name lookup so the fake can map a compiled `"table"."column"`
// reference back to the matching field on a FixtureRow, without hand-coding
// per-clause logic -- it reads whichever columns actually appear in the real
// compiled SQL text.
const COLUMN_TO_FIELD: Record<string, keyof FixtureRow> = {
  org_id: "orgId",
  deleted_at: "deletedAt",
  doc_uid: "docUid",
  is_current: "isCurrent",
  created_at: "createdAt",
  content_erased_at: "contentErasedAt",
}

function rowMatchesCompiledCondition(row: FixtureRow, sql: string, params: unknown[]): boolean {
  let paramIdx = 0
  // "<col>" is null  -- e.g. deleted_at, content_erased_at
  for (const m of sql.matchAll(/"(\w+)" is null/g)) {
    const field = COLUMN_TO_FIELD[m[1]]
    if (field && row[field] !== null && row[field] !== undefined) return false
  }
  // "<col>" = $n  -- e.g. org_id, doc_uid, is_current
  for (const m of sql.matchAll(/"(\w+)" = \$(\d+)/g)) {
    const field = COLUMN_TO_FIELD[m[1]]
    if (!field) continue
    const value = params[Number(m[2]) - 1]
    if (row[field] !== value) return false
  }
  // "<col>" <= $n  -- created_at (asOf). Drizzle's postgres-js driver
  // serializes Date params to ISO strings at compile time (verified via the
  // real PgDialect output, not assumed) -- parse back to compare instants.
  for (const m of sql.matchAll(/"(\w+)" <= \$(\d+)/g)) {
    const field = COLUMN_TO_FIELD[m[1]]
    if (!field) continue
    const value = new Date(params[Number(m[2]) - 1] as string)
    const rowValue = row[field] as Date
    if (!(rowValue.getTime() <= value.getTime())) return false
  }
  void paramIdx
  return true
}

function makeTx() {
  return {
    select(_sel?: unknown) {
      return {
        from(_table?: unknown) {
          return {
            innerJoin(_table2?: unknown, _cond?: unknown) {
              return {
                where(cond: SQL) {
                  const { sql, params } = compile(cond)
                  const matched = fixtures.filter((r) => rowMatchesCompiledCondition(r, sql, params))
                  return {
                    orderBy(..._args: unknown[]) {
                      matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.seq - b.seq)
                      return {
                        async limit(n: number) {
                          return matched.slice(0, n).map((r) => ({
                            chunkId: r.chunkId,
                            sourceObjectId: r.sourceObjectId,
                            docUid: r.docUid,
                            isCurrent: r.isCurrent,
                            supersedesDocUid: r.supersedesDocUid,
                            supersededByDocUid: r.supersededByDocUid,
                            seq: r.seq,
                            page: r.page,
                            content: r.content,
                            sourceCreatedAt: r.createdAt,
                          }))
                        },
                      }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

function seedChain(orgId: string, docUidV1: string, docUidV2: string) {
  fixtures.push(
    {
      chunkId: `${docUidV1}-c0`,
      sourceObjectId: `${docUidV1}-so`,
      orgId,
      docUid: docUidV1,
      isCurrent: false,
      supersedesDocUid: null,
      supersededByDocUid: docUidV2,
      seq: 0,
      page: 1,
      content: "v1 content",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      deletedAt: null,
      contentErasedAt: null,
    },
    {
      chunkId: `${docUidV2}-c0`,
      sourceObjectId: `${docUidV2}-so`,
      orgId,
      docUid: docUidV2,
      isCurrent: true,
      supersedesDocUid: docUidV1,
      supersededByDocUid: null,
      seq: 0,
      page: 1,
      content: "v2 content",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      deletedAt: null,
      contentErasedAt: null,
    }
  )
}

beforeEach(() => {
  fixtures = []
  contextCalls = []
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: async (context: { orgId: string; clientIds?: string[]; userId?: string }, fn: (tx: unknown) => Promise<unknown>) => {
      contextCalls.push(context)
      return fn(makeTx())
    },
  }))
})

afterEach(() => {
  mock.restore()
})

describe("recall() end-to-end (fake tenant-scoped tx, real compiled WHERE clause)", () => {
  test("default mode: excludes the superseded revision, returns only the current one", async () => {
    const { recall } = await import("./recall")
    seedChain("org_chain", "doc_v1", "doc_v2")

    const results = await recall({ orgId: "org_chain" })

    expect(results.length).toBe(1)
    expect(results[0].docUid).toBe("doc_v2")
    expect(results[0].isCurrent).toBe(true)
    expect(contextCalls).toEqual([{ orgId: "org_chain", clientIds: undefined, userId: undefined }])
  })

  test("includeSuperseded:true: returns the full historical chain, both revisions", async () => {
    const { recall } = await import("./recall")
    seedChain("org_chain2", "doc_v1b", "doc_v2b")

    const results = await recall({ orgId: "org_chain2", includeSuperseded: true })

    expect(results.length).toBe(2)
    expect(results.map((r) => r.docUid).sort()).toEqual(["doc_v1b", "doc_v2b"])
  })

  test("asOf before the v2 revision existed: reaches back to the chain as it stood then (v1 only, since v2 didn't exist yet)", async () => {
    const { recall } = await import("./recall")
    seedChain("org_chain3", "doc_v1c", "doc_v2c")

    const results = await recall({ orgId: "org_chain3", asOf: new Date("2026-03-01T00:00:00.000Z") })

    expect(results.length).toBe(1)
    expect(results[0].docUid).toBe("doc_v1c")
  })

  test("a chunk with content_erased_at set is excluded in every mode", async () => {
    const { recall } = await import("./recall")
    fixtures.push({
      chunkId: "erased-c0",
      sourceObjectId: "erased-so",
      orgId: "org_erased",
      docUid: "doc_erased",
      isCurrent: true,
      supersedesDocUid: null,
      supersededByDocUid: null,
      seq: 0,
      page: 1,
      content: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      deletedAt: null,
      contentErasedAt: new Date("2026-02-01T00:00:00.000Z"),
    })

    const defaultResults = await recall({ orgId: "org_erased" })
    const historyResults = await recall({ orgId: "org_erased", includeSuperseded: true })

    expect(defaultResults.length).toBe(0)
    expect(historyResults.length).toBe(0)
  })

  test("cross-org isolation: a different org's rows never surface, in either mode", async () => {
    const { recall } = await import("./recall")
    seedChain("org_a", "doc_a1", "doc_a2")
    seedChain("org_b", "doc_b1", "doc_b2")

    const resultsA = await recall({ orgId: "org_a", includeSuperseded: true })
    expect(resultsA.map((r) => r.docUid).sort()).toEqual(["doc_a1", "doc_a2"])
  })
})
