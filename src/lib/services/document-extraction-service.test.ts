/// <reference types="bun-types" />
// VERIDIAN Review Framework remediation ("Supports Multiple Input Types",
// 2026-07-18). Follows this codebase's own established discipline for this
// file's neighbors (officecli-client.test.ts, document-classification-
// service.test.ts): pure functions and real, non-mocked extraction round-
// trips are tested directly; DB-touching extractDocumentContent() itself is
// left untested here (would need a live tenant-scoped DB, out of scope for
// a unit test). The last part of this file (PROJEXA-BUILD-001 U-36, BR-506) covers the
// workbook-to-project extraction; see the banner above its first describe block.
import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import jsPDF from "jspdf"
import {
  isVisionExtractable,
  isTextExtractable,
  isDocumentExtractable,
  extractEmailRawText,
  extractRawTextForMimeType,
  pickChunkPolicy,
  readWorkbookDigest,
  assertWorkbookArchiveWithinLimits,
  extractProjectFromDocument,
  createProjectFromDocument,
  createEdgeExtractCaller,
  projectSourceLedgerKey,
  toBoqLineItems,
} from "./document-extraction-service"
import {
  ExtractionRejectedError,
  ProjectCreatedUnlinkedError,
  ProjectCreatedWithoutBoqError,
  WORKBOOK_LIMITS,
  EDGE_REQUEST_MAX_CHARS,
  cleanCellText,
  validateExtractionOutput,
  type WorkbookDigest,
} from "./document-extraction-schema"
import { chunkText } from "@/lib/crr/chunker"
import {
  buildFixtureWorkbook,
  buildWorkbook,
  craftZip,
  deterministicModel,
  edgeCallerFor,
  edgeDeps,
  HIDDEN_TRADE,
  LINES_PER_SHEET,
  memoryLedger,
  TRADES,
} from "./__test-helpers__/document-extraction-fixtures"

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

// ============================================================================================================================
// PROJEXA-BUILD-001 U-36 (BR-506): the workbook-to-project extraction of document-extraction-service.ts. No database and no
// network: the real Edge Function handler runs in process behind an EdgeCaller with a deterministic stand-in for the model
// (__test-helpers__/document-extraction-fixtures.ts), and the ledger and the two create functions are in-memory doubles. The real
// ledger SQL is proven on PGlite in document-extraction-ledger.test.ts; the real route, createProject() and createBoq() on PGlite
// in src/app/api/v1/projexa/projects/from-document/route.test.ts.
// ============================================================================================================================

async function rejection(p: Promise<unknown>): Promise<ExtractionRejectedError> {
  try {
    await p
  } catch (e) {
    if (e instanceof ExtractionRejectedError) return e
    throw e
  }
  throw new Error("expected an ExtractionRejectedError, but the call succeeded")
}

const FIXTURE = buildFixtureWorkbook()

describe("readWorkbookDigest -- every sheet of the workbook is read", () => {
  test("all 23 sheets come back in workbook order: the 22 trade sheets, the hidden one included, and the empty one", async () => {
    const digest = await readWorkbookDigest(FIXTURE)
    expect(digest.sheets.map((s) => s.name)).toEqual([...TRADES, "Empty sheet"])
    const hidden = digest.sheets.find((s) => s.name === HIDDEN_TRADE)!
    expect(hidden.rows.length).toBeGreaterThan(0)
    expect(digest.sheets.find((s) => s.name === "Empty sheet")!.rows).toEqual([])
  })

  test("rows keep their real worksheet row numbers and blank rows are dropped", async () => {
    const digest = await readWorkbookDigest(FIXTURE)
    const first = digest.sheets[0]
    expect(first.rows.map((r) => r.row)).toEqual([1, 3, 4, 5, 7])
    expect(first.rows[1].cells).toEqual(["Item", "Description", "Unit", "Qty", "Rate", "Amount", "Breakdown %"])
    const doors = digest.sheets.find((s) => s.name === "Doors")!
    expect(doors.rows.map((r) => r.row)).toEqual([1, 3, 4, 5, 7, 9])
  })

  test("numbers and dates read as text: 0.1 + 0.2 reads 0.3, a date reads YYYY-MM-DD, a boolean reads true", async () => {
    const digest = await readWorkbookDigest(FIXTURE)
    expect(digest.sheets[0].rows.find((r) => r.row === 7)!.cells[4]).toBe("0.3")
    const wb = buildWorkbook([{ name: "Types", rows: [[new Date(Date.UTC(2026, 8, 25)), true, 12.5, "text"]] }])
    const typed = await readWorkbookDigest(wb)
    expect(typed.sheets[0].rows[0].cells).toEqual(["2026-09-25", "true", "12.5", "text"])
  })

  test("hidden characters and line breaks are removed from a cell, and a long cell is cut", async () => {
    const tagged = String.fromCodePoint(0xe0049, 0xe0067, 0xe006e)
    const wb = buildWorkbook([
      { name: "Clean", rows: [[`Ex​cav‍ation‮  of\n  soil${tagged}`, "a".repeat(1000)]] },
    ])
    const digest = await readWorkbookDigest(wb)
    expect(digest.sheets[0].rows[0].cells[0]).toBe("Excavation of soil")
    expect(digest.sheets[0].rows[0].cells[1]).toHaveLength(WORKBOOK_LIMITS.maxCellChars)
    expect(cleanCellText(`a\u0000b﻿c`)).toBe("abc")
  })

  test("a file that is not an xlsx workbook is refused before it is parsed", async () => {
    expect((await rejection(readWorkbookDigest(Buffer.from("Item,Description\n1.01,Excavation")))).code).toBe("unsupported_file_type")
    const legacyXls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00])
    expect((await rejection(readWorkbookDigest(legacyXls))).code).toBe("unsupported_file_type")
  })

  test("a zip that is not a readable workbook is refused with a code, not a crash", async () => {
    const garbage = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("this is not a zip archive at all, just bytes")])
    const err = await rejection(readWorkbookDigest(garbage))
    expect(["workbook_unreadable", "workbook_empty"]).toContain(err.code)
  })

  test("a workbook with no cell content is workbook_empty", async () => {
    const wb = buildWorkbook([{ name: "A", rows: [] }, { name: "B", rows: [[], []] }])
    expect((await rejection(readWorkbookDigest(wb))).code).toBe("workbook_empty")
  })

  test("over a limit is refused, never cut short: bytes, sheets and rows per sheet", async () => {
    expect((await rejection(readWorkbookDigest(FIXTURE, { ...WORKBOOK_LIMITS, maxBytes: 100 }))).code).toBe("workbook_too_large")
    expect((await rejection(readWorkbookDigest(FIXTURE, { ...WORKBOOK_LIMITS, maxSheets: 22 }))).code).toBe("workbook_too_large")
    const err = await rejection(readWorkbookDigest(FIXTURE, { ...WORKBOOK_LIMITS, maxRowsPerSheet: 3 }))
    expect(err.code).toBe("workbook_too_large")
    expect(err.message).toContain("Preliminaries")
  })

  test("the row limit is exact: a sheet of maxRowsPerSheet rows is read, one of maxRowsPerSheet + 1 is refused", async () => {
    const sheetOf = (n: number) => buildWorkbook([{ name: "Long", rows: Array.from({ length: n }, (_, i) => [`r${i + 1}`]) }])
    const at = await readWorkbookDigest(sheetOf(WORKBOOK_LIMITS.maxRowsPerSheet))
    expect(at.sheets[0].rows).toHaveLength(WORKBOOK_LIMITS.maxRowsPerSheet)
    const over = await rejection(readWorkbookDigest(sheetOf(WORKBOOK_LIMITS.maxRowsPerSheet + 1)))
    expect(over.code).toBe("workbook_too_large")
    expect(over.message).toContain("Long")
  })
})

// A small file can make the read do a lot of work: a sheet that declares a huge range is filled cell by cell, and a zip part can
// inflate to far more than the file holds. These limits are checked before that work is done (see WORKBOOK_LIMITS).
describe("readWorkbookDigest -- what a small file can make the read do is bounded", () => {
  const wide = (columns: number) => [Array.from({ length: columns }, (_, i) => `c${i}`)]

  test("a workbook deflated the way Excel writes it reads exactly like the stored one", async () => {
    const packed = buildFixtureWorkbook({ compressed: true })
    expect(packed.length).toBeLessThan(FIXTURE.length)
    expect((await readWorkbookDigest(packed)).sheets).toEqual((await readWorkbookDigest(FIXTURE)).sheets)
  })

  test("the column limit is exact: maxColumns columns are read, one more is refused, and the message names the sheet", async () => {
    const at = await readWorkbookDigest(buildWorkbook([{ name: "Wide", rows: wide(WORKBOOK_LIMITS.maxColumns) }]))
    expect(at.sheets[0].rows[0].cells).toHaveLength(WORKBOOK_LIMITS.maxColumns)
    const err = await rejection(readWorkbookDigest(buildWorkbook([{ name: "Wide", rows: wide(WORKBOOK_LIMITS.maxColumns + 1) }])))
    expect(err.code).toBe("workbook_too_large")
    expect(err.message).toContain("Wide")
    expect(err.message).toContain("columns")
  })

  test("a file that DECLARES a wide range but holds two cells is refused from the declaration alone (scaled: 78 columns against a limit of 50)", async () => {
    // At the real limit the same file would be A1:XFD5000, 82 million cells; the scaled range keeps a failure of this test cheap.
    const declared = buildWorkbook([{ name: "Declared", rows: [["Item", "Description"], ["1.01", "x"]], declaredRange: "A1:BZ100" }])
    const err = await rejection(readWorkbookDigest(declared, { ...WORKBOOK_LIMITS, maxColumns: 50 }))
    expect(err.code).toBe("workbook_too_large")
    expect(err.message).toContain("50 columns")
    // Under the limit the same declaration is read (nothing else about the file is wrong).
    expect((await readWorkbookDigest(declared, { ...WORKBOOK_LIMITS, maxColumns: 78 })).sheets[0].rows).toHaveLength(2)
  })

  test("the cells the sheets declare are added up across the workbook: three sheets of 1000 declared cells against a limit of 2500", async () => {
    const declared = (name: string) => ({ name, rows: [["a", "b"]], declaredRange: "A1:J100" })
    const limits = { ...WORKBOOK_LIMITS, maxCells: 2500 }
    expect((await readWorkbookDigest(buildWorkbook([declared("One"), declared("Two")]), limits)).sheets).toHaveLength(2)
    const err = await rejection(readWorkbookDigest(buildWorkbook([declared("One"), declared("Two"), declared("Three")]), limits))
    expect(err.code).toBe("workbook_too_large")
    expect(err.message).toContain("2500 cells")
  })

  test("an archive that DECLARES small sizes and inflates past the ceiling is refused as workbook_too_large before the parser runs (24 MB of data in a file of a few KB)", async () => {
    const bomb = craftZip([{ name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(24 * 1024 * 1024, 32), declaredSize: 10 }])
    expect(bomb.length).toBeLessThan(100_000)
    const err = await rejection(readWorkbookDigest(bomb))
    expect(err.code).toBe("workbook_too_large")
    expect(err.message).toContain("16 MB")
  })

  describe("the unpacked-size check on its own (ceiling 1 000 000 bytes)", () => {
    const limits = { ...WORKBOOK_LIMITS, maxUncompressedBytes: 1_000_000 }
    const codeOf = (zip: Buffer) => {
      try {
        assertWorkbookArchiveWithinLimits(zip, limits)
      } catch (e) {
        if (e instanceof ExtractionRejectedError) return e.code
        throw e
      }
      return "accepted"
    }
    const part = (name: string, size: number, extra: { method?: number; declaredSize?: number; sharesDataOf?: number } = {}) => ({ name, data: Buffer.alloc(size, 65), ...extra })

    test("one part under the ceiling is accepted, one over it is refused, and a real workbook of either kind is accepted", () => {
      expect(codeOf(craftZip([part("a", 900_000)]))).toBe("accepted")
      expect(codeOf(craftZip([part("a", 1_100_000)]))).toBe("workbook_too_large")
      expect(assertWorkbookArchiveWithinLimits(FIXTURE)).toBeUndefined()
      expect(assertWorkbookArchiveWithinLimits(buildFixtureWorkbook({ compressed: true }))).toBeUndefined()
    })

    test("the sizes of all parts are added up: two parts of 600 000 bytes are over a ceiling neither is over alone", () => {
      expect(codeOf(craftZip([part("a", 600_000)]))).toBe("accepted")
      expect(codeOf(craftZip([part("a", 600_000), part("b", 600_000)]))).toBe("workbook_too_large")
    })

    test("two entries that share one stream count twice, as they do when the parser reads them", () => {
      expect(codeOf(craftZip([part("a", 600_000), part("b", 10, { sharesDataOf: 0 })]))).toBe("workbook_too_large")
    })

    test("the size a part declares is not believed: declared 10 bytes, inflates to 1.1 MB", () => {
      expect(codeOf(craftZip([part("a", 1_100_000, { declaredSize: 10 })]))).toBe("workbook_too_large")
    })

    test("a stored part counts by the bytes it holds", () => {
      expect(codeOf(craftZip([part("a", 900_000, { method: 0 })]))).toBe("accepted")
      expect(codeOf(craftZip([part("a", 1_100_000, { method: 0 })]))).toBe("workbook_too_large")
    })

    test("what is not a well-formed archive is workbook_unreadable, never an uncaught error: no directory, a cut-off directory, a stream that does not inflate, an unsupported method", () => {
      expect(codeOf(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("not a zip archive at all, only bytes")]))).toBe("workbook_unreadable")
      const zip = craftZip([part("a", 1000)])
      expect(codeOf(zip.subarray(0, zip.length - 10))).toBe("workbook_unreadable")
      const garbageStream = craftZip([{ name: "a", data: Buffer.from("this is text, not a deflate stream"), method: 0 }])
      garbageStream.writeUInt16LE(8, 8) // the local header now says deflate
      expect(codeOf(garbageStream)).toBe("workbook_unreadable")
      expect(codeOf(craftZip([{ name: "a", data: Buffer.from("x"), method: 12 }]))).toBe("workbook_unreadable")
    })
  })
})

describe("extractProjectFromDocument -- the 22-sheet workbook through the real Edge handler and a stand-in model", () => {
  const run = async () => {
    const caller = edgeCallerFor(edgeDeps(deterministicModel))
    const result = await extractProjectFromDocument({ fileName: "synthetic-villa.xlsx", bytes: FIXTURE }, { callEdge: caller })
    return { result, caller }
  }

  test("every sheet is read: 23 sheets, 22 of them with lines, 3 lines each, 66 in all", async () => {
    const { result } = await run()
    expect(result.stats.sheets).toBe(23)
    expect(result.stats.lines).toBe(TRADES.length * LINES_PER_SHEET)
    const bySheet = new Map<string, number[]>()
    for (const l of result.extracted.boq.lineItems) bySheet.set(l.source.sheet, [...(bySheet.get(l.source.sheet) ?? []), l.source.row])
    expect([...bySheet.keys()]).toEqual([...TRADES])
    for (const rows of bySheet.values()) expect(rows).toEqual([4, 5, 7])
  })

  test("the hidden sheet contributes its lines like any other", async () => {
    const { result } = await run()
    const ceiling = result.extracted.boq.lineItems.filter((l) => l.source.sheet === HIDDEN_TRADE)
    expect(ceiling.map((l) => l.itemCode)).toEqual(["7.01", "7.01.1", "7.02"])
  })

  test("the Edge Function is called once, with a body that holds all 23 sheets and is under the request ceiling", async () => {
    const { caller } = await run()
    expect(caller.calls.count).toBe(1)
    const body = JSON.parse(caller.calls.lastBody!) as { schema: string; fileName: string; sheets: Array<{ name: string }> }
    expect(body.schema).toBe("boq_project_v1")
    expect(body.sheets).toHaveLength(23)
    expect(caller.calls.lastBody!.length).toBeLessThan(EDGE_REQUEST_MAX_CHARS)
  })

  test("the result is the project, the BOQ and the hierarchy the workbook holds", async () => {
    const { result } = await run()
    const { project, boq } = result.extracted
    expect(project.name).toBe("synthetic-villa")
    expect(boq.title).toBe("synthetic-villa BOQ")
    const root = boq.lineItems.find((l) => l.itemCode === "1.01")!
    const child = boq.lineItems.find((l) => l.itemCode === "1.01.1")!
    expect(root).toMatchObject({ description: "Preliminaries: main work item", unit: "m2", quantity: 10, rate: 101, source: { sheet: "Preliminaries", row: 4 } })
    expect(child).toMatchObject({ parentItemCode: "1.01", breakdownPercentage: 40, unit: "" })
    expect(boq.lineItems.find((l) => l.itemCode === "1.02")!.rate).toBe(0.3)
  })

  test("toBoqLineItems hands createBoq() its own fields only: no source citation, quantity and rate default to 0", async () => {
    const { result } = await run()
    const items = toBoqLineItems(result.extracted)
    expect(items).toHaveLength(66)
    expect(items.every((i) => !("source" in i))).toBe(true)
    expect(items.find((i) => i.itemCode === "1.01.1")).toMatchObject({ parentItemCode: "1.01", breakdownPercentage: 40, quantity: 0, rate: 0 })
  })

  // What createBoq() stores is what this returns, so the figures of every root line are pinned here, quantity and rate apart: the
  // fixture gives sheet n the lines n.01 (quantity 10 x n, rate 100 + n, m2) and n.02 (quantity n, rate 2000 + n, nos).
  test("toBoqLineItems keeps each root line's quantity, rate, unit and category as the workbook has them (quantity and rate are not swapped or mixed up)", async () => {
    const { result } = await run()
    const items = toBoqLineItems(result.extracted)
    expect(items.find((i) => i.itemCode === "1.01")).toEqual({
      itemCode: "1.01",
      description: "Preliminaries: main work item",
      unit: "m2",
      quantity: 10,
      rate: 101,
      category: "Preliminaries",
    })
    TRADES.forEach((trade, i) => {
      const n = i + 1
      expect(items.find((l) => l.itemCode === `${n}.01`)).toMatchObject({ unit: "m2", quantity: 10 * n, rate: 100 + n, category: trade })
      expect(items.find((l) => l.itemCode === `${n}.02`)).toMatchObject({ unit: "nos", quantity: n, rate: n === 1 ? 0.3 : 2000 + n, category: trade })
    })
  })
})

describe("extractProjectFromDocument -- what the Edge Function's answers mean", () => {
  const small = buildWorkbook([{ name: "Civil", rows: [["Item", "Description", "Unit", "Qty", "Rate"], ["1.01", "Excavation", "m3", 100, 250]] }])
  const answering = (status: number, body: unknown) => async () => ({ status, body })

  test("no model configured: the real handler answers 503 and the call ends model_not_configured", async () => {
    const noModel = edgeCallerFor(edgeDeps(null))
    const err = await rejection(extractProjectFromDocument({ fileName: "a.xlsx", bytes: small }, { callEdge: noModel }))
    expect(err.code).toBe("model_not_configured")
    expect(err.status).toBe(503)
    expect(noModel.calls.count).toBe(1)
  })

  test("each other answer maps to one stable code", async () => {
    const cases: Array<[number, unknown, string]> = [
      [503, { ok: false, code: "extraction_not_configured" }, "extraction_not_configured"],
      [401, { ok: false, code: "unauthorized" }, "extraction_unavailable"],
      [500, null, "extraction_unavailable"],
      [502, { ok: false, code: "model_error" }, "extraction_unavailable"],
      [502, { ok: false, code: "edge_unreachable" }, "extraction_unavailable"],
      [200, { ok: true }, "extraction_unavailable"],
      [413, { ok: false, code: "input_too_large" }, "workbook_too_large"],
      [502, { ok: false, code: "model_output_not_json" }, "extraction_schema_invalid"],
      [502, { ok: false, code: "model_output_too_large" }, "extraction_output_too_large"],
    ]
    for (const [status, body, code] of cases) {
      const err = await rejection(extractProjectFromDocument({ fileName: "a.xlsx", bytes: small }, { callEdge: answering(status, body) }))
      expect(`${status} ${err.code}`).toBe(`${status} ${code}`)
    }
  })

  test("a workbook over the request ceiling is refused before the Edge Function is called", async () => {
    const big = buildWorkbook([
      { name: "Big", rows: Array.from({ length: 900 }, (_, i) => [`${i}.01`, "x".repeat(300), "m2", i, i]) },
    ])
    let calls = 0
    const err = await rejection(
      extractProjectFromDocument({ fileName: "big.xlsx", bytes: big }, { callEdge: async () => { calls++; return { status: 200, body: {} } } }),
    )
    expect(err.code).toBe("workbook_too_large")
    expect(calls).toBe(0)
  })
})

describe("validateExtractionOutput -- the gate between a model's answer and any write", () => {
  const digest: WorkbookDigest = { sheets: [{ name: "Civil", rows: [{ row: 3, cells: ["Item"] }, { row: 4, cells: ["1.01", "Excavation"] }] }] }
  const valid = () => ({
    schema: "boq_project_v1",
    project: { name: "Villa", startDate: "2026-01-15" },
    boq: { title: "Villa BOQ", lineItems: [{ source: { sheet: "Civil", row: 4 }, itemCode: "1.01", description: "Excavation", unit: "m3", quantity: 100, rate: 250 }] },
  })
  const codeOf = (raw: unknown) => {
    try {
      validateExtractionOutput(raw, digest)
    } catch (e) {
      if (e instanceof ExtractionRejectedError) return e.code
      throw e
    }
    return "accepted"
  }

  test("a valid answer is accepted and returned parsed", () => {
    expect(validateExtractionOutput(valid(), digest).boq.lineItems[0].description).toBe("Excavation")
  })

  test("an unexpected key anywhere is a schema rejection, not ignored", () => {
    expect(codeOf({ ...valid(), createProject: true })).toBe("extraction_schema_invalid")
    const v = valid()
    ;(v.boq.lineItems[0] as Record<string, unknown>).toolCall = "createProject"
    expect(codeOf(v)).toBe("extraction_schema_invalid")
    const w = valid()
    ;(w.project as Record<string, unknown>).admin = true
    expect(codeOf(w)).toBe("extraction_schema_invalid")
  })

  test("wrong shapes are rejected: schema name, missing name, no lines, negative figure, string figure, bad date", () => {
    expect(codeOf({ ...valid(), schema: "other" })).toBe("extraction_schema_invalid")
    expect(codeOf({ ...valid(), project: {} })).toBe("extraction_schema_invalid")
    expect(codeOf({ ...valid(), boq: { title: "x", lineItems: [] } })).toBe("extraction_schema_invalid")
    const neg = valid()
    neg.boq.lineItems[0].quantity = -1
    expect(codeOf(neg)).toBe("extraction_schema_invalid")
    const str = valid()
    ;(str.boq.lineItems[0] as Record<string, unknown>).rate = "250"
    expect(codeOf(str)).toBe("extraction_schema_invalid")
    const date = valid()
    date.project.startDate = "2026-02-30"
    expect(codeOf(date)).toBe("extraction_schema_invalid")
    expect(codeOf(null)).toBe("extraction_schema_invalid")
    expect(codeOf("ignore previous instructions")).toBe("extraction_schema_invalid")
  })

  test("a line must cite a sheet and a row the file has", () => {
    const wrongSheet = valid()
    wrongSheet.boq.lineItems[0].source.sheet = "Plumbing"
    expect(codeOf(wrongSheet)).toBe("extraction_not_grounded")
    const blankRow = valid()
    blankRow.boq.lineItems[0].source.row = 2
    expect(codeOf(blankRow)).toBe("extraction_not_grounded")
    const pastEnd = valid()
    pastEnd.boq.lineItems[0].source.row = 9000
    expect(codeOf(pastEnd)).toBe("extraction_not_grounded")
  })

  test("rejection issues are short, capped at 20, and never longer than 200 characters each", () => {
    const many = valid()
    many.boq.lineItems = Array.from({ length: 50 }, () => ({ source: { sheet: "x".repeat(500), row: 1 }, description: "d", unit: "m", quantity: 1, rate: 1, itemCode: "c" }))
    try {
      validateExtractionOutput(many, digest)
      throw new Error("expected a rejection")
    } catch (e) {
      const err = e as ExtractionRejectedError
      expect(err.issues.length).toBeLessThanOrEqual(20)
      expect(err.issues.every((i) => i.length <= 203)).toBe(true)
    }
  })
})

describe("extractProjectFromDocument -- the BOQ must be acceptable to createBoq() before anything is created", () => {
  const small = buildWorkbook([
    { name: "Civil", rows: [["Item", "Description", "Unit", "Qty", "Rate"], ["1.01", "Excavation", "m3", 100, 250], ["1.02", "Backfill", "m3", 50, 120]] },
  ])
  const answer = (lineItems: unknown[]) =>
    edgeCallerFor(edgeDeps(async () => JSON.stringify({ schema: "boq_project_v1", project: { name: "P" }, boq: { title: "B", lineItems } })))
  const line = (row: number, extra: Record<string, unknown> = {}) => ({ source: { sheet: "Civil", row }, description: "d", unit: "m3", quantity: 1, rate: 1, ...extra })

  test("two lines with one item code are refused", async () => {
    const err = await rejection(extractProjectFromDocument({ fileName: "a.xlsx", bytes: small }, { callEdge: answer([line(2, { itemCode: "1.01" }), line(3, { itemCode: "1.01" })]) }))
    expect(err.code).toBe("extraction_boq_invalid")
    expect(err.issues[0]).toContain("duplicate itemCode")
  })

  test("a sub-task without a breakdown percentage, or naming a parent that is not in the reply, is refused", async () => {
    const noPercent = await rejection(extractProjectFromDocument({ fileName: "a.xlsx", bytes: small }, { callEdge: answer([line(2, { itemCode: "1.01" }), line(3, { itemCode: "1.01.1", parentItemCode: "1.01" })]) }))
    expect(noPercent.code).toBe("extraction_boq_invalid")
    const orphan = await rejection(extractProjectFromDocument({ fileName: "a.xlsx", bytes: small }, { callEdge: answer([line(2, { itemCode: "1.01.1", parentItemCode: "9.99", breakdownPercentage: 50 })]) }))
    expect(orphan.code).toBe("extraction_boq_invalid")
  })

  test("a root line without a unit is refused", async () => {
    const err = await rejection(extractProjectFromDocument({ fileName: "a.xlsx", bytes: small }, { callEdge: answer([line(2, { unit: "" })]) }))
    expect(err.code).toBe("extraction_boq_invalid")
  })
})

describe("createEdgeExtractCaller -- the fetch to the Edge Function, wired from the environment", () => {
  test("without a base URL or a secret it answers not-configured and does not call fetch", async () => {
    let calls = 0
    const fetchImpl = (async () => { calls++; return new Response("{}") }) as unknown as typeof fetch
    expect(await createEdgeExtractCaller({ baseUrl: "https://x.supabase.co", secret: "", fetchImpl })("{}")).toEqual({ status: 503, body: { ok: false, code: "extraction_not_configured" } })
    expect(await createEdgeExtractCaller({ baseUrl: undefined, secret: "s".repeat(40), fetchImpl })("{}")).toEqual({ status: 503, body: { ok: false, code: "extraction_not_configured" } })
    expect(calls).toBe(0)
  })

  test("it posts the body to the function path with the bearer secret, whatever trailing slash the base URL has", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return new Response(JSON.stringify({ ok: true, output: { a: 1 } }), { status: 200 })
    }) as unknown as typeof fetch
    const secret = "s".repeat(40)
    const res = await createEdgeExtractCaller({ baseUrl: "https://ref.supabase.co/", secret, fetchImpl })('{"x":1}')
    expect(res).toEqual({ status: 200, body: { ok: true, output: { a: 1 } } })
    expect(seen[0].url).toBe("https://ref.supabase.co/functions/v1/projexa-document-extract")
    expect(seen[0].init.method).toBe("POST")
    expect(seen[0].init.cache).toBe("no-store")
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`)
    expect(seen[0].init.body).toBe('{"x":1}')
  })

  test("a network failure is a 502 edge_unreachable and a non-JSON answer has a null body", async () => {
    const failing = (async () => { throw new Error("connect ECONNREFUSED") }) as unknown as typeof fetch
    expect(await createEdgeExtractCaller({ baseUrl: "https://x.supabase.co", secret: "s".repeat(40), fetchImpl: failing })("{}")).toEqual({ status: 502, body: { ok: false, code: "edge_unreachable" } })
    const html = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch
    expect(await createEdgeExtractCaller({ baseUrl: "https://x.supabase.co", secret: "s".repeat(40), fetchImpl: html })("{}")).toEqual({ status: 502, body: null })
  })
})

// ---------------------------------------------------------------------------------------------------- orchestration
function harness(opts: { failCreateProject?: boolean; failCreateBoq?: boolean } = {}) {
  const l = memoryLedger()
  const projects: Array<{ id: string; input: Record<string, unknown> }> = []
  const boqs: Array<{ id: string; input: { projectId: string; title: string; lineItems: unknown[] } }> = []
  const model = async (req: Parameters<typeof deterministicModel>[0]) => {
    l.events.push("model")
    return deterministicModel(req)
  }
  const caller = edgeCallerFor(edgeDeps(model))
  const deps = {
    callEdge: caller,
    ledger: l.ledger,
    createProject: async (_ctx: { orgId: string; userId: string; isRealUser?: boolean }, input: Record<string, unknown>) => {
      l.events.push("createProject")
      if (opts.failCreateProject) throw new Error("project insert failed")
      const row = { id: `project-${projects.length + 1}`, input }
      projects.push(row)
      return row
    },
    createBoq: async (_ctx: { orgId: string; userId: string }, input: { projectId: string; title: string; lineItems: unknown[] }) => {
      l.events.push("createBoq")
      if (opts.failCreateBoq) throw new Error("boq insert failed")
      const row = { id: `boq-${boqs.length + 1}`, input }
      boqs.push(row)
      return row
    },
  } as unknown as Parameters<typeof createProjectFromDocument>[1]
  return { deps, projects, boqs, ...l }
}

const workbookOf = (seed: string) =>
  buildWorkbook([{ name: "Civil", rows: [["Item", "Description", "Unit", "Qty", "Rate"], ["1.01", `Excavation ${seed}`, "m3", 100, 250]] }])
const INPUT = { orgId: "org-1", actorId: "person-1", productId: "product-1" }

describe("createProjectFromDocument -- the order of the steps", () => {
  test("claim, then read and extract, then createProject, then record it against the claim, then createBoq", async () => {
    const h = harness()
    const result = await createProjectFromDocument({ ...INPUT, fileName: "villa.xlsx", bytes: workbookOf("a") }, h.deps)
    expect(h.events).toEqual(["claim", "model", "createProject", "attach", "createBoq"])
    expect(result.duplicate).toBe(false)
    expect(result).toMatchObject({ projectId: "project-1", extraction: { sheets: 1, lines: 1 } })
    expect(h.projects[0].input).toMatchObject({ productId: "product-1", name: "villa" })
    expect(h.boqs[0].input).toMatchObject({ projectId: "project-1", title: "villa BOQ" })
    expect(h.boqs[0].input.lineItems).toHaveLength(1)
  })

  test("the name the caller gives replaces the name the extraction found", async () => {
    const h = harness()
    await createProjectFromDocument({ ...INPUT, fileName: "villa.xlsx", bytes: workbookOf("a"), projectName: "  Marina Tower  " }, h.deps)
    expect(h.projects[0].input.name).toBe("Marina Tower")
  })
})

describe("createProjectFromDocument -- the same file twice", () => {
  test("a second submit of the same bytes, under another file name, returns the first project and inserts nothing", async () => {
    const h = harness()
    const bytes = workbookOf("same")
    const first = await createProjectFromDocument({ ...INPUT, fileName: "villa.xlsx", bytes }, h.deps)
    const second = await createProjectFromDocument({ ...INPUT, fileName: "villa (copy 2).xlsx", bytes: Buffer.from(bytes) }, h.deps)
    expect(second).toEqual({ duplicate: true, projectId: "project-1" })
    expect(first.projectId).toBe("project-1")
    expect(h.projects).toHaveLength(1)
    expect(h.boqs).toHaveLength(1)
    expect(h.events.filter((e) => e === "model")).toHaveLength(1)
  })

  test("a different file is a different project", async () => {
    const h = harness()
    await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes: workbookOf("one") }, h.deps)
    const second = await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes: workbookOf("two") }, h.deps)
    expect(second.duplicate).toBe(false)
    expect(h.projects).toHaveLength(2)
  })

  test("the ledger key comes from the content: it is not the file hash itself, and it differs when one byte differs", async () => {
    const key = projectSourceLedgerKey("a".repeat(64))
    expect(key).not.toBe("a".repeat(64))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(projectSourceLedgerKey("a".repeat(64))).toBe(key)
    expect(projectSourceLedgerKey(`${"a".repeat(63)}b`)).not.toBe(key)
  })

  test("a file already being processed is duplicate_in_progress, and nothing else runs", async () => {
    const h = harness()
    const bytes = workbookOf("busy")
    h.rows.set(projectSourceLedgerKey(createHashHex(bytes)), { claimId: "claim-x", projectId: null })
    const err = await rejection(createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, h.deps))
    expect(err.code).toBe("duplicate_in_progress")
    expect(err.status).toBe(409)
    expect(h.events).toEqual(["claim"])
  })
})

describe("createProjectFromDocument -- failures", () => {
  test("a refused extraction creates nothing, releases the claim, and the same file can be submitted again", async () => {
    const h = harness()
    const bytes = workbookOf("rejected")
    const bad = { ...h.deps, callEdge: async () => ({ status: 200, body: { ok: true, output: { action: "createProject" } } }) }
    const err = await rejection(createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, bad))
    expect(err.code).toBe("extraction_schema_invalid")
    expect(h.projects).toHaveLength(0)
    expect(h.boqs).toHaveLength(0)
    expect(h.events).toEqual(["claim", "release"])
    expect(h.rows.size).toBe(0)
    const retry = await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, h.deps)
    expect(retry.duplicate).toBe(false)
  })

  test("a createProject failure releases the claim and reports the error itself", async () => {
    const h = harness({ failCreateProject: true })
    await expect(createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes: workbookOf("p") }, h.deps)).rejects.toThrow("project insert failed")
    expect(h.events).toEqual(["claim", "model", "createProject", "release"])
    expect(h.rows.size).toBe(0)
    expect(h.boqs).toHaveLength(0)
  })

  test("a createBoq failure keeps the project and its link: ProjectCreatedWithoutBoqError names it, a second submit returns it", async () => {
    const h = harness({ failCreateBoq: true })
    const bytes = workbookOf("noboq")
    const err = await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, h.deps).catch((e) => e)
    expect(err).toBeInstanceOf(ProjectCreatedWithoutBoqError)
    expect((err as ProjectCreatedWithoutBoqError).projectId).toBe("project-1")
    expect(h.events).toEqual(["claim", "model", "createProject", "attach", "createBoq"])
    expect(await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, h.deps)).toEqual({ duplicate: true, projectId: "project-1" })
  })

  test("recording the project against the claim fails twice: ProjectCreatedUnlinkedError names the project, no BOQ is attempted, and the claim is kept", async () => {
    const h = harness()
    const bytes = workbookOf("unlinked")
    const failing = { ...h.deps, ledger: { ...h.ledger, attach: async () => { h.events.push("attach-failed"); throw new Error("database down") } } }
    const err = await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, failing).catch((e) => e)
    expect(err).toBeInstanceOf(ProjectCreatedUnlinkedError)
    expect((err as ProjectCreatedUnlinkedError).projectId).toBe("project-1")
    expect((err as ProjectCreatedUnlinkedError).cause).toBeInstanceOf(Error)
    expect(h.events).toEqual(["claim", "model", "createProject", "attach-failed", "attach-failed"])
    expect(h.projects).toHaveLength(1)
    expect(h.boqs).toHaveLength(0)
    // The claim is not released: freeing it would let the same file create a second project at once.
    expect(h.rows.size).toBe(1)
    expect([...h.rows.values()][0].projectId).toBeNull()
    const again = await rejection(createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, h.deps))
    expect(again.code).toBe("duplicate_in_progress")
    expect(h.projects).toHaveLength(1)
  })

  test("recording the project fails once and works on the repeat: the BOQ is created and the link is stored", async () => {
    const h = harness()
    let failures = 1
    const flaky = {
      ...h.deps,
      ledger: {
        ...h.ledger,
        attach: async (claimId: string, projectId: string) => {
          if (failures-- > 0) {
            h.events.push("attach-failed")
            throw new Error("connection reset")
          }
          return h.ledger.attach(claimId, projectId)
        },
      },
    }
    const result = await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes: workbookOf("flaky") }, flaky)
    expect(result.duplicate).toBe(false)
    expect(h.events).toEqual(["claim", "model", "createProject", "attach-failed", "attach", "createBoq"])
    expect(h.boqs).toHaveLength(1)
    expect([...h.rows.values()][0].projectId).toBe("project-1")
  })

  test("a claim refused by the rate limit is extraction_rate_limited (429) with the wait, and no model call, project or release follows", async () => {
    const h = harness()
    const limited = { ...h.deps, ledger: { ...h.ledger, claim: async () => { h.events.push("claim"); return { kind: "rate_limited" as const, retryAfterSeconds: 120 } } } }
    const err = await rejection(createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes: workbookOf("busy-org") }, limited))
    expect(err.code).toBe("extraction_rate_limited")
    expect(err.status).toBe(429)
    expect(err.retryAfterSeconds).toBe(120)
    expect(h.events).toEqual(["claim"])
    expect(h.projects).toHaveLength(0)
  })

  test("a file that is not an xlsx workbook, or is over the size limit, is refused before the ledger is touched", async () => {
    const h = harness()
    const csv = await rejection(createProjectFromDocument({ ...INPUT, fileName: "a.csv", bytes: Buffer.from("Item,Description\n1.01,Excavation") }, h.deps))
    expect(csv.code).toBe("unsupported_file_type")
    const huge = await rejection(createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes: new Uint8Array(WORKBOOK_LIMITS.maxBytes + 1) }, h.deps))
    expect(huge.code).toBe("workbook_too_large")
    expect(h.events).toEqual([])
  })

  test("a failure while releasing the claim does not hide the real error", async () => {
    const h = harness()
    const noRelease = { ...h.deps, ledger: { ...h.ledger, release: async () => { throw new Error("database down") } }, callEdge: async () => ({ status: 503, body: { ok: false, code: "model_not_configured" } }) }
    const err = await rejection(createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes: workbookOf("r") }, noRelease))
    expect(err.code).toBe("model_not_configured")
  })

  // The ledger rows are the organisation's rate limit; a claim released with modelCalled false is left out of the count (see the ledger
  // notes in document-extraction-service.ts and the SQL proof in document-extraction-ledger.test.ts). Here: which refusals say so.
  describe("what the claim is released as: an attempt that did not reach a model does not count against the limit", () => {
    const answering = (status: number, body: unknown) => async () => ({ status, body })
    const releasedAs = async (bytes: Uint8Array, edge: ReturnType<typeof answering> | null, opts: { failCreateProject?: boolean } = {}) => {
      const h = harness(opts)
      const deps = edge ? { ...h.deps, callEdge: edge } : h.deps
      await createProjectFromDocument({ ...INPUT, fileName: "a.xlsx", bytes }, deps).catch(() => undefined)
      return h.releases.map((r) => r.modelCalled)
    }
    const notReached: Array<[string, () => Promise<boolean[]>]> = [
      ["the model is not configured (the function says so)", () => releasedAs(workbookOf("n1"), answering(503, { ok: false, code: "model_not_configured" }))],
      ["extraction is not set up in this environment", () => releasedAs(workbookOf("n2"), answering(503, { ok: false, code: "extraction_not_configured" }))],
      ["the function refuses the request as too large", () => releasedAs(workbookOf("n3"), answering(413, { ok: false, code: "input_too_large" }))],
      ["the file is a zip that is not a workbook", () => releasedAs(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("garbage")]), null)],
      ["the workbook has no cells", () => releasedAs(buildWorkbook([{ name: "A", rows: [] }]), null)],
      ["the workbook is over a limit (too many columns)", () => releasedAs(buildWorkbook([{ name: "W", rows: [Array.from({ length: WORKBOOK_LIMITS.maxColumns + 1 }, (_, i) => `c${i}`)] }]), null)],
    ]
    for (const [label, run] of notReached) {
      test(`released as not counted: ${label}`, async () => {
        expect(await run()).toEqual([false])
      })
    }

    const mayHaveReached: Array<[string, () => Promise<boolean[]>]> = [
      ["the answer is not valid against the schema", () => releasedAs(workbookOf("m1"), answering(200, { ok: true, output: { action: "createProject" } }))],
      ["the model call failed inside the function", () => releasedAs(workbookOf("m2"), answering(502, { ok: false, code: "model_error" }))],
      ["the function refused the caller (a call that may not have been billed is still an attempt)", () => releasedAs(workbookOf("m3"), answering(401, { ok: false, code: "unauthorized" }))],
      ["the project could not be created after a valid answer", () => releasedAs(workbookOf("m4"), null, { failCreateProject: true })],
    ]
    for (const [label, run] of mayHaveReached) {
      test(`released as counted: ${label}`, async () => {
        expect(await run()).toEqual([true])
      })
    }
  })
})

function createHashHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
