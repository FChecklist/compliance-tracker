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
    is_personal: false,
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

  // R68 Phase 3 (IMG-012): DEPARTMENT is an ordinary org-scoped write, same
  // as ORGANIZATION/USER/etc -- not an admin/service_role-only path.
  test("supports DEPARTMENT scopeType when a scopeId (department id) is given", async () => {
    const storeEmbedding = mock(async () => {})
    mockEmbeddingsModule({ storeEmbedding })
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[rawRow({ scope_type: "DEPARTMENT", scope_id: "dept-1" })], []])

    const result = await createMemoryRecord(tx, "org-1", {
      scopeType: "DEPARTMENT",
      scopeId: "dept-1",
      memoryType: "ORGANIZATION_INSTRUCTION",
      content: "engineering standup is at 10am",
      provenanceType: "USER_CONFIRMED",
    })

    expect(result.scopeType).toBe("DEPARTMENT")
    expect(result.scopeId).toBe("dept-1")
    expect(calls.length).toBe(2)
  })

  test("rejects DEPARTMENT scopeType without a scopeId, without touching the database", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([])

    await expect(
      createMemoryRecord(tx, "org-1", {
        scopeType: "DEPARTMENT",
        memoryType: "ORGANIZATION_INSTRUCTION",
        content: "engineering standup is at 10am",
        provenanceType: "USER_CONFIRMED",
      })
    ).rejects.toThrow(/DEPARTMENT-scoped memory requires scopeId/)
    expect(calls.length).toBe(0)
  })

  // R68 Phase 3 (IMG-014 / CRR-234): the input-level mirror of
  // memory_records_personal_requires_user_scope_check.
  test("rejects isPersonal on a non-USER scopeType, without touching the database", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([])

    await expect(
      createMemoryRecord(tx, "org-1", {
        scopeType: "ORGANIZATION",
        memoryType: "FACT",
        content: "org-wide fact",
        provenanceType: "USER_CONFIRMED",
        isPersonal: true,
      })
    ).rejects.toThrow(/isPersonal is only legal for a USER-scoped memory with a userId/)
    expect(calls.length).toBe(0)
  })

  test("rejects isPersonal on USER scopeType without a userId", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([])

    await expect(
      createMemoryRecord(tx, "org-1", {
        scopeType: "USER",
        memoryType: "PREFERENCE",
        content: "prefers dark mode",
        provenanceType: "USER_CONFIRMED",
        isPersonal: true,
      })
    ).rejects.toThrow(/isPersonal is only legal for a USER-scoped memory with a userId/)
    expect(calls.length).toBe(0)
  })

  test("accepts isPersonal on a USER-scoped record with a userId, and persists it in the INSERT", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[rawRow({ scope_type: "USER", user_id: "user-9", is_personal: true })], []])

    const result = await createMemoryRecord(tx, "org-1", {
      scopeType: "USER",
      userId: "user-9",
      memoryType: "PREFERENCE",
      content: "please always address me as ma'am",
      provenanceType: "USER_CONFIRMED",
      isPersonal: true,
    })

    expect(result.isPersonal).toBe(true)
    // The real INSERT text must actually carry the true value through as a
    // bound parameter -- a passing input-level guard with no matching
    // column write would be a guard that lies about what it protects.
    // drizzle-orm's sql`` tag interleaves literal StringChunks with bound
    // parameter values in `queryChunks`; a bound boolean parameter shows up
    // as the raw JS value `true`, not a chunk object.
    const insertCall = calls[0] as { queryChunks: unknown[] }
    expect(insertCall.queryChunks).toContain(true)
  })

  test("defaults isPersonal to false when omitted (exact pre-R68 behavior)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { createMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[rawRow()], []])

    const result = await createMemoryRecord(tx, "org-1", {
      scopeType: "ORGANIZATION",
      memoryType: "FACT",
      content: "some fact",
      provenanceType: "SYSTEM_DERIVED",
    })

    expect(result.isPersonal).toBe(false)
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

// R68 Phase 3 (IMG-013): the ONE scope resolver's precedence order,
// GLOBAL -> ORGANIZATION -> DEPARTMENT -> USER, most specific wins.
// resolveMostSpecific() is tested directly against real, hand-built
// multi-row fixtures (not mocked DB calls) -- it is a pure function over
// already-fetched candidates, so this proves the actual precedence
// decision, not just that some SQL WHERE clause was constructed.
describe("resolveMostSpecific", () => {
  // resolveMostSpecific() is a pure function (no embeddings/db I/O), but
  // it lives in the same module as everything else in this file, so it is
  // imported the same dynamic way every other describe block here uses --
  // consistent with this file's own "mock the DB layer only" convention
  // rather than assuming module-load order across describe blocks.
  let resolveMostSpecific: (typeof import("./memory-service"))["resolveMostSpecific"]
  beforeEach(async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    ;({ resolveMostSpecific } = await import("./memory-service"))
  })

  // Builds a candidate directly in ResolvedMemoryRecord shape (mapped +
  // ranked), the same shape resolveMemoryScope() itself hands to this
  // function -- a real fixture, not a bare assertion on the ranking table.
  function candidate(overrides: Partial<import("./memory-service").ResolvedMemoryRecord>): import("./memory-service").ResolvedMemoryRecord {
    const scopeType = (overrides.scopeType ?? "GLOBAL") as "GLOBAL" | "ORGANIZATION" | "DEPARTMENT" | "USER"
    const rank = { GLOBAL: 0, ORGANIZATION: 1, DEPARTMENT: 2, USER: 3 }[scopeType]
    return {
      id: `mem-${scopeType}`,
      scopeType,
      scopeId: null,
      orgId: "org-1",
      userId: null,
      industryId: null,
      projectId: null,
      taskId: null,
      memoryType: "PREFERENCE",
      content: `${scopeType} content`,
      contentHash: `hash-${scopeType}`,
      confidence: null,
      provenanceType: "USER_CONFIRMED",
      lifecycleState: "ACTIVE",
      sourceType: null,
      sourceId: null,
      registryRef: "pref:greeting",
      metadata: {},
      version: 1,
      supersededById: null,
      isPersonal: false,
      effectiveFrom: NOW,
      effectiveTo: null,
      createdAt: NOW,
      updatedAt: NOW,
      scopeRank: rank,
      ...overrides,
    }
  }

  test("real multi-row fixture: GLOBAL, ORGANIZATION, DEPARTMENT and USER rows for the SAME key -- USER wins", () => {
    const global = candidate({ scopeType: "GLOBAL" })
    const org = candidate({ scopeType: "ORGANIZATION" })
    const dept = candidate({ scopeType: "DEPARTMENT", scopeId: "dept-1" })
    const user = candidate({ scopeType: "USER", userId: "user-1" })

    const result = resolveMostSpecific([global, org, dept, user])

    expect(result).toHaveLength(1)
    expect(result[0].scopeType).toBe("USER")
    expect(result[0].id).toBe(user.id)
  })

  test("IMG-013's own gate: a user in a department gets the department row above the org row (no USER row present)", () => {
    const global = candidate({ scopeType: "GLOBAL" })
    const org = candidate({ scopeType: "ORGANIZATION" })
    const dept = candidate({ scopeType: "DEPARTMENT", scopeId: "dept-1" })

    const result = resolveMostSpecific([global, org, dept])

    expect(result).toHaveLength(1)
    expect(result[0].scopeType).toBe("DEPARTMENT")
  })

  test("DEPARTMENT row loses to a USER row for the same key (department is below the user's own)", () => {
    const dept = candidate({ scopeType: "DEPARTMENT", scopeId: "dept-1" })
    const user = candidate({ scopeType: "USER", userId: "user-1" })

    const result = resolveMostSpecific([dept, user])

    expect(result).toHaveLength(1)
    expect(result[0].scopeType).toBe("USER")
  })

  test("ORGANIZATION beats GLOBAL when neither DEPARTMENT nor USER exist for the key", () => {
    const global = candidate({ scopeType: "GLOBAL" })
    const org = candidate({ scopeType: "ORGANIZATION" })

    const result = resolveMostSpecific([global, org])

    expect(result).toHaveLength(1)
    expect(result[0].scopeType).toBe("ORGANIZATION")
  })

  test("GLOBAL alone is returned when it is the only candidate for the key", () => {
    const global = candidate({ scopeType: "GLOBAL" })
    expect(resolveMostSpecific([global])).toEqual([global])
  })

  test("two different logical keys (registryRef) resolve independently -- each keeps its own winner", () => {
    const keyA_org = candidate({ scopeType: "ORGANIZATION", registryRef: "pref:greeting" })
    const keyA_user = candidate({ scopeType: "USER", userId: "user-1", registryRef: "pref:greeting" })
    const keyB_global = candidate({ scopeType: "GLOBAL", registryRef: "pref:timezone", id: "mem-tz-global" })
    const keyB_dept = candidate({ scopeType: "DEPARTMENT", scopeId: "dept-1", registryRef: "pref:timezone", id: "mem-tz-dept" })

    const result = resolveMostSpecific([keyA_org, keyA_user, keyB_global, keyB_dept])

    expect(result).toHaveLength(2)
    const byKey = new Map(result.map((r) => [r.registryRef, r]))
    expect(byKey.get("pref:greeting")?.scopeType).toBe("USER")
    expect(byKey.get("pref:timezone")?.scopeType).toBe("DEPARTMENT")
  })

  test("no registryRef: candidates group by memoryType instead", () => {
    const org = candidate({ scopeType: "ORGANIZATION", registryRef: null, memoryType: "FACT" })
    const user = candidate({ scopeType: "USER", userId: "user-1", registryRef: null, memoryType: "FACT" })
    // A different memoryType is a DIFFERENT logical key even with no registryRef.
    const unrelated = candidate({ scopeType: "GLOBAL", registryRef: null, memoryType: "RULE", id: "mem-rule" })

    const result = resolveMostSpecific([org, user, unrelated])

    expect(result).toHaveLength(2)
    const winners = result.map((r) => r.scopeType).sort()
    expect(winners).toEqual(["GLOBAL", "USER"])
  })

  test("a tie at the same scope rank breaks by the most recently updated row", () => {
    const older = candidate({ scopeType: "ORGANIZATION", id: "mem-older", updatedAt: new Date("2026-01-01T00:00:00.000Z") })
    const newer = candidate({ scopeType: "ORGANIZATION", id: "mem-newer", updatedAt: new Date("2026-06-01T00:00:00.000Z") })

    const result = resolveMostSpecific([older, newer])

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("mem-newer")
  })

  test("empty input returns empty output", () => {
    expect(resolveMostSpecific([])).toEqual([])
  })
})

describe("resolveMemoryScope", () => {
  function actorWithDepartment(departmentId: string | null): import("./actor-context").ActorCtx {
    return {
      orgId: "org-1",
      userId: "user-1",
      dbUser: { id: "user-1", departmentId } as import("./actor-context").ActorCtx["dbUser"],
    }
  }

  test("maps DB rows to ranked candidates and applies most-specific-wins end to end", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { resolveMemoryScope } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [
        rawRow({ id: "mem-global", scope_type: "GLOBAL", org_id: null, registry_ref: "pref:greeting" }),
        rawRow({ id: "mem-org", scope_type: "ORGANIZATION", registry_ref: "pref:greeting" }),
        rawRow({ id: "mem-dept", scope_type: "DEPARTMENT", scope_id: "dept-1", registry_ref: "pref:greeting" }),
        rawRow({ id: "mem-user", scope_type: "USER", user_id: "user-1", registry_ref: "pref:greeting" }),
      ],
    ])

    const result = await resolveMemoryScope(tx, actorWithDepartment("dept-1"))

    expect(calls.length).toBe(1)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("mem-user")
    expect(result[0].scopeRank).toBe(3)
  })

  test("without a USER row, a department member's result is the DEPARTMENT row, not ORGANIZATION", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { resolveMemoryScope } = await import("./memory-service")
    const { tx } = makeQueueTx([
      [
        rawRow({ id: "mem-org", scope_type: "ORGANIZATION", registry_ref: "policy:standup-time" }),
        rawRow({ id: "mem-dept", scope_type: "DEPARTMENT", scope_id: "dept-1", registry_ref: "policy:standup-time" }),
      ],
    ])

    const result = await resolveMemoryScope(tx, actorWithDepartment("dept-1"))

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("mem-dept")
  })

  test("an apiKey (server-to-server) actor has no departmentId -- the query is issued with a null department filter value", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { resolveMemoryScope } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    const apiKeyActor: import("./actor-context").ActorCtx = { orgId: "org-1", userId: "svc-1", apiKey: { id: "k1", name: "PROJEXA proxy" } }
    await resolveMemoryScope(tx, apiKeyActor)

    const query = calls[0] as { queryChunks: unknown[] }
    // actor.orgId ("org-1") is bound 3 times (ORGANIZATION/DEPARTMENT/USER
    // branches) and the department filter's own bound value is `null` --
    // real proof the apiKey branch's missing departmentId flows all the way
    // into the query as NULL (which can never equal a real department's
    // scope_id), not silently defaulted to the actor's own orgId or dropped.
    expect(query.queryChunks).toContain("org-1")
    expect(query.queryChunks).toContain(null)
  })

  test("defensively drops a candidate whose scope_type is not one of the four resolvable levels", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { resolveMemoryScope } = await import("./memory-service")
    // Should not happen given the WHERE clause, but proves the resolver
    // does not crash or misrank a row from a future WHERE-clause bug.
    const { tx } = makeQueueTx([[rawRow({ id: "mem-project", scope_type: "PROJECT" })]])

    const result = await resolveMemoryScope(tx, actorWithDepartment(null))

    expect(result).toEqual([])
  })

  test("excludes ARCHIVED/SUPERSEDED rows by default", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { resolveMemoryScope } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await resolveMemoryScope(tx, actorWithDepartment(null))

    // The lifecycle filter is its own nested sql`` fragment (interpolated
    // into the outer WHERE clause), so its text lives inside a nested
    // queryChunks array -- JSON.stringify() (same technique this file's
    // own promoteMemoryRecord tests already use) walks the whole tree
    // rather than assuming a flat shape.
    expect(JSON.stringify(calls[0])).toContain("lifecycle_state NOT IN ('ARCHIVED', 'SUPERSEDED')")
  })

  test("includeArchivedAndSuperseded:true omits that filter entirely", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { resolveMemoryScope } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await resolveMemoryScope(tx, actorWithDepartment(null), { includeArchivedAndSuperseded: true })

    expect(JSON.stringify(calls[0])).not.toContain("NOT IN ('ARCHIVED', 'SUPERSEDED')")
  })
})

// R68 (Institutional Memory Graph) Phase 1: getMemoryRecordAsOf() /
// redactMemoryRecordLineage(). DB-level enforcement (the append-only
// trigger + SUPERSEDED-requires-pointer CHECK) is proved live against the
// real migrated schema separately -- see this PR's own description for
// that proof (both cannot be exercised from this mocked-DB test file, same
// reasoning this file's own header gives for every other test in it: no
// live Postgres connection is available in this sandbox/CI). What CAN be
// unit-tested here, and is: the real branching/query-shape logic of the
// two new TypeScript functions themselves -- lineage walking (both
// directions, not-found, cycle detection), the as-of window clause, and
// which connection (tx vs the bypass `db`) each one actually uses.
describe("getMemoryRecordAsOf (R68 Phase 1 item 3)", () => {
  test("returns null when the id does not exist (lineage walk finds nothing)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { getMemoryRecordAsOf } = await import("./memory-service")
    // [0] backward-walk SELECT (no predecessor) -> []; [1] forward-walk SELECT (cursor not found) -> []
    const { tx, calls } = makeQueueTx([[], []])

    const result = await getMemoryRecordAsOf(tx, "missing-id", new Date("2026-01-01"))

    expect(result).toBeNull()
    expect(calls.length).toBe(2) // never reaches the as-of SELECT itself
  })

  test("single-row lineage (never superseded): resolves root=self and returns the row when asOf falls in its open window", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { getMemoryRecordAsOf } = await import("./memory-service")
    // [0] backward walk: no predecessor -> []
    // [1] forward walk: cursor=mem-1, superseded_by_id null -> stop after 1
    // [2] as-of SELECT -> the row
    const { tx, calls } = makeQueueTx([[], [{ id: "mem-1", superseded_by_id: null }], [rawRow()]])

    const result = await getMemoryRecordAsOf(tx, "mem-1", new Date("2026-01-01"))

    expect(result?.id).toBe("mem-1")
    expect(calls.length).toBe(3)
    const asOfSql = JSON.stringify(calls[2])
    expect(asOfSql).toContain("effective_from <=")
    expect(asOfSql).toContain("effective_to IS NULL OR effective_to >")
  })

  test("walks backward to the lineage root when given a NEWER row's id, then queries the full lineage", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { getMemoryRecordAsOf } = await import("./memory-service")
    // Lineage: mem-1 (root) -> mem-2 (given id). Backward walk from mem-2
    // finds mem-1 (whose superseded_by_id = mem-2), then finds nothing
    // predecessor to mem-1 -> root = mem-1. Forward walk: mem-1 (-> mem-2),
    // mem-2 (-> null).
    const { tx, calls } = makeQueueTx([
      [{ id: "mem-1" }], // backward: who points to mem-2? -> mem-1
      [], // backward: who points to mem-1? -> nobody, root = mem-1
      [{ id: "mem-1", superseded_by_id: "mem-2" }], // forward: mem-1
      [{ id: "mem-2", superseded_by_id: null }], // forward: mem-2
      [rawRow({ id: "mem-2", version: 2 })], // as-of SELECT
    ])

    const result = await getMemoryRecordAsOf(tx, "mem-2", new Date("2026-06-01"))

    expect(result?.id).toBe("mem-2")
    expect(calls.length).toBe(5)
    // The as-of query's lineage array must contain BOTH ids, not just the one passed in.
    const asOfSql = JSON.stringify(calls[4])
    expect(asOfSql).toContain("mem-1")
    expect(asOfSql).toContain("mem-2")
  })

  test("returns null when no row in the lineage was effective at asOf (query legitimately matches nothing)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { getMemoryRecordAsOf } = await import("./memory-service")
    const { tx } = makeQueueTx([[], [{ id: "mem-1", superseded_by_id: null }], []])

    const result = await getMemoryRecordAsOf(tx, "mem-1", new Date("2020-01-01"))
    expect(result).toBeNull()
  })

  test("throws a clear, bounded error on a cyclic superseded_by_id chain rather than looping forever", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { getMemoryRecordAsOf } = await import("./memory-service")
    // Backward walk: mem-1's predecessor is mem-2, mem-2's predecessor is
    // mem-1 again -- a cycle. makeQueueTx cycles its response queue via
    // `responses[i] ?? []` once exhausted, so without cycle detection this
    // would need MAX_MEMORY_LINEAGE_DEPTH real iterations before this test
    // could even observe a difference; the explicit throw makes the
    // guard's effect immediately observable instead.
    let call = 0
    const responses = [[{ id: "mem-2" }], [{ id: "mem-1" }]]
    const execute = mock(async () => responses[call++ % 2])
    const tx = { execute } as unknown as TenantDb

    await expect(getMemoryRecordAsOf(tx, "mem-1", new Date("2026-01-01"))).rejects.toThrow(/cyclic superseded_by_id chain/)
  })
})

describe("redactMemoryRecordLineage (R68 Phase 1 item 5)", () => {
  test("uses the bypass-RLS `db` connection, never the caller's own tx (required to get past the append-only trigger)", async () => {
    mockEmbeddingsModule({})
    // db.execute queue: [0] backward walk -> []; [1] forward walk -> single row;
    // [2] UPDATE memory_records RETURNING id -> 1 row; [3] UPDATE memory_versions RETURNING id -> 1 row
    const dbExecute = mock(async () => {
      const n = dbExecute.mock.calls.length
      if (n === 1) return []
      if (n === 2) return [{ id: "mem-1", superseded_by_id: null }]
      if (n === 3) return [{ id: "mem-1" }]
      return [{ id: "v1" }]
    })
    mockDbModule(dbExecute)
    const { redactMemoryRecordLineage } = await import("./memory-service")

    const result = await redactMemoryRecordLineage("mem-1", { type: "USER", reason: "DPDP erasure request" })

    expect(result).toEqual({ recordsRedacted: 1, versionsRedacted: 1 })
    expect(dbExecute).toHaveBeenCalledTimes(4)
  })

  test("redacts EVERY row in the lineage, not just the one id passed in", async () => {
    mockEmbeddingsModule({})
    const { redactMemoryRecordLineage } = await import("./memory-service")

    // Explicit lineage fake: id mem-2 (current) whose predecessor is mem-1 (root).
    let call = 0
    const responses: unknown[][] = [
      [{ id: "mem-1" }], // backward: who points to mem-2? mem-1
      [], // backward: who points to mem-1? nobody -> root = mem-1
      [{ id: "mem-1", superseded_by_id: "mem-2" }], // forward: mem-1
      [{ id: "mem-2", superseded_by_id: null }], // forward: mem-2
      [{ id: "mem-1" }, { id: "mem-2" }], // UPDATE memory_records RETURNING id -- both rows
      [{ id: "v1" }, { id: "v2" }], // UPDATE memory_versions RETURNING id -- both snapshots
    ]
    const execute = mock(async () => responses[call++] ?? [])
    mock.module("@/lib/db", () => ({ db: { execute } }))

    const result = await redactMemoryRecordLineage("mem-2", { type: "SYSTEM" })

    expect(result).toEqual({ recordsRedacted: 2, versionsRedacted: 2 })
    // The UPDATE statements must reference BOTH lineage ids, not just "mem-2".
    const updateRecordsSql = JSON.stringify(execute.mock.calls[4]?.[0])
    expect(updateRecordsSql).toContain("mem-1")
    expect(updateRecordsSql).toContain("mem-2")
  })

  test("throws when the id does not exist, writing nothing", async () => {
    mockEmbeddingsModule({})
    const dbExecute = mock(async () => [])
    mockDbModule(dbExecute)
    const { redactMemoryRecordLineage } = await import("./memory-service")

    await expect(redactMemoryRecordLineage("missing-id", { type: "USER" })).rejects.toThrow(/not found/)
    // Only the 2 lineage-walk SELECTs should have run -- no UPDATE.
    expect(dbExecute).toHaveBeenCalledTimes(2)
  })

  test("expectedOrgId guard: throws and writes nothing when a lineage row belongs to a different org", async () => {
    mockEmbeddingsModule({})
    let call = 0
    const responses: unknown[][] = [
      [], // backward: no predecessor
      [{ id: "mem-1", superseded_by_id: null }], // forward: mem-1
      [{ org_id: "org-other" }], // org-check SELECT DISTINCT org_id
    ]
    const execute = mock(async () => responses[call++] ?? [])
    mock.module("@/lib/db", () => ({ db: { execute } }))
    const { redactMemoryRecordLineage } = await import("./memory-service")

    await expect(redactMemoryRecordLineage("mem-1", { type: "USER" }, "org-expected")).rejects.toThrow(
      /not the expected org-expected/
    )
    expect(execute).toHaveBeenCalledTimes(3) // never reaches the UPDATEs
  })

  test("redaction placeholder replaces content on every UPDATE, never merely closing effective_to", async () => {
    mockEmbeddingsModule({})
    let call = 0
    const responses: unknown[][] = [
      [],
      [{ id: "mem-1", superseded_by_id: null }],
      [{ id: "mem-1" }],
      [],
    ]
    const execute = mock(async () => responses[call++] ?? [])
    mock.module("@/lib/db", () => ({ db: { execute } }))
    const { redactMemoryRecordLineage } = await import("./memory-service")

    await redactMemoryRecordLineage("mem-1", { type: "AI", id: "model-x", reason: "erasure request #42" })

    const updateRecordsSql = JSON.stringify(execute.mock.calls[2]?.[0])
    expect(updateRecordsSql).toContain("REDACTED")
    expect(updateRecordsSql).toContain("erasure request #42")
    // Must be a real content rewrite, not an effective_to close -- the
    // whole point of R-IMG-05's obligation this function exists to satisfy.
    expect(updateRecordsSql).toContain("content")
  })
})
