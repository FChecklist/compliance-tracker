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
} from "./document-extraction-service"

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
