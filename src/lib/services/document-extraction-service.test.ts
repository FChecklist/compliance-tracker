/// <reference types="bun-types" />
// VERIDIAN Review Framework remediation ("Supports Multiple Input Types",
// 2026-07-18). Follows this codebase's own established discipline for this
// file's neighbors (officecli-client.test.ts, document-classification-
// service.test.ts): pure functions and real, non-mocked extraction round-
// trips are tested directly; DB-touching extractDocumentContent() itself is
// left untested here (would need a live tenant-scoped DB, out of scope for
// a unit test).
import { describe, expect, test } from "bun:test"
import jsPDF from "jspdf"
import {
  isVisionExtractable,
  isTextExtractable,
  isDocumentExtractable,
  extractEmailRawText,
  extractRawTextForMimeType,
  pickChunkPolicy,
} from "./document-extraction-service"
import { chunkText } from "@/lib/crr/chunker"

describe("mime-type gates", () => {
  test("isVisionExtractable stays image-only (ai-report-builder-service.ts and construction-ai-service.ts depend on this exact meaning)", () => {
    expect(isVisionExtractable("image/jpeg")).toBe(true)
    expect(isVisionExtractable("image/png")).toBe(true)
    expect(isVisionExtractable("image/webp")).toBe(true)
    expect(isVisionExtractable("application/pdf")).toBe(false)
    expect(isVisionExtractable(null)).toBe(false)
  })

  test("isTextExtractable covers PDF, Word, PowerPoint, and email", () => {
    expect(isTextExtractable("application/pdf")).toBe(true)
    expect(isTextExtractable("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true)
    expect(isTextExtractable("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe(true)
    expect(isTextExtractable("message/rfc822")).toBe(true)
    expect(isTextExtractable("image/jpeg")).toBe(false)
    expect(isTextExtractable("video/mp4")).toBe(false)
    expect(isTextExtractable(null)).toBe(false)
  })

  test("isDocumentExtractable is the union of vision and text extraction", () => {
    expect(isDocumentExtractable("image/png")).toBe(true)
    expect(isDocumentExtractable("application/pdf")).toBe(true)
    expect(isDocumentExtractable("message/rfc822")).toBe(true)
    expect(isDocumentExtractable("video/mp4")).toBe(false)
    expect(isDocumentExtractable("application/x-msdownload")).toBe(false)
  })
})

describe("extractEmailRawText -- best-effort .eml header+body extraction", () => {
  test("pulls Subject/From/To/Date headers and the plain-text body", () => {
    const eml = [
      "From: sender@example.com",
      "To: recipient@example.com",
      "Subject: GST notice reminder",
      "Date: Mon, 1 Jul 2026 10:00:00 +0000",
      "X-Mailer: SomeClient/1.0",
      "",
      "Please find the attached notice regarding your GST filing deadline of 2026-08-01.",
    ].join("\r\n")
    const text = extractEmailRawText(Buffer.from(eml, "utf-8"))
    expect(text).toContain("Subject: GST notice reminder")
    expect(text).toContain("From: sender@example.com")
    expect(text).toContain("To: recipient@example.com")
    expect(text).toContain("Date: Mon, 1 Jul 2026 10:00:00 +0000")
    expect(text).not.toContain("X-Mailer")
    expect(text).toContain("GST filing deadline of 2026-08-01")
  })

  test("a header-only email with no blank-line body separator still returns the headers", () => {
    const eml = "Subject: No body separator\r\nFrom: a@b.com"
    const text = extractEmailRawText(Buffer.from(eml, "utf-8"))
    expect(text).toContain("Subject: No body separator")
  })
})

describe("extractRawTextForMimeType -- PDF branch, real end-to-end integration", () => {
  test("extracts real text from a PDF generated with jsPDF (already a dependency)", async () => {
    const doc = new jsPDF()
    doc.text("Integration test PDF line one.", 10, 10)
    doc.text("Integration test PDF line two: 2026-08-01 deadline.", 10, 20)
    const buffer = Buffer.from(doc.output("arraybuffer"))

    const text = await extractRawTextForMimeType("application/pdf", buffer)
    expect(text).toContain("Integration test PDF line one.")
    expect(text).toContain("Integration test PDF line two")
  }, 30000)

  // Note: a genuinely blank jsPDF page is not a useful stand-in for "no
  // extractable text" here -- pdf-parse emits its own "-- 1 of 1 --" page-
  // separator marker even for a page with zero real content, so `.trim()`
  // never sees a truly empty string for a single-page PDF either way. This
  // is an existing, disclosed limitation of pdf-parse's own output shape,
  // not something introduced by this pass (src/lib/ingest/parser.ts's own
  // parsePdf() has the identical `.trim()` check against the same library).
})

describe("extractRawTextForMimeType -- email branch", () => {
  test("routes message/rfc822 through extractEmailRawText", async () => {
    const eml = "Subject: Routing check\r\n\r\nBody content here."
    const text = await extractRawTextForMimeType("message/rfc822", Buffer.from(eml, "utf-8"))
    expect(text).toContain("Subject: Routing check")
    expect(text).toContain("Body content here.")
  })

  test("throws for an empty email", async () => {
    await expect(extractRawTextForMimeType("message/rfc822", Buffer.from("", "utf-8"))).rejects.toThrow(/no readable text/)
  })
})

describe("extractRawTextForMimeType -- unsupported type", () => {
  test("throws a clear error rather than silently returning garbage", async () => {
    await expect(extractRawTextForMimeType("video/mp4", Buffer.from("not real video bytes"))).rejects.toThrow(/Unsupported mime type/)
  })
})

// CRR-087: pickChunkPolicy -- exact businessObjectType match, with a
// mandatory 'generic' fallback for anything unmatched (including null/
// undefined). Pure function, no DB -- policies are passed in directly, the
// same shape chunkAndEmbedSourceObject reads from compliance.chunk_policy.
describe("pickChunkPolicy -- CRR-087 (business_object_type match, generic fallback)", () => {
  const genericPolicy = { businessObjectType: "generic", maxChars: 1200, overlapChars: 150 }
  const constructionPolicy = { businessObjectType: "construction", maxChars: 800, overlapChars: 100 }
  const indiaCompliancePolicy = { businessObjectType: "india_compliance", maxChars: 1500, overlapChars: 200 }
  const policies = [constructionPolicy, genericPolicy, indiaCompliancePolicy]

  test("an exact businessObjectType match wins over generic", () => {
    expect(pickChunkPolicy("construction", policies)).toBe(constructionPolicy)
    expect(pickChunkPolicy("india_compliance", policies)).toBe(indiaCompliancePolicy)
  })

  test("gate_pass: an unknown/unmatched businessObjectType falls back to the generic policy exactly (same object, not a re-derived copy)", () => {
    expect(pickChunkPolicy("some_type_with_no_policy_row", policies)).toBe(genericPolicy)
    expect(pickChunkPolicy("document", policies)).toBe(genericPolicy) // classifyBusinessObjectType's own 4-type vocabulary, none of which is a chunk_policy row today
  })

  test("null/undefined businessObjectType also falls back to generic (never throws)", () => {
    expect(pickChunkPolicy(null, policies)).toBe(genericPolicy)
    expect(pickChunkPolicy(undefined, policies)).toBe(genericPolicy)
  })

  test("returns null (caller's own responsibility to throw) when no generic row exists either", () => {
    expect(pickChunkPolicy("construction", [constructionPolicy])).toBe(constructionPolicy)
    expect(pickChunkPolicy("unknown", [constructionPolicy])).toBeNull()
    expect(pickChunkPolicy(null, [])).toBeNull()
  })
})

// CRR-088: proves chunkText's charStart/charEnd bookkeeping is precise
// enough that concatenating chunk content by seq, with each chunk's overlap
// against the PREVIOUS chunk trimmed off using those same offsets, exactly
// reconstructs the original extracted text -- character for character, on
// text that came out of a real extraction code path (extractRawTextForMimeType),
// not a hand-typed string literal. 2 fixtures: one ASCII (a real PDF via
// jsPDF, same as this file's existing PDF integration test), one Unicode (a
// real .eml through the email extraction branch -- chosen over a Unicode
// PDF specifically because jsPDF's default font has no non-Latin glyphs, so
// a Unicode PDF fixture would silently test font-fallback mangling rather
// than chunker offset math).
function reconstructFromChunks(chunks: ReturnType<typeof chunkText>): string {
  let result = ""
  let coveredUpTo = 0
  for (const chunk of chunks) {
    if (chunk.charEnd <= coveredUpTo) continue // fully within a previous chunk's span already
    const sliceFrom = Math.max(chunk.charStart, coveredUpTo) - chunk.charStart
    result += chunk.content.slice(sliceFrom)
    coveredUpTo = chunk.charEnd
  }
  return result
}

// Mirrors the real compliance.chunk_policy 'generic' row's live values
// (max_chars=1200, overlap_chars=150, split_on='paragraph') as of this
// point's own closure -- see CRR-087's own evidence for how that was read.
const GENERIC_POLICY = { maxChars: 1200, overlapChars: 150, splitOn: "paragraph" as const }

describe("CRR-088: chunk offsets reconstruct the real extracted source text exactly", () => {
  test("ASCII fixture: a real multi-paragraph PDF extracted via extractRawTextForMimeType", async () => {
    const doc = new jsPDF()
    const paragraphs = [
      "This is the first paragraph of a compliance notice reconstruction fixture, deliberately written long enough to exceed a small chunk window on its own so the chunker actually has to split it.",
      "This is the second paragraph, covering GST filing deadlines, penalty amounts, and reference numbers so the fixture reads like a real Indian regulatory document rather than lorem ipsum filler text.",
      "This is the third and final paragraph, closing out the notice with a due date and an authority name, again padded out with enough real words to force at least one more chunk boundary decision.",
    ]
    let y = 10
    for (const p of paragraphs) {
      doc.text(p, 10, y, { maxWidth: 180 })
      y += 40
    }
    const buffer = Buffer.from(doc.output("arraybuffer"))
    const text = await extractRawTextForMimeType("application/pdf", buffer)

    const chunks = chunkText(text, GENERIC_POLICY)
    expect(chunks.length).toBeGreaterThan(0)
    chunks.forEach((c, i) => expect(c.seq).toBe(i))
    expect(reconstructFromChunks(chunks)).toBe(text)
  }, 30000)

  test("Unicode fixture: a real .eml with non-ASCII body content extracted via extractRawTextForMimeType", async () => {
    const eml = [
      "Subject: GST नोटिस reminder — café Mumbai branch 📄",
      "From: sender@example.com",
      "To: recipient@example.com",
      "",
      "Dear Sir/Madam नमस्ते,\n\nPlease find enclosed the GST reconciliation notice for M/s Café Élite Pvt Ltd (मुंबई branch), reference № GST/2026/0817, due ₹50,000 by 2026-09-15. ¡Gracias por su atención! 🙏\n\nThis paragraph is deliberately padded with a good deal of extra real prose so the fixture is long enough to force the chunker through more than one chunk boundary decision, mixing Devanagari, Latin-with-diacritics, currency symbols, and an emoji within a single run of text.\n\nSecond paragraph, plain but still meaningfully long: regards, the compliance desk, please respond within the statutory time window or escalation follows automatically per the standing notice policy on file for this account.",
    ].join("\r\n")
    const text = await extractRawTextForMimeType("message/rfc822", Buffer.from(eml, "utf-8"))
    expect(text).toMatch(/[^\x00-\x7F]/) // sanity: the fixture really is non-ASCII

    const chunks = chunkText(text, { maxChars: 120, overlapChars: 20, splitOn: "paragraph" })
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((c, i) => expect(c.seq).toBe(i))
    expect(reconstructFromChunks(chunks)).toBe(text)
  })
})
