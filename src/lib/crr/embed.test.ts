/// <reference types="bun-types" />
// platform.crr_spec CRR-079/CRR-080. Both the real embedding provider chain
// and the real DB write are dependency-injected (deps.embed / deps.sqlClient)
// rather than mock.module()'d -- see embed.ts's own header for why
// mock.module("postgres", ...) or mock.module("@/lib/embeddings", ...) would
// leak across other test files in this codebase that import those modules
// unmocked (same class of bug capture.test.ts's header documents for
// "@supabase/supabase-js").
//
// The live-DB half of this point's proof (real chunks, real is_real=true
// vectors actually landing in compliance.document_chunk) is verified
// separately against the real table -- see CRR-079's evidence in
// platform.crr_spec for that query and its result.
import { describe, expect, test } from "bun:test"
import {
  storeChunkEmbedding,
  storeChunkEmbeddingsBatch,
  type BatchEmbedFn,
  type ChunkSeqLookupClient,
  type ChunkSqlClient,
  type EmbedFn,
} from "./embed"
import type { TextChunk } from "./chunker"

function makeChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  return { seq: 0, charStart: 0, charEnd: 11, content: "hello world", ...overrides }
}

// Fake of the one shape embed.ts's raw client is actually called as: a
// tagged-template function. Records every call so tests can assert on the
// exact values written (org_id, source_object_id, is_real, the vector
// literal), the same "record the call, replay it in an assertion" style
// capture.test.ts's makeTx() already established.
function makeFakeSqlClient(): { client: ChunkSqlClient; calls: { strings: TemplateStringsArray; values: unknown[] }[] } {
  const calls: { strings: TemplateStringsArray; values: unknown[] }[] = []
  const client: ChunkSqlClient = async (strings, ...values) => {
    calls.push({ strings, values })
    return [{ id: `fake-chunk-id-${calls.length}` }]
  }
  return { client, calls }
}

const realEmbed: EmbedFn = async (text: string) => ({
  isReal: true,
  // Deterministic, content-derived "vector" -- not a real semantic
  // embedding (no network call in a unit test, see this file's header), but
  // a real, non-degenerate 4-dim numeric array so assertions on shape/values
  // are meaningful rather than checking a hardcoded constant.
  vector: [text.length, text.charCodeAt(0) || 0, 0.5, -0.25],
  model: "openai/text-embedding-3-small",
})

const hashPseudoEmbed: EmbedFn = async () => ({ isReal: false, vector: [0, 0, 0], model: "hash-pseudo-vector" })

describe("storeChunkEmbedding", () => {
  test("persists a real chunk row: is_real=true, embedding cast to ::vector, content/offsets passed through", async () => {
    const { client, calls } = makeFakeSqlClient()
    const chunk = makeChunk({ seq: 3, charStart: 100, charEnd: 111, content: "hello world" })

    const result = await storeChunkEmbedding(
      { orgId: "org_embed_1", sourceObjectId: "so_1", chunk },
      { embed: realEmbed, sqlClient: client }
    )

    expect(result.isReal).toBe(true)
    expect(result.id).toBe("fake-chunk-id-1")
    expect(calls.length).toBe(1)
    const { strings, values } = calls[0]
    expect(strings.join("")).toContain("INSERT INTO compliance.document_chunk")
    expect(strings.join("")).toContain("::vector")
    // Positional values, in the exact order the INSERT's ${...} interpolations
    // appear: source_object_id, org_id, seq, char_start, char_end, content,
    // content_hash, token_estimate, embedding literal, embedding_model, dim
    // (is_real is a literal `true` in the SQL text itself, not interpolated
    // -- see embed.ts).
    expect(values[0]).toBe("so_1")
    expect(values[1]).toBe("org_embed_1")
    expect(values[2]).toBe(3)
    expect(values[3]).toBe(100)
    expect(values[4]).toBe(111)
    expect(values[5]).toBe("hello world")
    expect(typeof values[6]).toBe("string") // content_hash (sha256 hex)
    expect((values[6] as string).length).toBe(64)
    expect(values[7]).toBeGreaterThan(0) // token_estimate
    expect(values[8]).toBe("[11,104,0.5,-0.25]") // the vector literal
    // R68 Phase 5: embedding_model/dim, derived from the embed() result
    // itself, not a caller-supplied argument.
    expect(values[9]).toBe("openai/text-embedding-3-small")
    expect(values[10]).toBe(4)
  })

  test("D-1: refuses to persist a hash pseudo-vector -- throws, and the sql client is never called", async () => {
    const { client, calls } = makeFakeSqlClient()

    await expect(
      storeChunkEmbedding({ orgId: "org_embed_2", sourceObjectId: "so_2", chunk: makeChunk() }, { embed: hashPseudoEmbed, sqlClient: client })
    ).rejects.toThrow(/refusing to persist a hash pseudo-vector/)
    expect(calls.length).toBe(0)
  })

  test("D-2: writes the caller-supplied orgId verbatim (the parent source_object's own org_id), never a different value", async () => {
    const { client, calls } = makeFakeSqlClient()
    await storeChunkEmbedding(
      { orgId: "org_parent_source_object", sourceObjectId: "so_3", chunk: makeChunk() },
      { embed: realEmbed, sqlClient: client }
    )
    expect(calls[0].values[1]).toBe("org_parent_source_object")
  })

  test("token_estimate is a positive integer derived from content length, not a hardcoded constant", async () => {
    const { client, calls } = makeFakeSqlClient()
    const shortChunk = makeChunk({ content: "hi" })
    const longChunk = makeChunk({ content: "a".repeat(400) })

    await storeChunkEmbedding({ orgId: "org_x", sourceObjectId: "so_4", chunk: shortChunk }, { embed: realEmbed, sqlClient: client })
    await storeChunkEmbedding({ orgId: "org_x", sourceObjectId: "so_4", chunk: longChunk }, { embed: realEmbed, sqlClient: client })

    const shortEstimate = calls[0].values[7] as number
    const longEstimate = calls[1].values[7] as number
    expect(shortEstimate).toBeGreaterThan(0)
    expect(longEstimate).toBeGreaterThan(shortEstimate)
  })

  test("distinct chunks with distinct content hash to distinct content_hash values", async () => {
    const { client, calls } = makeFakeSqlClient()
    await storeChunkEmbedding(
      { orgId: "org_y", sourceObjectId: "so_5", chunk: makeChunk({ seq: 0, content: "chunk A content" }) },
      { embed: realEmbed, sqlClient: client }
    )
    await storeChunkEmbedding(
      { orgId: "org_y", sourceObjectId: "so_5", chunk: makeChunk({ seq: 1, content: "chunk B content, different" }) },
      { embed: realEmbed, sqlClient: client }
    )
    expect(calls[0].values[6]).not.toBe(calls[1].values[6])
  })
})

// CRR-081 (batching) / CRR-082 (resumable) -- storeChunkEmbeddingsBatch.
function makeChunks(n: number): TextChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: i,
    charStart: i * 10,
    charEnd: i * 10 + 9,
    content: `chunk content number ${i}`,
  }))
}

function makeFakeSeqLookupClient(existing: number[]): ChunkSeqLookupClient {
  return (async () => existing.map((seq) => ({ seq }))) as unknown as ChunkSeqLookupClient
}

describe("storeChunkEmbeddingsBatch", () => {
  test("CRR-081: sends one embedBatch call per BATCH of chunks, not one call per chunk", async () => {
    const { client } = makeFakeSqlClient()
    const batchCalls: string[][] = []
    const embedBatch: BatchEmbedFn = async (texts) => {
      batchCalls.push(texts)
      return texts.map((t) => ({ isReal: true, vector: [t.length, 0, 0], model: "openai/text-embedding-3-small" }))
    }

    const result = await storeChunkEmbeddingsBatch(
      { orgId: "org_batch_1", sourceObjectId: "so_batch_1", chunks: makeChunks(10) },
      { embedBatch, sqlClient: client, seqLookupClient: makeFakeSeqLookupClient([]), batchSize: 4 }
    )

    // 10 chunks at batchSize=4 -> 3 provider calls (4, 4, 2), never 10.
    expect(batchCalls.length).toBe(3)
    expect(batchCalls[0].length).toBe(4)
    expect(batchCalls[1].length).toBe(4)
    expect(batchCalls[2].length).toBe(2)
    expect(result.written).toBe(10)
    expect(result.skipped).toBe(0)
  })

  test("CRR-082: skips chunks whose seq already has a document_chunk row, and never embeds them", async () => {
    const { client } = makeFakeSqlClient()
    const embeddedSeqs: number[] = []
    const embedBatch: BatchEmbedFn = async (texts) => {
      // Content is "chunk content number N" -- record which N's were embedded.
      for (const t of texts) embeddedSeqs.push(Number(t.split(" ").pop()))
      return texts.map(() => ({ isReal: true, vector: [1, 2, 3], model: "openai/text-embedding-3-small" }))
    }

    // Simulate a prior attempt that got 5 of 10 chunks (seq 0-4) written
    // before crashing.
    const result = await storeChunkEmbeddingsBatch(
      { orgId: "org_resume_1", sourceObjectId: "so_resume_1", chunks: makeChunks(10) },
      { embedBatch, sqlClient: client, seqLookupClient: makeFakeSeqLookupClient([0, 1, 2, 3, 4]), batchSize: 16 }
    )

    expect(result.skipped).toBe(5)
    expect(result.written).toBe(5)
    expect(embeddedSeqs.sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9])
  })

  test("CRR-082: a full resume (every seq already exists) makes zero provider calls and writes nothing", async () => {
    const { client } = makeFakeSqlClient()
    let embedBatchCalls = 0
    const embedBatch: BatchEmbedFn = async (texts) => {
      embedBatchCalls++
      return texts.map(() => ({ isReal: true, vector: [1], model: "openai/text-embedding-3-small" }))
    }

    const result = await storeChunkEmbeddingsBatch(
      { orgId: "org_resume_2", sourceObjectId: "so_resume_2", chunks: makeChunks(5) },
      { embedBatch, sqlClient: client, seqLookupClient: makeFakeSeqLookupClient([0, 1, 2, 3, 4]) }
    )

    expect(embedBatchCalls).toBe(0)
    expect(result.written).toBe(0)
    expect(result.skipped).toBe(5)
  })

  test("D-1 still applies per-item inside a batch: a hash pseudo-vector in the results throws and stops further writes in that batch", async () => {
    const { client, calls } = makeFakeSqlClient()
    const embedBatch: BatchEmbedFn = async (texts) =>
      texts.map((_, i) => (i === 1 ? { isReal: false, vector: [0], model: "hash-pseudo-vector" } : { isReal: true, vector: [1, 2], model: "openai/text-embedding-3-small" }))

    await expect(
      storeChunkEmbeddingsBatch(
        { orgId: "org_d1", sourceObjectId: "so_d1", chunks: makeChunks(3) },
        { embedBatch, sqlClient: client, seqLookupClient: makeFakeSeqLookupClient([]), batchSize: 3 }
      )
    ).rejects.toThrow(/refusing to persist a hash pseudo-vector/)
    // Chunk 0 (real) was written before chunk 1 (hash) threw; chunk 2 never ran.
    expect(calls.length).toBe(1)
  })

  test("throws when the provider returns a different number of vectors than chunks in the batch", async () => {
    const { client } = makeFakeSqlClient()
    const embedBatch: BatchEmbedFn = async () => [{ isReal: true, vector: [1], model: "openai/text-embedding-3-small" }] // 1 result for 3 chunks

    await expect(
      storeChunkEmbeddingsBatch(
        { orgId: "org_mismatch", sourceObjectId: "so_mismatch", chunks: makeChunks(3) },
        { embedBatch, sqlClient: client, seqLookupClient: makeFakeSeqLookupClient([]) }
      )
    ).rejects.toThrow(/provider returned 1 vectors for a batch of 3 chunks/)
  })
})
