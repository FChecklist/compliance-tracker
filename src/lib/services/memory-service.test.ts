/// <reference types="bun-types" />
// R65 Part C Phase 2: unit tests for src/lib/services/memory-service.ts.
//
// Same "mock the DB layer only" convention as
// instruction-execution-cache-service.test.ts's makeQueueDb() (a
// queue-based fake standing in for the caller's own withTenantContext
// `tx`) combined with llm-response-cache.test.ts's mock.module("@/lib/db",
// ...) shape (memory-service.ts's embedAndMirror() reads back from
// compliance.embeddings through the bypass-RLS `db` export, a SEPARATE
// connection from `tx` -- see memory-service.ts's own header for why).
// `storeEmbedding`/`generateEmbedding` are swapped via mock.module the
// same way findPriorExecutionPath's own tests swap generateEmbedding.
//
// No live Postgres connection is available in this sandbox/CI (same
// reasoning as r65-partc-phase1-memory-schema-rls.test.ts and every other
// DB-independent test in this repo) -- these tests exercise this file's
// real branching logic (guards, row mapping, call sequencing, error
// propagation) against fake DB responses, not a live schema.
import { describe, expect, test, mock, beforeEach } from "bun:test"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { createHash } from "crypto"

// Real sha256 of the trimmed content -- matches memory-service.ts's own
// `createHash("sha256").update(trimmedContent).digest("hex")` exactly, so
// the byte-identical-content no-op tests below exercise the real
// comparison rather than a hand-typed hash that happens to look right.
function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

const NOW = new Date("2026-09-01T00:00:00.000Z")

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    scope_type: "ORGANIZATION",
    scope_id: null,
    org_id: "org-1",
    user_id: null,
    industry_id: null,
    project_id: null,
    task_id: null,
    memory_type: "FACT",
    content: "the sky is blue",
    content_hash: "hash-1",
    confidence: "0.9",
    provenance_type: "USER_CONFIRMED",
    lifecycle_state: "CANDIDATE",
    source_type: null,
    source_id: null,
    registry_ref: null,
    metadata: {},
    version: 1,
    superseded_by_id: null,
    effective_from: NOW,
    effective_to: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

// Queue-based fake tx.execute() -- same shape as instruction-execution-
// cache-service.test.ts's makeQueueDb().
function makeQueueTx(responses: unknown[][]) {
  let i = 0
  const calls: unknown[] = []
  const execute = mock(async (q: unknown) => {
    calls.push(q)
    const r = responses[i] ?? []
    i += 1
    return r
  })
  return { tx: { execute } as unknown as TenantDb, calls }
}

function mockEmbeddingsModule(opts: { storeEmbedding?: ReturnType<typeof mock>; generateEmbedding?: ReturnType<typeof mock> }) {
  mock.module("@/lib/embeddings", () => ({
    storeEmbedding: opts.storeEmbedding ?? mock(async () => {}),
    generateEmbedding: opts.generateEmbedding ?? mock(async () => [0.1, 0.2, 0.3]),
  }))
}

function mockDbModule(executeImpl?: ReturnType<typeof mock>) {
  mock.module("@/lib/db", () => ({
    db: { execute: executeImpl ?? mock(async () => [{ embedding: "[0.1,0.2,0.3]" }]) },
  }))
}

beforeEach(() => {
  mock.restore()
})

describe("createMemoryRecord", () => {
  test("rejects a GLOBAL/INDUSTRY scopeType without touching the database", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([])

    await expect(
      createMemoryRecord(tx, "org-1", {
        // @ts-expect-error -- deliberately passing an excluded scope type to test the runtime guard
        scopeType: "GLOBAL",
        memoryType: "FACT",
        content: "platform-wide fact",
        provenanceType: "SYSTEM_DERIVED",
      })
    ).rejects.toThrow(/admin\/service_role-only path/)
  })

  test("rejects empty content", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([])

    await expect(
      createMemoryRecord(tx, "org-1", {
        scopeType: "ORGANIZATION",
        memoryType: "FACT",
        content: "   ",
        provenanceType: "SYSTEM_DERIVED",
      })
    ).rejects.toThrow(/content must not be empty/)
  })

  test("rejects a missing orgId", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([])

    await expect(
      createMemoryRecord(tx, "", {
        scopeType: "ORGANIZATION",
        memoryType: "FACT",
        content: "some fact",
        provenanceType: "SYSTEM_DERIVED",
      })
    ).rejects.toThrow(/orgId is required/)
  })

  test("happy path: inserts the record, mirrors the embedding, and returns the mapped row", async () => {
    const storeEmbedding = mock(async () => {})
    const dbExecute = mock(async () => [{ embedding: "[0.1,0.2,0.3]" }])
    mockEmbeddingsModule({ storeEmbedding })
    mockDbModule(dbExecute)
    const { createMemoryRecord } = await import("./memory-service")

    // responses[0] = INSERT ... RETURNING * ; responses[1] = UPDATE embedding mirror (return value unused)
    const { tx, calls } = makeQueueTx([[rawRow()], []])

    const result = await createMemoryRecord(tx, "org-1", {
      scopeType: "ORGANIZATION",
      memoryType: "FACT",
      content: "the sky is blue",
      provenanceType: "USER_CONFIRMED",
      confidence: 0.9,
    })

    expect(result.id).toBe("mem-1")
    expect(result.orgId).toBe("org-1")
    expect(result.confidence).toBe(0.9)
    expect(result.version).toBe(1)
    expect(result.lifecycleState).toBe("CANDIDATE")

    expect(storeEmbedding).toHaveBeenCalledTimes(1)
    expect(storeEmbedding).toHaveBeenCalledWith("memory_record", "mem-1", "the sky is blue", "org-1")
    expect(dbExecute).toHaveBeenCalledTimes(1) // the compliance.embeddings read-back
    expect(calls.length).toBe(2) // INSERT memory_records + UPDATE embedding mirror, no source given
  })

  test("also writes a memory_sources row when `source` is supplied", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")

    // responses[0] = INSERT memory_records RETURNING *; [1] = INSERT memory_sources; [2] = UPDATE embedding mirror
    const { tx, calls } = makeQueueTx([[rawRow()], [], []])

    await createMemoryRecord(tx, "org-1", {
      scopeType: "CONVERSATION",
      memoryType: "CONTEXT",
      content: "user prefers dark mode",
      provenanceType: "USER_CONFIRMED",
      source: { sourceKind: "CONVERSATION", conversationId: "conv-1" },
    })

    expect(calls.length).toBe(3)
  })

  test("propagates storeEmbedding's throw (no real embedding provider) without swallowing it", async () => {
    const storeEmbedding = mock(async () => {
      throw new Error("storeEmbedding: no real embedding provider available")
    })
    mockEmbeddingsModule({ storeEmbedding })
    const dbExecute = mock(async () => [])
    mockDbModule(dbExecute)
    const { createMemoryRecord } = await import("./memory-service")

    const { tx, calls } = makeQueueTx([[rawRow()]])

    await expect(
      createMemoryRecord(tx, "org-1", {
        scopeType: "ORGANIZATION",
        memoryType: "FACT",
        content: "some fact",
        provenanceType: "SYSTEM_DERIVED",
      })
    ).rejects.toThrow(/no real embedding provider available/)

    // The record insert itself already ran (1 call); the embedding mirror
    // UPDATE must never run since storeEmbedding threw first.
    expect(calls.length).toBe(1)
    expect(dbExecute).not.toHaveBeenCalled()
  })

  test("throws a clear error if storeEmbedding succeeds but the row can't be read back", async () => {
    mockEmbeddingsModule({ storeEmbedding: mock(async () => {}) })
    mockDbModule(mock(async () => [])) // no row found
    const { createMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow()]])

    await expect(
      createMemoryRecord(tx, "org-1", {
        scopeType: "ORGANIZATION",
        memoryType: "FACT",
        content: "some fact",
        provenanceType: "SYSTEM_DERIVED",
      })
    ).rejects.toThrow(/no matching row was found in compliance\.embeddings/)
  })
})

describe("searchMemories", () => {
  test("returns [] for a blank query without touching generateEmbedding or the database", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mockEmbeddingsModule({ generateEmbedding })
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([])

    const result = await searchMemories(tx, "   ")

    expect(result).toEqual([])
    expect(generateEmbedding).not.toHaveBeenCalled()
    expect(calls.length).toBe(0)
  })

  test("happy path: embeds the query and returns mapped, scored matches", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mockEmbeddingsModule({ generateEmbedding })
    mockDbModule()
    const { searchMemories } = await import("./memory-service")

    const { tx, calls } = makeQueueTx([[{ ...rawRow(), score: 0.87 }]])

    const results = await searchMemories(tx, "what color is the sky?", { limit: 5 })

    expect(generateEmbedding).toHaveBeenCalledTimes(1)
    expect(generateEmbedding).toHaveBeenCalledWith("what color is the sky?")
    expect(calls.length).toBe(1)
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("mem-1")
    expect(results[0].score).toBe(0.87)
    expect(results[0].content).toBe("the sky is blue")
  })

  test("returns [] when nothing in memory_records matches", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx } = makeQueueTx([[]])

    const results = await searchMemories(tx, "an entirely novel query")
    expect(results).toEqual([])
  })

  // R65 Part C Phase 3: cross-user USER-scope memory isolation. Real gap
  // this option closes -- see SearchMemoriesOptions.requestingUserId's own
  // header comment. Asserting on the compiled SQL text (not just that a
  // result came back) because a query-shape regression here is exactly the
  // kind of silent cross-user leak that would otherwise pass every other
  // assertion in this file.
  test("requestingUserId adds the scope_type<>'USER' OR user_id=<id> guard clause to the query", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "what did the user ask for last time?", { requestingUserId: "user-1" })

    expect(calls.length).toBe(1)
    // Drizzle's sql`` template exposes its compiled fragments via
    // queryChunks (verified directly against this repo's drizzle-orm
    // version) -- asserting on the actual guard-clause TEXT and the actual
    // bound parameter VALUE, not merely that "user_id" appears somewhere
    // (it always does, in the SELECT column list, whether or not this
    // option is set -- a weaker assertion would pass even with the filter
    // silently missing).
    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("scope_type <> 'USER' OR user_id =")
    expect(sqlText).toContain("user-1")
  })

  test("omitting requestingUserId compiles no scope_type<>'USER' guard clause at all", async () => {
    mockEmbeddingsModule({})
    const dbExecute = mock(async () => [{ embedding: "[0.1,0.2,0.3]" }])
    mockDbModule(dbExecute)
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[{ ...rawRow(), score: 0.5 }]])

    const results = await searchMemories(tx, "a query with no user scoping")

    expect(calls.length).toBe(1)
    expect(results).toHaveLength(1)
    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).not.toContain("scope_type <> 'USER'")
  })
})

describe("supersedeMemoryRecord", () => {
  test("not-found id throws (unknown id or filtered out by RLS -- indistinguishable, both fail closed)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { supersedeMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[]]) // SELECT existing row -> empty

    await expect(
      supersedeMemoryRecord(tx, "missing-id", "new content", { type: "USER" })
    ).rejects.toThrow(/not found/)
  })

  test("refuses to supersede an already-superseded record", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { supersedeMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ lifecycle_state: "SUPERSEDED", superseded_by_id: "mem-2" })]])

    await expect(
      supersedeMemoryRecord(tx, "mem-1", "new content", { type: "SYSTEM" })
    ).rejects.toThrow(/already been superseded/)
  })

  test("refuses a GLOBAL/INDUSTRY (org_id NULL) row", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { supersedeMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ org_id: null, scope_type: "GLOBAL" })]])

    await expect(
      supersedeMemoryRecord(tx, "mem-1", "new content", { type: "SYSTEM" })
    ).rejects.toThrow(/admin\/service_role-only path/)
  })

  test("rejects empty new content", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { supersedeMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([])

    await expect(
      supersedeMemoryRecord(tx, "mem-1", "  ", { type: "USER" })
    ).rejects.toThrow(/newContent must not be empty/)
  })

  test("happy path: snapshots old content, inserts a new row with incremented version, marks the old row superseded", async () => {
    const storeEmbedding = mock(async () => {})
    mockEmbeddingsModule({ storeEmbedding })
    mockDbModule(mock(async () => [{ embedding: "[0.1,0.2,0.3]" }]))
    const { supersedeMemoryRecord } = await import("./memory-service")

    const oldRow = rawRow({ version: 3 })
    const newRow = rawRow({ id: "mem-2", version: 4, content: "the sky is actually cyan", lifecycle_state: "ACTIVE" })

    // [0] SELECT old row; [1] INSERT memory_versions; [2] INSERT new memory_records RETURNING *;
    // [3] UPDATE old row superseded; [4] UPDATE embedding mirror on new row.
    const { tx, calls } = makeQueueTx([[oldRow], [], [newRow], [], []])

    const result = await supersedeMemoryRecord(tx, "mem-1", "the sky is actually cyan", {
      type: "AI",
      reason: "corrected by a later observation",
    })

    expect(result.next.id).toBe("mem-2")
    expect(result.next.version).toBe(4)
    expect(result.next.content).toBe("the sky is actually cyan")
    expect(result.previous.lifecycleState).toBe("SUPERSEDED")
    expect(result.previous.supersededById).toBe("mem-2")

    expect(storeEmbedding).toHaveBeenCalledWith("memory_record", "mem-2", "the sky is actually cyan", "org-1")
    // SELECT old row, INSERT memory_versions, INSERT new memory_records,
    // UPDATE old row -> SUPERSEDED, UPDATE new row's embedding mirror.
    expect(calls.length).toBe(5)
  })

  test("byte-identical content is a true no-op: zero writes beyond the initial SELECT, zero embedding-provider call, next === previous", async () => {
    const storeEmbedding = mock(async () => {})
    mockEmbeddingsModule({ storeEmbedding })
    const dbExecute = mock(async () => [{ embedding: "[0.1,0.2,0.3]" }])
    mockDbModule(dbExecute)
    const { supersedeMemoryRecord } = await import("./memory-service")

    const oldRow = rawRow({ content: "the sky is blue", content_hash: sha256("the sky is blue"), version: 3 })
    // Only response queued is the initial SELECT -- if the fix regresses
    // and the function tries to INSERT/UPDATE anyway, makeQueueTx's `[]`
    // fallback for exhausted responses would silently return an empty
    // RawMemoryRecordRow[], and `mapMemoryRecordRow(insertedNewRows[0])`
    // would throw on `undefined` -- so a regression here fails loudly.
    const { tx, calls } = makeQueueTx([[oldRow]])

    const result = await supersedeMemoryRecord(tx, "mem-1", "the sky is blue", { type: "USER" })

    expect(result.next).toEqual(result.previous)
    expect(result.previous.content).toBe("the sky is blue")
    expect(result.previous.lifecycleState).toBe("CANDIDATE") // unchanged -- never touched
    expect(calls.length).toBe(1) // only the initial SELECT
    expect(storeEmbedding).not.toHaveBeenCalled()
    expect(dbExecute).not.toHaveBeenCalled() // embedAndMirror() never runs
  })

  test("content that only differs by surrounding whitespace is still a no-op after trimming", async () => {
    const storeEmbedding = mock(async () => {})
    mockEmbeddingsModule({ storeEmbedding })
    mockDbModule()
    const { supersedeMemoryRecord } = await import("./memory-service")

    const oldRow = rawRow({ content: "the sky is blue", content_hash: sha256("the sky is blue") })
    const { tx, calls } = makeQueueTx([[oldRow]])

    const result = await supersedeMemoryRecord(tx, "mem-1", "  the sky is blue  \n", { type: "USER" })

    expect(result.next).toEqual(result.previous)
    expect(calls.length).toBe(1)
    expect(storeEmbedding).not.toHaveBeenCalled()
  })

  test("an already-superseded row still throws even when the new content is byte-identical to its old content (guards run before the no-op check)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { supersedeMemoryRecord } = await import("./memory-service")

    const oldRow = rawRow({
      content: "the sky is blue",
      content_hash: sha256("the sky is blue"),
      lifecycle_state: "SUPERSEDED",
      superseded_by_id: "mem-2",
    })
    const { tx } = makeQueueTx([[oldRow]])

    await expect(
      supersedeMemoryRecord(tx, "mem-1", "the sky is blue", { type: "USER" })
    ).rejects.toThrow(/already been superseded/)
  })
})

describe("promoteMemoryRecord", () => {
  test("not-found id throws (unknown id or filtered out by RLS)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[]])

    await expect(
      promoteMemoryRecord(tx, "missing-id", "CONFIRMED", { type: "USER" })
    ).rejects.toThrow(/not found/)
  })

  test("refuses a GLOBAL/INDUSTRY (org_id NULL) row", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ org_id: null, scope_type: "GLOBAL" })]])

    await expect(
      promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { type: "SYSTEM" })
    ).rejects.toThrow(/admin\/service_role-only path/)
  })

  test("CANDIDATE -> CONFIRMED: legal single-step promotion succeeds", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE" })],
      [rawRow({ lifecycle_state: "CONFIRMED" })],
    ])

    const result = await promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { type: "USER", id: "user-1" })

    expect(result.lifecycleState).toBe("CONFIRMED")
    expect(calls.length).toBe(2) // SELECT + UPDATE
    const updateSql = JSON.stringify(calls[1])
    expect(updateSql).toContain("CONFIRMED")
    expect(updateSql).toContain("lifecycleHistory")
  })

  test("TRANSIENT -> CANDIDATE: legal single-step promotion succeeds", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([
      [rawRow({ lifecycle_state: "TRANSIENT" })],
      [rawRow({ lifecycle_state: "CANDIDATE" })],
    ])

    const result = await promoteMemoryRecord(tx, "mem-1", "CANDIDATE", { type: "SYSTEM" })
    expect(result.lifecycleState).toBe("CANDIDATE")
  })

  test("CONFIRMED -> ACTIVE: legal single-step promotion succeeds", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([
      [rawRow({ lifecycle_state: "CONFIRMED" })],
      [rawRow({ lifecycle_state: "ACTIVE" })],
    ])

    const result = await promoteMemoryRecord(tx, "mem-1", "ACTIVE", { type: "AI", reason: "repeated successful use" })
    expect(result.lifecycleState).toBe("ACTIVE")
  })

  test("rejects a skip-level promotion (CANDIDATE -> ACTIVE)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[rawRow({ lifecycle_state: "CANDIDATE" })]])

    await expect(
      promoteMemoryRecord(tx, "mem-1", "ACTIVE", { type: "USER" })
    ).rejects.toThrow(/only legal next state is CONFIRMED, not ACTIVE/)
    expect(calls.length).toBe(1) // SELECT only, no UPDATE issued
  })

  test("rejects a backward/same-state promotion (ACTIVE -> CONFIRMED)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ lifecycle_state: "ACTIVE" })]])

    await expect(
      promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { type: "USER" })
    ).rejects.toThrow(/has no further promotion/)
  })

  test("rejects promoting an already-SUPERSEDED record", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ lifecycle_state: "SUPERSEDED", superseded_by_id: "mem-2" })]])

    await expect(
      promoteMemoryRecord(tx, "mem-1", "ACTIVE", { type: "USER" })
    ).rejects.toThrow(/has no further promotion/)
  })

  test("rejects promoting an already-ARCHIVED record", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ lifecycle_state: "ARCHIVED" })]])

    await expect(
      promoteMemoryRecord(tx, "mem-1", "CANDIDATE", { type: "USER" })
    ).rejects.toThrow(/has no further promotion/)
  })

  test("preserves existing metadata keys while appending lifecycleHistory", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE", metadata: { existingKey: "keepMe" } })],
      [rawRow({ lifecycle_state: "CONFIRMED" })],
    ])

    await promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { type: "USER", id: "user-1", reason: "user confirmed it" })

    const updateSql = JSON.stringify(calls[1])
    expect(updateSql).toContain("existingKey")
    expect(updateSql).toContain("keepMe")
    expect(updateSql).toContain("user confirmed it")
  })
})

describe("archiveMemoryRecord", () => {
  test("not-found id throws (unknown id or filtered out by RLS)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[]])

    await expect(archiveMemoryRecord(tx, "missing-id", { type: "USER" })).rejects.toThrow(/not found/)
  })

  test("refuses a GLOBAL/INDUSTRY (org_id NULL) row", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ org_id: null, scope_type: "INDUSTRY" })]])

    await expect(archiveMemoryRecord(tx, "mem-1", { type: "SYSTEM" })).rejects.toThrow(/admin\/service_role-only path/)
  })

  test("refuses to archive an already-archived record (idempotency guard)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow({ lifecycle_state: "ARCHIVED" })]])

    await expect(archiveMemoryRecord(tx, "mem-1", { type: "USER" })).rejects.toThrow(/already ARCHIVED/)
  })

  test("archives a CANDIDATE record directly, without requiring CONFIRMED/ACTIVE first", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE", effective_to: null })],
      [rawRow({ lifecycle_state: "ARCHIVED" })],
    ])

    const result = await archiveMemoryRecord(tx, "mem-1", { type: "USER", reason: "rejected AI inference" })

    expect(result.lifecycleState).toBe("ARCHIVED")
    expect(calls.length).toBe(2)
    const updateSql = JSON.stringify(calls[1])
    expect(updateSql).toContain("ARCHIVED")
    expect(updateSql).toContain("COALESCE")
  })

  test("archives an ACTIVE record", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([
      [rawRow({ lifecycle_state: "ACTIVE" })],
      [rawRow({ lifecycle_state: "ARCHIVED" })],
    ])

    const result = await archiveMemoryRecord(tx, "mem-1", { type: "AI", reason: "no longer relevant" })
    expect(result.lifecycleState).toBe("ARCHIVED")
  })

  test("archives an already-SUPERSEDED record (retention cleanup)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([
      [rawRow({ lifecycle_state: "SUPERSEDED", superseded_by_id: "mem-2" })],
      [rawRow({ lifecycle_state: "ARCHIVED" })],
    ])

    const result = await archiveMemoryRecord(tx, "mem-1", { type: "SYSTEM" })
    expect(result.lifecycleState).toBe("ARCHIVED")
  })
})
