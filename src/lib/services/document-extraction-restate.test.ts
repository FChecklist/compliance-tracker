/// <reference types="bun-types" />
// BUILD-002 WP-15 (AW-902): a model told to return the reader's lines exactly still changes one now and then (first live run of the real ZOOMIES file: a lump-sum line's
// description came back different, and the whole file was refused). restateCandidateLines() writes each candidate line as the file's own reading has it, so a changed
// field cannot reach the BOQ, and an ADDED or DROPPED line is still refused. Proven on the ZOOMIES workbook through the real service and the real handler.
// Run: bun test --isolate src/lib/services/document-extraction-restate.test.ts
import { describe, expect, test } from "bun:test"
import { extractProjectFromDocument } from "./document-extraction-service"
import { ExtractionRejectedError } from "./document-extraction-schema"
import { edgeCallerFor, edgeDeps } from "./__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"
import type { ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"

/** The careful stand-in's answer, changed by `change` before it is returned: what a model that is sloppy with one line would send. */
function sloppy(change: (out: { boq: { lineItems: Array<Record<string, unknown>> } }) => void): ModelCall {
  return async (req) => {
    const reply = await carefulHumanModel(req)
    const text = typeof reply === "string" ? reply : reply.text
    const out = JSON.parse(text)
    change(out)
    return { text: JSON.stringify(out) }
  }
}

const run = (model: ModelCall) => extractProjectFromDocument({ fileName: "SMD ZOOMIES.xlsx", bytes: new Uint8Array(zoomiesWorkbook()) }, { callEdge: edgeCallerFor(edgeDeps(model)) })
const total = (r: Awaited<ReturnType<typeof run>>) => r.extracted.boq.lineItems.reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0)

describe("restateCandidateLines through the real service", () => {
  test("a model that reformats one description still gives the reader's line, text and all: 53 lines, AED 1,596,280", async () => {
    const honest = await run(carefulHumanModel)
    const result = await run(sloppy((out) => (out.boq.lineItems[51].description = "  Something   the model reformatted  ")))
    expect(result.extracted.boq.lineItems).toEqual(honest.extracted.boq.lineItems)
    expect(result.stats.lines).toBe(53)
    expect(Math.round(total(result) * 100) / 100).toBe(1_596_280)
  })

  test("a changed rate, quantity, unit or category is still refused: restating touches description only", async () => {
    await expect(run(sloppy((out) => (out.boq.lineItems[3].rate = 999_999)))).rejects.toMatchObject({ code: "extraction_lines_diverge" })
    await expect(run(sloppy((out) => (out.boq.lineItems[7].unit = "kg")))).rejects.toMatchObject({ code: "extraction_lines_diverge" })
    await expect(run(sloppy((out) => (out.boq.lineItems[3].quantity += 1)))).rejects.toMatchObject({ code: "extraction_lines_diverge" })
  })

  test("an ADDED line and a DROPPED line are still refused", async () => {
    // an invented line with a fresh item code (valid area code shape) is not one the file's reading found
    await expect(run(sloppy((out) => out.boq.lineItems.push({ ...out.boq.lineItems[0], itemCode: "PLAY-B9-999" })))).rejects.toMatchObject({ code: "extraction_lines_diverge" })
    await expect(run(sloppy((out) => out.boq.lineItems.pop()))).rejects.toBeInstanceOf(ExtractionRejectedError)
    await expect(run(sloppy((out) => out.boq.lineItems.pop()))).rejects.toMatchObject({ code: "extraction_lines_diverge" })
  })
})
