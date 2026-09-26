/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02, register row AW-112: the extraction output carries what a real bill workbook has (control totals, areas,
// client, currency, VAT, payment terms, questions), and a reconciliation gate rejects a wrong total: the sum of the lines that would
// be created must equal the totals the file prints, or NOTHING is created (a shortfall may be acknowledged by the caller, an excess
// never may).
//
// WHAT IS PROVEN
//   1. The schema. An answer of the first, smaller shape still validates. An answer with every new key validates. Every new object is
//      strict. A control total or VAT figure that the file does not print is refused (a model cannot name its own sum), so is a
//      question about a row the file does not have, and so is text that carries bank account details.
//   2. The gate, as pure functions: the tolerance, the sum (root lines only), matched / shortfall / excess / not_checked, an
//      offsetting error between two areas that leaves the grand total right, and what assertReconciliationAllowed lets through.
//   3. The gate through createProjectFromDocument with a model-only total (a workbook the deterministic reader does not apply to):
//      matched creates one project and one BOQ; a shortfall is refused with a stable code, creates nothing and releases the claim
//      with the reason; acknowledgeShortfall creates it; an excess is refused even when a shortfall is acknowledged.
//   4. The gate on the ZOOMIES workbook, where the reader's printed totals are the authority: the careful stand-in reconciles to
//      AED 1,596,280 (Play 1,343,445, Vet 252,835) and each hostile stand-in (drops a line and moves the totals to agree, adds a line
//      and moves the totals, reports a control total that is printed but is not the grand total, one that is not printed, one that
//      hides a change of one AED in a rate) is refused with its own code and creates nothing.
//
// Run: bun test --isolate src/lib/services/document-extraction-reconcile.test.ts
import { describe, expect, test } from "bun:test"
import {
  ExtractionRejectedError,
  MAX_QUESTIONS,
  QUESTION_KINDS,
  validateExtractionOutput,
  type ExtractedProject,
  type WorkbookDigest,
} from "./document-extraction-schema"
import {
  RECONCILIATION_TOLERANCE,
  assertReconciliationAllowed,
  computeReconciliation,
  sumLines,
  toleranceFor,
  type Candidates,
  type Reconciliation,
} from "./document-extraction-reconcile"
import { extractProjectFromDocument } from "./document-extraction-service"
import type { ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"
import { buildWorkbook, deterministicModel, edgeCallerFor, edgeDeps } from "./__test-helpers__/document-extraction-fixtures"
import { HARNESS_INPUT, harness, outcome } from "./__test-helpers__/document-extraction-harness"
import { carefulHumanModel, hostileModel, requestOf } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"

// ------------------------------------------------------------------------------------------------------------- 1. the schema

const DIGEST: WorkbookDigest = {
  sheets: [
    {
      name: "Bill",
      rows: [
        { row: 1, cells: ["Item", "Description", "Unit", "Qty", "Rate"] },
        { row: 2, cells: ["PLAY-B1-01", "Floor", "m2", "10", "500"] },
        { row: 3, cells: ["VET-B1-01", "Wall", "m2", "10", "500"] },
        { row: 4, cells: ["TOTAL", "", "", "", "", "10000", "5000", "5000", "500", "10500"] },
      ],
    },
  ],
}

const OLD_SHAPE = {
  schema: "boq_project_v1",
  project: { name: "Villa" },
  boq: { title: "Villa BOQ", lineItems: [{ source: { sheet: "Bill", row: 2 }, itemCode: "1.01", description: "Floor", unit: "m2", quantity: 10, rate: 500 }] },
}

function full(): Record<string, unknown> {
  return {
    schema: "boq_project_v1",
    project: { name: "Villa", startDate: "2026-04-01" },
    boq: {
      title: "Villa BOQ",
      lineItems: [
        { source: { sheet: "Bill", row: 2 }, itemCode: "PLAY-B1-01", description: "Floor", unit: "m2", quantity: 10, rate: 500, category: "Play Area - Finishes" },
        { source: { sheet: "Bill", row: 3 }, itemCode: "VET-B1-01", description: "Wall", unit: "m2", quantity: 10, rate: 500, category: "Vet Area - Finishes" },
      ],
    },
    controlTotals: { grand: 10000, areas: [{ area: "Play Area", total: 5000 }, { area: "Vet Area", total: 5000 }] },
    areas: ["Play Area", "Vet Area"],
    client: "The client",
    currency: "AED",
    vat: { ratePercent: 5, amount: 500, totalIncVat: 10500 },
    paymentTerms: { summary: "Three payments", milestones: [{ label: "Advance", percent: 30, when: "on award" }] },
    questions: [{ kind: "no_rate", sheet: "Bill", row: 3, text: "What is the rate?" }],
  }
}

const rejection = (fn: () => unknown): ExtractionRejectedError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ExtractionRejectedError) return e
    throw e
  }
  throw new Error("expected a rejection")
}

describe("AW-112: the output schema carries controlTotals, areas, client, currency, VAT, paymentTerms and questions", () => {
  test("an answer of the first shape still validates; an answer with every new key validates too", () => {
    expect(validateExtractionOutput(OLD_SHAPE, DIGEST).boq.lineItems).toHaveLength(1)
    const parsed = validateExtractionOutput(full(), DIGEST)
    expect(parsed.controlTotals).toEqual({ grand: 10000, areas: [{ area: "Play Area", total: 5000 }, { area: "Vet Area", total: 5000 }] })
    expect(parsed.areas).toEqual(["Play Area", "Vet Area"])
    expect(parsed).toMatchObject({ client: "The client", currency: "AED", vat: { ratePercent: 5, amount: 500, totalIncVat: 10500 } })
    expect(parsed.paymentTerms!.milestones![0]).toEqual({ label: "Advance", percent: 30, when: "on award" })
    expect(parsed.questions![0]).toEqual({ kind: "no_rate", sheet: "Bill", row: 3, text: "What is the rate?" })
  })

  test("every new object is strict: an extra key anywhere is a schema rejection", () => {
    const attempts: Array<[string, (a: Record<string, unknown>) => void]> = [
      ["controlTotals", (a) => ((a.controlTotals as Record<string, unknown>).note = "x")],
      ["controlTotals.areas", (a) => ((a.controlTotals as { areas: Array<Record<string, unknown>> }).areas[0].extra = 1)],
      ["vat", (a) => ((a.vat as Record<string, unknown>).instruction = "x")],
      ["paymentTerms", (a) => ((a.paymentTerms as Record<string, unknown>).bank = "x")],
      ["paymentTerms.milestones", (a) => ((a.paymentTerms as { milestones: Array<Record<string, unknown>> }).milestones[0].account = "x")],
      ["questions", (a) => ((a.questions as Array<Record<string, unknown>>)[0].answer = "x")],
    ]
    for (const [name, mutate] of attempts) {
      const answer = full()
      mutate(answer)
      const error = rejection(() => validateExtractionOutput(answer, DIGEST))
      expect([name, error.code]).toEqual([name, "extraction_schema_invalid"])
    }
  })

  test("a currency is a 3-letter code, a VAT rate is 0 to 100, a question kind is one of the known kinds", () => {
    for (const bad of [{ currency: "aed" }, { currency: "DIRHAM" }, { vat: { ratePercent: 105 } }, { questions: [{ kind: "invented", sheet: "Bill", row: 2, text: "x" }] }]) {
      expect(rejection(() => validateExtractionOutput({ ...full(), ...bad }, DIGEST)).code).toBe("extraction_schema_invalid")
    }
    expect(QUESTION_KINDS).toContain("no_rate")
    expect(MAX_QUESTIONS).toBeGreaterThanOrEqual(2000)
  })

  test("a control total, an area total or a VAT figure that the file does not print is refused as not grounded", () => {
    for (const change of [
      { controlTotals: { grand: 123456 } },
      { controlTotals: { grand: 10000, areas: [{ area: "Play Area", total: 4999 }] } },
      { vat: { ratePercent: 5, amount: 501 } },
      { vat: { ratePercent: 5, totalIncVat: 10501 } },
    ]) {
      const error = rejection(() => validateExtractionOutput({ ...full(), ...change }, DIGEST))
      expect(error.code).toBe("extraction_not_grounded")
      expect(error.status).toBe(422)
      expect(error.issues.join(" ")).toContain("not a figure the uploaded file prints")
    }
  })

  test("a question about a row the file does not have is refused as not grounded", () => {
    const answer = { ...full(), questions: [{ kind: "no_rate", sheet: "Bill", row: 99, text: "x" }] }
    expect(rejection(() => validateExtractionOutput(answer, DIGEST)).code).toBe("extraction_not_grounded")
  })

  test("text that carries bank account details is refused wherever it is put (the terms cell has them; they are never stored)", () => {
    const bank = "Pay to account IBAN AE07 0331 2345 6789 0123 456"
    for (const change of [
      { paymentTerms: { summary: bank } },
      { paymentTerms: { milestones: [{ label: "Advance to A/C no 12345678", percent: 30 }] } },
      { paymentTerms: { milestones: [{ label: "Advance", when: "SWIFT ADCBAEAA" }] } },
      { client: "Client, sort code 12-34-56" },
      { project: { name: "Villa", description: `Terms: ${bank}` } },
    ]) {
      const error = rejection(() => validateExtractionOutput({ ...full(), ...change }, DIGEST))
      expect(error.code).toBe("extraction_schema_invalid")
      expect(error.issues.join(" ")).toContain("bank account details")
    }
    // Ordinary payment wording is not refused.
    expect(() => validateExtractionOutput({ ...full(), paymentTerms: { summary: "30% advance, 5% retention, balance in stages" } }, DIGEST)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------------------------------------- 2. the gate, pure

type Line = ExtractedProject["boq"]["lineItems"][number]
const line = (itemCode: string, quantity: number, rate: number, category: string, extra: Partial<Line> = {}): Line => ({
  source: { sheet: "Bill", row: 2 },
  itemCode,
  description: itemCode,
  unit: "m2",
  quantity,
  rate,
  category,
  ...extra,
})
const answerOf = (lines: Line[], extra: Partial<ExtractedProject> = {}): ExtractedProject => ({
  schema: "boq_project_v1",
  project: { name: "P" },
  boq: { title: "B", lineItems: lines },
  ...extra,
})
const candidatesOf = (grand: number, areas: Array<[string, number]>): Candidates => ({
  projectName: null,
  areas: areas.map(([a]) => a),
  lines: [],
  questions: [],
  totals: { grand, areas: areas.map(([area, total]) => ({ area, total })), vat: null },
  readerReconciled: true,
})

describe("AW-112: the gate as pure functions", () => {
  test("the tolerance is one unit of currency or one part in a million, whichever is larger", () => {
    expect(RECONCILIATION_TOLERANCE).toEqual({ absolute: 1, relative: 1e-6 })
    expect(toleranceFor(1_596_280)).toBeCloseTo(1.59628, 5)
    expect(toleranceFor(1_596_280)).toBeGreaterThanOrEqual(1)
    expect(toleranceFor(10)).toBe(1)
    expect(toleranceFor(5_000_000_000)).toBeCloseTo(5000, 6)
  })

  test("the sum is quantity x rate of the root lines in fils; a sub-task line is a share of its parent and is not added", () => {
    expect(sumLines([{ quantity: 3, rate: 0.1 }, { quantity: 3, rate: 0.2 }])).toBe(0.9)
    expect(sumLines([{ quantity: 10, rate: 40 }, { quantity: 10, rate: 16, parentItemCode: "x" }])).toBe(400)
    expect(sumLines([])).toBe(0)
  })

  test("matched, shortfall, excess and not_checked", () => {
    const lines = [line("PLAY-B1-01", 10, 500, "Play Area - A"), line("VET-B1-01", 10, 500, "Vet Area - A")]
    const c = (g: number, p: number, v: number) => candidatesOf(g, [["Play Area", p], ["Vet Area", v]])
    const at = (rec: ReturnType<typeof computeReconciliation>) => [rec.status, rec.expected, rec.actual, rec.difference]
    expect(at(computeReconciliation(answerOf(lines), c(10000, 5000, 5000)))).toEqual(["matched", 10000, 10000, 0])
    expect(at(computeReconciliation(answerOf(lines), c(10000.9, 5000, 5000)))).toEqual(["matched", 10000.9, 10000, 0.9])
    expect(at(computeReconciliation(answerOf(lines), c(12000, 6000, 6000)))).toEqual(["shortfall", 12000, 10000, 2000])
    expect(at(computeReconciliation(answerOf(lines), c(8000, 4000, 4000)))).toEqual(["excess", 8000, 10000, -2000])
    expect(at(computeReconciliation(answerOf(lines), null))).toEqual(["not_checked", null, 10000, null])
    const rec = computeReconciliation(answerOf(lines), c(10000, 5000, 5000))
    expect(rec.source).toBe("reader")
    expect(typeof rec.tolerance).toBe("number")
    expect(rec.byArea.map((a) => [a.area, a.expected, a.actual, a.status])).toEqual([["Play Area", 5000, 5000, "matched"], ["Vet Area", 5000, 5000, "matched"]])
  })

  test("an error between two areas that leaves the grand total right is still not matched", () => {
    // The Play area is 1,000 short and the Vet area is 1,000 over: 10,000 in all, as printed.
    const lines = [line("PLAY-B1-01", 10, 400, "Play Area - A"), line("VET-B1-01", 10, 600, "Vet Area - A")]
    const rec = computeReconciliation(answerOf(lines), candidatesOf(10000, [["Play Area", 5000], ["Vet Area", 5000]]))
    expect(rec.byArea.map((a) => a.status)).toEqual(["shortfall", "excess"])
    expect(rec.status).toBe("excess")
    expect(() => assertReconciliationAllowed(rec, { acknowledgeShortfall: true })).toThrow(ExtractionRejectedError)
  })

  test("the model's own control totals are used when there are no candidates; with candidates they must agree with the file", () => {
    const lines = [line("A-B1-01", 10, 500, "Play Area - A")]
    const own = answerOf(lines, { controlTotals: { grand: 5000 }, areas: ["Play Area"] })
    expect(computeReconciliation(own, null)).toMatchObject({ status: "matched", expected: 5000, source: "model" })
    const contradicts = answerOf(lines, { controlTotals: { grand: 5000 } })
    const error = rejection(() => computeReconciliation(contradicts, candidatesOf(9000, [["Play Area", 9000]])))
    expect(error.code).toBe("extraction_total_mismatch")
    expect(error.issues.join(" ")).toContain("the model reports 5000 but the file prints 9000")
    // An area the file prints no total for is refused too.
    const unknownArea = answerOf(lines, { controlTotals: { grand: 9000, areas: [{ area: "Roof Area", total: 9000 }] } })
    expect(rejection(() => computeReconciliation(unknownArea, candidatesOf(9000, [["Play Area", 9000]]))).issues.join(" ")).toContain("no total for")
  })

  test("what the gate lets through: matched and not_checked; a shortfall only when acknowledged; an excess never", () => {
    const rec = (status: Reconciliation["status"]): Reconciliation => ({
      status,
      expected: 100,
      actual: status === "shortfall" ? 80 : status === "excess" ? 120 : 100,
      difference: status === "shortfall" ? 20 : status === "excess" ? -20 : 0,
      tolerance: 1,
      source: "reader",
      byArea: [],
    })
    expect(() => assertReconciliationAllowed(rec("matched"))).not.toThrow()
    expect(() => assertReconciliationAllowed(rec("not_checked"))).not.toThrow()
    const short = rejection(() => assertReconciliationAllowed(rec("shortfall")))
    expect([short.code, short.status]).toEqual(["extraction_total_mismatch", 422])
    expect(short.message).toContain("acknowledgeShortfall=true")
    expect(short.issues[0]).toContain("prints 100")
    expect(short.issues[0]).toContain("add up to 80")
    expect(() => assertReconciliationAllowed(rec("shortfall"), { acknowledgeShortfall: true })).not.toThrow()
    const over = rejection(() => assertReconciliationAllowed(rec("excess"), { acknowledgeShortfall: true }))
    expect(over.code).toBe("extraction_total_mismatch")
    expect(over.message).toContain("more than the file prints")
  })
})

// ------------------------------------------------------------------- 3. the gate through the create path, model-only totals

/**
 * A workbook the deterministic reader does not apply to (its rate column is called Price), with two priced lines that add up to
 * 10,000 and a row that prints `printed`. The stand-in reads the lines as it always does and reports `printed` as the control total.
 */
function bookWithPrintedTotal(printed: number): Buffer {
  return buildWorkbook([
    {
      name: "Bill",
      rows: [
        ["Item", "Description", "Unit", "Qty", "Price"],
        ["1.01", "Floor", "m2", 10, 500],
        ["1.02", "Wall", "m2", 10, 500],
        ["TOTAL", "", "", "", printed],
      ],
    },
  ])
}
const reportingTotal = (printed: number): ModelCall => async (req) => JSON.stringify({ ...JSON.parse(await deterministicModel(req)), controlTotals: { grand: printed } })

describe("AW-112: the gate through the create path (model-only totals)", () => {
  test("matched: one project and one BOQ, the reconciliation says matched and where the total came from", async () => {
    const h = harness(reportingTotal(10000))
    const { result, error } = await outcome(h, bookWithPrintedTotal(10000))
    expect(error).toBeNull()
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
    expect(result).toMatchObject({ duplicate: false, reconciliation: { status: "matched", expected: 10000, actual: 10000, source: "model" } })
  })

  test("a shortfall is refused with a stable code: nothing is created and the claim is released with the reason", async () => {
    const h = harness(reportingTotal(12000))
    const { error } = await outcome(h, bookWithPrintedTotal(12000))
    expect(error).toBeInstanceOf(ExtractionRejectedError)
    expect([error!.code, error!.status]).toEqual(["extraction_total_mismatch", 422])
    expect(error!.issues[0]).toContain("prints 12000")
    expect(error!.issues[0]).toContain("add up to 10000")
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
    expect(h.events).toEqual(["claim", "release"])
    expect(h.releases[0].rejection).toMatchObject({ code: "extraction_total_mismatch" })
    expect(h.rows.size).toBe(0)
  })

  test("the caller acknowledges the shortfall: the BOQ is created as it is and the reconciliation still says shortfall", async () => {
    const h = harness(reportingTotal(12000))
    const { result, error } = await outcome(h, bookWithPrintedTotal(12000), { acknowledgeShortfall: true })
    expect(error).toBeNull()
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
    expect(result).toMatchObject({ reconciliation: { status: "shortfall", expected: 12000, actual: 10000, difference: 2000 } })
  })

  test("an excess is refused, and acknowledging a shortfall does not cover it", async () => {
    for (const acknowledge of [false, true]) {
      const h = harness(reportingTotal(8000))
      const { error } = await outcome(h, bookWithPrintedTotal(8000), { acknowledgeShortfall: acknowledge })
      expect(error!.code).toBe("extraction_total_mismatch")
      expect(error!.message).toContain("more than the file prints")
      expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
    }
  })

  test("a workbook that prints no total is not checked, and the result says so (never matched)", async () => {
    const h = harness(deterministicModel)
    const { result } = await outcome(h, bookWithPrintedTotal(10000))
    expect(result).toMatchObject({ reconciliation: { status: "not_checked", expected: null, source: "none" } })
    expect(h.calls.createProject).toBe(1)
  })

  test("a control total the model makes up (not a figure in the file) is refused as not grounded", async () => {
    const h = harness(reportingTotal(10001))
    const { error } = await outcome(h, bookWithPrintedTotal(10000))
    expect(error!.code).toBe("extraction_not_grounded")
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
  })
})

// ---------------------------------------------------------------------------------------------- 4. the gate on ZOOMIES

describe("AW-112: the gate on the ZOOMIES workbook, where the file's own printed totals are the authority", () => {
  const bytes = zoomiesWorkbook()

  test("the careful stand-in reconciles to AED 1,596,280 (Play 1,343,445, Vet 252,835), VAT excluded", async () => {
    const caller = edgeCallerFor(edgeDeps(carefulHumanModel))
    const result = await extractProjectFromDocument({ fileName: "zoomies.xlsx", bytes }, { callEdge: caller })
    expect(result.source).toBe("model+reader")
    expect(result.reconciliation).toMatchObject({ status: "matched", expected: 1_596_280, actual: 1_596_280, difference: 0, source: "reader" })
    expect(result.reconciliation.byArea.map((a) => [a.area, a.expected, a.actual, a.status])).toEqual([
      ["Play Area", 1_343_445, 1_343_445, "matched"],
      ["Vet Area", 252_835, 252_835, "matched"],
    ])
    expect(result.extracted.boq.lineItems).toHaveLength(53)
    expect(result.extracted.vat).toEqual({ ratePercent: 5, amount: 79_814, totalIncVat: 1_676_094 })
    expect(result.extracted.currency).toBe("AED")
    // The request the model got: the reader's candidates with the printed totals.
    const doc = requestOf(`x\n${caller.calls.lastBody}`)
    expect(doc.candidates!.totals.grand).toBe(1_596_280)
    expect(doc.candidates!.lines).toHaveLength(53)
  })

  const refused: Array<[string, Parameters<typeof hostileModel>[0], string, RegExp]> = [
    ["drops the biggest line", "drops_a_line", "extraction_lines_diverge", /was dropped/],
    ["adds a line for AED 9,999,999", "adds_a_line", "extraction_lines_diverge", /not a line the file's own reading found/],
    ["drops the biggest line and lowers the control totals to agree", "drops_a_line_and_matches_totals", "extraction_not_grounded", /not a figure the uploaded file prints/],
    ["adds a line for AED 9,999,999 and raises the control totals to agree", "adds_a_line_and_matches_totals", "extraction_not_grounded", /not a figure the uploaded file prints/],
    ["prices a row that the file leaves unpriced", "prices_an_unpriced_row", "extraction_lines_diverge", /not a line the file's own reading found/],
    ["reports a figure that is printed in the file but is not the grand total", "control_total_differs_from_file", "extraction_total_mismatch", /the model reports .* but the file prints 1596280/],
    ["reports a control total that the file does not print", "control_total_not_printed", "extraction_not_grounded", /not a figure the uploaded file prints/],
    ["copies a bank account into the payment terms", "bank_details_in_terms", "extraction_schema_invalid", /bank account details/],
  ]
  for (const [what, kind, code, issue] of refused) {
    test(`a model that ${what} is refused (${code}) and nothing is created`, async () => {
      const h = harness(hostileModel(kind))
      const { error } = await outcome(h, bytes, { acknowledgeQuestions: true, acknowledgeShortfall: true })
      expect(error).toBeInstanceOf(ExtractionRejectedError)
      expect(error!.code).toBe(code)
      expect(error!.issues.join(" ")).toMatch(issue)
      expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
      expect(h.events).toEqual(["claim", "release"])
      expect(h.rows.size).toBe(0)
    })
  }

  test("a model that changes one rate by 1 AED (and reports the totals as the file prints them) is refused: the lines must be the file's", async () => {
    const nudged: ModelCall = async (req) => {
      const answer = JSON.parse(await carefulHumanModel(req)) as { boq: { lineItems: Array<{ rate: number }> } }
      answer.boq.lineItems[0].rate += 1
      return JSON.stringify(answer)
    }
    const h = harness(nudged)
    const { error } = await outcome(h, bytes, { acknowledgeQuestions: true, acknowledgeShortfall: true })
    expect(error!.code).toBe("extraction_lines_diverge")
    expect(error!.issues[0]).toMatch(/rate .* but the file reads/)
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
  })

  test("a model that leaves out the totals altogether is not refused for it: the reader's printed totals still hold the lines", async () => {
    const silent: ModelCall = async (req) => {
      const answer = JSON.parse(await carefulHumanModel(req)) as Record<string, unknown>
      delete answer.controlTotals
      return JSON.stringify(answer)
    }
    const result = await extractProjectFromDocument({ fileName: "zoomies.xlsx", bytes }, { callEdge: edgeCallerFor(edgeDeps(silent)) })
    expect(result.reconciliation).toMatchObject({ status: "matched", expected: 1_596_280, source: "reader" })
  })

  test("the harness input names an organisation and a person, and an unrefused run creates exactly one project and one BOQ", async () => {
    const h = harness(carefulHumanModel)
    const { result, error } = await outcome(h, bytes, { acknowledgeQuestions: true })
    expect(error).toBeNull()
    expect(HARNESS_INPUT.orgId).toBe("org-1")
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
    expect(result).toMatchObject({ duplicate: false, reconciliation: { status: "matched" } })
  })
})
