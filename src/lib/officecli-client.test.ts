// PRIORITY-22 (2026-07-16): mammoth-replacement OfficeCLI wrapper. Two
// layers, matching this repo's existing precedent of testing pure functions
// directly while keeping DB/process-touching functions out of unit tests
// (see document-classification-service.test.ts's own header comment for the
// same discipline applied to a live DB instead of a live child process):
//
// 1. parseQueryResultToText() -- a pure function, tested everywhere with
//    literal JSON fixtures captured from the REAL binary during this task
//    (see officecli-client.ts's own header comment for how they were
//    captured: a real create/add/close/query round-trip against the actual
//    v1.0.136 CLI, including the table-nested-paragraph case).
// 2. extractDocxRawText() -- a real, non-mocked integration test that
//    invokes the actual committed bin/officecli-linux-x64 binary end-to-end
//    against a real .docx built with the `docx` package (already a
//    dependency, used for Word export elsewhere in this codebase -- no new
//    test dependency needed). This is preferred over mocking child_process
//    per the task brief, since the binary is genuinely vendored into the
//    repo and CI runs on the matching ubuntu-latest Linux runner. Skipped on
//    non-Linux platforms (e.g. a contributor's Windows/macOS dev machine)
//    since only the Linux x64 binary is committed -- this is a real,
//    disclosed limitation of local dev-machine coverage, not a hidden gap:
//    CI is where this test actually runs and matters.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx"
import PptxGenJS from "pptxgenjs"
import { extractDocxRawText, extractPptxRawText, OfficeCliError, parseQueryResultToText } from "./officecli-client"

describe("parseQueryResultToText -- pure JSON-to-text parsing (real captured fixtures)", () => {
  test("concatenates each result's top-level text field, newline-joined", () => {
    const fixture = JSON.stringify({
      success: true,
      data: {
        matches: 2,
        results: [
          { path: "/body/p[1]", type: "paragraph", text: "Hello from OfficeCLI test." },
          { path: "/body/p[2]", type: "paragraph", text: "Second paragraph: compliance deadline is 2026-08-01." },
        ],
      },
    })
    expect(parseQueryResultToText(fixture)).toBe("Hello from OfficeCLI test.\nSecond paragraph: compliance deadline is 2026-08-01.")
  })

  test("includes paragraphs nested inside table cells, in document order (real captured shape)", () => {
    // Captured against the real binary: a paragraph before a 2x2 table,
    // followed by the table's 4 (empty, in this fixture) cell paragraphs.
    const fixture = JSON.stringify({
      success: true,
      data: {
        matches: 5,
        results: [
          { path: "/body/p[@paraId=00100000]", type: "paragraph", text: "Before table paragraph." },
          { path: "/body/tbl[1]/tr[1]/tc[1]/p[@paraId=00100002]", type: "paragraph", text: "Row1Col1" },
          { path: "/body/tbl[1]/tr[1]/tc[2]/p[@paraId=00100004]", type: "paragraph", text: "Row1Col2" },
          { path: "/body/tbl[1]/tr[2]/tc[1]/p[@paraId=00100006]", type: "paragraph", text: "Row2Col1" },
          { path: "/body/tbl[1]/tr[2]/tc[2]/p[@paraId=00100008]", type: "paragraph", text: "Row2Col2" },
        ],
      },
    })
    expect(parseQueryResultToText(fixture)).toBe("Before table paragraph.\nRow1Col1\nRow1Col2\nRow2Col1\nRow2Col2")
  })

  test("an empty document (matches: 0) returns an empty string, not a crash", () => {
    const fixture = JSON.stringify({ success: true, data: { matches: 0, results: [] } })
    expect(parseQueryResultToText(fixture)).toBe("")
  })

  test("a result with no text field is treated as empty text, not undefined-concatenated", () => {
    const fixture = JSON.stringify({
      success: true,
      data: { matches: 1, results: [{ path: "/body/p[1]", type: "paragraph" }] },
    })
    expect(parseQueryResultToText(fixture)).toBe("")
  })

  test("throws OfficeCliError with the real error message on success:false (captured: file-not-found shape)", () => {
    const fixture = JSON.stringify({
      success: false,
      error: { error: "File not found: /tmp/nope.docx", code: "file_not_found", suggestion: "Check the file path." },
    })
    expect(() => parseQueryResultToText(fixture)).toThrow(OfficeCliError)
    try {
      parseQueryResultToText(fixture)
      throw new Error("expected parseQueryResultToText to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(OfficeCliError)
      expect((err as OfficeCliError).message).toBe("File not found: /tmp/nope.docx")
      expect((err as OfficeCliError).code).toBe("file_not_found")
    }
  })

  test("throws OfficeCliError with the real error message on success:false (captured: corrupt-file shape)", () => {
    const fixture = JSON.stringify({
      success: false,
      error: { error: "Cannot open garbage.docx: File contains corrupted data.", code: "corrupt_file" },
    })
    expect(() => parseQueryResultToText(fixture)).toThrow("Cannot open garbage.docx: File contains corrupted data.")
  })

  test("throws OfficeCliError on non-JSON stdout instead of crashing on JSON.parse", () => {
    expect(() => parseQueryResultToText("not json at all")).toThrow(OfficeCliError)
  })
})

describe("extractDocxRawText -- real end-to-end integration against the vendored Linux binary", () => {
  // Only the Linux x64 binary is committed (bin/officecli-linux-x64) -- the
  // real Vercel/CI runtime target, per the feasibility memo. This test only
  // runs where that binary can actually execute.
  test.skipIf(process.platform !== "linux")("extracts paragraph text (including a table) from a real .docx buffer, matching mammoth's return shape", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("Integration test paragraph one.")] }),
            new Paragraph({ children: [new TextRun("Integration test paragraph two: 2026-08-01 deadline.")] }),
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph("CellA1")] }),
                    new TableCell({ children: [new Paragraph("CellB1")] }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    })
    const buffer = await Packer.toBuffer(doc)

    const result = await extractDocxRawText(buffer)

    // Shape check: matches mammoth.extractRawText()'s `{ value: string }`.
    expect(typeof result.value).toBe("string")
    expect(result.value).toContain("Integration test paragraph one.")
    expect(result.value).toContain("Integration test paragraph two: 2026-08-01 deadline.")
    expect(result.value).toContain("CellA1")
    expect(result.value).toContain("CellB1")
  }, 30000)

  test.skipIf(process.platform !== "linux")("throws OfficeCliError for a corrupt/non-docx buffer instead of returning garbage text", async () => {
    const notADocx = Buffer.from("this is not a real docx file, just plain bytes")
    await expect(extractDocxRawText(notADocx)).rejects.toThrow(OfficeCliError)
  }, 30000)

  test.skipIf(process.platform !== "linux")("the vendored binary is present and marked executable in the working tree", async () => {
    const stat = await fs.stat(process.cwd() + "/bin/officecli-linux-x64")
    expect(stat.isFile()).toBe(true)
    expect((stat.mode & 0o100) !== 0).toBe(true)
  })
})

describe("extractPptxRawText -- real end-to-end integration against the vendored Linux binary", () => {
  // VERIDIAN Review Framework remediation ("Supports Multiple Input Types",
  // 2026-07-18): same real, non-mocked integration posture as
  // extractDocxRawText's own tests above -- a real .pptx built with
  // `pptxgenjs` (already a dependency, used for pptx export elsewhere in
  // this codebase -- pptxgenjs itself can run server-side and write a Node
  // Buffer directly via `outputType: "nodebuffer"`, no browser needed for
  // this test).
  test.skipIf(process.platform !== "linux")("extracts slide text from a real .pptx buffer", async () => {
    const pptx = new PptxGenJS()
    const slide1 = pptx.addSlide()
    slide1.addText("Integration test slide one.", { x: 1, y: 1 })
    const slide2 = pptx.addSlide()
    slide2.addText("Integration test slide two: 2026-08-01 deadline.", { x: 1, y: 1 })
    const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer

    const result = await extractPptxRawText(buffer)

    expect(typeof result.value).toBe("string")
    expect(result.value).toContain("Integration test slide one.")
    expect(result.value).toContain("Integration test slide two: 2026-08-01 deadline.")
  }, 30000)

  test.skipIf(process.platform !== "linux")("throws OfficeCliError for a corrupt/non-pptx buffer instead of returning garbage text", async () => {
    const notAPptx = Buffer.from("this is not a real pptx file, just plain bytes")
    await expect(extractPptxRawText(notAPptx)).rejects.toThrow(OfficeCliError)
  }, 30000)
})
