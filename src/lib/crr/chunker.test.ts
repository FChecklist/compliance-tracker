// CRR P3-BRIDGE, platform.crr_spec CRR-077: boundary-case coverage for
// chunker.ts's chunkText(), the primitive every downstream retrieval
// capability (capture.ts, embed.ts, the worker routes) depends on. Per
// CRR-077's what_not_to_do, this deliberately does not stop at the happy
// path -- each required edge case (empty input, sub-max_chars input,
// boundary-free input, a pathological policy, and the charStart/charEnd
// reconstruction invariant) gets its own explicit test, not just a bundled
// "it works" assertion.
import { describe, expect, test } from "bun:test"
import { chunkText, type ChunkPolicy } from "./chunker"

function policy(overrides: Partial<ChunkPolicy> = {}): ChunkPolicy {
  return { maxChars: 1000, overlapChars: 0, splitOn: "paragraph", ...overrides }
}

/** Shared invariant every emitted chunk must satisfy, regardless of policy: the recorded offsets reproduce `content` exactly out of the ORIGINAL text, with no drift, drop, or duplication in the slicing itself. */
function assertReconstructs(text: string, chunks: ReturnType<typeof chunkText>) {
  chunks.forEach((chunk, i) => {
    expect(chunk.seq).toBe(i)
    expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.content)
    expect(chunk.charEnd).toBeGreaterThan(chunk.charStart)
  })
}

describe("chunkText -- edge cases", () => {
  test("empty string returns []", () => {
    expect(chunkText("", policy())).toEqual([])
  })

  test("text shorter than max_chars returns exactly 1 chunk", () => {
    const text = "Hello world, this is a short document."
    const chunks = chunkText(text, policy({ maxChars: 1000, overlapChars: 50 }))
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toEqual({ seq: 0, charStart: 0, charEnd: text.length, content: text })
  })

  test("text with no paragraph breaks still splits correctly", () => {
    // 25 chars, zero newlines anywhere -- split_on: 'paragraph' has no
    // boundary to prefer, so this must fall back to hard cuts at max_chars.
    const text = "abcdefghijklmnopqrstuvwxy"
    expect(text.length).toBe(25)
    expect(text.includes("\n")).toBe(false)

    const chunks = chunkText(text, policy({ maxChars: 10, overlapChars: 2, splitOn: "paragraph" }))

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(10)
      expect(chunk.content.length).toBeGreaterThan(0)
    }
    // Exact walk of the sliding window: [0,10), then back by overlap to
    // 8 -> [8,18), then back to 16 -> [16,25) (hard stop at text end).
    expect(chunks).toEqual([
      { seq: 0, charStart: 0, charEnd: 10, content: "abcdefghij" },
      { seq: 1, charStart: 8, charEnd: 18, content: "ijklmnopqr" },
      { seq: 2, charStart: 16, charEnd: 25, content: "qrstuvwxy" },
    ])
    assertReconstructs(text, chunks)
  })

  test("a lone whitespace-only span (e.g. trailing blank lines with nothing after) is never emitted as a chunk", () => {
    const text = "Real paragraph content here.\n\n\n\n"
    const chunks = chunkText(text, policy({ maxChars: 40, overlapChars: 0, splitOn: "paragraph" }))
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0)
    }
  })
})

describe("chunkText -- overlap_chars validation (throws rather than looping forever)", () => {
  test("overlap_chars > max_chars throws a clear, named error", () => {
    expect(() => chunkText("hello world", policy({ maxChars: 10, overlapChars: 15 }))).toThrow(/overlap_chars/)
  })

  test("overlap_chars === max_chars throws (equality is still non-advancing, not just strictly-greater)", () => {
    expect(() => chunkText("hello world", policy({ maxChars: 10, overlapChars: 10 }))).toThrow(/overlap_chars/)
  })

  test("throwing happens before any chunking work -- long input does not hang", () => {
    const longText = "x".repeat(50_000)
    const start = Date.now()
    expect(() => chunkText(longText, policy({ maxChars: 100, overlapChars: 100 }))).toThrow()
    expect(Date.now() - start).toBeLessThan(1000)
  })

  test("negative overlap_chars throws", () => {
    expect(() => chunkText("hello world", policy({ maxChars: 10, overlapChars: -1 }))).toThrow(/overlap_chars/)
  })

  test("non-positive max_chars throws", () => {
    expect(() => chunkText("hello world", policy({ maxChars: 0, overlapChars: 0 }))).toThrow(/max_chars/)
    expect(() => chunkText("hello world", policy({ maxChars: -5, overlapChars: 0 }))).toThrow(/max_chars/)
  })
})

describe("chunkText -- charStart/charEnd reconstruct the exact original substring", () => {
  test("holds across every chunk of a multi-paragraph document", () => {
    const text = [
      "Paragraph one has some words in it.",
      "Paragraph two is a fair bit longer than the first one and keeps going for a while so it does not fit in a single small window.",
      "Paragraph three is short.",
    ].join("\n\n")

    const chunks = chunkText(text, policy({ maxChars: 60, overlapChars: 10, splitOn: "paragraph" }))
    expect(chunks.length).toBeGreaterThan(1)
    assertReconstructs(text, chunks)
  })

  test("holds for split_on: 'sentence' across mixed punctuation", () => {
    const text = "First sentence here. Second sentence follows! Is this the third? Yes, it is the fourth."
    const chunks = chunkText(text, policy({ maxChars: 30, overlapChars: 5, splitOn: "sentence" }))
    expect(chunks.length).toBeGreaterThan(1)
    assertReconstructs(text, chunks)
  })

  test("holds for split_on: 'fixed' (pure hard cuts, no boundary preference)", () => {
    const text = "0123456789".repeat(37) // 370 chars, deliberately not a clean multiple of max_chars
    const chunks = chunkText(text, policy({ maxChars: 47, overlapChars: 11, splitOn: "fixed" }))
    expect(chunks.length).toBeGreaterThan(1)
    assertReconstructs(text, chunks)
    // Every chunk after the first should start exactly overlap_chars before
    // the previous one ended, since 'fixed' never has a boundary to prefer.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBe(chunks[i - 1].charEnd - 11)
    }
  })

  test("holds when the text itself contains no valid boundaries at all for the requested split_on", () => {
    const text = "no punctuation or paragraph breaks anywhere in this run of words at all"
    const chunks = chunkText(text, policy({ maxChars: 15, overlapChars: 3, splitOn: "sentence" }))
    expect(chunks.length).toBeGreaterThan(1)
    assertReconstructs(text, chunks)
  })
})

describe("chunkText -- paragraph splitting and overlap behavior", () => {
  test("a paragraph that fits within max_chars is not split further", () => {
    const text = "Short first paragraph.\n\nShort second paragraph."
    const chunks = chunkText(text, policy({ maxChars: 500, overlapChars: 0, splitOn: "paragraph" }))
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toBe(text)
  })

  test("prefers ending a chunk at a paragraph boundary over a mid-word hard cut when one fits in the window", () => {
    // "AAAA\n\nBBBB" (10 chars): with max_chars=8 there is room to include
    // the whole first paragraph plus its separator (6 chars) before hitting
    // the limit, and a hard cut at 8 would land mid-way through "BBBB" --
    // the boundary at offset 6 must win instead.
    const text = "AAAA\n\nBBBB"
    const chunks = chunkText(text, policy({ maxChars: 8, overlapChars: 0, splitOn: "paragraph" }))
    expect(chunks[0]).toEqual({ seq: 0, charStart: 0, charEnd: 6, content: "AAAA\n\n" })
  })

  test("consecutive chunks actually share overlap_chars of real content, not just non-overlapping adjacency", () => {
    const text = "abcdefghijklmnopqrstuvwxyz".repeat(3) // 78 chars, no boundaries
    const chunks = chunkText(text, policy({ maxChars: 20, overlapChars: 5, splitOn: "paragraph" }))
    expect(chunks.length).toBeGreaterThan(1)
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]
      const curr = chunks[i]
      expect(curr.charStart).toBe(prev.charEnd - 5)
      expect(text.slice(curr.charStart, prev.charEnd)).toBe(prev.content.slice(-5))
    }
  })

  test("seq is 0-based and strictly sequential regardless of how many chunks are produced", () => {
    const text = ("Paragraph.\n\n").repeat(20)
    const chunks = chunkText(text, policy({ maxChars: 25, overlapChars: 3, splitOn: "paragraph" }))
    chunks.forEach((chunk, i) => expect(chunk.seq).toBe(i))
  })
})
