/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02, register row AW-114: a line with a quantity and no rate is a QUESTION, never a zero-priced line, and "if
// there is any question, ask the human" works because a question is a state of the job, not an error.
//
// WHAT IS PROVEN
//   1. On the ZOOMIES workbook (Play and Vet): 22 rows have a quantity and no rate ("-", Excluded, By Main Contractor, Details
//      required). 21 of them come back as questions (kind no_rate) and the 22nd sits under the Play Bill 7 lump sum, which the file
//      prices as a whole; 3 more questions ask for the lump sums to be confirmed and 3 report cells that hold several lines pressed
//      together. No created line has a rate or a quantity of 0, and none of the question rows is the source of a line.
//   2. With any open question and no acknowledgement, NOTHING is created (0 createProject, 0 createBoq); the job is parked in
//      needs_answers with its extraction stored and the claim kept, and the answer to the caller is `pending`, not an error.
//   3. A second submit of the same file with acknowledgeQuestions finishes the parked job WITHOUT a second model call and creates
//      the project and the BOQ once; the questions stay on the job. mode "prepare" parks a job with no question in `ready` and a
//      second submit creates it the same way.
//   4. Whatever the model returns, the service moves a root line that has a quantity and no rate (or a rate of 0), or a rate and
//      no quantity, out of the BOQ and into a question; a sub-task of such a line goes with it, and the question says so. A workbook
//      in which no line can be priced is refused (extraction_boq_invalid); a cell cut at the cell limit is a question too.
//   5. The questions of the reader, the model and the service are merged once each (same kind, sheet and row).
//
// Run: bun test --isolate src/lib/services/document-extraction-questions.test.ts
import { describe, expect, test } from "bun:test"
import { readMultisheetBills } from "@/lib/ingest/multisheet-bill-reader"
import { extractProjectFromDocument } from "./document-extraction-service"
import { mergeQuestions, splitUnpricedLines } from "./document-extraction-reconcile"
import type { ExtractedProject, ExtractionQuestion } from "./document-extraction-schema"
import type { ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"
import { buildWorkbook, deterministicModel, edgeCallerFor, edgeDeps } from "./__test-helpers__/document-extraction-fixtures"
import { harness, outcome } from "./__test-helpers__/document-extraction-harness"
import { carefulHumanModel } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesFixture, zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"

const kinds = (qs: ExtractionQuestion[]) => qs.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.kind]: (acc[q.kind] ?? 0) + 1 }), {})

describe("AW-114 on the ZOOMIES workbook", () => {
  const bytes = zoomiesWorkbook()

  test("the reader's accounting: 21 questions for rows with a quantity and no rate, plus 1 covered by the Play Bill 7 lump sum", () => {
    const read = readMultisheetBills(zoomiesFixture as never)
    const glass = read.lumpSums.find((l) => l.bill === "7")!
    expect(read.questions.filter((q) => q.kind === "no_rate")).toHaveLength(21)
    expect(glass.notItemised).toHaveLength(1)
    expect(read.questions.filter((q) => q.kind === "no_rate").length + glass.notItemised.length).toBe(22)
  })

  test("the extraction returns those 21 as questions with their sheet, row and text, and no created line is priced at 0", async () => {
    const result = await extractProjectFromDocument({ fileName: "zoomies.xlsx", bytes }, { callEdge: edgeCallerFor(edgeDeps(carefulHumanModel)) })
    expect(kinds(result.questions)).toEqual({ no_rate: 21, lump_sum: 3, packed_cell: 2, packed_sheet: 1 })
    expect(result.questions).toHaveLength(27)
    for (const q of result.questions) {
      expect(typeof q.sheet).toBe("string")
      expect(Number.isInteger(q.row)).toBe(true)
      expect(q.text.length).toBeGreaterThan(10)
      expect(q.text.length).toBeLessThanOrEqual(500)
    }
    const lines = result.extracted.boq.lineItems
    expect(lines).toHaveLength(53)
    expect(lines.every((l) => (l.quantity ?? 0) > 0 && (l.rate ?? 0) > 0)).toBe(true)
    const lineRows = new Set(lines.map((l) => `${l.source.sheet}|${l.source.row}`))
    for (const q of result.questions.filter((x) => x.kind === "no_rate")) expect(lineRows.has(`${q.sheet}|${q.row}`)).toBe(false)
    expect(result.extracted.questions).toEqual(result.questions)
  })

  test("with open questions and no acknowledgement NOTHING is created: the job is parked in needs_answers with its extraction stored", async () => {
    const h = harness(carefulHumanModel)
    const { result, error } = await outcome(h, bytes)
    expect(error).toBeNull()
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
    expect(result).toMatchObject({ duplicate: false, pending: true, state: "needs_answers", jobId: "claim-1" })
    const pending = result as Extract<typeof result, { pending: true }>
    expect(pending.questions).toHaveLength(27)
    expect(pending.reconciliation.status).toBe("matched")
    // Parked, not released: the claim is kept and the stored result can finish the job.
    expect(h.rows.size).toBe(1)
    expect(h.events).toEqual(["claim"])
    expect(h.states.map((s) => s.state)).toEqual(["reading", "needs_answers"])
    const stored = h.states[1].result as { v: number; extracted: ExtractedProject; questions: unknown[]; acknowledgedShortfall: boolean }
    expect(stored.v).toBe(1)
    expect(stored.extracted.boq.lineItems).toHaveLength(53)
    expect(stored.questions).toHaveLength(27)
    expect(stored.acknowledgedShortfall).toBe(false)
  })

  test("a second submit with acknowledgeQuestions finishes the parked job WITHOUT a second model call and creates one project and one BOQ", async () => {
    const h = harness(carefulHumanModel)
    await outcome(h, bytes)
    expect(h.caller.calls.count).toBe(1)
    const { result, error } = await outcome(h, bytes, { acknowledgeQuestions: true })
    expect(error).toBeNull()
    expect(h.caller.calls.count).toBe(1)
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
    expect(h.created.lines).toHaveLength(53)
    expect(h.created.lines.every((l) => l.quantity > 0 && l.rate > 0)).toBe(true)
    expect(result).toMatchObject({ duplicate: false, projectId: "project-1" })
    expect((result as { questions: unknown[] }).questions).toHaveLength(27)
    expect(h.events).toEqual(["claim", "claim", "attach"])
    expect(h.states.map((s) => s.state)).toEqual(["reading", "needs_answers", "reading", "created"])
    // Asking again returns the project and inserts nothing.
    const again = await outcome(h, bytes, { acknowledgeQuestions: true })
    expect(again.result).toEqual({ duplicate: true, projectId: "project-1" })
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
  })

  test("the same file submitted with acknowledgeQuestions from the start creates at once, and the questions are still returned", async () => {
    const h = harness(carefulHumanModel)
    const { result } = await outcome(h, bytes, { acknowledgeQuestions: true })
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
    expect((result as { questions: unknown[] }).questions).toHaveLength(27)
    expect(h.states.map((s) => s.state)).toEqual(["reading", "created"])
  })
})

// A workbook the deterministic reader does not apply to (the rate column is called Price), so the model's own lines are what the
// service has to judge.
const priceBook = (rows: unknown[][]) => buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price", "Amount", "Breakdown %"], ...rows] }])

describe("AW-114 whatever the model returns: an unpriced line is a question", () => {
  test("a quantity with no rate, a rate of 0, and a rate with no quantity leave the BOQ and become questions; the priced line is created", async () => {
    const bytes = priceBook([
      ["1.01", "Priced", "m2", 10, 500],
      ["1.02", "No rate", "m2", 5, ""],
      ["1.03", "No quantity", "m2", "", 200],
      ["1.04", "Rate of zero", "m2", 7, 0],
    ])
    const h = harness(deterministicModel)
    const first = await outcome(h, bytes)
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
    const pending = first.result as Extract<NonNullable<typeof first.result>, { pending: true }>
    expect(pending.state).toBe("needs_answers")
    expect(kinds(pending.questions)).toEqual({ no_rate: 2, bad_quantity: 1 })
    expect(pending.questions.map((q) => q.row).sort()).toEqual([3, 4, 5])
    const created = await outcome(h, bytes, { acknowledgeQuestions: true })
    expect(created.error).toBeNull()
    expect(h.created.lines.map((l) => l.itemCode)).toEqual(["1.01"])
    expect(h.created.lines.some((l) => l.rate === 0 || l.quantity === 0)).toBe(false)
  })

  test("the sub-task lines of a line that leaves the BOQ leave with it, and the question says so", async () => {
    const bytes = priceBook([
      ["1.01", "Priced", "m2", 10, 500],
      ["1.02", "No rate", "m2", 5, ""],
      ["1.02.1", "Sub one", "", "", "", "", 60],
      ["1.02.2", "Sub two", "", "", "", "", 40],
    ])
    const h = harness(deterministicModel)
    await outcome(h, bytes, { acknowledgeQuestions: true })
    expect(h.created.lines.map((l) => l.itemCode)).toEqual(["1.01"])
    const split = splitUnpricedLines({
      schema: "boq_project_v1",
      project: { name: "P" },
      boq: {
        title: "B",
        lineItems: [
          { source: { sheet: "Bill", row: 3 }, itemCode: "1.02", description: "No rate", unit: "m2", quantity: 5 },
          { source: { sheet: "Bill", row: 4 }, itemCode: "1.02.1", parentItemCode: "1.02", breakdownPercentage: 60, description: "Sub one", unit: "" },
          { source: { sheet: "Bill", row: 5 }, itemCode: "1.02.2", parentItemCode: "1.02", breakdownPercentage: 40, description: "Sub two", unit: "" },
          { source: { sheet: "Bill", row: 6 }, itemCode: "1.03", description: "Priced", unit: "m2", quantity: 1, rate: 1 },
        ],
      },
    })
    expect(split.extracted.boq.lineItems.map((l) => l.itemCode)).toEqual(["1.03"])
    expect(split.questions).toHaveLength(1)
    expect(split.questions[0].text).toContain("Its 2 sub-task line(s) were left out with it.")
  })

  test("a root with neither a quantity nor a rate is a heading and stays; the answer object is not changed in place", () => {
    const answer: ExtractedProject = {
      schema: "boq_project_v1",
      project: { name: "P" },
      boq: { title: "B", lineItems: [{ source: { sheet: "Bill", row: 2 }, itemCode: "H", description: "Heading", unit: "" }, { source: { sheet: "Bill", row: 3 }, itemCode: "1", description: "No rate", unit: "m", quantity: 2 }] },
    }
    const before = JSON.stringify(answer)
    const split = splitUnpricedLines(answer)
    expect(split.extracted.boq.lineItems.map((l) => l.itemCode)).toEqual(["H"])
    expect(JSON.stringify(answer)).toBe(before)
    // Nothing to move: the same object comes back and there are no questions.
    const clean = { ...answer, boq: { ...answer.boq, lineItems: [answer.boq.lineItems[0]] } }
    expect(splitUnpricedLines(clean)).toEqual({ extracted: clean, questions: [] })
  })

  test("a workbook in which no line can be priced is refused, not created empty", async () => {
    const h = harness(deterministicModel)
    const { error } = await outcome(h, priceBook([["1.01", "No rate", "m2", 5, ""]]), { acknowledgeQuestions: true })
    expect(error!.code).toBe("extraction_boq_invalid")
    expect(error!.message).toContain("nothing to create")
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
    expect(h.events).toEqual(["claim", "release"])
  })

  test("a cell cut at the cell limit is a question: the job waits for a person instead of creating from half a clause", async () => {
    const bytes = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Priced", "m2", 10, 500], ["Notes", `Clause ${"y".repeat(2500)}`]] }])
    const h = harness(deterministicModel)
    const { result } = await outcome(h, bytes)
    const pending = result as Extract<NonNullable<typeof result>, { pending: true }>
    expect(pending.state).toBe("needs_answers")
    expect(pending.questions).toHaveLength(1)
    expect(pending.questions[0]).toMatchObject({ kind: "unclear", sheet: "Bill", row: 3 })
    expect(h.calls.createProject).toBe(0)
  })

  test("mode prepare parks a job with no question in ready; a second submit creates it without a second model call", async () => {
    const bytes = priceBook([["1.01", "Priced", "m2", 10, 500]])
    const h = harness(deterministicModel)
    const prepared = await outcome(h, bytes, { mode: "prepare" })
    expect(prepared.result).toMatchObject({ pending: true, state: "ready", questions: [] })
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
    expect(h.states.map((s) => s.state)).toEqual(["reading", "ready"])
    const done = await outcome(h, bytes)
    expect(done.error).toBeNull()
    expect(h.caller.calls.count).toBe(1)
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
    expect(h.states.map((s) => s.state)).toEqual(["reading", "ready", "reading", "created"])
  })
})

describe("AW-114 the questions of every source are merged once", () => {
  test("the same kind, sheet and row is one question, in the order the lists are given", () => {
    const q = (kind: ExtractionQuestion["kind"], row: number, text = "t"): ExtractionQuestion => ({ kind, sheet: "S", row, text })
    expect(mergeQuestions([q("no_rate", 1, "reader")], [q("no_rate", 1, "model"), q("unclear", 1), q("no_rate", 2)], [q("no_rate", 2, "service")])).toEqual([
      q("no_rate", 1, "reader"),
      q("unclear", 1),
      q("no_rate", 2),
    ])
  })

  test("a question of the model's own is added to the reader's, and one that repeats the reader's is not counted twice", async () => {
    const own: ModelCall = async (req) => {
      const answer = JSON.parse(await carefulHumanModel(req)) as { questions: Array<{ kind: string; sheet: string; row: number; text: string }> }
      answer.questions.push({ ...answer.questions[0], text: "the same question, in the model's words" })
      answer.questions.push({ kind: "missing_information", sheet: "Table 1", row: 3, text: "The client is not named in this file. Who is the client?" })
      return JSON.stringify(answer)
    }
    const result = await extractProjectFromDocument({ fileName: "zoomies.xlsx", bytes: zoomiesWorkbook() }, { callEdge: edgeCallerFor(edgeDeps(own)) })
    expect(result.questions).toHaveLength(28)
    expect(result.questions.filter((q) => q.kind === "missing_information")).toHaveLength(1)
    // The reader's wording wins for a repeated question: it came first.
    expect(result.questions.some((q) => q.text === "the same question, in the model's words")).toBe(false)
  })
})
