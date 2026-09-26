// PROJEXA-BUILD-002 WP-02 (register rows AW-112, AW-113, AW-114): the pure decisions of the model route that need no database and no
// network. document-extraction-service.ts calls them in a fixed order; the tests call them directly.
//
//   1. buildCandidates(): the deterministic reader of WP-01 (multisheet-bill-reader.ts) is the FIRST step. When the workbook prints
//      totals the reader can check itself against, its lines and totals become the CANDIDATES the model is given. The model then
//      adds only what the reader cannot (client, dates, project name, a summary of the terms, more questions); it does not
//      decide the figures.
//   2. checkAgainstCandidates(): the model's lines must be the candidates, no more and no fewer, with the same quantities and
//      rates. A model that drops a line, adds one or changes a figure is refused (extraction_lines_diverge).
//   3. splitUnpricedLines(): a line with a quantity and no rate is a question, never a zero-priced line. Its sub-task lines go
//      with it, and the question says so.
//   4. computeReconciliation() and assertReconciliationAllowed(): the sum of the lines that will be created must equal the totals
//      the file prints (per area and in all, VAT excluded) within RECONCILIATION_TOLERANCE, or nothing is created
//      (extraction_total_mismatch). A shortfall may be acknowledged by the caller; an excess never may, because a total that is too
//      high means a line the file does not carry.
//
// What is authoritative. With candidates, the totals the file prints (read by the reader, not by the model) are the expected totals;
// a model whose own controlTotals differ from them is refused. Without candidates (a workbook the reader cannot check), the model's
// controlTotals are used, and validateExtractionOutput() has already required each of them to be a figure the file prints. With
// neither, nothing can be checked and the reconciliation says so (status not_checked): it is never reported as matched.
import { hasBillSheets, readMultisheetBills } from "@/lib/ingest/multisheet-bill-reader"
import {
  ExtractionRejectedError,
  type ExtractedProject,
  type ExtractionQuestion,
  type QuestionKind,
  type WorkbookDigest,
} from "@/lib/services/document-extraction-schema"

// ------------------------------------------------------------------------------------------------------ the tolerance

/**
 * "Equal" for the gate. Prices are typed to the fils, so a sum of many lines can differ from a printed total by rounding: one unit
 * of currency, or one part in a million of the expected figure, whichever is larger. On the 1,596,280 of the ZOOMIES file that is
 * AED 1.00 (the parts-per-million term is 1.6).
 */
export const RECONCILIATION_TOLERANCE = { absolute: 1, relative: 1e-6 } as const

export function toleranceFor(expected: number): number {
  return Math.max(RECONCILIATION_TOLERANCE.absolute, Math.abs(expected) * RECONCILIATION_TOLERANCE.relative)
}

const cents = (n: number): number => Math.round(n * 100)
const money2 = (n: number): number => Math.round(n * 100) / 100

// ------------------------------------------------------------------------------------------------------- the candidates

export type CandidateLine = {
  itemCode: string
  description: string
  unit: string
  quantity: number
  rate: number
  category: string
  source: { sheet: string; row: number }
}

export type Candidates = {
  projectName: string | null
  areas: string[]
  lines: CandidateLine[]
  questions: ExtractionQuestion[]
  totals: {
    grand: number
    areas: Array<{ area: string; total: number }>
    vat: { ratePercent: number | null; amount: number | null; totalIncVat: number | null } | null
  }
  /** True when the reader's own lines add up to every printed total it found (its own reconciliation). */
  readerReconciled: boolean
}

const DESCRIPTION_MAX = 500
const QUESTION_TEXT_MAX = 500

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

/**
 * The reader's result for this digest as candidates, or null when the reader does not apply: no sheet has a bill header, or the
 * workbook prints no grand total the reader could check against (then there is nothing the lines can be held to, and the model
 * answers alone, as before). Never throws: a workbook the reader cannot make sense of is a workbook without candidates.
 */
export function buildCandidates(digest: WorkbookDigest): Candidates | null {
  try {
    const grid = { sheets: digest.sheets }
    if (!hasBillSheets(grid)) return null
    const read = readMultisheetBills(grid)
    if (read.totals.checks === 0 || read.totals.grand.declared === null) return null
    const lines: CandidateLine[] = [...read.lines, ...read.lumpSums].map((l) => ({
      itemCode: l.itemCode,
      description: clip(l.description, DESCRIPTION_MAX),
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      category: l.category,
      source: { sheet: l.source.sheet, row: l.source.row },
    }))
    const areaTotals: Candidates["totals"]["areas"] = []
    for (const a of read.totals.byArea) {
      const printed = a.declaredMain ?? a.declaredSubtotal
      if (a.area !== null && printed !== null) areaTotals.push({ area: a.area, total: printed })
    }
    const areas = read.totals.byArea.map((a) => a.area).filter((a): a is string => a !== null)
    const questions: ExtractionQuestion[] = read.questions.map((q) => ({
      kind: q.kind,
      sheet: q.source.sheet,
      row: q.source.row,
      text: clip(q.question, QUESTION_TEXT_MAX),
    }))
    const vat = read.totals.vat
    return {
      projectName: read.projectName,
      areas,
      lines,
      questions,
      totals: {
        grand: read.totals.grand.declared,
        areas: areaTotals,
        vat: vat ? { ratePercent: vat.ratePercent, amount: vat.amount, totalIncVat: vat.totalIncVat } : null,
      },
      readerReconciled: read.reconciled,
    }
  } catch {
    return null
  }
}

/** The candidates that belong to a group of sheets (a request that carries only some sheets). Totals and the name stay with all. */
export function candidatesForSheets(all: Candidates, sheetNames: ReadonlySet<string>): Candidates {
  return {
    ...all,
    lines: all.lines.filter((l) => sheetNames.has(l.source.sheet)),
    questions: all.questions.filter((q) => sheetNames.has(q.sheet)),
  }
}

const flatText = (text: string): string => text.replace(/\s+/g, " ").trim()

/**
 * The problems between the model's lines and the candidates, one sentence each; empty means the model returned exactly the
 * candidates. Compared: item code (without regard to case), quantity, rate (to the fils), unit, category, source and description
 * (line breaks and runs of blanks ignored). A missing candidate, an extra line and a changed figure are each named.
 */
export function checkAgainstCandidates(extracted: ExtractedProject, candidates: Candidates): string[] {
  const problems: string[] = []
  const want = new Map(candidates.lines.map((c) => [c.itemCode.toLowerCase(), c]))
  const seen = new Set<string>()
  extracted.boq.lineItems.forEach((line, index) => {
    const where = `boq.lineItems.${index}`
    const key = (line.itemCode ?? "").toLowerCase()
    const c = want.get(key)
    if (!c) {
      problems.push(`${where}: ${JSON.stringify(line.itemCode ?? line.description.slice(0, 40))} is not a line the file's own reading found`)
      return
    }
    seen.add(key)
    if (cents(line.quantity ?? -1) !== cents(c.quantity)) problems.push(`${where}: quantity ${line.quantity ?? "missing"} but the file reads ${c.quantity} (${c.itemCode})`)
    if (cents(line.rate ?? -1) !== cents(c.rate)) problems.push(`${where}: rate ${line.rate ?? "missing"} but the file reads ${c.rate} (${c.itemCode})`)
    if (flatText(line.unit) !== flatText(c.unit)) problems.push(`${where}: unit ${JSON.stringify(line.unit)} but the file reads ${JSON.stringify(c.unit)} (${c.itemCode})`)
    if (flatText(line.category ?? "") !== flatText(c.category)) problems.push(`${where}: category differs from the file's reading (${c.itemCode})`)
    if (flatText(line.description) !== flatText(c.description)) problems.push(`${where}: description differs from the file's reading (${c.itemCode})`)
    if (line.source.sheet !== c.source.sheet || line.source.row !== c.source.row) problems.push(`${where}: source differs from the file's reading (${c.itemCode})`)
  })
  for (const c of candidates.lines) {
    if (!seen.has(c.itemCode.toLowerCase())) problems.push(`boq.lineItems: the line ${c.itemCode} (${c.source.sheet} row ${c.source.row}) was dropped`)
  }
  return problems
}

const squash = (text: string): string => text.replace(/\s+/g, "").toLowerCase()

/**
 * When the reader found the project's title in the file, the model's project name must be that title (blanks and case aside: a
 * model may tidy " ," to ","). A model that was talked into a different name by text in the workbook is refused here; the name is
 * otherwise the one field the candidates would leave to the model's own words. Empty when there is no title to hold it to.
 */
export function checkProjectName(extracted: ExtractedProject, candidates: Candidates): string[] {
  if (!candidates.projectName) return []
  if (squash(extracted.project.name) === squash(candidates.projectName)) return []
  return [`project.name: ${JSON.stringify(extracted.project.name)} is not the title the file prints (${JSON.stringify(candidates.projectName)})`]
}

// ------------------------------------------------------------------------------------------------------------ questions

const questionKey = (q: Pick<ExtractionQuestion, "kind" | "sheet" | "row">): string => `${q.kind}|${q.sheet}|${q.row}`

/** The questions of every source in one list, once each (same kind, sheet and row), in the order given. */
export function mergeQuestions(...lists: ReadonlyArray<ReadonlyArray<ExtractionQuestion>>): ExtractionQuestion[] {
  const seen = new Set<string>()
  const out: ExtractionQuestion[] = []
  for (const list of lists) {
    for (const q of list) {
      const key = questionKey(q)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(q)
    }
  }
  return out
}

function question(kind: QuestionKind, sheet: string, row: number, text: string): ExtractionQuestion {
  return { kind, sheet, row, text: clip(text, QUESTION_TEXT_MAX) }
}

/**
 * A line that has a quantity and no rate is not a line of the BOQ: it is a question. So is a line that has a rate and no quantity,
 * and one whose rate is zero. (A sub-task line takes its figures from its parent, so it is judged with its parent; a root with
 * neither quantity nor rate is a heading and stays.) The lines that remain are the ones that will be created; their sub-tasks of a
 * removed parent go with it and are named in its question. Nothing is changed in place.
 */
export function splitUnpricedLines(extracted: ExtractedProject): { extracted: ExtractedProject; questions: ExtractionQuestion[] } {
  const lines = extracted.boq.lineItems
  const removed = new Map<string, ExtractionQuestion>()
  const dropped = new Set<number>()
  lines.forEach((line, index) => {
    if (line.parentItemCode) return
    const quantity = line.quantity ?? 0
    const rate = line.rate ?? 0
    const label = line.itemCode ?? line.description.slice(0, 60)
    if (quantity > 0 && rate <= 0) {
      removed.set(String(index), question("no_rate", line.source.sheet, line.source.row, `${label}: quantity ${quantity} ${line.unit} has no rate in row ${line.source.row} of "${line.source.sheet}", so it was not added to the BOQ. What is its rate?`))
      dropped.add(index)
    } else if (rate > 0 && quantity <= 0) {
      removed.set(String(index), question("bad_quantity", line.source.sheet, line.source.row, `${label}: rate ${rate} has no quantity in row ${line.source.row} of "${line.source.sheet}", so it was not added to the BOQ. What is its quantity?`))
      dropped.add(index)
    }
  })
  // Sub-tasks of a removed line, at any depth, go with it.
  const goneCodes = new Set(lines.filter((_, i) => dropped.has(i) && lines[i].itemCode).map((l) => l.itemCode!))
  let grew = true
  while (grew) {
    grew = false
    lines.forEach((line, index) => {
      if (!dropped.has(index) && line.parentItemCode && goneCodes.has(line.parentItemCode)) {
        dropped.add(index)
        if (line.itemCode) goneCodes.add(line.itemCode)
        grew = true
      }
    })
  }
  const questions: ExtractionQuestion[] = []
  lines.forEach((line, index) => {
    if (!dropped.has(index)) return
    const own = removed.get(String(index))
    if (own) {
      const children = lines.filter((c) => c.parentItemCode && line.itemCode && c.parentItemCode === line.itemCode).length
      questions.push(children > 0 ? { ...own, text: clip(`${own.text} Its ${children} sub-task line(s) were left out with it.`, QUESTION_TEXT_MAX) } : own)
    }
  })
  if (dropped.size === 0) return { extracted, questions: [] }
  return {
    extracted: { ...extracted, boq: { ...extracted.boq, lineItems: lines.filter((_, i) => !dropped.has(i)) } },
    questions,
  }
}

/** A cell longer than the digest's cell limit was cut. It is a question, never silent: the cut part may hold a payment milestone. */
export function cutCellQuestions(digest: WorkbookDigest, limitChars: number): ExtractionQuestion[] {
  return (digest.cutCells ?? []).map((c) =>
    question("unclear", c.sheet, c.row, `A cell in row ${c.row} of "${c.sheet}" holds ${c.chars} characters and only the first ${limitChars} were read. Please check the rest.`),
  )
}

// -------------------------------------------------------------------------------------------------- the reconciliation

export type AreaReconciliation = { area: string; expected: number; actual: number; difference: number; status: "matched" | "shortfall" | "excess" }

export type Reconciliation = {
  status: "matched" | "shortfall" | "excess" | "not_checked"
  /** The grand total the file prints, VAT excluded; null when there is none to check against. */
  expected: number | null
  /** The sum of quantity x rate over the lines that will be created (sub-task lines are shares of their parent and are not added). */
  actual: number
  /** expected - actual: positive is a shortfall (the lines add up to less than the file prints). */
  difference: number | null
  tolerance: number
  source: "reader" | "model" | "none"
  byArea: AreaReconciliation[]
}

/** The sum of quantity x rate over the root lines, in fils. */
export function sumLines(lines: ReadonlyArray<{ parentItemCode?: string; quantity?: number; rate?: number }>): number {
  let total = 0
  for (const l of lines) {
    if (l.parentItemCode) continue
    total += cents((l.quantity ?? 0) * (l.rate ?? 0))
  }
  return total / 100
}

type ExpectedTotals = { grand: number; areas: Array<{ area: string; total: number }>; source: "reader" | "model" }

function compareStatus(expected: number, actual: number): "matched" | "shortfall" | "excess" {
  const diff = expected - actual
  if (Math.abs(diff) <= toleranceFor(expected)) return "matched"
  return diff > 0 ? "shortfall" : "excess"
}

/**
 * The totals the lines are held to, and where they came from. With candidates they are the reader's; a model that also reports
 * control totals must agree with them (a model that reports another figure is refusing the file's own numbers, so it is refused).
 */
function expectedTotals(extracted: ExtractedProject, candidates: Candidates | null): ExpectedTotals | null {
  const model = extracted.controlTotals
  if (candidates) {
    if (model) {
      const problems: string[] = []
      if (Math.abs(model.grand - candidates.totals.grand) > toleranceFor(candidates.totals.grand)) {
        problems.push(`controlTotals.grand: the model reports ${model.grand} but the file prints ${candidates.totals.grand}`)
      }
      for (const a of model.areas ?? []) {
        const printed = candidates.totals.areas.find((p) => p.area.toLowerCase() === a.area.toLowerCase())
        if (!printed) problems.push(`controlTotals.areas: the file prints no total for ${JSON.stringify(a.area)}`)
        else if (Math.abs(a.total - printed.total) > toleranceFor(printed.total)) problems.push(`controlTotals.areas: ${a.area} is ${a.total} for the model but ${printed.total} in the file`)
      }
      if (problems.length > 0) {
        throw new ExtractionRejectedError("extraction_total_mismatch", "The control totals of the extraction are not the totals the file prints, so nothing was created", problems)
      }
    }
    return { grand: candidates.totals.grand, areas: candidates.totals.areas, source: "reader" }
  }
  if (model) return { grand: model.grand, areas: model.areas ?? [], source: "model" }
  return null
}

/** The area a line belongs to: the area its category starts with, or null. */
function areaOfLine(category: string | undefined, areas: ReadonlyArray<string>): string | null {
  const c = (category ?? "").toLowerCase()
  return areas.find((a) => c.startsWith(`${a.toLowerCase()} - `)) ?? null
}

/**
 * Holds the lines that will be created to the totals the file prints. Per area first (an offsetting error between two areas
 * leaves the grand total right and one area wrong), then in all. Does not throw for a shortfall or an excess: it reports them, and
 * assertReconciliationAllowed() decides. It does throw (extraction_total_mismatch) when the model's controlTotals contradict the
 * totals the reader found in the file.
 */
export function computeReconciliation(extracted: ExtractedProject, candidates: Candidates | null): Reconciliation {
  const lines = extracted.boq.lineItems
  const actual = sumLines(lines)
  const expected = expectedTotals(extracted, candidates)
  if (!expected) return { status: "not_checked", expected: null, actual, difference: null, tolerance: 0, source: "none", byArea: [] }

  const areaNames = extracted.areas ?? expected.areas.map((a) => a.area)
  const byArea: AreaReconciliation[] = expected.areas.map((a) => {
    const areaActual = sumLines(lines.filter((l) => areaOfLine(l.category, areaNames)?.toLowerCase() === a.area.toLowerCase()))
    return { area: a.area, expected: a.total, actual: areaActual, difference: money2(a.total - areaActual), status: compareStatus(a.total, areaActual) }
  })
  const grandStatus = compareStatus(expected.grand, actual)
  const all = [grandStatus, ...byArea.map((a) => a.status)]
  const status = all.includes("excess") ? "excess" : all.includes("shortfall") ? "shortfall" : "matched"
  return { status, expected: expected.grand, actual, difference: money2(expected.grand - actual), tolerance: toleranceFor(expected.grand), source: expected.source, byArea }
}

/**
 * The gate. Matched and not_checked pass. A shortfall passes only when the caller acknowledges it. An excess never passes.
 * Throws ExtractionRejectedError extraction_total_mismatch, naming the figures, so the caller creates nothing.
 */
export function assertReconciliationAllowed(rec: Reconciliation, options: { acknowledgeShortfall?: boolean } = {}): void {
  if (rec.status === "matched" || rec.status === "not_checked") return
  const issues: string[] = []
  if (rec.expected !== null && Math.abs(rec.expected - rec.actual) > rec.tolerance) {
    issues.push(`the file prints ${rec.expected} in all and the lines add up to ${rec.actual} (difference ${rec.difference})`)
  }
  for (const a of rec.byArea) {
    if (a.status !== "matched") issues.push(`${a.area}: the file prints ${a.expected} and the lines add up to ${a.actual} (difference ${a.difference})`)
  }
  if (rec.status === "shortfall" && options.acknowledgeShortfall === true) return
  throw new ExtractionRejectedError(
    "extraction_total_mismatch",
    rec.status === "excess"
      ? "The lines add up to more than the file prints, so nothing was created"
      : "The lines add up to less than the file prints, so nothing was created. Send acknowledgeShortfall=true to create the BOQ as it is",
    issues,
  )
}

// ------------------------------------------------------------------------------------------------- one answer from many

/**
 * One extraction from the answers to several requests (a workbook too big for one request is sent in groups of sheets). The first
 * answer that has a value names it (project, client, currency, VAT, payment terms, control totals); the lines and the questions
 * of every answer are added in order; the areas are the union. Two answers that give the same item code are not merged here: the
 * duplicate reaches validateExtractionOutput() and createBoq()'s own rule and is refused.
 */
export function mergeExtractions(parts: ReadonlyArray<ExtractedProject>): ExtractedProject {
  const first = parts[0]
  const pick = <T>(get: (p: ExtractedProject) => T | undefined): T | undefined => {
    for (const p of parts) {
      const v = get(p)
      if (v !== undefined) return v
    }
    return undefined
  }
  const areas: string[] = []
  for (const p of parts) for (const a of p.areas ?? []) if (!areas.some((x) => x.toLowerCase() === a.toLowerCase())) areas.push(a)
  const questions = mergeQuestions(...parts.map((p) => p.questions ?? []))
  const merged: ExtractedProject = {
    schema: first.schema,
    project: {
      name: first.project.name,
      description: pick((p) => p.project.description),
      startDate: pick((p) => p.project.startDate),
      targetDate: pick((p) => p.project.targetDate),
    },
    boq: { title: first.boq.title, lineItems: parts.flatMap((p) => p.boq.lineItems) },
  }
  const controlTotals = pick((p) => p.controlTotals)
  if (controlTotals) merged.controlTotals = controlTotals
  if (areas.length > 0) merged.areas = areas
  const client = pick((p) => p.client)
  if (client !== undefined) merged.client = client
  const currency = pick((p) => p.currency)
  if (currency !== undefined) merged.currency = currency
  const vat = pick((p) => p.vat)
  if (vat) merged.vat = vat
  const paymentTerms = pick((p) => p.paymentTerms)
  if (paymentTerms) merged.paymentTerms = paymentTerms
  if (questions.length > 0) merged.questions = questions
  // JSON round trip drops the keys that are undefined, so the object is exactly what the schema accepts.
  return JSON.parse(JSON.stringify(merged)) as ExtractedProject
}

