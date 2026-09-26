/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02, register row AW-111: the digest the model route reads a workbook with keeps what a real bill workbook
// needs kept, and the request that carries it fits, or is split, never cut.
//
// WHAT IS PROVEN
//   1. Row breaks. A merged cell of a PDF-table export holds several table lines; the model-route digest keeps them as lines (the
//      digest every earlier caller uses joins them with spaces, and still does).
//   2. Long cells. A notes cell of 1,228 characters and a terms cell of 1,156 characters (the lengths of the two decisive cells of
//      the ZOOMIES workbook, here written with public filler text and a made-up bank block) come through whole, including the last
//      payment milestone; the earlier 400-character limit cut both. A cell over the new 2,000-character limit is cut AND listed, and
//      the extraction turns it into a question, so a cut is never silent.
//   3. Fit. The ZOOMIES workbook (built from the public fixture) is one request, well under EDGE_REQUEST_MAX_CHARS, with the reader's
//      candidates in it. A workbook over the ceiling is split by groups of sheets: every sheet is in exactly one group, in order, each
//      request is under the ceiling, and the answers of the groups give the same BOQ as the one request did. A single sheet over the
//      ceiling, or a workbook that needs more than MAX_EDGE_REQUESTS groups, is refused (workbook_too_large), never shortened.
//   4. The Edge Function accepts the widened request (candidates, part) and refuses a malformed one; the prompt carries the optional
//      keys and the example of them validates against the caller's schema.
//   5. On the real workbook (when it is on this machine; skipped elsewhere): the digest equals the reader's own grid, the two long
//      cells survive whole, and it is one request. Nothing of its content is printed or asserted, only lengths and equalities.
//
// Run: bun test --isolate src/lib/services/document-extraction-contract.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import {
  EDGE_REQUEST_MAX_CHARS,
  EXTRACTION_DIGEST_LIMITS,
  ExtractionRejectedError,
  WORKBOOK_LIMITS,
  cleanCellTextKeepBreaks,
  validateExtractionOutput,
  type WorkbookDigest,
} from "./document-extraction-schema"
import { buildCandidates, cutCellQuestions } from "./document-extraction-reconcile"
import {
  MAX_EDGE_REQUESTS,
  buildEdgeRequestBodies,
  createEdgeExtractCaller,
  extractProjectFromDocument,
  readWorkbookDigest,
} from "./document-extraction-service"
import { attributionFromHeaders } from "../../../supabase/functions/projexa-document-extract/budget"
import {
  OUTPUT_EXTRAS_EXAMPLE,
  OUTPUT_SHAPE_EXAMPLE,
  SYSTEM_PROMPT,
  buildUserMessage,
  handleProjexaDocumentExtract,
  parseRequestBody,
} from "../../../supabase/functions/projexa-document-extract/handler"
import { buildWorkbook, edgeCallerFor, edgeDeps, SHARED_SECRET } from "./__test-helpers__/document-extraction-fixtures"
import { harness, outcome } from "./__test-helpers__/document-extraction-harness"
import { testBudget } from "./__test-helpers__/extract-budget-fixtures"
import { carefulHumanModel, requestOf } from "./__test-helpers__/zoomies-standin-model"
import { workbookFromDigest, zoomiesFixture, zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"

const KEEP = { keepLineBreaks: true } as const

/** A cell of exactly `length` characters made of the given lines (no blank lines, no runs of blanks) and a closing filler word. */
function cellOf(lines: string[], length: number): string {
  const head = lines.join("\n")
  const pad = length - head.length - 1
  if (pad < 1) throw new Error("the lines are longer than the cell")
  const text = `${head}\n${"z".repeat(pad)}`
  if (text.length !== length) throw new Error("the cell is not the requested length")
  return text
}

// Made-up text in the shape of the two decisive cells. No real name, figure or account.
const NOTES = cellOf(["Notes / Exclusions / Penalty clause", "1. The rates include supply and installation unless a line says otherwise.", "2. Works by others are excluded: MEP, IT, AV and furniture.", "3. A penalty of 0.5% per week applies to delay, up to 10% of the contract value."], 1228)
const TERMS_LINES = [
  "Terms and Payment schedule",
  "20% advance payment on award of the contract, against the client's purchase order and a valid tax invoice",
  "10% on approval of shop drawings and material samples, before any material is ordered for the works",
  "30% on completion of civil works, including partitions, ceilings and first fix of services, as certified",
  "30% on completion of finishes, including flooring, wall finishes, painting and joinery, as certified",
  "5% on handover, with the as-built drawings, the operation manuals and the warranty certificates",
  "5% retention released after the defects period",
]
const BANK_BLOCK = ["Bank: EXAMPLE BANK PJSC", "A/C name: EXAMPLE FIT OUT LLC", "IBAN AE00 0000 0000 0000 0000 000"]
// The closing milestone is the last line before the filler, so a cell cut at 400 characters loses it.
const TERMS = cellOf([...TERMS_LINES, ...BANK_BLOCK], 1156)

// One line-shaped row so the stand-in has a BOQ line to return, then the two long cells.
const termsWorkbook = () =>
  buildWorkbook([
    {
      name: "Table 2",
      rows: [["Item", "Description", "Unit", "Qty", "Rate"], ["1.01", "Fit-out", "m2", 10, 800], [NOTES], [TERMS]],
    },
  ])

describe("AW-111: the digest keeps row breaks and merged-cell text", () => {
  test("a cell of several table lines keeps its lines; the earlier digest still joins them with spaces", async () => {
    const wb = buildWorkbook([{ name: "Table 5", rows: [["1.0\n2.0\n3.0", "Glass partition\n  Metal door\r\nFrame", "22,000.00\nIncluded\n3,150.00"]] }])
    const kept = await readWorkbookDigest(wb, EXTRACTION_DIGEST_LIMITS, KEEP)
    expect(kept.sheets[0].rows[0].cells).toEqual(["1.0\n2.0\n3.0", "Glass partition\nMetal door\nFrame", "22,000.00\nIncluded\n3,150.00"])
    const flat = await readWorkbookDigest(wb)
    expect(flat.sheets[0].rows[0].cells).toEqual(["1.0 2.0 3.0", "Glass partition Metal door Frame", "22,000.00 Included 3,150.00"])
  })

  test("hidden characters are removed from a cell that keeps its line breaks", () => {
    const tagged = String.fromCodePoint(0xe0049, 0xe0067, 0xe006e)
    expect(cleanCellTextKeepBreaks(`Ex\u200bcav\u202eation\n  of${tagged}\n\n soil `, 100)).toEqual({ text: "Excavation\nof\nsoil", chars: 18 })
  })

  test("a notes cell of 1,228 characters and a terms cell of 1,156 characters come through whole, the last milestone included", async () => {
    const digest = await readWorkbookDigest(termsWorkbook(), EXTRACTION_DIGEST_LIMITS, KEEP)
    const cells = digest.sheets[0].rows.flatMap((r) => r.cells)
    const notes = cells.find((c) => c.startsWith("Notes"))!
    const terms = cells.find((c) => c.startsWith("Terms"))!
    expect(notes).toHaveLength(1228)
    expect(terms).toHaveLength(1156)
    expect(notes).toBe(NOTES)
    expect(terms).toBe(TERMS)
    expect(terms).toContain("5% retention released after the defects period")
    expect(digest.cutCells).toBeUndefined()
  })

  test("the earlier 400-character limit cut both cells and lost the milestones after the first few lines", async () => {
    const digest = await readWorkbookDigest(termsWorkbook())
    const cells = digest.sheets[0].rows.flatMap((r) => r.cells)
    const terms = cells.find((c) => c.startsWith("Terms"))!
    expect(WORKBOOK_LIMITS.maxCellChars).toBe(400)
    expect(terms).toHaveLength(400)
    expect(terms).not.toContain("5% retention released after the defects period")
  })

  test("a cell over 2,000 characters is cut, listed in cutCells, and becomes a question: the cut is never silent", async () => {
    const long = `Clause one\n${"y".repeat(2600)}`
    const wb = buildWorkbook([{ name: "Table 9", rows: [["a"], ["b", long]] }])
    const digest = await readWorkbookDigest(wb, EXTRACTION_DIGEST_LIMITS, KEEP)
    expect(digest.sheets[0].rows[1].cells[1]).toHaveLength(EXTRACTION_DIGEST_LIMITS.maxCellChars)
    expect(digest.cutCells).toEqual([{ sheet: "Table 9", row: 2, column: 2, chars: 2611 }])
    const questions = cutCellQuestions(digest, EXTRACTION_DIGEST_LIMITS.maxCellChars)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ kind: "unclear", sheet: "Table 9", row: 2 })
    expect(questions[0].text).toContain("2611")
  })

  test("the model route reads the terms workbook with the widened limits: the request the model gets holds both cells whole", async () => {
    const caller = edgeCallerFor(edgeDeps(carefulHumanModel))
    await extractProjectFromDocument({ fileName: "terms.xlsx", bytes: termsWorkbook() }, { callEdge: caller })
    const doc = requestOf(`x\n${caller.calls.lastBody}`)
    const cells = doc.sheets.flatMap((s) => s.rows.flatMap((r) => r.cells))
    expect(cells.find((c) => c.startsWith("Notes"))).toHaveLength(1228)
    expect(cells.find((c) => c.startsWith("Terms"))).toHaveLength(1156)
  })

  test("a careful reader of the request gets the payment milestones out of the terms cell and leaves the bank block out", async () => {
    const caller = edgeCallerFor(edgeDeps(carefulHumanModel))
    const result = await extractProjectFromDocument({ fileName: "terms.xlsx", bytes: termsWorkbook() }, { callEdge: caller })
    const terms = result.extracted.paymentTerms!
    expect(terms.milestones!.map((m) => m.percent)).toEqual([20, 10, 30, 30, 5, 5])
    expect(terms.milestones!.reduce((sum, m) => sum + (m.percent ?? 0), 0)).toBe(100)
    expect(JSON.stringify(result.extracted)).not.toMatch(/IBAN|EXAMPLE BANK|A\/C/)
  })
})

describe("AW-111: the request fits under the ceiling, or is split by sheet groups, never cut", () => {
  const digestPromise = readWorkbookDigest(zoomiesWorkbook(), EXTRACTION_DIGEST_LIMITS, KEEP)

  test("the digest of the ZOOMIES workbook is the fixture, row for row: 22 sheets, the merged cells' line breaks kept", async () => {
    const digest = await digestPromise
    expect(digest.sheets).toEqual(zoomiesFixture.sheets)
    expect(digest.sheets).toHaveLength(22)
    const cells = digest.sheets.flatMap((s) => s.rows.flatMap((r) => r.cells))
    expect(cells.some((c) => c.includes("\n"))).toBe(true)
  })

  test("the whole workbook with the reader's candidates is ONE request, far under the 200,000-character ceiling", async () => {
    const digest = await digestPromise
    const candidates = buildCandidates(digest)
    expect(candidates).not.toBeNull()
    const requests = buildEdgeRequestBodies("zoomies.xlsx", digest, candidates)
    expect(requests).toHaveLength(1)
    expect(requests[0].body.length).toBeLessThan(EDGE_REQUEST_MAX_CHARS / 2)
    expect(requests[0].sheets).toHaveLength(22)
    // Without candidates it is smaller still.
    expect(buildEdgeRequestBodies("zoomies.xlsx", digest, null)[0].body.length).toBeLessThan(requests[0].body.length)
  })

  test("over the ceiling, the sheets are split in order into the fewest groups that fit; every sheet is in exactly one group; each request fits", async () => {
    const digest = await digestPromise
    const candidates = buildCandidates(digest)
    const ceiling = 30_000
    const requests = buildEdgeRequestBodies("zoomies.xlsx", digest, candidates, ceiling)
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.length).toBeLessThanOrEqual(MAX_EDGE_REQUESTS)
    for (const r of requests) expect(r.body.length).toBeLessThanOrEqual(ceiling)
    // Every sheet once, in workbook order.
    expect(requests.flatMap((r) => r.sheets)).toEqual(digest.sheets.map((s) => s.name))
    // Every row of every sheet went out: nothing was cut.
    const sent = requests.flatMap((r) => requestOf(`x\n${r.body}`).sheets)
    expect(sent.map((s) => s.rows.length)).toEqual(digest.sheets.map((s) => s.rows.length))
    expect(sent).toEqual(digest.sheets)
    // Each request says which part it is, and carries the candidates of its own sheets plus the whole workbook's printed totals.
    requests.forEach((r, i) => {
      const doc = requestOf(`x\n${r.body}`)
      expect(doc.part).toEqual({ index: i + 1, of: requests.length })
      expect(doc.candidates!.totals.grand).toBe(1_596_280)
      const own = new Set(r.sheets)
      expect(doc.candidates!.lines.every((l) => own.has(l.source.sheet))).toBe(true)
    })
    // The candidate lines of all requests are the reader's 53 lines, none twice.
    const sentCodes = requests.flatMap((r) => requestOf(`x\n${r.body}`).candidates!.lines).map((l) => l.itemCode)
    expect(sentCodes).toHaveLength(53)
    expect([...sentCodes].sort()).toEqual(candidates!.lines.map((l) => l.itemCode).sort())
  })

  test("the answers of the groups give the same BOQ as the one request", async () => {
    const bytes = zoomiesWorkbook()
    const single = await extractProjectFromDocument({ fileName: "zoomies.xlsx", bytes }, { callEdge: edgeCallerFor(edgeDeps(carefulHumanModel)) })
    const caller = edgeCallerFor(edgeDeps(carefulHumanModel))
    const split = await extractProjectFromDocument({ fileName: "zoomies.xlsx", bytes }, { callEdge: caller }, { requestCeilingChars: 30_000 })
    expect(caller.calls.count).toBeGreaterThan(1)
    const byCode = (a: { itemCode?: string }, b: { itemCode?: string }) => String(a.itemCode).localeCompare(String(b.itemCode))
    const byKey = (a: { sheet: string; row: number; kind: string }, b: { sheet: string; row: number; kind: string }) => `${a.sheet}|${a.row}|${a.kind}`.localeCompare(`${b.sheet}|${b.row}|${b.kind}`)
    expect(split.extracted.boq.lineItems).toHaveLength(53)
    expect([...split.extracted.boq.lineItems].sort(byCode)).toEqual([...single.extracted.boq.lineItems].sort(byCode))
    expect(split.extracted.project.name).toBe(single.extracted.project.name)
    expect(split.reconciliation).toEqual(single.reconciliation)
    expect([...split.questions].sort(byKey)).toEqual([...single.questions].sort(byKey))
    expect(split.extracted.areas).toEqual(["Play Area", "Vet Area"])
  })

  test("a single sheet over the ceiling is refused by name, never shortened", async () => {
    const digest = await digestPromise
    const error = (() => {
      try {
        buildEdgeRequestBodies("zoomies.xlsx", digest, null, 1500)
        return null
      } catch (e) {
        return e as ExtractionRejectedError
      }
    })()
    expect(error).toBeInstanceOf(ExtractionRejectedError)
    expect(error!.code).toBe("workbook_too_large")
    expect(error!.message).toMatch(/Sheet "Table \d+" alone/)
  })

  test("a workbook that needs more than 8 requests is refused, never shortened", () => {
    const sheet = (n: number) => ({ name: `S${n}`, rows: [{ row: 1, cells: ["x".repeat(900)] }] })
    const digest: WorkbookDigest = { sheets: Array.from({ length: 20 }, (_, i) => sheet(i + 1)) }
    // 20 sheets of 900 characters at a ceiling that holds two of them: 10 groups.
    expect(() => buildEdgeRequestBodies("big.xlsx", digest, null, 2200)).toThrow(/needs 10 requests/)
    // The same sheets at a ceiling that holds four of them: 5 groups, every sheet once.
    const ok = buildEdgeRequestBodies("big.xlsx", digest, null, 4200)
    expect(ok).toHaveLength(5)
    expect(ok.flatMap((r) => r.sheets)).toEqual(digest.sheets.map((s) => s.name))
  })

  test("an empty part of a split workbook is allowed to answer with no line; the merged answer still needs one", () => {
    const answer = { schema: "boq_project_v1", project: { name: "P" }, boq: { title: "B", lineItems: [] } }
    const digest: WorkbookDigest = { sheets: [{ name: "Summary", rows: [{ row: 1, cells: ["x"] }] }] }
    const refused = (() => {
      try {
        validateExtractionOutput(answer, digest)
        return null
      } catch (e) {
        return e as ExtractionRejectedError
      }
    })()
    expect(refused!.code).toBe("extraction_schema_invalid")
    expect(refused!.issues.join(" ")).toContain("a BOQ needs at least one line item")
    expect(validateExtractionOutput(answer, digest, { minLines: 0 }).boq.lineItems).toEqual([])
  })
})

describe("AW-111: the Edge Function's side of the widened request", () => {
  const base = { schema: "boq_project_v1", fileName: "a.xlsx", sheets: [{ name: "A", rows: [{ row: 1, cells: ["x"] }] }] }
  const candidates = { projectName: "P", areas: [], lines: [], questions: [], totals: { grand: 1, areas: [], vat: null } }

  test("candidates and part are accepted and reach the model, on the one JSON line of the user message", () => {
    const parsed = parseRequestBody(JSON.stringify({ ...base, candidates, part: { index: 1, of: 2 } }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const message = buildUserMessage(parsed.value)
    expect(message.split("\n")).toHaveLength(2)
    expect(JSON.parse(message.split("\n")[1])).toMatchObject({ candidates: { projectName: "P" }, part: { index: 1, of: 2 } })
    // Without them the message is the one every earlier caller sent.
    const plain = parseRequestBody(JSON.stringify(base))
    expect(plain.ok && Object.keys(JSON.parse(buildUserMessage(plain.value).split("\n")[1]))).toEqual(["fileName", "sheets"])
  })

  test("a malformed candidates or part value is refused as a bad request", () => {
    for (const bad of [
      { candidates: "text" },
      { candidates: { ...candidates, lines: "no" } },
      { candidates: { ...candidates, totals: [] } },
      { part: { index: 0, of: 2 } },
      { part: { index: 3, of: 2 } },
      { part: { index: 1, of: 9 } },
      { part: "1 of 2" },
    ]) {
      expect(parseRequestBody(JSON.stringify({ ...base, ...bad }))).toEqual({ ok: false, code: "bad_request" })
    }
  })

  test("the handler passes the candidates to the model and nothing else changes: still a bearer secret, still two lines", async () => {
    let seen = ""
    const res = await handleProjexaDocumentExtract(
      new Request("https://edge.test/f", { method: "POST", headers: { authorization: `Bearer ${SHARED_SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ ...base, candidates }) }),
      edgeDeps(async (req) => {
        seen = req.user
        return "{}"
      }),
    )
    expect(res.status).toBe(200)
    expect(seen.split("\n")).toHaveLength(2)
    expect(requestOf(seen).candidates!.projectName).toBe("P")
  })

  test("the prompt carries the optional keys, and the example of them is a valid answer for the caller's schema with the shape example", () => {
    expect(SYSTEM_PROMPT).toContain(JSON.stringify(OUTPUT_SHAPE_EXAMPLE, null, 2))
    expect(SYSTEM_PROMPT).toContain(JSON.stringify(OUTPUT_EXTRAS_EXAMPLE, null, 2))
    // A digest that prints the rows and figures the examples cite (the schema holds a control total to a figure the file prints).
    const digest: WorkbookDigest = {
      sheets: [
        { name: "Civil", rows: [{ row: 4, cells: ["1.01"] }, { row: 5, cells: ["1.01.1"] }] },
        { name: "Table 6", rows: [{ row: 12, cells: ["Excavation", "40", "m2"] }] },
        { name: "Summary", rows: [{ row: 1, cells: ["1596280", "1343445", "252835", "79814", "1676094"] }] },
      ],
    }
    const merged = { ...JSON.parse(JSON.stringify(OUTPUT_SHAPE_EXAMPLE)), ...JSON.parse(JSON.stringify(OUTPUT_EXTRAS_EXAMPLE)) }
    // The example lines have no area prefix; areas are optional and the example shows them, so the area rules are what they check here.
    merged.boq.lineItems = merged.boq.lineItems.map((l: Record<string, unknown>, i: number) => ({ ...l, category: `Play Area - ${l.category ?? "Civil"}`, itemCode: `PLAY-B1-0${i + 1}`, ...(l.parentItemCode ? { parentItemCode: "PLAY-B1-01" } : {}) }))
    expect(() => validateExtractionOutput(merged, digest)).not.toThrow()
    // The first shape on its own is still a valid answer.
    expect(() => validateExtractionOutput(JSON.parse(JSON.stringify(OUTPUT_SHAPE_EXAMPLE)), digest)).not.toThrow()
  })
})

describe("AW-111: the caller names who a request is for, so a wired model's spend is metered", () => {
  const realAttribution = (used: Array<unknown>) =>
    edgeDeps(carefulHumanModel, {
      budget: testBudget({
        resolveAttribution: (req) => {
          const who = attributionFromHeaders(req.headers, () => "generated-id")
          used.push(who)
          return who
        },
      }),
    })

  test("createEdgeExtractCaller sends the organisation, the person and the request id as headers, and none without an attribution", async () => {
    const sent: Array<Record<string, string>> = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent.push(init.headers as Record<string, string>)
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    const caller = createEdgeExtractCaller({ baseUrl: "https://ref.supabase.test", secret: SHARED_SECRET, fetchImpl })
    await caller("{}", { orgId: "org-1", userId: "person-1", requestId: "claim-1" })
    await caller("{}")
    expect(sent[0]).toMatchObject({ "x-projexa-org-id": "org-1", "x-projexa-user-id": "person-1", "x-projexa-request-id": "claim-1", Authorization: `Bearer ${SHARED_SECRET}` })
    expect(Object.keys(sent[1]).some((k) => k.startsWith("x-projexa"))).toBe(false)
  })

  test("without attribution a wired budget refuses (400 attribution_required, so extraction_unavailable); with it the call is made", async () => {
    const used: unknown[] = []
    const bytes = zoomiesWorkbook()
    const bare = edgeCallerFor(realAttribution(used))
    await expect(extractProjectFromDocument({ fileName: "z.xlsx", bytes }, { callEdge: bare })).rejects.toMatchObject({ code: "extraction_unavailable" })
    expect(used).toEqual([null])
    const named = edgeCallerFor(realAttribution(used))
    const result = await extractProjectFromDocument({ fileName: "z.xlsx", bytes, attribution: { orgId: "org-1", userId: "person-1", requestId: "claim-7" } }, { callEdge: named })
    expect(result.extracted.boq.lineItems).toHaveLength(53)
    expect(used[1]).toEqual({ orgId: "org-1", userId: "person-1", requestId: "claim-7" })
  })

  test("createProjectFromDocument names the organisation, the acting person and the claim; a split workbook gives each part its own request id", async () => {
    const h = harness(carefulHumanModel)
    await outcome(h, zoomiesWorkbook(), { acknowledgeQuestions: true })
    expect(h.caller.calls.attributions).toEqual([{ orgId: "org-1", userId: "person-1", requestId: "claim-1" }])
    const split = edgeCallerFor(edgeDeps(carefulHumanModel))
    await extractProjectFromDocument({ fileName: "z.xlsx", bytes: zoomiesWorkbook(), attribution: { orgId: "o", userId: "u", requestId: "job" } }, { callEdge: split }, { requestCeilingChars: 30_000 })
    const ids = split.calls.attributions.map((a) => a!.requestId)
    expect(ids.length).toBeGreaterThan(1)
    expect(ids).toEqual(ids.map((_, i) => `job-p${i + 1}`))
  })
})

// The real workbook is a client document and is never in the repository. On a machine that has it, the same proofs run on it and
// only lengths, counts and equalities are asserted (nothing of its content, and none of its bank block, is read into a message).
const REAL = "C:\\Users\\Dell\\Downloads\\SMD.ZOOMIES, DIP, FP.DUBAI signed.xlsx"
describe.skipIf(!existsSync(REAL))("AW-111 on the real ZOOMIES workbook (local only)", () => {
  test("the digest has 22 sheets, keeps the two long cells whole, has no cut cell, and is one request with the reader's candidates", async () => {
    const bytes = new Uint8Array(readFileSync(REAL))
    const digest = await readWorkbookDigest(bytes, EXTRACTION_DIGEST_LIMITS, KEEP)
    expect(digest.sheets).toHaveLength(22)
    expect(digest.cutCells).toBeUndefined()
    // The notes cell and the terms cell (about 1,200 and 1,000 characters once the blanks around line breaks are trimmed) are the only
    // cells over the old 400-character limit, and both are whole.
    const longest = digest.sheets.flatMap((s) => s.rows.flatMap((r) => r.cells.map((c) => c.length))).sort((a, c) => c - a)
    expect(longest[0]).toBeGreaterThan(1000)
    expect(longest[1]).toBeGreaterThan(1000)
    expect(longest[2]).toBeLessThanOrEqual(WORKBOOK_LIMITS.maxCellChars)
    const requests = buildEdgeRequestBodies("real.xlsx", digest, buildCandidates(digest))
    expect(requests).toHaveLength(1)
    expect(requests[0].body.length).toBeLessThan(EDGE_REQUEST_MAX_CHARS)
  })

  test("the model-route digest equals the deterministic reader's own grid of the same file, cell for cell", async () => {
    const { readWorkbookGrid } = await import("@/lib/ingest/parser")
    const bytes = readFileSync(REAL)
    const digest = await readWorkbookDigest(new Uint8Array(bytes), EXTRACTION_DIGEST_LIMITS, KEEP)
    const grid = await readWorkbookGrid(bytes)
    expect(digest.sheets).toEqual(grid.sheets)
  })
})

// The workbook builder of the fixture is what every other AW-11x test reads; this holds it to the fixture.
test("workbookFromDigest gives back the rows it was given", async () => {
  const small: WorkbookDigest = { sheets: [{ name: "T", rows: [{ row: 2, cells: ["a", "b\nc"] }, { row: 5, cells: ["d"] }] }] }
  expect((await readWorkbookDigest(workbookFromDigest(small), EXTRACTION_DIGEST_LIMITS, KEEP)).sheets).toEqual(small.sheets)
})
