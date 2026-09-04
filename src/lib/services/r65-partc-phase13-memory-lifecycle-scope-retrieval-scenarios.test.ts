/// <reference types="bun-types" />
// R65 Part C directive §36 Phase 13 ("testing: 100 chat / 100 task / 100
// memory retrieval / 50 permission-isolation / 50 Google-Sheet-sync / 20
// conflict / 20 versioning scenarios") -- this file is a real, scoped
// SUBSET of that corpus: the retrieval-ranking, scope-isolation, and
// lifecycle/versioning-audit scenarios that exercise the SERVICE LAYER
// (src/lib/services/memory-service.ts) specifically, not the full 440-count
// corpus (chat/task-level scenarios belong with chat-service.test.ts /
// run-submission.test.ts; Google-Sheets-sync scenarios are not buildable at
// all yet -- Phases 8-11 are still gated on the COMPOSIO_API_KEY decision).
//
// Why this file exists alongside memory-service.test.ts rather than adding
// to it: memory-service.test.ts (PR #1557/#1560/#1565) already covers each
// function's own guard clauses and one happy path per function in
// isolation. Two real, previously-untested behaviors this file closes
// instead:
//
//   1. appendLifecycleHistory()'s accumulation branch. Every existing
//      promoteMemoryRecord()/archiveMemoryRecord() test's fixture metadata
//      has NO pre-existing `lifecycleHistory` key, so
//      `Array.isArray(metadata.lifecycleHistory) ? metadata.lifecycleHistory
//      : []` always took the `: []` fallback in every prior test -- the
//      branch that matters on a record's SECOND+ lifecycle change (append
//      onto an existing array, don't overwrite it) was never actually
//      exercised. Directive §28 requires every lifecycle change be
//      traceable; an accumulation bug here would silently lose that trail
//      starting from the second transition on any given record.
//
//   2. searchMemories() scenario combinations. chat-service.ts's real
//      caller (fetchRelevantMemories()) always passes requestingUserId
//      together with `limit`; Phase 13's own scenario framing (§24-25's
//      worked example, §34-35's mandated retrieval-accuracy/isolation
//      tests) is about REALISTIC combinations of scope + filters + ranking,
//      not each option tested only in isolation. This file adds the
//      combinations (requestingUserId + scopeType, + memoryType, +
//      includeArchivedAndSuperseded, GLOBAL/INDUSTRY scope search, default
//      vs custom limit, multi-row score-mapping fidelity) that existing
//      tests never combined.
//
// Same "mock the DB layer only" convention as memory-service.test.ts itself
// (queue-based fake tx.execute(), mock.module() for @/lib/db and
// @/lib/embeddings) -- no live Postgres connection is available in this
// sandbox/CI, so this exercises real branching/SQL-shape logic against fake
// DB responses, not a live schema (cross-org RLS itself is covered
// separately and for real by r65-partc-phase1-memory-schema-rls.test.ts's
// migration-SQL assertions).
import { describe, expect, test, mock, beforeEach } from "bun:test"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { imgEntitled, isImgEntitlementQuery } from "./__test-helpers__/img-entitlement-fake"

const NOW = new Date("2026-09-02T00:00:00.000Z")

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

// Queue-based fake tx.execute() -- identical shape to memory-service.test.ts's
// own makeQueueTx() (duplicated here, not imported, matching this repo's own
// convention of each test file being self-contained -- see
// r65-partc-phase1-memory-schema-rls.test.ts / r65-partc-phase2-memory-
// embedding.test.ts, neither of which imports helpers from a sibling test).
function makeQueueTx(responses: unknown[][]) {
  let i = 0
  const calls: unknown[] = []
  const execute = mock(async (q: unknown) => {
    // R68 Phase 8: the lifecycle/scope/retrieval paths this file drives now
    // gate on IMG entitlement first. Answered out of band so every scenario
    // below keeps its own queue indices and keeps meaning "an ENTITLED org".
    if (isImgEntitlementQuery(q)) return imgEntitled()
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

// JSON.stringify(calls[i]) (a drizzle sql`` query object) embeds the bound
// metadata JSON string as a VALUE inside that outer JSON, so its own
// internal quotes come through backslash-escaped (`\"key\":\"value\"`) in
// the resulting string -- this undoes exactly that one level of escaping so
// assertions can check for plain `"key":"value"` pairs, matching how the
// real JSON actually reads once parsed.
function unescapeQuotes(s: string): string {
  return s.replaceAll('\\"', '"')
}

// R68 Phase 6: the write functions this file drives now run the three-boolean
// authorization gate first. Stubbed to a pass here for the same reason
// memory-service.test.ts stubs it -- these are lifecycle/retrieval scenarios,
// and letting the gate issue its own DB reads would shift every queue index
// in this file's fixtures. The gate's real refusal behaviour is tested
// unmocked in src/lib/services/r68-phase6-write-path.test.ts.
const ACTOR = { orgId: "org-1", userId: "user-1", actorUserId: "user-1" }

function mockAuthorizationModule() {
  mock.module("./memory-write-authorization", () => ({
    assertMemoryWriteAuthorized: mock(async () => ({
      allowed: true,
      callerContextResolves: true,
      inputsResolve: true,
      roleSufficient: true,
      chainChecked: false,
      resolvedRole: "admin",
      requiredRole: "member",
      reason: null,
    })),
  }))
}

beforeEach(() => {
  mock.restore()
  mockAuthorizationModule()
})

// ─── A. searchMemories: scope-isolation combined with other filters ───────
// Directive §9 (multi-tenant isolation, non-negotiable) + §7 (retrieval
// priority order must not let a lower-authority scope override a higher
// one) -- the real caller (chat-service.ts's fetchRelevantMemories())
// always combines requestingUserId with other options, so isolation must
// hold under combination, not only alone.
describe("searchMemories scenarios: requestingUserId combined with other filters", () => {
  test("requestingUserId + scopeType both compile together (isolation guard survives an additional narrowing filter)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "what format does this org use?", {
      requestingUserId: "user-1",
      scopeType: "ORGANIZATION",
    })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("scope_type <> 'USER' OR user_id =")
    expect(sqlText).toContain("user-1")
    expect(sqlText).toContain("scope_type = ")
    expect(sqlText).toContain("ORGANIZATION")
  })

  test("requestingUserId + memoryType both compile together", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "what are this user's preferences?", {
      requestingUserId: "user-1",
      memoryType: "PREFERENCE",
    })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("scope_type <> 'USER' OR user_id =")
    expect(sqlText).toContain("memory_type = ")
    expect(sqlText).toContain("PREFERENCE")
  })

  test("requestingUserId + scopeType='USER' compiles BOTH the exact-scope filter AND the own-vs-other-user guard (not mutually exclusive)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "what does this user prefer?", {
      requestingUserId: "user-1",
      scopeType: "USER",
    })

    const sqlText = JSON.stringify(calls[0])
    // Both clauses are real, independent AND-ed filters -- narrowing to
    // scope_type='USER' does not make the isolation guard redundant or
    // silently dropped.
    expect(sqlText).toContain("scope_type = ")
    expect(sqlText).toContain("scope_type <> 'USER' OR user_id =")
  })

  test("requestingUserId + includeArchivedAndSuperseded=true: isolation guard still compiles even when the lifecycle filter is dropped", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "show me even old/superseded memories for this user", {
      requestingUserId: "user-1",
      includeArchivedAndSuperseded: true,
    })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("scope_type <> 'USER' OR user_id =")
    expect(sqlText).not.toContain("lifecycle_state NOT IN")
  })

  test("omitting includeArchivedAndSuperseded (default) excludes ARCHIVED/SUPERSEDED regardless of requestingUserId", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "normal query", { requestingUserId: "user-1" })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("lifecycle_state NOT IN")
    expect(sqlText).toContain("ARCHIVED")
    expect(sqlText).toContain("SUPERSEDED")
  })

  test("explicit includeArchivedAndSuperseded=false behaves identically to omitting the option", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "normal query", { includeArchivedAndSuperseded: false })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("lifecycle_state NOT IN")
  })

  test("two sequential calls with DIFFERENT requestingUserId values each bind their own id (no cross-call state leak)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")

    const first = makeQueueTx([[]])
    await searchMemories(first.tx, "query one", { requestingUserId: "user-1" })
    const firstSql = JSON.stringify(first.calls[0])
    expect(firstSql).toContain("user-1")
    expect(firstSql).not.toContain("user-2")

    const second = makeQueueTx([[]])
    await searchMemories(second.tx, "query two", { requestingUserId: "user-2" })
    const secondSql = JSON.stringify(second.calls[0])
    expect(secondSql).toContain("user-2")
    expect(secondSql).not.toContain("user-1")
  })
})

// ─── B. searchMemories: retrieval-ranking / filter-combination scenarios ──
// Directive §11 (retrieval must combine similarity + scope + authorization
// + recency + source authority + metadata -- vector similarity alone is
// insufficient) and §26 (hybrid retrieval). searchMemories() today ranks by
// raw vector distance only; these scenarios document the REAL current
// behavior (ordering clause presence, filter composition, column
// availability for a future authority/recency re-rank) rather than
// asserting a re-ranking behavior that does not exist yet -- see this PR's
// description for that honestly-disclosed gap.
describe("searchMemories scenarios: retrieval-ranking and filter composition", () => {
  test("ranks by vector distance via ORDER BY (similarity-based ranking is real, not just a LIMIT'd unordered scan)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "any query")

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("ORDER BY")
    expect(sqlText).toContain("embedding <=>")
  })

  test("defaults to LIMIT 10 when no limit is supplied", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "any query")

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("LIMIT")
    // The bound param for LIMIT is the number 10 -- check it's actually bound,
    // not merely that the literal SQL keyword "LIMIT" appears (which it always
    // does regardless of the value).
    expect(JSON.stringify(calls[0])).toMatch(/10/)
  })

  test("honors a custom limit (chat-service.ts's real RELEVANT_MEMORY_LIMIT-style call)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "any query", { limit: 3 })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toMatch(/\b3\b/)
  })

  test("scopeType and memoryType compile together, both as real AND-ed filters", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "org procedures", { scopeType: "ORGANIZATION", memoryType: "PROCEDURE" })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("scope_type = ")
    expect(sqlText).toContain("ORGANIZATION")
    expect(sqlText).toContain("memory_type = ")
    expect(sqlText).toContain("PROCEDURE")
  })

  test("scopeType='GLOBAL' is a real, searchable filter (unlike createMemoryRecord(), which rejects it as write-only admin path)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "industry-wide construction knowledge", { scopeType: "GLOBAL" })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("scope_type = ")
    expect(sqlText).toContain("GLOBAL")
  })

  test("scopeType='INDUSTRY' is likewise a real, searchable filter", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "typical interior-construction workflow", { scopeType: "INDUSTRY" })

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("INDUSTRY")
  })

  test("trims the query before embedding (leading/trailing whitespace never reaches generateEmbedding)", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mockEmbeddingsModule({ generateEmbedding })
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx } = makeQueueTx([[]])

    await searchMemories(tx, "   what color is the sky?   ")

    expect(generateEmbedding).toHaveBeenCalledWith("what color is the sky?")
  })

  test("selects provenance_type, lifecycle_state, and confidence in every query (data a future authority/recency re-rank would need is already retrievable)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[]])

    await searchMemories(tx, "any query")

    const sqlText = JSON.stringify(calls[0])
    expect(sqlText).toContain("provenance_type")
    expect(sqlText).toContain("lifecycle_state")
    expect(sqlText).toContain("confidence")
  })

  test("maps each returned row's OWN score independently (does not collapse multiple matches to one shared score)", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx } = makeQueueTx([
      [
        { ...rawRow({ id: "mem-1", content: "closest match" }), score: 0.95 },
        { ...rawRow({ id: "mem-2", content: "second match" }), score: 0.6 },
        { ...rawRow({ id: "mem-3", content: "weakest match" }), score: 0.31 },
      ],
    ])

    const results = await searchMemories(tx, "any query", { limit: 3 })

    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ id: "mem-1", score: 0.95 })
    expect(results[1]).toMatchObject({ id: "mem-2", score: 0.6 })
    expect(results[2]).toMatchObject({ id: "mem-3", score: 0.31 })
  })

  test("an empty result set with multiple filters applied returns [] cleanly, no throw", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { searchMemories } = await import("./memory-service")
    const { tx } = makeQueueTx([[]])

    const results = await searchMemories(tx, "nothing matches this", {
      scopeType: "PROJECT",
      memoryType: "LESSON",
      requestingUserId: "user-1",
      includeArchivedAndSuperseded: true,
      limit: 25,
    })

    expect(results).toEqual([])
  })
})

// ─── C. Lifecycle audit-trail accumulation scenarios ───────────────────────
// Directive §28 (every retrieved memory traceable to who/when/why changed
// it) applied to STATE changes, not just content changes. The real gap this
// closes: PR #1565's own tests never gave a fixture row a pre-existing
// `metadata.lifecycleHistory` array, so `appendLifecycleHistory()`'s append-
// vs-overwrite branch was never exercised on a record's second-or-later
// transition -- exactly the case a real record hits after its first
// promotion.
describe("promoteMemoryRecord / archiveMemoryRecord: lifecycleHistory accumulation across multiple transitions", () => {
  test("promoting a record that already has ONE lifecycleHistory entry APPENDS a second, it does not overwrite the array", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")

    const priorEntry = {
      from: "TRANSIENT",
      to: "CANDIDATE",
      changedByType: "SYSTEM",
      changedById: null,
      reason: "captured from chat",
      at: "2026-09-01T00:00:00.000Z",
    }
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE", metadata: { lifecycleHistory: [priorEntry] } })],
      [rawRow({ lifecycle_state: "CONFIRMED" })],
    ])

    await promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { actor: ACTOR, type: "USER", id: "user-1", reason: "user confirmed it" })

    const updateSql = unescapeQuotes(JSON.stringify(calls[1]))
    // The OLD entry must survive verbatim...
    expect(updateSql).toContain("captured from chat")
    expect(updateSql).toContain('"from":"TRANSIENT"')
    expect(updateSql).toContain('"to":"CANDIDATE"')
    // ...AND the new entry must be appended alongside it, not replacing it.
    expect(updateSql).toContain('"from":"CANDIDATE"')
    expect(updateSql).toContain('"to":"CONFIRMED"')
    expect(updateSql).toContain("user confirmed it")
    // Exactly 2 history entries now exist -- count "changedByType" occurrences
    // as a proxy for entry count (each history entry has exactly one).
    const entryCount = (updateSql.match(/changedByType/g) ?? []).length
    expect(entryCount).toBe(2)
  })

  test("a full real-world chain (TRANSIENT -> CANDIDATE -> CONFIRMED -> ACTIVE -> ARCHIVED) accumulates 4 history entries in order, each step building on the last", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord, archiveMemoryRecord } = await import("./memory-service")

    // Step 1: TRANSIENT -> CANDIDATE (system captures an AI-inferred fact)
    const step1 = makeQueueTx([
      [rawRow({ lifecycle_state: "TRANSIENT", metadata: {} })],
      [rawRow({ lifecycle_state: "CANDIDATE" })],
    ])
    await promoteMemoryRecord(step1.tx, "mem-1", "CANDIDATE", { actor: ACTOR, type: "SYSTEM", reason: "auto-captured" })
    const step1Sql = unescapeQuotes(JSON.stringify(step1.calls[1]))
    expect((step1Sql.match(/changedByType/g) ?? []).length).toBe(1)

    // Step 2: CANDIDATE -> CONFIRMED (user explicitly confirms it) -- simulate
    // the row as it would now really exist, carrying step 1's own history
    // forward (this is what a real re-fetch of the row would return).
    const historyAfterStep1 = [
      { from: "TRANSIENT", to: "CANDIDATE", changedByType: "SYSTEM", changedById: null, reason: "auto-captured", at: "2026-09-02T00:00:00.000Z" },
    ]
    const step2 = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE", metadata: { lifecycleHistory: historyAfterStep1 } })],
      [rawRow({ lifecycle_state: "CONFIRMED" })],
    ])
    await promoteMemoryRecord(step2.tx, "mem-1", "CONFIRMED", { actor: ACTOR, type: "USER", id: "user-1", reason: "user confirmed" })
    const step2Sql = unescapeQuotes(JSON.stringify(step2.calls[1]))
    expect((step2Sql.match(/changedByType/g) ?? []).length).toBe(2)
    expect(step2Sql).toContain("auto-captured")
    expect(step2Sql).toContain("user confirmed")

    // Step 3: CONFIRMED -> ACTIVE (repeated successful use, directive §29's
    // own worked example)
    const historyAfterStep2 = [
      ...historyAfterStep1,
      { from: "CANDIDATE", to: "CONFIRMED", changedByType: "USER", changedById: "user-1", reason: "user confirmed", at: "2026-09-02T00:00:01.000Z" },
    ]
    const step3 = makeQueueTx([
      [rawRow({ lifecycle_state: "CONFIRMED", metadata: { lifecycleHistory: historyAfterStep2 } })],
      [rawRow({ lifecycle_state: "ACTIVE" })],
    ])
    // R68 Phase 6: an AI-originated transition must carry model + prompt
    // attribution or it is refused before the UPDATE. This step of the
    // real-world chain genuinely IS the AI one ("repeated successful use"),
    // so it is attributed rather than relabelled.
    await promoteMemoryRecord(step3.tx, "mem-1", "ACTIVE", {
      actor: ACTOR,
      type: "AI",
      reason: "repeated successful use",
      modelId: "anthropic/claude-sonnet-5",
      promptHash: "sha256:8f14e45fceea167a5a36dedd4bea2543",
    })
    const step3Sql = unescapeQuotes(JSON.stringify(step3.calls[1]))
    expect((step3Sql.match(/changedByType/g) ?? []).length).toBe(3)
    expect(step3Sql).toContain("repeated successful use")

    // Step 4: ACTIVE -> ARCHIVED (user later retracts it) -- archiveMemoryRecord
    // reuses the same appendLifecycleHistory(), reachable from ANY prior state.
    const historyAfterStep3 = [
      ...historyAfterStep2,
      { from: "CONFIRMED", to: "ACTIVE", changedByType: "AI", changedById: null, reason: "repeated successful use", at: "2026-09-02T00:00:02.000Z" },
    ]
    const step4 = makeQueueTx([
      [rawRow({ lifecycle_state: "ACTIVE", metadata: { lifecycleHistory: historyAfterStep3 }, effective_to: null })],
      [rawRow({ lifecycle_state: "ARCHIVED" })],
    ])
    const finalRecord = await archiveMemoryRecord(step4.tx, "mem-1", { actor: ACTOR, type: "USER", id: "user-1", reason: "no longer accurate" })
    const step4Sql = unescapeQuotes(JSON.stringify(step4.calls[1]))
    expect((step4Sql.match(/changedByType/g) ?? []).length).toBe(4)
    expect(step4Sql).toContain('"from":"ACTIVE"')
    expect(step4Sql).toContain('"to":"ARCHIVED"')
    expect(finalRecord.lifecycleState).toBe("ARCHIVED")
  })

  test("archiving a record that was already SUPERSEDED (with effective_to already set) still emits COALESCE(effective_to, now()) -- never a bare overwrite", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const alreadySetEffectiveTo = new Date("2026-08-15T00:00:00.000Z")
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "SUPERSEDED", superseded_by_id: "mem-2", effective_to: alreadySetEffectiveTo })],
      [rawRow({ lifecycle_state: "ARCHIVED" })],
    ])

    await archiveMemoryRecord(tx, "mem-1", { actor: ACTOR, type: "SYSTEM", reason: "retention cleanup" })

    const updateSql = JSON.stringify(calls[1])
    expect(updateSql).toContain("COALESCE")
    expect(updateSql).toContain("effective_to")
  })

  test("archiving a record still in TRANSIENT (never promoted at all) succeeds -- confirms the 'from ANY other state' contract really includes the very first state", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "TRANSIENT", metadata: {} })],
      [rawRow({ lifecycle_state: "ARCHIVED" })],
    ])

    const result = await archiveMemoryRecord(tx, "mem-1", { actor: ACTOR, type: "SYSTEM", reason: "never confirmed, discarding" })

    expect(result.lifecycleState).toBe("ARCHIVED")
    const updateSql = unescapeQuotes(JSON.stringify(calls[1]))
    expect(updateSql).toContain('"from":"TRANSIENT"')
    expect(updateSql).toContain('"to":"ARCHIVED"')
  })

  test("changedBy with only {type} (no id/reason) round-trips as explicit JSON null, never the string 'undefined'", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "TRANSIENT", metadata: {} })],
      [rawRow({ lifecycle_state: "CANDIDATE" })],
    ])

    await promoteMemoryRecord(tx, "mem-1", "CANDIDATE", { actor: ACTOR, type: "SYSTEM" })

    const updateSql = unescapeQuotes(JSON.stringify(calls[1]))
    expect(updateSql).not.toContain("undefined")
    expect(updateSql).toContain('"changedById":null')
    expect(updateSql).toContain('"reason":null')
    expect(updateSql).toContain('"changedByType":"SYSTEM"')
  })

  test("changedBy with {type, id} but no reason: id is preserved, reason is explicit null", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE", metadata: {} })],
      [rawRow({ lifecycle_state: "CONFIRMED" })],
    ])

    await promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { actor: ACTOR, type: "USER", id: "user-42" })

    const updateSql = unescapeQuotes(JSON.stringify(calls[1]))
    expect(updateSql).toContain('"changedById":"user-42"')
    expect(updateSql).toContain('"reason":null')
  })

  test("preserves unrelated nested metadata (arrays and nested objects, not just flat string keys) untouched across a promotion", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const complexMetadata = {
      tags: ["quotation", "abc-ltd"],
      sourceDetail: { channel: "chat", conversationId: "conv-9" },
    }
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE", metadata: complexMetadata })],
      [rawRow({ lifecycle_state: "CONFIRMED" })],
    ])

    await promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { actor: ACTOR, type: "USER" })

    const updateSql = JSON.stringify(calls[1])
    expect(updateSql).toContain("quotation")
    expect(updateSql).toContain("abc-ltd")
    expect(updateSql).toContain("conv-9")
    expect(updateSql).toContain("lifecycleHistory")
  })

  test("rejects a nonsense toState (runtime guard, not just a compile-time union) with a message naming the real current state and legal next state", async () => {
    mockEmbeddingsModule({})
    mockDbModule()
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[rawRow({ lifecycle_state: "CANDIDATE" })]])

    await expect(
      promoteMemoryRecord(
        tx,
        "mem-1",
        // @ts-expect-error -- deliberately passing an illegal state to test the runtime guard
        "SUPERSEDED",
        { actor: ACTOR, type: "USER" }
      )
    ).rejects.toThrow(/only legal next state is CONFIRMED, not SUPERSEDED/)
    expect(calls.length).toBe(1) // SELECT only, no UPDATE issued
  })
})

// ─── D. Cross-function consistency scenarios ───────────────────────────────
// Directive §9's fail-closed principle applied consistently: an unknown id
// and a cross-org id (filtered out by RLS) must be indistinguishable to
// EVERY lifecycle-affecting function, not just some of them -- a caller
// that can tell the two apart from one function but not another would leak
// which ids exist in other orgs.
describe("supersedeMemoryRecord / promoteMemoryRecord / archiveMemoryRecord: consistent fail-closed behavior", () => {
  const cases: { name: string; run: (tx: TenantDb) => Promise<unknown> }[] = [
    {
      name: "supersedeMemoryRecord",
      run: async (tx) => {
        const { supersedeMemoryRecord } = await import("./memory-service")
        return supersedeMemoryRecord(tx, "missing-id", "new content", { actor: ACTOR, type: "USER" })
      },
    },
    {
      name: "promoteMemoryRecord",
      run: async (tx) => {
        const { promoteMemoryRecord } = await import("./memory-service")
        return promoteMemoryRecord(tx, "missing-id", "CONFIRMED", { actor: ACTOR, type: "USER" })
      },
    },
    {
      name: "archiveMemoryRecord",
      run: async (tx) => {
        const { archiveMemoryRecord } = await import("./memory-service")
        return archiveMemoryRecord(tx, "missing-id", { actor: ACTOR, type: "USER" })
      },
    },
  ]

  for (const { name, run } of cases) {
    test(`${name}: an unknown/cross-org id throws "not found", never a distinguishable RLS-specific error`, async () => {
      mockEmbeddingsModule({})
      mockDbModule()
      const { tx } = makeQueueTx([[]])
      await expect(run(tx)).rejects.toThrow(/not found/)
    })
  }

  const globalCases: { name: string; run: (tx: TenantDb) => Promise<unknown> }[] = [
    {
      name: "supersedeMemoryRecord",
      run: async (tx) => {
        const { supersedeMemoryRecord } = await import("./memory-service")
        return supersedeMemoryRecord(tx, "mem-1", "new content", { actor: ACTOR, type: "USER" })
      },
    },
    {
      name: "promoteMemoryRecord",
      run: async (tx) => {
        const { promoteMemoryRecord } = await import("./memory-service")
        return promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { actor: ACTOR, type: "USER" })
      },
    },
    {
      name: "archiveMemoryRecord",
      run: async (tx) => {
        const { archiveMemoryRecord } = await import("./memory-service")
        return archiveMemoryRecord(tx, "mem-1", { actor: ACTOR, type: "USER" })
      },
    },
  ]

  for (const { name, run } of globalCases) {
    test(`${name}: a GLOBAL/INDUSTRY (org_id NULL) row is consistently rejected as an admin/service_role-only path`, async () => {
      mockEmbeddingsModule({})
      mockDbModule()
      const { tx } = makeQueueTx([[rawRow({ org_id: null, scope_type: "GLOBAL", lifecycle_state: "CANDIDATE" })]])
      await expect(run(tx)).rejects.toThrow(/admin\/service_role-only path/)
    })
  }
})
