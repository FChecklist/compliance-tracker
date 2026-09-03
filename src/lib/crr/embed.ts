// CRR P3-BRIDGE (2026-08-27), platform.crr_spec CRR-079/CRR-080 (this
// file's original storeChunkEmbedding) plus CRR-081/CRR-082 (added below:
// storeChunkEmbeddingsBatch, its batched-and-resumable sibling -- see that
// function's own header for the split of responsibilities).
// storeChunkEmbedding is the "then chunk/embed separately" half of
// capture.ts's own header comment -- turns one already-chunked TextChunk
// (chunker.ts's pure, DB-free output) into a real compliance.document_chunk
// row carrying a real embedding vector. Wired in from document-extraction-
// service.ts's extractDocumentContent, immediately after chunkText() runs
// on the freshly-extracted plain text.
//
// D-1 protection (mirrors embeddings.ts's storeEmbedding, CRR-017): reuses
// generateEmbeddingUncached's own real-vs-hash-pseudo-vector signal instead
// of inventing a second copy of that provider chain -- an embedding call
// that only produced a hash pseudo-vector (no real provider configured/
// reachable) throws instead of writing an is_real=false row. This point's
// own gate_fail is explicit: "Zero chunks or any is_real=false" -- a
// silently-degraded chunk vector sitting in document_chunk would poison
// retrieval exactly as an unreal row in compliance.embeddings would.
// D-2 protection (mirrors CRR-018/019's mandatory-orgId discipline):
// orgId is a required argument here too, always the parent source_object's
// own org_id (never inferred, never defaulted) -- document_chunk's RLS
// policy (`org_id = compliance.current_org_id()`) depends on this column
// being correct for every row.
//
// document_chunk.embedding (vector(1536)) has no Drizzle column (see
// schema.ts's own comment on the documentChunk table) -- written via the
// same raw postgres.js tagged-template client pattern as embeddings.ts's
// storeEmbedding, for the same reason (Drizzle has no first-class pgvector
// type). That raw client connects via the `postgres` role (RLS-bypass), the
// same as embeddings.ts's own -- document_chunk's own
// `service_role_bypass_document_chunk` / tenant-isolation RLS policies are
// therefore not exercised by this write path, matching the precedent
// storeEmbedding already established for compliance.embeddings.
//
// Dependency injection (deps.embed / deps.sqlClient), NOT mock.module():
// both the "postgres" package and "@/lib/embeddings" are imported unmocked,
// for real, by several other test files in this codebase (db/index.ts,
// tenant-scoped.ts, ai-config-crypto.ts, db/seed.ts all import "postgres"
// directly) -- Bun's mock.module() leaks a mocked module across every test
// FILE in one `bun test` run, not just within the file that calls it. This
// is the exact bug capture.test.ts's own header documents hitting for
// "@supabase/supabase-js" during CRR-078 -- same root cause, same fix.

import { createHash } from "node:crypto"
import postgres from "postgres"
import { getConnectionString } from "@/lib/db/connection-string"
import type { TextChunk } from "@/lib/crr/chunker"

let rawClient: ReturnType<typeof postgres> | null = null
function getRawClient() {
  if (!rawClient) {
    rawClient = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      // Same rationale as embeddings.ts's own raw client: occasional
      // chunk-write traffic (fires once per uploaded document's extraction),
      // not hot-path query volume -- a small explicit cap, not the
      // library's own default-10 ceiling.
      max: 2,
    })
  }
  return rawClient
}

// R68 Phase 5: `model` added to this return shape (was `{ vector, isReal }`
// only) -- persisted verbatim into document_chunk.embedding_model below, the
// same field compliance.embeddings.embedding_model carries via
// embeddings.ts's own storeEmbedding. Real callers (defaultEmbed) already
// produce it unchanged, since generateEmbeddingUncached's own return shape
// grew this field.
export type EmbedFn = (text: string) => Promise<{ vector: number[]; isReal: boolean; model: string }>

// The one shape this file actually calls a postgres.js client as -- a
// tagged-template function returning the matched rows. Narrow on purpose
// (same reasoning as capture.ts's SourceObjectStorageClient) so a test can
// pass an in-memory fake instead of a real `postgres()` connection.
export type ChunkSqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ id: string }[]>

// Rough chars-per-token estimate (~4 chars/token, the commonly-cited
// average for English prose against OpenAI/GPT-family tokenizers) -- this
// column is advisory metadata for capacity planning, not fed into any
// prompt-budget decision the way context-assembly.ts's own token estimate
// is, so a second, simpler heuristic here (rather than importing that
// file's private estimateTokens) is a deliberate, disclosed simplification,
// not drift.
function estimateTokenCount(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4))
}

export type StoreChunkEmbeddingInput = {
  /** Always the parent source_object's own org_id -- see this file's D-2 header note. */
  orgId: string
  sourceObjectId: string
  chunk: TextChunk
}

export type StoreChunkEmbeddingResult = {
  id: string
  isReal: true
}

/**
 * Persists one TextChunk as a real compliance.document_chunk row carrying a
 * real embedding vector. Throws -- and persists nothing -- when only a hash
 * pseudo-vector is available; see this file's header (D-1).
 */
export async function storeChunkEmbedding(
  input: StoreChunkEmbeddingInput,
  deps: { embed?: EmbedFn; sqlClient?: ChunkSqlClient } = {}
): Promise<StoreChunkEmbeddingResult> {
  const embed = deps.embed ?? defaultEmbed
  const client = deps.sqlClient ?? (getRawClient() as unknown as ChunkSqlClient)

  const result = await embed(input.chunk.content)
  if (!result.isReal) {
    throw new Error(
      `storeChunkEmbedding: no real embedding provider available for source_object ${input.sourceObjectId} chunk#${input.chunk.seq} -- refusing to persist a hash pseudo-vector (see CRR-017/D-1)`
    )
  }

  const contentHash = createHash("sha256").update(input.chunk.content).digest("hex")
  const vectorStr = `[${result.vector.join(",")}]`
  const tokenEstimate = estimateTokenCount(input.chunk.content)

  // R68 Phase 5: embedding_model/dim derived from the embed() result itself
  // (never a new required input to this function) -- matches
  // embeddings.ts's storeEmbedding, which derives the same two columns the
  // same way for compliance.embeddings.
  const rows = await client`
    INSERT INTO compliance.document_chunk
      (id, source_object_id, org_id, seq, char_start, char_end, content, content_hash, token_estimate, is_real, embedding, embedding_model, dim, created_at)
    VALUES
      (gen_random_uuid()::text, ${input.sourceObjectId}, ${input.orgId}, ${input.chunk.seq}, ${input.chunk.charStart}, ${input.chunk.charEnd}, ${input.chunk.content}, ${contentHash}, ${tokenEstimate}, true, ${vectorStr}::vector, ${result.model}, ${result.vector.length}, NOW())
    RETURNING id
  `
  return { id: rows[0].id, isReal: true }
}

async function defaultEmbed(text: string): Promise<{ vector: number[]; isReal: boolean; model: string }> {
  const { generateEmbeddingUncached } = await import("@/lib/embeddings")
  return generateEmbeddingUncached(text)
}

// CRR-081/CRR-082 (P3-BRIDGE): storeChunkEmbeddingsBatch is the batched,
// resumable sibling of storeChunkEmbedding above -- used by
// chunkAndEmbedSourceObject (document-extraction-service.ts) instead of
// calling storeChunkEmbedding in a plain per-chunk loop.
//
// CRR-081 (batching): chunks are grouped into DEFAULT_BATCH_SIZE-sized
// groups and each group is embedded with ONE call to deps.embedBatch (real
// default: generateEmbeddingsBatchUncached, one HTTP request carrying an
// array `input` -- see embeddings.ts's own header) instead of one HTTP call
// per chunk. Each embedded chunk is still persisted through the existing,
// already-tested storeChunkEmbedding (same D-1/D-2 guarantees, same exact
// INSERT shape) by handing it a trivial `embed` stub that just resolves to
// the batch-computed vector -- this reuses the one tested INSERT code path
// instead of forking a second copy of it.
//
// CRR-082 (resumable): before embedding anything, reads which (source_
// object_id, seq) pairs already have a compliance.document_chunk row (a
// prior attempt that got partway through and crashed/timed out/hit
// maxDuration, then was retried) and skips those chunks entirely -- neither
// re-embedded (no wasted provider call) nor re-inserted (no risk of
// violating document_chunk_source_object_id_seq_key, the live unique index
// on (source_object_id, seq)). A batch that fails partway through (a batch
// embed call throws) throws out of this function without having advanced
// source_object.extract_status past CHUNKED -- chunkAndEmbedSourceObject's
// own embed-phase handling (not this file) is what leaves extract_status at
// CHUNKED rather than regressing it to FAILED, exactly so a retry calls this
// same function again and the pre-check above skips everything already
// written.
// R68 Phase 5: `model` added per item, same reasoning as EmbedFn above.
export type BatchEmbedFn = (texts: string[]) => Promise<{ vector: number[]; isReal: boolean; model: string }[]>

// The one shape this file's resumability pre-check actually needs: a
// tagged-template function returning rows with a numeric `seq`. Separately
// typed from ChunkSqlClient (whose rows carry `id`, from an INSERT...
// RETURNING) even though both are satisfied by the same real postgres.js
// client at runtime -- same narrow-on-purpose reasoning as ChunkSqlClient
// itself, so a test can inject a fake that only needs to answer this one
// SELECT shape.
export type ChunkSeqLookupClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ seq: number }[]>

// One provider HTTP call per this many chunks -- matches
// generateEmbeddingsBatchUncached's own 8000-char-per-text truncation with
// headroom: a generic chunk_policy row (max_chars=1200) times 16 stays
// comfortably under typical request-body/provider batch-size ceilings
// (OpenAI's own embeddings endpoint documents up to 2048 inputs per call;
// this is deliberately far below that, favouring more, smaller, resumable
// batches over fewer, larger ones that lose more work on a single failure).
const DEFAULT_BATCH_SIZE = 16

export type StoreChunkEmbeddingsBatchInput = {
  orgId: string
  sourceObjectId: string
  chunks: TextChunk[]
}

export type StoreChunkEmbeddingsBatchResult = {
  /** Count of chunks newly embedded and written by this call. */
  written: number
  /** Count of chunks whose (source_object_id, seq) already existed and were left untouched -- see CRR-082. */
  skipped: number
}

async function getExistingSeqs(sourceObjectId: string, client: ChunkSeqLookupClient): Promise<Set<number>> {
  const rows = await client`SELECT seq FROM compliance.document_chunk WHERE source_object_id = ${sourceObjectId}`
  return new Set(rows.map((r) => r.seq))
}

export async function storeChunkEmbeddingsBatch(
  input: StoreChunkEmbeddingsBatchInput,
  deps: {
    embedBatch?: BatchEmbedFn
    sqlClient?: ChunkSqlClient
    seqLookupClient?: ChunkSeqLookupClient
    batchSize?: number
  } = {}
): Promise<StoreChunkEmbeddingsBatchResult> {
  const embedBatch = deps.embedBatch ?? defaultEmbedBatch
  const insertClient = deps.sqlClient ?? (getRawClient() as unknown as ChunkSqlClient)
  const seqLookupClient = deps.seqLookupClient ?? (getRawClient() as unknown as ChunkSeqLookupClient)
  const batchSize = deps.batchSize && deps.batchSize > 0 ? deps.batchSize : DEFAULT_BATCH_SIZE

  const existingSeqs = await getExistingSeqs(input.sourceObjectId, seqLookupClient)
  const pending = input.chunks.filter((c) => !existingSeqs.has(c.seq))
  const skipped = input.chunks.length - pending.length

  let written = 0
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)
    const results = await embedBatch(batch.map((c) => c.content))
    if (results.length !== batch.length) {
      throw new Error(
        `storeChunkEmbeddingsBatch: provider returned ${results.length} vectors for a batch of ${batch.length} chunks (source_object ${input.sourceObjectId}) -- refusing to write mismatched rows`
      )
    }

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j]
      const result = results[j]
      // storeChunkEmbedding's own D-1 check (throws, writes nothing) fires
      // here when result.isReal is false -- not duplicated in this function.
      await storeChunkEmbedding(
        { orgId: input.orgId, sourceObjectId: input.sourceObjectId, chunk },
        { embed: async () => result, sqlClient: insertClient }
      )
      written++
    }
  }

  return { written, skipped }
}

async function defaultEmbedBatch(texts: string[]): Promise<{ vector: number[]; isReal: boolean; model: string }[]> {
  const { generateEmbeddingsBatchUncached } = await import("@/lib/embeddings")
  return generateEmbeddingsBatchUncached(texts)
}
