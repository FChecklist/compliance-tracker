// PROJEXA-BUILD-001 U-36 (PMD-03, register rows BR-505 to BR-508): the target schema, the error codes and the pure checks of the
// "create a project and its BOQ from an uploaded workbook" path. document-extraction-service.ts holds the entry point and the
// side effects; this sibling file holds only what needs no database and no network, so the Edge Function tests and the
// injection tests can import it cheaply.
//
// TRUST MODEL. A workbook is untrusted text, and so is whatever a model returns after reading it. Nothing here trusts either:
//   * cleanCellText() removes control, zero-width, bidirectional-control and Unicode tag characters (the ways an instruction can
//     be hidden inside a cell) before a cell reaches a prompt;
//   * validateExtractionOutput() accepts only an exact shape (every object is strict: an extra key is a rejection, not ignored)
//     and every BOQ line must cite a sheet and a row that exist in the uploaded file;
//   * a rejection is an ExtractionRejectedError with a stable code, and the caller creates nothing.
// Passing this validation says the output has the right shape and points at real rows. It does not say the figures are right:
// a person still reads the created BOQ before relying on it.
import { z } from "zod"

export const EXTRACTION_SCHEMA_NAME = "boq_project_v1" as const

/** Most BOQ lines one extraction may carry. The largest real BOQ seen so far has 153 lines. */
export const MAX_LINE_ITEMS = 2000

export type WorkbookLimits = {
  maxBytes: number
  maxSheets: number
  maxRowsPerSheet: number
  maxCellChars: number
  maxColumns: number
  maxCells: number
  maxUncompressedBytes: number
}

/**
 * Input ceilings (COST_BUDGET.csv X-01 and X-02): what an upload may hold before any model call is made.
 * maxColumns, maxCells and maxUncompressedBytes bound the work the read itself does, which the size of the file alone does not:
 *   * maxColumns and maxCells: a sheet's declared range is filled cell by cell when the sheet is turned into rows, so a file of a
 *     few hundred bytes that declares A1:XFD5000 would build 82 million cells. maxCells is the sum over all sheets of columns x
 *     rows of the declared ranges (the 200 x 5000 that one sheet may declare is 1 million, so this is half of that).
 *   * maxUncompressedBytes: the parts of an xlsx file are deflate streams. Measured with a 300 000 cell sheet (9.5 MB unpacked, 2 MB
 *     in the file), reading held about 600 bytes per populated cell (peak 225 MB of memory), so 16 MB unpacked bounds a read near
 *     350 MB. A workbook with more text than the request ceiling (EDGE_REQUEST_MAX_CHARS) is refused later anyway.
 */
export const WORKBOOK_LIMITS: WorkbookLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxSheets: 64,
  maxRowsPerSheet: 5000,
  maxCellChars: 400,
  maxColumns: 200,
  maxCells: 500_000,
  maxUncompressedBytes: 16 * 1024 * 1024,
}

/**
 * The limits the model route reads a workbook with (BUILD-002 WP-02, AW-111). The only difference from WORKBOOK_LIMITS is the cell:
 * a bill workbook exported from a PDF keeps its notes, exclusions and payment terms in single cells of 1,100 to 1,300 characters,
 * and the 400-character cap cut every milestone after the first. 2,000 keeps those whole. A cell longer than this is still cut, but
 * never silently: readWorkbookDigest() lists it in `cutCells` and the extraction turns each into a question.
 */
export const EXTRACTION_DIGEST_LIMITS: WorkbookLimits = { ...WORKBOOK_LIMITS, maxCellChars: 2000 }

/**
 * Ceiling for the whole multipart request of the from-document route: the file plus the framing around it and the two small text
 * fields. The route stops reading the body here, so a body that is far over the file limit is never held in memory.
 */
export const MAX_REQUEST_BODY_BYTES = WORKBOOK_LIMITS.maxBytes + 64 * 1024

/**
 * Size of the request body sent to the Edge Function, and of the model output it may return, in characters. The Edge Function
 * enforces the same numbers (supabase/functions/projexa-document-extract/handler.ts DEFAULT_LIMITS); a test holds the two equal.
 */
export const EDGE_REQUEST_MAX_CHARS = 200_000
export const EDGE_OUTPUT_MAX_CHARS = 80_000

export type ExtractionErrorCode =
  | "unsupported_file_type"
  | "workbook_unreadable"
  | "workbook_empty"
  | "workbook_too_large"
  | "extraction_not_configured"
  | "model_not_configured"
  | "extraction_unavailable"
  | "extraction_output_too_large"
  | "extraction_schema_invalid"
  | "extraction_not_grounded"
  | "extraction_boq_invalid"
  | "extraction_total_mismatch"
  | "extraction_lines_diverge"
  | "extraction_areas_invalid"
  | "duplicate_in_progress"
  | "extraction_rate_limited"

const STATUS_BY_CODE: Record<ExtractionErrorCode, number> = {
  unsupported_file_type: 400,
  workbook_unreadable: 400,
  workbook_empty: 422,
  workbook_too_large: 413,
  extraction_not_configured: 503,
  model_not_configured: 503,
  extraction_unavailable: 502,
  extraction_output_too_large: 502,
  extraction_schema_invalid: 422,
  extraction_not_grounded: 422,
  extraction_boq_invalid: 422,
  extraction_total_mismatch: 422,
  extraction_lines_diverge: 422,
  extraction_areas_invalid: 422,
  duplicate_in_progress: 409,
  extraction_rate_limited: 429,
}

/**
 * A refusal with a stable machine code. Whoever catches one has created nothing. `retryAfterSeconds` is set only for
 * extraction_rate_limited: the wait before the oldest counted extraction leaves the window.
 */
export class ExtractionRejectedError extends Error {
  readonly code: ExtractionErrorCode
  readonly status: number
  readonly issues: string[]
  readonly retryAfterSeconds?: number
  constructor(code: ExtractionErrorCode, message: string, issues: string[] = [], retryAfterSeconds?: number) {
    super(message)
    this.name = "ExtractionRejectedError"
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.issues = issues.slice(0, 20).map((i) => (i.length > 200 ? `${i.slice(0, 200)}...` : i))
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * The one case where something exists after a failure: the project was created and recorded against the upload, and then the BOQ
 * insert failed. The BOQ lines were validated before the project was created, so this means a database fault, not bad input. The
 * caller reports the project id; a second submit of the same file returns that same project, so the BOQ is added through the
 * ordinary BOQ import, not by uploading again.
 */
export class ProjectCreatedWithoutBoqError extends Error {
  readonly projectId: string
  constructor(projectId: string, cause: unknown) {
    super(`Project ${projectId} was created but its BOQ could not be saved`)
    this.name = "ProjectCreatedWithoutBoqError"
    this.projectId = projectId
    this.cause = cause
  }
}

/**
 * The project was created and then recording it against the upload failed twice (a database fault). The BOQ was not attempted. The
 * upload's claim is left as it is, so a second submit of the same file within LEDGER_CLAIM_TTL_SECONDS is refused as in progress and,
 * after that, would create a second project: the caller reports this project's id so the person uses it instead of uploading again.
 */
export class ProjectCreatedUnlinkedError extends Error {
  readonly projectId: string
  constructor(projectId: string, cause: unknown) {
    super(`Project ${projectId} was created but could not be recorded against the upload, so its BOQ was not created`)
    this.name = "ProjectCreatedUnlinkedError"
    this.projectId = projectId
    this.cause = cause
  }
}

// ---------------------------------------------------------------------------------------------------------------- the digest

/** One worksheet as sent to the model: only rows that hold something, each with its real 1-based worksheet row number. */
export type SheetDigest = { name: string; rows: Array<{ row: number; cells: string[] }> }
/** A cell that was longer than the digest's cell limit and was cut. Listed, never silent: the extraction asks a person about it. */
export type CutCell = { sheet: string; row: number; column: number; chars: number }
export type WorkbookDigest = { sheets: SheetDigest[]; cutCells?: CutCell[] }

// Characters that render as nothing or change how text reads, which is how an instruction is hidden in a cell: C0 and C1
// controls, soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul and Braille fillers, Mongolian free variation
// selectors, zero-width and directional marks (U+200B to U+200F, U+202A to U+202E), word joiner and invisible operators
// (U+2060 to U+206F), variation selectors, the byte order mark, and the Unicode tag block.
const HIDDEN_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]|[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** One cell as text: hidden characters removed, every run of whitespace (line breaks included) one space, cut at maxChars. */
export function cleanCellText(value: string, maxChars: number = WORKBOOK_LIMITS.maxCellChars): string {
  const cleaned = value.replace(HIDDEN_CHARS, "").replace(/\s+/gu, " ").trim()
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned
}

/**
 * The row-preserving form of cleanCellText (AW-111): hidden characters are removed the same way, but a line break stays a line
 * break. A merged cell of a PDF-table export holds several table lines in one cell (item numbers, descriptions, quantities and
 * amounts, each as its own newline-joined column), and joining them with spaces made it impossible to line a quantity up with its
 * description. Each line is trimmed and its inner runs of blanks are one space; empty lines are dropped; the result is cut at
 * maxChars (the caller finds out through `chars`, so a cut is never silent).
 */
export function cleanCellTextKeepBreaks(value: string, maxChars: number): { text: string; chars: number } {
  const text = value
    .replace(HIDDEN_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")
  return { text: text.length > maxChars ? text.slice(0, maxChars) : text, chars: text.length }
}

// ------------------------------------------------------------------------------------------------------ the target schema

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date is written YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
  }, "not a real calendar date")

const money = z.number().min(0).max(1e13)

const sourceRefSchema = z.strictObject({ sheet: z.string().min(1).max(200), row: z.number().int().min(1).max(1_048_576) })

const lineItemSchema = z.strictObject({
  source: sourceRefSchema,
  itemCode: z.string().trim().min(1).max(64).optional(),
  parentItemCode: z.string().trim().min(1).max(64).optional(),
  breakdownPercentage: z.number().min(0).max(100).optional(),
  description: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(32),
  quantity: money.optional(),
  rate: money.optional(),
  category: z.string().trim().min(1).max(120).optional(),
})

/** What a question is about. The first six are the deterministic reader's kinds (multisheet-bill-reader.ts QuestionKind). */
export const QUESTION_KINDS = ["no_rate", "packed_cell", "packed_sheet", "bad_quantity", "lump_sum", "unknown_bill", "missing_information", "unclear"] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]
/** Most questions one extraction may carry. A workbook of 2,000 lines can have one per line. */
export const MAX_QUESTIONS = 2000

const questionSchema = z.strictObject({
  kind: z.enum(QUESTION_KINDS),
  sheet: z.string().min(1).max(200),
  row: z.number().int().min(1).max(1_048_576),
  text: z.string().trim().min(1).max(500),
})
export type ExtractionQuestion = z.infer<typeof questionSchema>

const areaName = z.string().trim().min(1).max(60)

// Text that is bank account details. The terms cell of a real bill workbook carries them next to the payment schedule; a model that
// copies the cell whole would put them in a project record. Refusing is the safe direction: the milestones are kept, the account is not.
const BANK_DETAILS = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b|\biban\b|\bswift\b|\bsort\s*code\b|\b(?:a\/c|acct?|account)\s*(?:no|number|#)?\.?\s*[:.-]?\s*\d{6,}/i

const termText = (max: number) => z.string().trim().max(max)

/**
 * The output schema. `minLines` is 1 for a whole answer ("a BOQ needs at least one line item"); an answer for one group of sheets of
 * a workbook that was sent in several requests may have none (a group of summary sheets), so it is read with 0 and the merged answer
 * is read with 1.
 */
export function buildOutputSchema(minLines: number) {
  return z
    .strictObject({
      schema: z.literal(EXTRACTION_SCHEMA_NAME),
      project: z.strictObject({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).optional(),
        startDate: isoDate.optional(),
        targetDate: isoDate.optional(),
      }),
      boq: z.strictObject({
        title: z.string().trim().min(1).max(200),
        lineItems: z.array(lineItemSchema).min(minLines, "a BOQ needs at least one line item").max(MAX_LINE_ITEMS),
      }),
      // What the file itself prints, excluding VAT: per area and in all. The reconciliation gate compares the created lines with it.
      controlTotals: z
        .strictObject({
          grand: money,
          areas: z.array(z.strictObject({ area: areaName, total: money })).max(20).optional(),
        })
        .optional(),
      // The areas of the workbook ("Play Area", "Vet Area"). More than one is still ONE BOQ: a line's category starts with its area.
      areas: z.array(areaName).max(20).optional(),
      client: z.string().trim().min(1).max(200).optional(),
      currency: z.string().regex(/^[A-Z]{3}$/, "a currency is a 3-letter code such as AED").optional(),
      vat: z
        .strictObject({ ratePercent: z.number().min(0).max(100), amount: money.optional(), totalIncVat: money.optional() })
        .optional(),
      paymentTerms: z
        .strictObject({
          summary: termText(2000).optional(),
          milestones: z
            .array(
              z.strictObject({
                label: z.string().trim().min(1).max(200),
                percent: z.number().min(0).max(100).optional(),
                amount: money.optional(),
                when: termText(200).optional(),
              }),
            )
            .max(30)
            .optional(),
        })
        .optional(),
      // Whatever the reader or the model could not settle. Never a reason to invent a figure: a question is answered by a person.
      questions: z.array(questionSchema).max(MAX_QUESTIONS).optional(),
    })
    .superRefine((value, ctx) => {
      const texts: Array<[Array<string | number>, string | undefined]> = [
        [["client"], value.client],
        [["project", "description"], value.project.description],
        [["paymentTerms", "summary"], value.paymentTerms?.summary],
      ]
      value.paymentTerms?.milestones?.forEach((m, i) => {
        texts.push([["paymentTerms", "milestones", i, "label"], m.label], [["paymentTerms", "milestones", i, "when"], m.when])
      })
      for (const [path, text] of texts) {
        if (text && BANK_DETAILS.test(text)) ctx.addIssue({ code: "custom", path, message: "holds bank account details, which are never stored" })
      }
    })
}

export const extractionOutputSchema = buildOutputSchema(1)

export type ExtractedProject = z.infer<typeof extractionOutputSchema>

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
}

/**
 * The code prefix of an area, the way the deterministic reader writes it (multisheet-bill-reader.ts areaCode): the word "Area"
 * and everything that is not a letter or a digit removed, upper case. "Play Area" is PLAY, "Vet Area" is VET.
 */
export function areaCodePrefix(area: string): string {
  return area.replace(/\bArea\b/i, "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase() || "AREA"
}

/** Every number written anywhere in a cell, thousands commas removed ("AED 1,343,445.00" gives 1343445). */
function numbersInCell(text: string): number[] {
  const found: number[] = []
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""))
    if (Number.isFinite(n)) found.push(n)
  }
  return found
}

/** The set of figures the uploaded file prints, to two decimals. A control total that is not in it was computed, not read. */
function printedFigures(digest: WorkbookDigest): Set<number> {
  const figures = new Set<number>()
  for (const sheet of digest.sheets) for (const row of sheet.rows) for (const cell of row.cells) for (const n of numbersInCell(cell)) figures.add(Math.round(n * 100) / 100)
  return figures
}

/**
 * The rules that make two or more areas ONE BOQ (AW-113, only when the answer names `areas`): a line's category starts with its
 * area ("Play Area - Floor Finishes"), and its item code starts with the area's code and a bill ("PLAY-B3-01": hyphens, no dot,
 * because createBoq infers a parent line from a dot), so numbering that restarts in every bill sheet cannot collide. Codes are
 * compared without regard to case. Returns the problems, one sentence each; empty means the rules hold.
 */
export function checkAreaRules(extracted: ExtractedProject): string[] {
  const areas = extracted.areas
  if (!areas || areas.length === 0) return []
  const problems: string[] = []
  const names = areas.map((a) => a.toLowerCase())
  if (new Set(names).size !== names.length) problems.push("areas: an area is named twice")
  const prefixes = new Map(areas.map((a) => [a.toLowerCase(), areaCodePrefix(a)]))
  if (new Set(prefixes.values()).size !== prefixes.size) problems.push("areas: two areas have the same code prefix")
  const seen = new Map<string, number>()
  extracted.boq.lineItems.forEach((line, index) => {
    const where = `boq.lineItems.${index}`
    const category = line.category ?? ""
    const area = areas.find((a) => category.toLowerCase().startsWith(`${a.toLowerCase()} - `))
    if (!area) {
      problems.push(`${where}.category: must start with one of the areas followed by " - " (got ${JSON.stringify(category)})`)
      return
    }
    const code = line.itemCode
    if (!code) {
      problems.push(`${where}.itemCode: is required when the answer names areas`)
      return
    }
    const prefix = areaCodePrefix(area)
    if (code.includes(".") || !code.toUpperCase().startsWith(`${prefix}-`) || code.split("-").length < 3) {
      problems.push(`${where}.itemCode: ${JSON.stringify(code)} must be ${prefix}-B<bill>-<number> (hyphens, no dot)`)
    }
    const key = code.toLowerCase()
    const first = seen.get(key)
    if (first !== undefined) problems.push(`${where}.itemCode: ${JSON.stringify(code)} repeats boq.lineItems.${first}; codes must be unique across sheets`)
    else seen.set(key, index)
  })
  return problems
}

/**
 * The one gate between a model's output and anything that writes. Returns the parsed output, or throws
 * ExtractionRejectedError: extraction_schema_invalid when the shape is wrong (including an unexpected key),
 * extraction_not_grounded when a line or a question cites a sheet and row that the uploaded file does not have, or a control total
 * or VAT figure is not a figure the file prints, extraction_areas_invalid when the area rules of checkAreaRules() do not hold.
 */
export function validateExtractionOutput(raw: unknown, digest: WorkbookDigest, options: { minLines?: number } = {}): ExtractedProject {
  const parsed = (options.minLines === undefined || options.minLines === 1 ? extractionOutputSchema : buildOutputSchema(options.minLines)).safeParse(raw)
  if (!parsed.success) {
    throw new ExtractionRejectedError(
      "extraction_schema_invalid",
      "The extraction output does not match the project and BOQ schema, so nothing was created",
      describeIssues(parsed.error),
    )
  }
  const rowsBySheet = new Map<string, Set<number>>()
  for (const sheet of digest.sheets) rowsBySheet.set(sheet.name, new Set(sheet.rows.map((r) => r.row)))
  const ungrounded: string[] = []
  parsed.data.boq.lineItems.forEach((line, index) => {
    if (!rowsBySheet.get(line.source.sheet)?.has(line.source.row)) {
      ungrounded.push(`boq.lineItems.${index}.source: sheet ${JSON.stringify(line.source.sheet)} row ${line.source.row} is not a row of the uploaded file`)
    }
  })
  parsed.data.questions?.forEach((q, index) => {
    if (!rowsBySheet.get(q.sheet)?.has(q.row)) {
      ungrounded.push(`questions.${index}: sheet ${JSON.stringify(q.sheet)} row ${q.row} is not a row of the uploaded file`)
    }
  })
  const printed = printedFigures(digest)
  const mustBePrinted: Array<[string, number | undefined]> = [
    ["controlTotals.grand", parsed.data.controlTotals?.grand],
    ["vat.amount", parsed.data.vat?.amount],
    ["vat.totalIncVat", parsed.data.vat?.totalIncVat],
  ]
  parsed.data.controlTotals?.areas?.forEach((a, index) => mustBePrinted.push([`controlTotals.areas.${index}.total`, a.total]))
  for (const [path, value] of mustBePrinted) {
    if (value !== undefined && !printed.has(Math.round(value * 100) / 100)) {
      ungrounded.push(`${path}: ${value} is not a figure the uploaded file prints`)
    }
  }
  if (ungrounded.length > 0) {
    throw new ExtractionRejectedError("extraction_not_grounded", "The extraction cites a row or a figure that the uploaded file does not have, so nothing was created", ungrounded)
  }
  const areaProblems = checkAreaRules(parsed.data)
  if (areaProblems.length > 0) {
    throw new ExtractionRejectedError("extraction_areas_invalid", "The areas of the extraction do not make one BOQ with unique item codes, so nothing was created", areaProblems)
  }
  return parsed.data
}
