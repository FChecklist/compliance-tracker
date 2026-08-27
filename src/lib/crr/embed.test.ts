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
import { storeChunkEmbedding, type ChunkSqlClient, type EmbedFn } from "./embed"
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
})

const hashPseudoEmbed: EmbedFn = async () => ({ isReal: false, vector: [0, 0, 0] })

describe("storeChunkEmbedding", () => {
  test("persists a real chunk row: is_real=true, embedding cast to ::vector, content/offsets passed through", async () => {
    const { client, calls } = makeFakeSqlClient()
    const chunk = makeChunk({ seq: 3, charStart: 100, charEnd: 111, content: "hello world" })

    const result = await storeChunkEmbedding(
      { orgId: "org_embed_1", sourceObjectId: "so_1", docUid: "doc_uid_1", chunk },
      { embed: realEmbed, sqlClient: client }
    )

    expect(result.isReal).toBe(true)
    expect(result.id).toBe("fake-chunk-id-1")
    expect(calls.length).toBe(1)
    const { strings, values } = calls[0]
    expect(strings.join("")).toContain("INSERT INTO compliance.document_chunk")
    expect(strings.join("")).toContain("::vector")
    // Positional values, in the exact order the INSERT's ${...} interpolations
    // appear: source_object_id, org_id, doc_uid, seq, char_start, char_end,
    // content, content_hash, token_estimate, embedding literal (is_real is a
    // literal `true` in the SQL text itself, not interpolated -- see embed.ts).
    expect(values[0]).toBe("so_1")
    expect(values[1]).toBe("org_embed_1")
    expect(values[2]).toBe("doc_uid_1")
    expect(values[3]).toBe(3)
    expect(values[4]).toBe(100)
    expect(values[5]).toBe(111)
    expect(values[6]).toBe("hello world")
    expect(typeof values[7]).toBe("string") // content_hash (sha256 hex)
    expect((values[7] as string).length).toBe(64)
    expect(values[8]).toBeGreaterThan(0) // token_estimate
    expect(values[9]).toBe("[11,104,0.5,-0.25]") // the vector literal
  })

  test("D-1: refuses to persist a hash pseudo-vector -- throws, and the sql client is never called", async () => {
    const { client, calls } = makeFakeSqlClient()

    await expect(
      storeChunkEmbedding(
        { orgId: "org_embed_2", sourceObjectId: "so_2", docUid: "doc_uid_2", chunk: makeChunk() },
        { embed: hashPseudoEmbed, sqlClient: client }
      )
    ).rejects.toThrow(/refusing to persist a hash pseudo-vector/)
    expect(calls.length).toBe(0)
  })

  test("D-2: writes the caller-supplied orgId verbatim (the parent source_object's own org_id), never a different value", async () => {
    const { client, calls } = makeFakeSqlClient()
    await storeChunkEmbedding(
      { orgId: "org_parent_source_object", sourceObjectId: "so_3", docUid: "doc_uid_3", chunk: makeChunk() },
      { embed: realEmbed, sqlClient: client }
    )
    expect(calls[0].values[1]).toBe("org_parent_source_object")
  })

  // CRR-223: mirrors D-2's discipline for doc_uid -- the caller-supplied
  // doc_uid is written verbatim, positioned right after org_id.
  test("CRR-223: writes the caller-supplied docUid verbatim, alongside source_object_id", async () => {
    const { client, calls } = makeFakeSqlClient()
    await storeChunkEmbedding(
      { orgId: "org_doc_uid_check", sourceObjectId: "so_docuid", docUid: "doc_uid_verbatim_check", chunk: makeChunk() },
      { embed: realEmbed, sqlClient: client }
    )
    expect(calls[0].values[0]).toBe("so_docuid")
    expect(calls[0].values[2]).toBe("doc_uid_verbatim_check")
  })

  test("token_estimate is a positive integer derived from content length, not a hardcoded constant", async () => {
    const { client, calls } = makeFakeSqlClient()
    const shortChunk = makeChunk({ content: "hi" })
    const longChunk = makeChunk({ content: "a".repeat(400) })

    await storeChunkEmbedding({ orgId: "org_x", sourceObjectId: "so_4", docUid: "doc_uid_4", chunk: shortChunk }, { embed: realEmbed, sqlClient: client })
    await storeChunkEmbedding({ orgId: "org_x", sourceObjectId: "so_4", docUid: "doc_uid_4", chunk: longChunk }, { embed: realEmbed, sqlClient: client })

    const shortEstimate = calls[0].values[8] as number
    const longEstimate = calls[1].values[8] as number
    expect(shortEstimate).toBeGreaterThan(0)
    expect(longEstimate).toBeGreaterThan(shortEstimate)
  })

  test("distinct chunks with distinct content hash to distinct content_hash values", async () => {
    const { client, calls } = makeFakeSqlClient()
    await storeChunkEmbedding(
      { orgId: "org_y", sourceObjectId: "so_5", docUid: "doc_uid_5", chunk: makeChunk({ seq: 0, content: "chunk A content" }) },
      { embed: realEmbed, sqlClient: client }
    )
    await storeChunkEmbedding(
      { orgId: "org_y", sourceObjectId: "so_5", docUid: "doc_uid_5", chunk: makeChunk({ seq: 1, content: "chunk B content, different" }) },
      { embed: realEmbed, sqlClient: client }
    )
    expect(calls[0].values[7]).not.toBe(calls[1].values[7])
  })
})
