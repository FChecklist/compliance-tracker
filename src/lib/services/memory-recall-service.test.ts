/// <reference types="bun-types" />
// R68 Phase 4: unit tests for src/lib/services/memory-recall-service.ts.
//
// Same "mock the DB layer only" convention as memory-service.test.ts's
// makeQueueTx() -- a queue-based fake standing in for the caller's own
// withTenantContext `tx`. No live Postgres connection is available in this
// sandbox/CI (same reasoning as every other DB-independent test in this
// repo), so these tests exercise the file's REAL branching logic (tier
// ordering, fall-through, R-CRR-05 enforcement, the degradation path)
// against fixture rows shaped exactly like the live schema.
//
// The tsvector/ts_rank behaviour tier 2 depends on cannot be faked
// meaningfully in-process, so it was verified DIRECTLY against the live
// database (pcrjmlpuqsbocqfwoxod) instead, inside a rolled-back
// transaction -- see this file's "live-verified" note on the tier 2
// describe block. The fixtures below use the real ts_rank values that
// probe returned, not invented numbers.
import { describe, expect, test } from "bun:test"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { ActorCtx } from "./actor-context"
import {
  EXECUTABLE_TIER,
  GRAPH_EXPAND_MAX_DEPTH,
  GRAPH_EXPAND_MAX_ROWS,
  RECALL_TIERS,
  clampGraphDepth,
  recallGraphExpanded,
  recallKeyword,
  recallMemory,
  recallVector,
  rerankGraphExpanded,
  takeExecutableRecord,
  takeProposals,
  type RecallProposal,
  type RecallResult,
} from "./memory-recall-service"

const NOW = new Date("2026-09-04T00:00:00.000Z")

const ACTOR = {
  orgId: "org-1",
  userId: "user-1",
  dbUser: { id: "user-1", departmentId: "dept-1" },
} as unknown as ActorCtx

/** A compliance.memory_records row shaped exactly as the live table returns it. */
function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    scope_type: "ORGANIZATION",
    scope_id: null,
    org_id: "org-1",
    user_id: null,
    industry_id: null,
    project_id: null,
    task_id: null,
    memory_type: "RULE",
    content: "Retention policy requires invoices be archived for seven years",
    content_hash: "h-a",
    confidence: "0.9",
    provenance_type: "USER_CONFIRMED",
    lifecycle_state: "ACTIVE",
    source_type: null,
    source_id: null,
    registry_ref: "policy.retention",
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

/** Queue-based fake tx.execute() -- same shape as memory-service.test.ts's makeQueueTx(). */
function makeQueueTx(responses: unknown[][]) {
  let i = 0
  const calls: unknown[] = []
  const execute = async (q: unknown) => {
    calls.push(q)
    const r = responses[i] ?? []
    i += 1
    return r
  }
  return { tx: { execute } as unknown as TenantDb, calls, callCount: () => i }
}

/** An embedQuery seam that behaves exactly like generateEmbeddingUncached with NO provider configured. */
const NO_PROVIDER_EMBED = async () => ({
  vector: new Array(1536).fill(0).map((_, i) => Math.sin(i) / 39),
  isReal: false,
  model: "hash-pseudo-vector",
})

/** An embedQuery seam that behaves like a real OpenRouter response. */
const REAL_EMBED = async () => ({
  vector: new Array(1536).fill(0.01),
  isReal: true,
  model: "openai/text-embedding-3-small",
})

// ═══════════════════════════════════════════════════════════════════════
// R-CRR-05 -- the single most important constraint on this phase
// ═══════════════════════════════════════════════════════════════════════
describe("R-CRR-05: SIMILAR MAY ONLY PROPOSE, ONLY EXACT MAY EXECUTE", () => {
  test("the executable tier is 'exact' and nothing else", () => {
    expect(EXECUTABLE_TIER).toBe("exact")
  })

  test("takeExecutableRecord returns the record for an exact hit", () => {
    const record = { id: "mem-1", registryRef: "policy.retention", scopeRank: 1 } as never
    const result: RecallResult = { tier: "exact", mayExecute: true, record, skipped: [] }
    expect(takeExecutableRecord(result)).toBe(record)
  })

  test.each(["keyword", "vector", "graph"] as const)(
    "takeExecutableRecord returns null for the %s tier -- it may only propose",
    (tier) => {
      const result: RecallResult = {
        tier,
        mayExecute: false,
        proposals: [{ tier, entityType: "memory_record", entityId: "mem-9", content: "x", score: 0.99, citationTrail: [] }],
        skipped: [],
      }
      expect(takeExecutableRecord(result)).toBeNull()
      // ...and the proposals are still readable, just not executable.
      expect(takeProposals(result)).toHaveLength(1)
    }
  )

  test("a 0.99-scoring vector proposal is STILL not executable (the ruling's own rationale: a 0.95 cosine can be the wrong client)", () => {
    const result: RecallResult = {
      tier: "vector",
      mayExecute: false,
      proposals: [
        { tier: "vector", entityType: "memory_record", entityId: "mem-9", content: "near-identical", score: 0.99, citationTrail: [] },
      ],
      skipped: [],
    }
    expect(takeExecutableRecord(result)).toBeNull()
  })

  test("a forged object claiming tier 'exact' without mayExecute yields nothing (runtime re-check, not just types)", () => {
    const forged = JSON.parse(
      JSON.stringify({ tier: "exact", mayExecute: false, record: { id: "mem-1" }, skipped: [] })
    ) as RecallResult
    expect(takeExecutableRecord(forged)).toBeNull()
  })

  test("a forged object claiming mayExecute:true on a proposal tier yields nothing", () => {
    const forged = JSON.parse(
      JSON.stringify({ tier: "vector", mayExecute: true, record: { id: "mem-1" }, proposals: [], skipped: [] })
    ) as RecallResult
    expect(takeExecutableRecord(forged)).toBeNull()
  })

  test("takeProposals never returns anything for the exact tier -- the two accessors do not overlap", () => {
    const result: RecallResult = { tier: "exact", mayExecute: true, record: { id: "m" } as never, skipped: [] }
    expect(takeProposals(result)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Tier 1 -- exact
// ═══════════════════════════════════════════════════════════════════════
describe("tier 1 (exact)", () => {
  test("returns the most-specific record for a registryRef and marks it executable", async () => {
    // resolveMemoryScope() issues exactly one SELECT; it returns both a
    // DEPARTMENT and an ORGANIZATION row for the same registry_ref and
    // must pick the DEPARTMENT one (rank 2 > rank 1).
    const { tx } = makeQueueTx([
      [
        memoryRow({ id: "mem-org", scope_type: "ORGANIZATION" }),
        memoryRow({ id: "mem-dept", scope_type: "DEPARTMENT", scope_id: "dept-1" }),
      ],
    ])
    const result = await recallMemory(tx, ACTOR, "retention", { registryRef: "policy.retention" })

    expect(result.tier).toBe("exact")
    expect(result.mayExecute).toBe(true)
    const record = takeExecutableRecord(result)
    expect(record?.id).toBe("mem-dept")
    expect(record?.scopeRank).toBe(2)
  })

  test("reuses resolveMemoryScope's precedence -- it does not re-derive it (USER beats DEPARTMENT beats ORGANIZATION)", async () => {
    const { tx } = makeQueueTx([
      [
        memoryRow({ id: "mem-org", scope_type: "ORGANIZATION" }),
        memoryRow({ id: "mem-dept", scope_type: "DEPARTMENT", scope_id: "dept-1" }),
        memoryRow({ id: "mem-user", scope_type: "USER", user_id: "user-1" }),
      ],
    ])
    const result = await recallMemory(tx, ACTOR, "retention", { registryRef: "policy.retention" })
    expect(takeExecutableRecord(result)?.id).toBe("mem-user")
  })

  test("without a registryRef, tier 1 is skipped as not_requested and nothing can auto-execute", async () => {
    const { tx } = makeQueueTx([[], []])
    const result = await recallMemory(tx, ACTOR, "some free text", { maxTier: "keyword" })
    const exactSkip = result.skipped.find((s) => s.tier === "exact")
    expect(exactSkip?.kind).toBe("not_requested")
    expect(takeExecutableRecord(result)).toBeNull()
  })

  test("falls through to tier 2 on an exact miss", async () => {
    const { tx } = makeQueueTx([
      [], // tier 1: no scope rows
      [{ entity_type: "memory_record", entity_id: "mem-2", content: "invoice archiving", rank: 0.26 }],
    ])
    const result = await recallMemory(tx, ACTOR, "invoice archiving", { registryRef: "policy.missing" })
    expect(result.tier).toBe("keyword")
    expect(result.skipped.find((s) => s.tier === "exact")?.kind).toBe("miss")
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Tier 2 -- keyword
//
// LIVE-VERIFIED: the ts_rank values below are the REAL numbers returned by
// the live database (pcrjmlpuqsbocqfwoxod) for these exact two contents
// against plainto_tsquery('english','invoice archive retention'), captured
// in a rolled-back transaction after drizzle/0546 was applied:
//   'Retention policy requires invoices be archived for seven years'
//       -> ts_rank 0.260718, matches true
//   'The office cafeteria serves lunch at noon'
//       -> ts_rank 1e-20,    matches false
// (which also proves the column's English stemming is live: "invoices"
// matched "invoice", "archived" matched "archive".)
// ═══════════════════════════════════════════════════════════════════════
describe("tier 2 (keyword / tsvector)", () => {
  test("ranks memory_records by ts_rank and proposes -- never executes", async () => {
    const { tx } = makeQueueTx([
      [
        { entity_type: "memory_record", entity_id: "mem-lunch", content: "The office cafeteria serves lunch at noon", rank: 1e-20 },
        { entity_type: "memory_record", entity_id: "mem-ret", content: "Retention policy requires invoices be archived for seven years", rank: 0.260718 },
      ],
    ])
    const proposals = await recallKeyword(tx, "invoice archive retention")
    expect(proposals[0].entityId).toBe("mem-ret")
    expect(proposals[0].score).toBeCloseTo(0.260718, 6)
    expect(proposals[0].tier).toBe("keyword")
  })

  test("queries the search_vector column with plainto_tsquery, and excludes ARCHIVED/SUPERSEDED", async () => {
    const { tx, calls } = makeQueueTx([[]])
    await recallKeyword(tx, "retention")
    const emitted = JSON.stringify(calls[0])
    expect(emitted).toContain("search_vector")
    expect(emitted).toContain("plainto_tsquery")
    expect(emitted).toContain("ARCHIVED")
    expect(emitted).toContain("SUPERSEDED")
  })

  test("does not touch document_chunk unless explicitly asked", async () => {
    const { tx, callCount } = makeQueueTx([[], []])
    await recallKeyword(tx, "retention")
    expect(callCount()).toBe(1)

    const second = makeQueueTx([[], []])
    await recallKeyword(second.tx, "retention", { includeDocumentChunks: true })
    expect(second.callCount()).toBe(2)
    expect(JSON.stringify(second.calls[1])).toContain("document_chunk")
  })

  test("filters out non-matching rows below minRank", async () => {
    const { tx } = makeQueueTx([
      [
        { entity_type: "memory_record", entity_id: "mem-lunch", content: "lunch", rank: 1e-20 },
        { entity_type: "memory_record", entity_id: "mem-ret", content: "retention", rank: 0.260718 },
      ],
    ])
    const proposals = await recallKeyword(tx, "retention", { minRank: 0.01 })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].entityId).toBe("mem-ret")
  })

  test("an empty query short-circuits without hitting the database", async () => {
    const { tx, callCount } = makeQueueTx([[]])
    expect(await recallKeyword(tx, "   ")).toEqual([])
    expect(callCount()).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Tier 3 -- vector
// ═══════════════════════════════════════════════════════════════════════
describe("tier 3 (vector)", () => {
  test("proposes findSimilar hits and calls the embedding provider exactly ONCE", async () => {
    let embedCalls = 0
    const embedQuery = async () => {
      embedCalls += 1
      return { vector: [0.1, 0.2], isReal: true, model: "openai/text-embedding-3-small" }
    }
    const result = await recallVector(
      "retention rules",
      "org-1",
      {},
      {
        embedQuery,
        similaritySearch: (async (_q, _o, _l, deps) => {
          // findSimilar must be handed the ALREADY-generated vector, not
          // asked to generate a second one.
          const passed = await deps!.embedQuery!("retention rules")
          expect(passed.model).toBe("openai/text-embedding-3-small")
          return [{ entityType: "memory_record", entityId: "mem-7", score: 0.91, content: "retention" }]
        }) as never,
      }
    )
    expect(result.available).toBe(true)
    expect(embedCalls).toBe(1)
    if (result.available) {
      expect(result.proposals[0].tier).toBe("vector")
      expect(result.proposals[0].score).toBe(0.91)
    }
  })

  test("CRR-017: refuses to score a hash pseudo-vector and reports itself unavailable with a reason", async () => {
    let searchCalled = false
    const result = await recallVector(
      "retention rules",
      "org-1",
      {},
      {
        embedQuery: NO_PROVIDER_EMBED,
        similaritySearch: (async () => {
          searchCalled = true
          return []
        }) as never,
      }
    )
    expect(result.available).toBe(false)
    // The load-bearing assertion: it did not merely return an empty list,
    // it never ran the similarity search at all.
    expect(searchCalled).toBe(false)
    if (!result.available) {
      expect(result.reason).toContain("hash pseudo-vector")
      expect(result.reason).toContain("CRR-017")
    }
  })

  test("respects minScore", async () => {
    const result = await recallVector(
      "q",
      "org-1",
      { minScore: 0.5 },
      {
        embedQuery: REAL_EMBED,
        similaritySearch: (async () => [
          { entityType: "memory_record", entityId: "hi", score: 0.8, content: "a" },
          { entityType: "memory_record", entityId: "lo", score: 0.2, content: "b" },
        ]) as never,
      }
    )
    expect(result.available).toBe(true)
    if (result.available) {
      expect(result.proposals.map((p) => p.entityId)).toEqual(["hi"])
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Tier 4 -- graph-expanded
// ═══════════════════════════════════════════════════════════════════════
describe("tier 4 (graph-expanded)", () => {
  const seed: RecallProposal = {
    tier: "vector",
    entityType: "project",
    entityId: "proj-1",
    content: "the project",
    score: 0.9,
    citationTrail: [],
  }

  function makeGraphDb(nodeExists: boolean, impactRows: unknown[]) {
    const calls: string[] = []
    return {
      calls,
      graphDb: {
        execute: async (q: unknown) => {
          const s = JSON.stringify(q)
          calls.push(s)
          if (s.includes("graph_node")) return nodeExists ? [{ node_key: "table:compliance.projects" }] : []
          return impactRows
        },
      },
    }
  }

  test("expands a mapped seed and attaches a real citation trail", async () => {
    const { graphDb } = makeGraphDb(true, [
      { dependent_table: "table:compliance.pms_budgets", depth: 1, via_column: "project_id" },
    ])
    const { proposals, unmapped } = await recallGraphExpanded([seed], {}, { graphDb })

    expect(unmapped).toEqual([])
    expect(proposals).toHaveLength(1)
    expect(proposals[0].tier).toBe("graph")
    expect(proposals[0].citationTrail).toEqual([
      { fromNodeKey: "table:compliance.projects", toNodeKey: "table:compliance.pms_budgets", depth: 1, viaColumn: "project_id" },
    ])
  })

  test("passes graph_impact's own depth AND row caps through -- never bypasses them", async () => {
    const { graphDb, calls } = makeGraphDb(true, [])
    // Ask for depth 99; it must be clamped to the function's own ceiling.
    await recallGraphExpanded([seed], { depth: 99 }, { graphDb })
    const impactCall = calls.find((c) => c.includes("graph_impact"))!
    expect(impactCall).toContain(String(GRAPH_EXPAND_MAX_DEPTH))
    expect(impactCall).toContain(String(GRAPH_EXPAND_MAX_ROWS))
  })

  test("clampGraphDepth never exceeds the graph function's own ceiling", () => {
    expect(clampGraphDepth(99)).toBe(GRAPH_EXPAND_MAX_DEPTH)
    expect(clampGraphDepth(0)).toBe(1)
    expect(clampGraphDepth(undefined)).toBe(1)
    expect(clampGraphDepth(NaN)).toBe(1)
  })

  test("a seed whose entity type has no graph node is reported as unmapped, not silently dropped", async () => {
    // 'worker_agent' genuinely has no table:compliance.worker_agents node --
    // verified live against platform.graph_node.
    const { graphDb } = makeGraphDb(false, [])
    const { proposals, unmapped } = await recallGraphExpanded(
      [{ ...seed, entityType: "worker_agent" }],
      {},
      { graphDb }
    )
    expect(proposals).toEqual([])
    expect(unmapped).toEqual(["worker_agent"])
  })

  test("an expanded neighbour can never outrank the seed that found it", async () => {
    const { graphDb } = makeGraphDb(true, [
      { dependent_table: "table:compliance.a", depth: 1, via_column: "x" },
      { dependent_table: "table:compliance.b", depth: 2, via_column: "y" },
    ])
    const { proposals } = await recallGraphExpanded([seed], { depth: 2 }, { graphDb })
    expect(proposals[0].score).toBeLessThan(seed.score)
    // deeper hop ranks strictly below the shallower one
    expect(proposals[0].entityId).toBe("table:compliance.a")
    expect(proposals[1].score).toBeLessThan(proposals[0].score)
  })

  test("rerankGraphExpanded is deterministic on score ties", () => {
    const mk = (id: string, score: number): RecallProposal => ({
      tier: "graph", entityType: "graph_node", entityId: id, content: id, score, citationTrail: [],
    })
    expect(rerankGraphExpanded([mk("z", 0.5), mk("a", 0.5)]).map((p) => p.entityId)).toEqual(["a", "z"])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// THE FALSIFIABLE DEGRADATION TEST
//
// This is the real gate for R68 Phase 4 and the proof of requirement 5,
// "works first as software, then with AI".
//
// It simulates a total absence of any model/embedding provider the same
// way the rest of this codebase does -- by making the embedding seam
// behave exactly as generateEmbeddingUncached() really behaves with
// neither OPENROUTER_API_KEY nor GROQ_API_KEY set: a deterministic
// hash-based pseudo-vector with isReal:false and model
// 'hash-pseudo-vector' (see src/lib/embeddings.ts's own last-resort
// branch). It additionally asserts, from the real process environment,
// that neither key is set while the assertions run -- so the test cannot
// quietly pass against a machine that does have a provider configured.
//
// What it proves:
//   * tier 1 (exact)   still returns the CORRECT record
//   * tier 2 (keyword) still returns the CORRECT ranked results
//   * tier 3 (vector)  degrades HONESTLY -- it is skipped with an
//                      explicit reason and never substitutes the
//                      pseudo-vector into a user-facing answer (CRR-017)
//   * tier 4 (graph)   is skipped for the stated, dependent reason
//   * the ladder as a WHOLE keeps answering from whichever tier is
//     available instead of failing outright
// ═══════════════════════════════════════════════════════════════════════
describe("FALSIFIABLE DEGRADATION TEST: the ladder with NO model/embedding provider at all", () => {
  // Guard: if a provider were configured in this environment, the
  // "degraded" simulation below would not represent the real no-provider
  // path and this whole block would be proving nothing.
  test("precondition: no embedding provider is configured in this environment", () => {
    expect(process.env.OPENROUTER_API_KEY ?? "").toBe("")
    expect(process.env.GROQ_API_KEY ?? "").toBe("")
  })

  const NO_AI_DEPS = {
    embedQuery: NO_PROVIDER_EMBED,
    similaritySearch: (async () => {
      throw new Error("findSimilar must never be reached with no real embedding provider")
    }) as never,
    graphDb: {
      execute: async () => {
        throw new Error("the graph tier must never be reached with no tier-3 seeds")
      },
    },
  }

  test("TIER 1 still returns the correct answer with zero AI available", async () => {
    const { tx } = makeQueueTx([[memoryRow({ id: "mem-ret", registry_ref: "policy.retention" })]])
    const result = await recallMemory(tx, ACTOR, "how long do we keep invoices?", { registryRef: "policy.retention" }, NO_AI_DEPS)

    expect(result.tier).toBe("exact")
    const record = takeExecutableRecord(result)
    expect(record).not.toBeNull()
    expect(record!.id).toBe("mem-ret")
    expect(record!.content).toBe("Retention policy requires invoices be archived for seven years")
    // and it is genuinely executable -- the software-only path is the one
    // tier R-CRR-05 permits to act.
    expect(result.mayExecute).toBe(true)
  })

  test("TIER 2 still returns correct, correctly-ranked answers with zero AI available", async () => {
    const { tx } = makeQueueTx([
      [], // tier 1 misses
      // Real ts_rank values from the live database (see the tier 2 note above).
      [
        { entity_type: "memory_record", entity_id: "mem-lunch", content: "The office cafeteria serves lunch at noon", rank: 1e-20 },
        { entity_type: "memory_record", entity_id: "mem-ret", content: "Retention policy requires invoices be archived for seven years", rank: 0.260718 },
      ],
    ])
    const result = await recallMemory(
      tx,
      ACTOR,
      "invoice archive retention",
      { registryRef: "policy.absent", minKeywordRank: 0.01 },
      NO_AI_DEPS
    )

    expect(result.tier).toBe("keyword")
    const proposals = takeProposals(result)
    // The CORRECT answer, and only it -- the irrelevant lunch memory is
    // ranked out by the real ts_rank threshold.
    expect(proposals).toHaveLength(1)
    expect(proposals[0].entityId).toBe("mem-ret")
    expect(proposals[0].content).toContain("Retention policy")
    // ...but it PROPOSES, it does not execute.
    expect(result.mayExecute).toBe(false)
    expect(takeExecutableRecord(result)).toBeNull()
  })

  test("TIER 3 degrades honestly: skipped with an explicit reason, never a pseudo-vector answer", async () => {
    const { tx } = makeQueueTx([
      [], // tier 1 misses
      [], // tier 2 misses
    ])
    const result = await recallMemory(tx, ACTOR, "anything at all", { registryRef: "policy.absent" }, NO_AI_DEPS)

    const vectorSkip = result.skipped.find((s) => s.tier === "vector")
    expect(vectorSkip).toBeDefined()
    // "unavailable" -- NOT "miss". The ladder distinguishes "could not
    // search" from "searched and found nothing".
    expect(vectorSkip!.kind).toBe("unavailable")
    expect(vectorSkip!.reason).toContain("CRR-017")
    expect(vectorSkip!.reason).toContain("OPENROUTER_API_KEY")

    // No pseudo-vector result leaked into the answer.
    expect(takeProposals(result)).toEqual([])
    expect(takeExecutableRecord(result)).toBeNull()
  })

  test("TIER 4 is skipped for the stated dependent reason, not silently", async () => {
    const { tx } = makeQueueTx([[], []])
    const result = await recallMemory(tx, ACTOR, "anything", { registryRef: "policy.absent" }, NO_AI_DEPS)

    const graphSkip = result.skipped.find((s) => s.tier === "graph")
    expect(graphSkip).toBeDefined()
    expect(graphSkip!.kind).toBe("unavailable")
    expect(graphSkip!.reason).toContain("nothing to expand")
  })

  test("the ladder as a whole DEGRADES GRACEFULLY -- it answers from tier 2 rather than failing outright", async () => {
    const { tx } = makeQueueTx([
      [], // tier 1 misses
      [{ entity_type: "memory_record", entity_id: "mem-ret", content: "Retention policy requires invoices be archived for seven years", rank: 0.260718 }],
    ])
    // Note: NO_AI_DEPS throws if tier 3 or 4 is ever reached, so this
    // passing is itself proof the ladder stopped at the software-only tier.
    const result = await recallMemory(tx, ACTOR, "invoice archive retention", { registryRef: "policy.absent" }, NO_AI_DEPS)

    expect(result.tier).toBe("keyword")
    expect(takeProposals(result)).toHaveLength(1)
  })

  test("with every tier exhausted and no AI, the ladder returns 'none' with a full reasoned audit trail -- it does not throw", async () => {
    const { tx } = makeQueueTx([[], []])
    const result = await recallMemory(tx, ACTOR, "nothing matches this", { registryRef: "policy.absent" }, NO_AI_DEPS)

    expect(result.tier).toBe("none")
    expect(result.mayExecute).toBe(false)
    // Every one of the four tiers accounted for, with a reason each.
    expect(result.skipped.map((s) => s.tier).sort()).toEqual(["exact", "graph", "keyword", "vector"])
    for (const skip of result.skipped) {
      expect(skip.reason.length).toBeGreaterThan(0)
    }
  })

  test("CONTRAST: with a real provider the SAME ladder does reach tier 3 -- proving the degradation above is caused by the missing provider, not by a broken ladder", async () => {
    const { tx } = makeQueueTx([[], []])
    const result = await recallMemory(
      tx,
      ACTOR,
      "invoice retention",
      { registryRef: "policy.absent" },
      {
        embedQuery: REAL_EMBED,
        similaritySearch: (async () => [
          { entityType: "memory_record", entityId: "mem-ret", score: 0.88, content: "Retention policy" },
        ]) as never,
      }
    )
    expect(result.tier).toBe("vector")
    expect(takeProposals(result)[0].entityId).toBe("mem-ret")
    // Still proposes only.
    expect(takeExecutableRecord(result)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Ladder ordering
// ═══════════════════════════════════════════════════════════════════════
describe("ladder ordering and fall-through", () => {
  test("the tier order is exactly exact -> keyword -> vector -> graph", () => {
    expect([...RECALL_TIERS]).toEqual(["exact", "keyword", "vector", "graph"])
  })

  test("maxTier stops the ladder early and records the untried tiers", async () => {
    const { tx } = makeQueueTx([[], []])
    const result = await recallMemory(tx, ACTOR, "q", { registryRef: "none", maxTier: "keyword" }, {
      embedQuery: async () => {
        throw new Error("tier 3 must not run when maxTier is 'keyword'")
      },
    })
    expect(result.tier).toBe("none")
    expect(result.skipped.find((s) => s.tier === "vector")?.kind).toBe("not_requested")
    expect(result.skipped.find((s) => s.tier === "graph")?.kind).toBe("not_requested")
  })

  test("a tier-1 hit short-circuits -- no lower tier is queried at all", async () => {
    const { tx, callCount } = makeQueueTx([[memoryRow()]])
    const result = await recallMemory(tx, ACTOR, "q", { registryRef: "policy.retention" }, {
      embedQuery: async () => {
        throw new Error("tier 3 must not run after a tier-1 hit")
      },
    })
    expect(result.tier).toBe("exact")
    expect(callCount()).toBe(1)
  })
})
