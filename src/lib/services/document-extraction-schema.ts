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

export type WorkbookLimits = { maxBytes: number; maxSheets: number; maxRowsPerSheet: number; maxCellChars: number }

/** Input ceilings (COST_BUDGET.csv X-01 and X-02): what an upload may hold before any model call is made. */
export const WORKBOOK_LIMITS: WorkbookLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxSheets: 64,
  maxRowsPerSheet: 5000,
  maxCellChars: 400,
}

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
export type WorkbookDigest = { sheets: SheetDigest[] }

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

// ------------------------------------------------------------------------------------------------------ the target schema

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date is written YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
  }, "not a real calendar date")

const money = z.number().min(0).max(1e13)

const lineItemSchema = z.strictObject({
  source: z.strictObject({ sheet: z.string().min(1).max(200), row: z.number().int().min(1).max(1_048_576) }),
  itemCode: z.string().trim().min(1).max(64).optional(),
  parentItemCode: z.string().trim().min(1).max(64).optional(),
  breakdownPercentage: z.number().min(0).max(100).optional(),
  description: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(32),
  quantity: money.optional(),
  rate: money.optional(),
  category: z.string().trim().min(1).max(120).optional(),
})

export const extractionOutputSchema = z.strictObject({
  schema: z.literal(EXTRACTION_SCHEMA_NAME),
  project: z.strictObject({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    startDate: isoDate.optional(),
    targetDate: isoDate.optional(),
  }),
  boq: z.strictObject({
    title: z.string().trim().min(1).max(200),
    lineItems: z.array(lineItemSchema).min(1, "a BOQ needs at least one line item").max(MAX_LINE_ITEMS),
  }),
})

export type ExtractedProject = z.infer<typeof extractionOutputSchema>

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
}

/**
 * The one gate between a model's output and anything that writes. Returns the parsed output, or throws
 * ExtractionRejectedError: extraction_schema_invalid when the shape is wrong (including an unexpected key),
 * extraction_not_grounded when a line cites a sheet and row that the uploaded file does not have.
 */
export function validateExtractionOutput(raw: unknown, digest: WorkbookDigest): ExtractedProject {
  const parsed = extractionOutputSchema.safeParse(raw)
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
  if (ungrounded.length > 0) {
    throw new ExtractionRejectedError("extraction_not_grounded", "A BOQ line cites a row that the uploaded file does not have, so nothing was created", ungrounded)
  }
  return parsed.data
}
