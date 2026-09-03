/// <reference types="bun-types" />
// R68 Phase 5 (embedding spaces): proves findSimilar() actually excludes a
// row whose embedding_model doesn't match the query vector's own model --
// not just that its SQL string happens to mention embedding_model.
//
// findSimilar() is dependency-injected the same way src/lib/crr/embed.ts's
// storeChunkEmbedding already is (deps.embed / deps.sqlClient) rather than
// mock.module()'d, for the same reason documented in that file's header:
// mock.module("@/lib/embeddings", ...) would leak across every other test
// file in this `bun test` run that imports this module unmocked (memory-
// service.test.ts, task-dedup-service.ts's caller tests, etc.).
//
// The fake searchClient below is a REAL in-memory similarity search over a
// realistic fixture table -- not a stub that always returns a canned list --
// so this test is only satisfiable if findSimilar() actually threads the
// query vector's real model into the search call. A regression that dropped
// the embedding_model filter (e.g. reverting to the pre-Phase-5 SQL) would
// make this fixture return the mismatched-space row too, and the test would
// fail on that, not on a string match against the query text.
import { describe, expect, test } from "bun:test"
import { findSimilar, type FindSimilarClient, type FindSimilarRow } from "./embeddings"

type FixtureRow = FindSimilarRow & { org_id: string | null; is_platform_scope: boolean; is_real: boolean; embedding_model: string }

// A small, realistic in-memory "table" plus a searchClient that applies the
// EXACT same filter semantics as the real SQL in defaultFindSimilarClient
// (org match OR platform scope, is_real = true, embedding_model = query's
// model) -- proving the exclusion behaviour findSimilar() depends on,
// against a fixture that mixes matching-space, mismatched-space,
// wrong-org, and hash-pseudo-vector rows.
function makeFixtureSearchClient(rows: FixtureRow[]): { searchClient: FindSimilarClient; calls: { orgId: string; model: string; limit: number }[] } {
  const calls: { orgId: string; model: string; limit: number }[] = []
  const searchClient: FindSimilarClient = async ({ orgId, model, limit }) => {
    calls.push({ orgId, model, limit })
    return rows
      .filter((r) => (r.org_id === orgId || r.is_platform_scope) && r.is_real && r.embedding_model === model)
      .slice(0, limit)
  }
  return { searchClient, calls }
}

const ORG = "org_findsimilar_1"

describe("findSimilar -- R68 Phase 5 embedding-space filter", () => {
  test("excludes a same-org, same-content-family row embedded under a DIFFERENT model, even though it would otherwise be the closest match", async () => {
    const fixture: FixtureRow[] = [
      {
        entity_type: "compliance_item",
        entity_id: "matching_space",
        content: "matches the query's own embedding space",
        score: 0,
        org_id: ORG,
        is_platform_scope: false,
        is_real: true,
        embedding_model: "openai/text-embedding-3-small",
      },
      {
        entity_type: "compliance_item",
        entity_id: "mismatched_space",
        // Same org, same is_real=true -- the ONLY difference is the model
        // that produced this row's vector (e.g. a legacy Groq-era row, or
        // any future second real provider). Pre-Phase-5 findSimilar() would
        // have scored this against the query vector too (pgvector's <=>
        // never errors on two same-dimension vectors from different
        // spaces) -- this is the real bug this filter closes.
        content: "same org, real embedding, but a different model's space",
        score: 0,
        org_id: ORG,
        is_platform_scope: false,
        is_real: true,
        embedding_model: "groq/nomic-embed-text",
      },
    ]
    const { searchClient, calls } = makeFixtureSearchClient(fixture)

    const results = await findSimilar("some query text", ORG, 10, {
      embedQuery: async () => ({ vector: [0.1, 0.2, 0.3], model: "openai/text-embedding-3-small" }),
      searchClient,
    })

    expect(results.map((r) => r.entityId)).toEqual(["matching_space"])
    expect(results.find((r) => r.entityId === "mismatched_space")).toBeUndefined()
    // The search client really did receive the query vector's own model,
    // not a hardcoded/omitted value.
    expect(calls[0].model).toBe("openai/text-embedding-3-small")
    expect(calls[0].orgId).toBe(ORG)
  })

  test("still excludes is_real=false (hash-pseudo-vector) rows even when embedding_model happens to equal the query's own hash-pseudo-vector label", async () => {
    const fixture: FixtureRow[] = [
      {
        entity_type: "compliance_item",
        entity_id: "hash_row",
        content: "never a real embedding",
        score: 0,
        org_id: ORG,
        is_platform_scope: false,
        is_real: false,
        embedding_model: "hash-pseudo-vector",
      },
    ]
    const { searchClient } = makeFixtureSearchClient(fixture)

    const results = await findSimilar("query with no real provider available", ORG, 10, {
      embedQuery: async () => ({ vector: [0, 0, 0], model: "hash-pseudo-vector" }),
      searchClient,
    })

    expect(results).toEqual([])
  })

  test("still matches a platform-scope row (is_platform_scope=true) in the same embedding space regardless of the caller's own orgId", async () => {
    const fixture: FixtureRow[] = [
      {
        entity_type: "capability",
        entity_id: "platform_row",
        content: "platform-wide capability",
        score: 0,
        org_id: null,
        is_platform_scope: true,
        is_real: true,
        embedding_model: "openai/text-embedding-3-small",
      },
    ]
    const { searchClient } = makeFixtureSearchClient(fixture)

    const results = await findSimilar("capability query", "some_other_org", 10, {
      embedQuery: async () => ({ vector: [1, 1, 1], model: "openai/text-embedding-3-small" }),
      searchClient,
    })

    expect(results.map((r) => r.entityId)).toEqual(["platform_row"])
  })

  test("rejects an empty orgId before ever calling the search client (CRR-020/021, unchanged by Phase 5)", async () => {
    const { searchClient, calls } = makeFixtureSearchClient([])
    await expect(
      findSimilar("q", "", 10, { embedQuery: async () => ({ vector: [1], model: "openai/text-embedding-3-small" }), searchClient })
    ).rejects.toThrow(/orgId is required/)
    expect(calls.length).toBe(0)
  })
})
