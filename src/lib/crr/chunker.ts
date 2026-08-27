// CRR P3-BRIDGE (2026-08-27), platform.crr_spec CRR-076: "No chunking exists
// anywhere in this codebase today. This is the missing primitive every
// retrieval capability depends on." Everything downstream in the bridge
// phase -- capture.ts's ingest path, embed.ts, and the worker routes that
// turn a source_object into searchable document_chunk rows -- calls
// chunkText() as its first step, so its output_contract (seq/charStart/
// charEnd/content) is load-bearing for all of it.
//
// Deliberately pure and deterministic -- no DB access, no LLM/model call, no
// I/O of any kind -- matches every other gate/primitive in this codebase
// (abac.ts, confidence-banding.ts, floor-tier-escalation.ts). The chunk_policy
// row shape this consumes is defined in src/lib/db/schema.ts's chunkPolicy
// table (compliance.chunk_policy in the live DB): businessObjectType,
// maxChars, overlapChars, splitOn ('paragraph' | 'sentence' | 'page' |
// 'fixed', chunkPolicySplitOnEnum). Only maxChars/overlapChars/splitOn drive
// the algorithm below -- businessObjectType is purely a lookup key the
// caller uses to find the right policy row before calling this function, so
// it is not part of this function's input type.

/** Mirrors schema.ts's chunkPolicySplitOnEnum values exactly. */
export type ChunkSplitOn = "paragraph" | "sentence" | "page" | "fixed"

/** The subset of a compliance.chunk_policy row this algorithm actually needs. Callers can pass a full Drizzle chunkPolicy row as-is -- TS structural typing allows the extra fields (id, businessObjectType, createdAt). */
export type ChunkPolicy = {
  maxChars: number
  overlapChars: number
  splitOn: ChunkSplitOn
}

export type TextChunk = {
  /** 0-based position of this chunk among the chunks produced for this text, in order. */
  seq: number
  /** Inclusive start offset into the original `text`. */
  charStart: number
  /** Exclusive end offset into the original `text` -- always text.slice(charStart, charEnd) === content. */
  charEnd: number
  content: string
}

/**
 * Returns, for a given split_on mode, the offsets in `text` that are "nice"
 * places to end a chunk -- e.g. for 'paragraph', the offset immediately
 * after each run of 2+ newlines (so the separator itself is absorbed into
 * the chunk that precedes it, and the next chunk starts clean at the next
 * paragraph's first character). 'fixed' has no natural boundaries -- every
 * cut is a hard cut at max_chars, which IS fixed-size chunking.
 *
 * text.length is always included as a trailing boundary so the final chunk
 * can end exactly at end-of-text even when no separator precedes it.
 */
function boundaryOffsets(text: string, splitOn: ChunkSplitOn): number[] {
  const pattern: RegExp | null =
    splitOn === "paragraph" ? /\n{2,}/g :
    splitOn === "sentence" ? /[.!?]+\s+/g :
    splitOn === "page" ? /\f+/g :
    null // 'fixed' -- no boundary pattern, hard-cut only

  const offsets: number[] = []
  if (pattern) {
    for (const match of text.matchAll(pattern)) {
      offsets.push(match.index + match[0].length)
    }
  }
  offsets.push(text.length)
  return offsets
}

/**
 * Splits `text` into a sequence of overlapping chunks per `policy`, preferring
 * to end each chunk at a split_on boundary (paragraph/sentence/page) rather
 * than mid-word, but never exceeding max_chars even when no boundary fits --
 * a single paragraph/sentence longer than max_chars is hard-cut so the
 * max_chars contract always holds.
 *
 * Deliberately conservative about "empty": a chunk is skipped only when its
 * content is entirely whitespace (content.trim().length === 0) -- e.g. a
 * lone run of blank lines between two real paragraphs. The recorded
 * charStart/charEnd are never adjusted for this -- the next chunk's window
 * still advances past the skipped span, so no content is silently lost, and
 * every chunk that IS emitted still satisfies text.slice(charStart, charEnd)
 * === content exactly (content is always a raw, untrimmed slice).
 */
export function chunkText(text: string, policy: ChunkPolicy): TextChunk[] {
  if (!Number.isFinite(policy.maxChars) || policy.maxChars <= 0) {
    throw new Error(`chunkText: max_chars must be a positive number (got ${policy.maxChars}).`)
  }
  if (!Number.isFinite(policy.overlapChars) || policy.overlapChars < 0) {
    throw new Error(`chunkText: overlap_chars cannot be negative (got ${policy.overlapChars}).`)
  }
  if (policy.overlapChars >= policy.maxChars) {
    throw new Error(`chunkText: overlap_chars (${policy.overlapChars}) must be less than max_chars (${policy.maxChars}) -- an overlap this large would never advance past the same window, looping forever.`)
  }

  if (text.length === 0) return []

  const boundaries = boundaryOffsets(text, policy.splitOn)

  const chunks: TextChunk[] = []
  let start = 0
  let seq = 0

  while (start < text.length) {
    const hardEnd = Math.min(start + policy.maxChars, text.length)

    // Prefer the largest boundary that fits in (start, hardEnd] -- the
    // biggest chunk that still ends on a natural split point. Falls back to
    // a hard cut at hardEnd when no boundary fits in this window (a single
    // paragraph/sentence/page longer than max_chars, or split_on: 'fixed').
    const candidates = boundaries.filter((b) => b > start && b <= hardEnd)
    const end = candidates.length > 0 ? Math.max(...candidates) : hardEnd

    const content = text.slice(start, end)
    if (content.trim().length > 0) {
      chunks.push({ seq, charStart: start, charEnd: end, content })
      seq++
    }

    if (end >= text.length) break

    // Slide the window back by overlap_chars for the next chunk, but never
    // regress past `start` -- guarantees start strictly increases every
    // iteration (loop terminates in at most text.length iterations) even
    // when a boundary produced a very short chunk that overlap_chars alone
    // would otherwise rewind past its own start.
    start = Math.max(start + 1, end - policy.overlapChars)
  }

  return chunks
}
