// CRR P3-BRIDGE (2026-08-27), platform.crr_spec CRR-079/CRR-080:
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

export type EmbedFn = (text: string) => Promise<{ vector: number[]; isReal: boolean }>

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

  const rows = await client`
    INSERT INTO compliance.document_chunk
      (id, source_object_id, org_id, seq, char_start, char_end, content, content_hash, token_estimate, is_real, embedding, created_at)
    VALUES
      (gen_random_uuid()::text, ${input.sourceObjectId}, ${input.orgId}, ${input.chunk.seq}, ${input.chunk.charStart}, ${input.chunk.charEnd}, ${input.chunk.content}, ${contentHash}, ${tokenEstimate}, true, ${vectorStr}::vector, NOW())
    RETURNING id
  `
  return { id: rows[0].id, isReal: true }
}

async function defaultEmbed(text: string): Promise<{ vector: number[]; isReal: boolean }> {
  const { generateEmbeddingUncached } = await import("@/lib/embeddings")
  return generateEmbeddingUncached(text)
}
