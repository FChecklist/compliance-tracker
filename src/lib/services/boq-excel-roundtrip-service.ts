// R85 Addendum 3 v4 FINAL, PHASE 7 -- EXCEL ROUND TRIP (D89, spec gates
// 7-01..7-12, GATE C7). Owner rulings D87 (claude_log 366), D88 (372), D89
// (373), D90 (374), D91 (375). Work order: Google Drive
// WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, Part F Phase 7.
//
// ★ SINGLE PRODUCER RULE (X-27) ★ -- this file computes NOTHING. Every
// project/contract/variance figure it exports comes from
// boq-dual-view-service.ts's computeBoqLineMoneyView (already attached to
// every line item by construction-boq-service.ts's withComputedRate/getBoq,
// Phase 2) -- this file only reads those already-computed fields off the
// object getBoq() returns and renders them into cells. It never reimplements
// project_value/contract_value/variance/variancePercent/quantityVariance/
// rateVariance.
//
// THE FOUR-WAY UPLOAD SPLIT (7-05), the actual design this file implements:
//   COST     (qty_project/rate_project)     -- always accepted, no evidence
//            gate, ever. Cost tracking is an internal, ongoing activity.
//   CONTRACT (qty_contract/rate_contract)   -- accepted before this BOQ's
//            first confirmed baseline; once a baseline exists (checked via
//            boq-baseline-service.ts's listBaselineVersionsWithDb, never
//            re-derived here -- X-27 applies to "has this been confirmed"
//            exactly as it does to money math), a contract-side change is
//            REJECTED unless the caller cites a real evidenceArtefactRef --
//            the SAME evidence-artefact pattern boq-baseline-service.ts's
//            confirmBaseline() already established, reused, not reinvented.
//            Rejected-for-lack-of-evidence changes are FLAGGED in the diff
//            (contractChangesPendingEvidence) and excluded from the applied
//            set -- never silently dropped, never silently applied.
//   COMPUTED (project_value/contract_value/variance/variancePercent/
//            quantityVariance/rateVariance) -- IGNORED on upload, always,
//            with the diff explicitly reporting how many such cells were
//            edited-and-ignored (computedIgnored) so the system "says so"
//            (7-05's own wording).
//   STRUCTURAL (item_code/description/unit) -- routed through
//            construction-boq-service.ts's createBoqRevision (a NEW
//            revision), never an in-place edit -- matching this codebase's
//            existing rule that a structural BOQ change is a revision.
//
// WHAT "ONE TRANSACTION OR NONE" (7-07/X-21) MEANS HERE, DELIBERATELY
// DOCUMENTED SO A FUTURE READER DOES NOT RE-LITIGATE IT: a row/cell REJECTED
// for cause (unmatched Line ID, a non-numeric cell, a contract edit with no
// evidence on a confirmed BOQ) is excluded from the apply-set BEFORE any
// transaction opens -- it was never "half applied", it was never in the set
// at all, and it is reported, never dropped (7-09). "One transaction or
// none" is the guarantee over the SET OF CHANGES THAT WAS ACTUALLY GOING TO
// BE APPLIED: either every one of those writes commits together, or (a
// concurrent edit invalidates the diff, a DB constraint fails) none of them
// do. This mirrors 7-06's own diff-before-apply contract: the diff a caller
// reviewed and confirmed (via confirmedDiffToken) IS the apply-set: rejected
// material was never part of what was confirmed.
//
// NESTED withTenantContext, avoided by design (CLAUDE.md's real, documented
// R74/R75 assertNotNested() gotcha): diffUpload always opens its OWN
// transaction; applyUpload's structural path (applyStructuralRevision) reads
// via a plain top-level getBoq() call and then makes a SEPARATE top-level
// call to createBoqRevision() (which is itself already "one transaction" for
// everything IT writes) -- never one nested inside the other. The residual
// read-then-write race this leaves between the two sequential transactions
// is closed by an explicit optimistic-concurrency re-check (every targeit
// cell's current stored value is re-verified against the diff's recorded
// "before" value immediately before either write path actually writes;
// any mismatch refuses the WHOLE apply with a 409, nothing written) -- the
// same backstop-not-a-single-snapshot posture createBoqRevision's own E-128
// comment already accepts for its parentBoqId race.
import { createHash } from "node:crypto"
import { constructionBoqs, constructionBoqLineItems } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { NOT_SET } from "./boq-dual-view-service"
import {
  getBoq,
  createBoqRevision,
  toLineItemInput,
  type BoqLineItemInput,
  type BoqLineItemRow,
} from "./construction-boq-service"
// Same cache-bust convention every other BOQ line-item write in this
// codebase already follows (createBoq/createBoqRevision/updateBoq all call
// this after their own write) -- construction-boq-service.ts imports it
// from here too, rather than re-exporting it, so this file does the same
// rather than routing through that file for a function it doesn't own.
import { bustProjectDashboardCache } from "./project-dashboard-cache"
import { listBaselineVersionsWithDb } from "./boq-baseline-service"
import { listCurrencies } from "./erp-accounting-service"
import { applyCostVisibility } from "./cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

export type RoundtripReadContext = { orgId: string }
export type RoundtripWriteContext = { orgId: string; userId: string }

// ─────────────────────────────────────────────────────────────────────────
// COLUMN HEADERS (7-04: "Column headers exactly matching the on-screen
// labels"). No BOQ grid UI exists yet for this dual-view data (Phase 9's own
// ACTIVE-CLAIMS entry confirms Phase 7 had "not yet started" when it was
// written, and no earlier phase shipped a screen) -- these labels ARE the
// first real on-screen labels for these fields, chosen to read the same way
// this file's own upstream services already talk about them (Qty/Rate
// (Project) vs (Contract), matching boq-dual-view-service.ts's own naming).
// A future screen should adopt these exact strings rather than this file
// adopting whatever the screen invents later, since parseUploadedBoq()
// matches on them EXACTLY (never fuzzy-aliased the way the unrelated
// construction-boq-import-service.ts's brand-new-BOQ importer is -- see this
// file's own module comment on why that is a deliberately different,
// unrelated feature).
export const BOQ_EXCEL_HEADERS = {
  lineId: "Line ID",
  itemCode: "Item Code",
  description: "Description",
  unit: "Unit",
  qtyProject: "Qty (Project)",
  rateProject: "Rate (Project)",
  qtyContract: "Qty (Contract)",
  rateContract: "Rate (Contract)",
  projectValue: "DERIVED: Project Value",
  contractValue: "DERIVED: Contract Value",
  variance: "DERIVED: Variance",
  variancePercent: "DERIVED: Variance %",
  quantityVariance: "DERIVED: Quantity Variance",
  rateVariance: "DERIVED: Rate Variance",
} as const

const DERIVED_HEADERS = [
  BOQ_EXCEL_HEADERS.projectValue,
  BOQ_EXCEL_HEADERS.contractValue,
  BOQ_EXCEL_HEADERS.variance,
  BOQ_EXCEL_HEADERS.variancePercent,
  BOQ_EXCEL_HEADERS.quantityVariance,
  BOQ_EXCEL_HEADERS.rateVariance,
] as const

function moneyHeader(label: string, currencyCode: string | null): string {
  return currencyCode ? `${label} [${currencyCode}]` : label
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

// ─────────────────────────────────────────────────────────────────────────
// ZIP / FROZEN HEADER ROW (7-04). SheetJS Community Edition (the `xlsx`
// package this repo already depends on -- see report-export-shared.ts's own
// header for the lazy-`require` convention reused below) does NOT support
// writing freeze panes: verified by reading node_modules/xlsx/xlsx.js's own
// write_ws_xml_sheetviews, which emits only workbookViewId and (optionally)
// rightToLeft -- pane/freeze parsing exists in that same file (it's a real
// OOXML feature the READER understands) but the WRITER never emits it; that
// split is a real, Pro-vs-Community-edition feature gate, not an oversight
// this file can route around by passing a different option.
//
// Rather than add a new dependency for one cosmetic feature, this patches
// the .xlsx SheetJS already produced: `XLSX.write(..., {type:"buffer"})`
// with `compression` left at its default (false) writes every ZIP entry
// STORED, i.e. byte-for-byte uncompressed (verified directly against this
// exact installed version -- every entry's method byte reads 0) -- so the
// sheet's own XML sits in the buffer completely literally and can be
// string-replaced in place, then the whole (tiny, KB-scale for a BOQ) zip is
// rebuilt with correct CRC32s and offsets. A minimal, hand-rolled ZIP
// reader/writer, not a general-purpose one: STORED entries only, no
// comments, no data descriptors -- exactly what SheetJS's own writer
// produces and nothing more.
//
// FAILS SAFE, always: if the input does not look exactly like what SheetJS
// just produced (an unexpected compression method, no sheet1.xml, no
// self-closing <sheetView/> to patch), the ORIGINAL buffer is returned
// unchanged. A missing freeze pane is cosmetic; a corrupted workbook is not,
// and must never be risked for it -- 7-11's round-trip proof depends on this
// function never breaking a file it touches.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

type ZipEntry = { name: string; data: Buffer }

function parseStoredZip(buf: Buffer): ZipEntry[] {
  let i = 0
  const entries: ZipEntry[] = []
  while (i < buf.length - 4) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf.readUInt16LE(i + 8)
      const nameLen = buf.readUInt16LE(i + 26)
      const extraLen = buf.readUInt16LE(i + 28)
      const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8")
      const compSize = buf.readUInt32LE(i + 18)
      const dataStart = i + 30 + nameLen + extraLen
      if (method !== 0) throw new Error(`applyFrozenHeaderRow: unexpected compression method ${method} for ${name}`)
      entries.push({ name, data: buf.subarray(dataStart, dataStart + compSize) })
      i = dataStart + compSize
    } else {
      i++
    }
  }
  if (entries.length === 0) throw new Error("applyFrozenHeaderRow: no zip entries found")
  return entries
}

function buildStoredZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = 0x21 // 1980-01-01, the DOS-epoch minimum -- some readers reject an all-zero date

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8")
    const crc = crc32(data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(DOS_TIME, 10)
    localHeader.writeUInt16LE(DOS_DATE, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuf, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(DOS_TIME, 12)
    centralHeader.writeUInt16LE(DOS_DATE, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuf)

    offset += localHeader.length + nameBuf.length + data.length
  }

  const centralDirStart = offset
  const centralDirBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirBuf.length, 12)
  eocd.writeUInt32LE(centralDirStart, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirBuf, eocd])
}

const SHEET_VIEW_SELF_CLOSING_RE = /<sheetView([^>]*)\/>/

/** Exported for its own dedicated unit test (round-trip + fails-safe on garbage input); every export function below calls it, never bypasses it. */
export function applyFrozenHeaderRow(buf: Buffer, sheetPath = "xl/worksheets/sheet1.xml"): Buffer {
  try {
    const entries = parseStoredZip(buf)
    const idx = entries.findIndex((e) => e.name === sheetPath)
    if (idx === -1) return buf
    const xml = entries[idx]!.data.toString("utf8")
    const patchedXml = xml.replace(
      SHEET_VIEW_SELF_CLOSING_RE,
      (_m, attrs: string) =>
        `<sheetView${attrs}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>`
    )
    if (patchedXml === xml) return buf
    const patchedEntries = entries.slice()
    patchedEntries[idx] = { name: sheetPath, data: Buffer.from(patchedXml, "utf8") }
    return buildStoredZip(patchedEntries)
  } catch {
    return buf
  }
}

function buildWorkbookBuffer(headers: string[], rows: Array<Array<string | number>>, sheetName: string, hiddenColIndexes: number[]): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load: NEVER a top-level import (see report-export-shared.ts's own header for the real RAM/bundle-size bug this avoids)
  const XLSX = require("xlsx") as typeof import("xlsx")
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws["!cols"] = headers.map((_, i) => (hiddenColIndexes.includes(i) ? { hidden: true } : {}))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer
  return applyFrozenHeaderRow(buffer)
}

async function resolveBaseCurrencyCode(orgId: string): Promise<string | null> {
  try {
    const currencies = await listCurrencies({ orgId })
    return currencies.find((c) => c.isBaseCurrency)?.code ?? null
  } catch {
    // ERP not enabled for this org, or no currency configured -- export
    // proceeds with bare numbers, matching the sibling work-progress xlsx
    // route's own established `.catch(() => [])` fallback (never guess a
    // currency).
    return null
  }
}

/** MoneyFigure/undefined(redacted)/raw-string-from-DB -> the literal cell to write. Never rounds (X-03): the full-precision number is written as-is; Excel's own number format is a display concern, not this file's. */
function cellForMoneyFigure(value: unknown): string | number {
  if (value === undefined) return "" // redacted by applyCostVisibility -- the key was removed entirely
  if (value === NOT_SET) return NOT_SET
  if (typeof value === "number") return value
  if (value === null) return ""
  const n = Number(value)
  return Number.isFinite(n) ? n : ""
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT: INTERNAL (7-03/7-04) -- every column, computed columns visibly
// DERIVED-prefixed, hidden Line ID column.
// ─────────────────────────────────────────────────────────────────────────

/** Result type deliberately loose (Record<string, unknown> per line item) -- this function reads by KEY NAME, exactly like cost-visibility-service.ts's redactProjectSideFields does, so a role-redacted (key removed) line item degrades to a blank cell rather than a crash. */
export async function exportInternalBoq(
  ctx: RoundtripReadContext,
  boqId: string,
  role: UserRole | null | undefined
): Promise<Buffer> {
  const boqRaw = await getBoq(ctx, boqId)
  const boq = (await applyCostVisibility(ctx, role, boqRaw)) as typeof boqRaw
  const currencyCode = await resolveBaseCurrencyCode(ctx.orgId)

  const headers = [
    BOQ_EXCEL_HEADERS.lineId,
    BOQ_EXCEL_HEADERS.itemCode,
    BOQ_EXCEL_HEADERS.description,
    BOQ_EXCEL_HEADERS.unit,
    BOQ_EXCEL_HEADERS.qtyProject,
    moneyHeader(BOQ_EXCEL_HEADERS.rateProject, currencyCode),
    BOQ_EXCEL_HEADERS.qtyContract,
    moneyHeader(BOQ_EXCEL_HEADERS.rateContract, currencyCode),
    moneyHeader(BOQ_EXCEL_HEADERS.projectValue, currencyCode),
    moneyHeader(BOQ_EXCEL_HEADERS.contractValue, currencyCode),
    moneyHeader(BOQ_EXCEL_HEADERS.variance, currencyCode),
    BOQ_EXCEL_HEADERS.variancePercent,
    moneyHeader(BOQ_EXCEL_HEADERS.quantityVariance, currencyCode),
    moneyHeader(BOQ_EXCEL_HEADERS.rateVariance, currencyCode),
  ]

  const rows = (boq.lineItems as Array<Record<string, unknown>>).map((item) => [
    String(item.id ?? ""),
    item.itemCode !== undefined && item.itemCode !== null ? String(item.itemCode) : "",
    item.description !== undefined && item.description !== null ? String(item.description) : "",
    item.unit !== undefined && item.unit !== null ? String(item.unit) : "",
    cellForMoneyFigure(item.qtyProject),
    cellForMoneyFigure(item.rateProject),
    cellForMoneyFigure(item.qtyContract),
    cellForMoneyFigure(item.rateContract),
    cellForMoneyFigure(item.projectValue),
    cellForMoneyFigure(item.contractValue),
    cellForMoneyFigure(item.variance),
    cellForMoneyFigure(item.variancePercent),
    cellForMoneyFigure(item.quantityVariance),
    cellForMoneyFigure(item.rateVariance),
  ])

  return buildWorkbookBuffer(headers, rows, "BOQ Internal", [0])
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT: CUSTOMER (7-12, MANDATORY) -- structurally incapable of emitting
// any cost/variance figure: this function's own body never reads
// qtyProject/rateProject/projectValue/variance/variancePercent/
// quantityVariance/rateVariance off a line item at all -- there is no
// redaction step to forget, because there is nothing here that could emit
// them in the first place. Contrast with exportInternalBoq above, which
// reads a WIDER set of fields and relies on applyCostVisibility to redact by
// ROLE; this function reads a NARROWER set by CONSTRUCTION, regardless of
// caller role -- matching PROJECT_SIDE_COST_FIELDS's spirit (contract-side +
// structural is always safe to show a client) without depending on that
// list at all.
// ─────────────────────────────────────────────────────────────────────────
export async function exportCustomerBoq(ctx: RoundtripReadContext, boqId: string): Promise<Buffer> {
  const boq = await getBoq(ctx, boqId)
  const currencyCode = await resolveBaseCurrencyCode(ctx.orgId)

  const headers = [
    BOQ_EXCEL_HEADERS.lineId,
    BOQ_EXCEL_HEADERS.itemCode,
    BOQ_EXCEL_HEADERS.description,
    BOQ_EXCEL_HEADERS.unit,
    BOQ_EXCEL_HEADERS.qtyContract,
    moneyHeader(BOQ_EXCEL_HEADERS.rateContract, currencyCode),
  ]

  const rows = boq.lineItems.map((item: { id: string; itemCode: string | null; description: string; unit: string; qtyContract: string | null; rateContract: string | null }) => [
    item.id,
    item.itemCode ?? "",
    item.description,
    item.unit,
    item.qtyContract === null || item.qtyContract === undefined ? "" : Number(item.qtyContract),
    item.rateContract === null || item.rateContract === undefined ? "" : Number(item.rateContract),
  ])

  return buildWorkbookBuffer(headers, rows, "BOQ Customer", [0])
}

// ─────────────────────────────────────────────────────────────────────────
// PARSE (7-10: a malformed file changes NOTHING -- validate fully, THEN
// apply). This function only ever READS the buffer; it never touches the
// database and never decides what to accept/reject beyond "is this
// structurally a file this system produced" -- per-cell/per-row acceptance
// is diffUpload's job, one layer up, which is what lets 7-09's "rejected
// rows reported, never dropped" and this function's "malformed file changes
// nothing" both be true without contradicting each other: a MALFORMED FILE
// (missing Line ID column entirely, unreadable as .xlsx) fails HERE, before
// any row is even looked at; a malformed CELL within an otherwise-good file
// (a non-numeric Qty) fails per-row, one layer up.
// ─────────────────────────────────────────────────────────────────────────

export type ParsedUploadRow = {
  /** 1-based, header row = 1 -- the first data row is 2, matching this codebase's existing convention (construction-boq-import-service.ts's own sheetRow numbering). */
  sheetRow: number
  lineId: string | null
  /** undefined = this column was absent from the file entirely (not submitted); "" = present but blank (X-19: matched by Line ID, so a customer-template upload with no Item Code column is legal and simply submits no itemCode change). */
  itemCode?: string
  description?: string
  unit?: string
  /** number = a real value; null = the cell was present but blank (clear this field); undefined = the column itself was absent from the file (no change requested). */
  qtyProject?: number | null
  rateProject?: number | null
  qtyContract?: number | null
  rateContract?: number | null
  /** Field names where the cell had non-blank, unparseable content -- this row is REJECTED (not silently coerced to 0/NaN, X-04's own spirit extended to upload parsing). */
  malformedFields: string[]
  /** How many of the 6 DERIVED columns had a non-blank value in this row -- 7-05: "computed columns -- IGNORED, and the system SAYS SO." */
  derivedColumnsWithValues: number
}

export type ParsedUpload = {
  rows: ParsedUploadRow[]
  headers: string[]
  /** Non-empty ONLY when the file itself could not be used at all (7-10) -- callers must refuse the whole request without looking at `rows`. */
  fileErrors: string[]
  /** sha256 of the raw uploaded bytes -- "" when fileErrors is non-empty. This IS the evidence artefact for every change the upload makes (7-08): computed here, once, from the actual bytes, and threaded through diffUpload/applyUpload's `contentHash` option rather than re-read from disk/re-hashed twice. */
  contentHash: string
}

const REQUIRED_HEADERS = [BOQ_EXCEL_HEADERS.lineId, BOQ_EXCEL_HEADERS.description, BOQ_EXCEL_HEADERS.unit] as const

export function parseUploadedBoq(buffer: Buffer): ParsedUpload {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load, see buildWorkbookBuffer's own comment
  const XLSX = require("xlsx") as typeof import("xlsx")

  let workbook: import("xlsx").WorkBook
  try {
    workbook = XLSX.read(buffer, { type: "buffer" })
  } catch {
    return { rows: [], headers: [], fileErrors: ["The uploaded file could not be read as a valid .xlsx spreadsheet."], contentHash: "" }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { rows: [], headers: [], fileErrors: ["The uploaded file has no sheets."], contentHash: "" }
  const ws = workbook.Sheets[sheetName]!
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as unknown[][]
  if (aoa.length === 0) return { rows: [], headers: [], fileErrors: ["The uploaded file has no rows."], contentHash: "" }

  const headerRow = (aoa[0] ?? []).map((h) => String(h ?? "").trim())
  const missing = REQUIRED_HEADERS.filter((h) => !headerRow.includes(h))
  if (missing.length > 0) {
    return {
      rows: [],
      headers: headerRow,
      fileErrors: [
        `Missing required column(s): ${missing.join(", ")} -- this file does not look like this BOQ's own Excel export (Line ID/Description/Unit are on every template). Re-download the template and try again.`,
      ],
      contentHash: "",
    }
  }

  const idx = (label: string) => headerRow.indexOf(label)
  const iLineId = idx(BOQ_EXCEL_HEADERS.lineId)
  const iItemCode = idx(BOQ_EXCEL_HEADERS.itemCode)
  const iDescription = idx(BOQ_EXCEL_HEADERS.description)
  const iUnit = idx(BOQ_EXCEL_HEADERS.unit)
  const iQtyProject = idx(BOQ_EXCEL_HEADERS.qtyProject)
  const iRateProject = idx(BOQ_EXCEL_HEADERS.rateProject)
  const iQtyContract = idx(BOQ_EXCEL_HEADERS.qtyContract)
  const iRateContract = idx(BOQ_EXCEL_HEADERS.rateContract)
  // A currency suffix ("Rate (Contract) [INR]") is still an exact match for
  // "starts with the canonical label" -- callers must be able to re-upload
  // their own downloaded file even though the header carries a currency tag
  // the plain label constant does not.
  const iRateContractLoose = iRateContract !== -1 ? iRateContract : headerRow.findIndex((h) => h.startsWith(BOQ_EXCEL_HEADERS.rateContract))
  const iRateProjectLoose = iRateProject !== -1 ? iRateProject : headerRow.findIndex((h) => h.startsWith(BOQ_EXCEL_HEADERS.rateProject))
  const derivedIndexes = DERIVED_HEADERS.map((h) => headerRow.findIndex((x) => x === h || x.startsWith(h))).filter((i) => i !== -1)

  const rows: ParsedUploadRow[] = []
  for (let r = 1; r < aoa.length; r++) {
    const raw = aoa[r] ?? []
    const isBlankRow = raw.every((c) => c === "" || c === undefined || c === null)
    if (isBlankRow) continue

    const cellAt = (i: number): unknown => (i === -1 ? undefined : raw[i])
    const lineIdRaw = cellAt(iLineId)
    const lineId = lineIdRaw === undefined || lineIdRaw === null || String(lineIdRaw).trim() === "" ? null : String(lineIdRaw).trim()

    const malformedFields: string[] = []
    function numeric(i: number, fieldLabel: string): number | null | undefined {
      if (i === -1) return undefined
      const v = raw[i]
      if (v === "" || v === undefined || v === null) return null
      if (typeof v === "number") {
        if (Number.isFinite(v)) return v
        malformedFields.push(fieldLabel)
        return null
      }
      const s = String(v).trim()
      if (s === "") return null
      const n = Number(s)
      if (Number.isFinite(n)) return n
      malformedFields.push(fieldLabel)
      return null
    }

    const derivedColumnsWithValues = derivedIndexes.filter((i) => raw[i] !== "" && raw[i] !== undefined && raw[i] !== null).length

    rows.push({
      sheetRow: r + 1,
      lineId,
      itemCode: iItemCode === -1 ? undefined : String(cellAt(iItemCode) ?? "").trim(),
      description: iDescription === -1 ? undefined : String(cellAt(iDescription) ?? "").trim(),
      unit: iUnit === -1 ? undefined : String(cellAt(iUnit) ?? "").trim(),
      qtyProject: numeric(iQtyProject, BOQ_EXCEL_HEADERS.qtyProject),
      rateProject: numeric(iRateProjectLoose, BOQ_EXCEL_HEADERS.rateProject),
      qtyContract: numeric(iQtyContract, BOQ_EXCEL_HEADERS.qtyContract),
      rateContract: numeric(iRateContractLoose, BOQ_EXCEL_HEADERS.rateContract),
      malformedFields,
      derivedColumnsWithValues,
    })
  }

  return { rows, headers: headerRow, fileErrors: [], contentHash: sha256Hex(buffer) }
}

// ─────────────────────────────────────────────────────────────────────────
// DIFF (7-06/7-07: computed and returned, NOTHING written yet).
// ─────────────────────────────────────────────────────────────────────────

export type UploadColumnClass = "structural" | "cost" | "contract"
export type UploadCellField = "itemCode" | "description" | "unit" | "qtyProject" | "rateProject" | "qtyContract" | "rateContract"

export type UploadCellChange = {
  lineItemId: string
  sheetRow: number
  field: UploadCellField
  columnClass: UploadColumnClass
  before: string | number | null
  after: string | number | null
}

export type RejectedUploadRow = { sheetRow: number; lineId: string | null; reason: string }

export type UploadDiffCounts = { structural: number; cost: number; contract: number; computedIgnored: number }

export type UploadDiffResult = {
  contentHash: string
  totalDataRows: number
  matchedRows: number
  changes: UploadCellChange[]
  countsByColumnClass: UploadDiffCounts
  rejectedRows: RejectedUploadRow[]
  hasStructuralChanges: boolean
  /** Contract-side changes DETECTED but excluded from `changes` because this BOQ already has a confirmed baseline and no evidenceArtefactRef was supplied -- 7-05: "FLAGGED, never silently dropped." */
  contractChangesPendingEvidence: UploadCellChange[]
  evidenceRequired: boolean
  evidenceSatisfied: boolean
  /** Line items that exist in the BOQ but were not matched by any row in the upload -- informational only, NEVER deleted (Excel upload does not support removing lines; use a revision for that). */
  linesNotInUpload: string[]
  /** Binds a subsequent applyUpload() call to EXACTLY this diff (7-06/X-20: a per-cell diff must be shown before an apply, and the apply must be of what was shown, not a stale/different one). */
  confirmedDiffToken: string
}

export type DiffUploadOptions = { evidenceArtefactRef?: string; contentHash: string }

function computeDiffToken(input: { contentHash: string; changes: UploadCellChange[]; evidenceArtefactRef: string | null }): string {
  const sortedChanges = [...input.changes].sort((a, b) =>
    a.lineItemId === b.lineItemId ? a.field.localeCompare(b.field) : a.lineItemId.localeCompare(b.lineItemId)
  )
  const payload = JSON.stringify({ contentHash: input.contentHash, changes: sortedChanges, evidenceArtefactRef: input.evidenceArtefactRef })
  return sha256Hex(Buffer.from(payload, "utf8"))
}

type CurrentLineRow = { id: string; itemCode: string | null; description: string; unit: string; qtyProject: string | null; rateProject: string | null; qtyContract: string | null; rateContract: string | null }

/** STRUCTURAL cell comparisons for one row -- itemCode/description/unit. Split out of diffOneRow purely to keep that function's cyclomatic complexity under this codebase's lint ceiling; has no independent meaning of its own. */
function diffStructuralFields(row: ParsedUploadRow, current: CurrentLineRow): UploadCellChange[] {
  const lineItemId = current.id
  const comparisons: Array<[UploadCellField, string | null, string | null]> = []
  if (row.itemCode !== undefined) {
    const after = row.itemCode.trim() === "" ? null : row.itemCode.trim()
    comparisons.push(["itemCode", current.itemCode, after])
  }
  if (row.description !== undefined && row.description !== current.description) {
    comparisons.push(["description", current.description, row.description])
  }
  if (row.unit !== undefined && row.unit !== current.unit) {
    comparisons.push(["unit", current.unit, row.unit])
  }
  return comparisons
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => ({ lineItemId, sheetRow: row.sheetRow, field, columnClass: "structural" as const, before, after }))
}

/** COST cell comparisons (qtyProject/rateProject) -- always accepted, no evidence gate ever (7-05). Same split-out-for-complexity reasoning as diffStructuralFields. */
function diffCostFields(row: ParsedUploadRow, current: CurrentLineRow): UploadCellChange[] {
  const lineItemId = current.id
  const out: UploadCellChange[] = []
  for (const [field, currentRaw, afterVal] of [
    ["qtyProject", current.qtyProject, row.qtyProject] as const,
    ["rateProject", current.rateProject, row.rateProject] as const,
  ]) {
    if (afterVal === undefined) continue // column absent from file -- no change requested
    const before = currentRaw === null ? null : Number(currentRaw)
    if (before !== afterVal) out.push({ lineItemId, sheetRow: row.sheetRow, field, columnClass: "cost", before, after: afterVal })
  }
  return out
}

/**
 * Pure, per-row half of the diff -- extracted from diffUploadWithDb so the
 * classification rules (structural/cost/contract, evidence gate) are
 * independently unit-testable with no DB/mock scaffolding, and so the
 * surrounding function's own cyclomatic complexity stays within this
 * codebase's lint ceiling. Returns EITHER a rejection reason (row could not
 * be matched/read at all) OR the row's own classified changes -- never both.
 */
export function diffOneRow(
  row: ParsedUploadRow,
  current: CurrentLineRow | undefined,
  gate: { hasConfirmedBaseline: boolean; evidenceProvided: boolean }
): { rejectedReason: string | null; changes: UploadCellChange[]; pending: UploadCellChange[] } {
  if (row.malformedFields.length > 0) {
    return { rejectedReason: `Row ${row.sheetRow}: ${row.malformedFields.join(", ")} could not be read as a number.`, changes: [], pending: [] }
  }
  if (!row.lineId) {
    return {
      rejectedReason: `Row ${row.sheetRow}: no Line ID -- new lines cannot be added via Excel upload (X-19: matched by Line ID, never row position). Add new lines through the BOQ editor.`,
      changes: [],
      pending: [],
    }
  }
  if (!current) {
    return {
      rejectedReason: `Row ${row.sheetRow}: Line ID "${row.lineId}" does not match any line item in this BOQ (rows are matched by Line ID, never position -- X-19).`,
      changes: [],
      pending: [],
    }
  }

  const lineItemId = row.lineId
  const changes: UploadCellChange[] = [...diffStructuralFields(row, current), ...diffCostFields(row, current)]
  const pending: UploadCellChange[] = []

  // CONTRACT -- gated post-confirmation (7-05).
  for (const [field, currentRaw, afterVal] of [
    ["qtyContract", current.qtyContract, row.qtyContract] as const,
    ["rateContract", current.rateContract, row.rateContract] as const,
  ]) {
    if (afterVal === undefined) continue
    const before = currentRaw === null ? null : Number(currentRaw)
    if (before === afterVal) continue
    const change: UploadCellChange = { lineItemId, sheetRow: row.sheetRow, field, columnClass: "contract", before, after: afterVal }
    if (gate.hasConfirmedBaseline && !gate.evidenceProvided) pending.push(change)
    else changes.push(change)
  }

  return { rejectedReason: null, changes, pending }
}

async function diffUploadWithDb(
  db: TenantDb,
  orgId: string,
  boqId: string,
  parsedRows: ParsedUploadRow[],
  contentHash: string,
  options: DiffUploadOptions
): Promise<UploadDiffResult> {
  const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, orgId)) })
  if (!boq) throw new ServiceError("BOQ not found", 404)

  const currentLines = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, boqId) })
  const byId = new Map(currentLines.map((l) => [l.id, l]))

  // 7-05's evidence gate reads "has this BOQ ever been confirmed" from
  // boq-baseline-service.ts (X-27 applies to this fact exactly as it does to
  // money math) -- via the *WithDb sibling so this stays inside the ONE
  // transaction this function already holds, never a second nested one.
  const baselines = await listBaselineVersionsWithDb(db, boqId)
  const gate = {
    hasConfirmedBaseline: baselines.length > 0,
    evidenceProvided: typeof options.evidenceArtefactRef === "string" && options.evidenceArtefactRef.trim().length > 0,
  }

  const changes: UploadCellChange[] = []
  const contractChangesPendingEvidence: UploadCellChange[] = []
  const rejectedRows: RejectedUploadRow[] = []
  const matchedLineIds = new Set<string>()
  let computedIgnored = 0

  for (const row of parsedRows) {
    computedIgnored += row.derivedColumnsWithValues
    const result = diffOneRow(row, byId.get(row.lineId ?? ""), gate)
    if (result.rejectedReason) {
      rejectedRows.push({ sheetRow: row.sheetRow, lineId: row.lineId, reason: result.rejectedReason })
      continue
    }
    matchedLineIds.add(row.lineId!)
    changes.push(...result.changes)
    contractChangesPendingEvidence.push(...result.pending)
  }

  const linesNotInUpload = currentLines.filter((l) => !matchedLineIds.has(l.id)).map((l) => l.id)

  const countsByColumnClass: UploadDiffCounts = {
    structural: changes.filter((c) => c.columnClass === "structural").length,
    cost: changes.filter((c) => c.columnClass === "cost").length,
    contract: changes.filter((c) => c.columnClass === "contract").length,
    computedIgnored,
  }

  const contractChangeAttempted = countsByColumnClass.contract > 0 || contractChangesPendingEvidence.length > 0
  const evidenceRequired = gate.hasConfirmedBaseline && contractChangeAttempted
  const evidenceSatisfied = !evidenceRequired || gate.evidenceProvided

  const confirmedDiffToken = computeDiffToken({
    contentHash,
    changes,
    evidenceArtefactRef: gate.evidenceProvided ? options.evidenceArtefactRef!.trim() : null,
  })

  return {
    contentHash,
    totalDataRows: parsedRows.length,
    matchedRows: matchedLineIds.size,
    changes,
    countsByColumnClass,
    rejectedRows,
    hasStructuralChanges: countsByColumnClass.structural > 0,
    contractChangesPendingEvidence,
    evidenceRequired,
    evidenceSatisfied,
    linesNotInUpload,
    confirmedDiffToken,
  }
}

export async function diffUpload(
  ctx: RoundtripReadContext,
  boqId: string,
  parsedRows: ParsedUploadRow[],
  options: DiffUploadOptions
): Promise<UploadDiffResult> {
  return withTenantContext({ orgId: ctx.orgId }, (db) => diffUploadWithDb(db, ctx.orgId, boqId, parsedRows, options.contentHash, options))
}

/**
 * 6-01/6-03a-style redaction for THIS file's own response shape --
 * cost-visibility-service.ts's redactProjectSideFields cannot see these cost
 * figures because they are carried as VALUES of a generic `{field, before,
 * after}` change record, not as object KEYS named "qtyProject"/"rateProject"
 * (which is what that generic key-name-based redactor matches on). Contract
 * changes and counts are always visible (counts alone reveal no figure);
 * only per-cell COST changes (the actual rateProject/qtyProject numbers) are
 * stripped for a caller without cost visibility. Does NOT affect what
 * actually gets applied -- diffUpload/applyUpload always operate on the
 * real, unredacted data; this is a response-shaping step a route calls,
 * exactly like applyCostVisibility is for every other BOQ read route.
 */
export function redactUploadDiffForCostVisibility<T extends { changes: UploadCellChange[] }>(diff: T, canSeeCost: boolean): T {
  if (canSeeCost) return diff
  return { ...diff, changes: diff.changes.filter((c) => c.columnClass !== "cost") }
}

// ─────────────────────────────────────────────────────────────────────────
// APPLY (7-07: one transaction or none).
// ─────────────────────────────────────────────────────────────────────────

export type ApplyUploadOptions = { evidenceArtefactRef?: string; confirmedDiffToken: string; contentHash: string }

export type ApplyUploadResult = {
  applied: boolean
  changesApplied: number
  revisionCreated: { id: string; version: number } | null
  rejectedRows: RejectedUploadRow[]
  contractChangesPendingEvidence: UploadCellChange[]
  linesNotInUpload: string[]
  contentHash: string
}

function groupChangesByLine(changes: UploadCellChange[]): Map<string, UploadCellChange[]> {
  const byLine = new Map<string, UploadCellChange[]>()
  for (const c of changes) {
    const list = byLine.get(c.lineItemId) ?? []
    list.push(c)
    byLine.set(c.lineItemId, list)
  }
  return byLine
}

/**
 * Non-structural apply path: an in-place UPDATE of qtyProject/rateProject/
 * qtyContract/rateContract on the existing rows. ONE withTenantContext
 * transaction for the whole batch (X-21) -- every targeted row's CURRENT
 * value is re-read and compared against the diff's recorded "before" value
 * FIRST, inside this same transaction; any mismatch throws before any
 * `update` statement runs, so a stale diff can never partially clobber a
 * BOQ someone else has since edited.
 */
async function applyInPlaceCellEdits(ctx: RoundtripWriteContext, boqId: string, changes: UploadCellChange[]): Promise<void> {
  const byLine = groupChangesByLine(changes)
  const ids = [...byLine.keys()]

  await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq) throw new ServiceError("BOQ not found", 404)

    const rows = await db.query.constructionBoqLineItems.findMany({ where: inArray(constructionBoqLineItems.id, ids) })
    const rowById = new Map(rows.map((r) => [r.id, r]))

    for (const [lineItemId, cellChanges] of byLine) {
      const row = rowById.get(lineItemId)
      if (!row) throw new ServiceError(`Line item ${lineItemId} no longer exists -- the BOQ changed since this diff was computed. Re-run diff and try again. Nothing was applied.`, 409)
      for (const c of cellChanges) {
        const currentValue = row[c.field as "qtyProject" | "rateProject" | "qtyContract" | "rateContract"] as string | null
        const currentNormalized = currentValue === null ? null : Number(currentValue)
        if (currentNormalized !== c.before) {
          throw new ServiceError(
            `Line item ${lineItemId}'s ${c.field} changed since this diff was computed (was ${c.before}, is now ${currentNormalized}). Re-run diff and try again -- nothing was applied.`,
            409
          )
        }
      }
    }

    type CellUpdateSet = Partial<Record<"qtyProject" | "rateProject" | "qtyContract" | "rateContract", string | null>>
    for (const [lineItemId, cellChanges] of byLine) {
      const set: CellUpdateSet = {}
      for (const c of cellChanges) {
        const field = c.field as keyof CellUpdateSet
        set[field] = c.after === null ? null : String(c.after)
      }
      await db.update(constructionBoqLineItems).set(set).where(eq(constructionBoqLineItems.id, lineItemId))
    }

    return boq.projectId
  }).then((projectId) => bustProjectDashboardCache(ctx.orgId, projectId))
}

/**
 * Structural apply path: routes through construction-boq-service.ts's
 * createBoqRevision (7-05: "a REVISION, not an edit") rather than an
 * in-place edit. Deliberately TWO sequential top-level calls (getBoq, then
 * createBoqRevision), never one nested inside the other -- see this file's
 * own module header for why. The optimistic-concurrency re-check happens
 * here, against the FRESH getBoq() read, before createBoqRevision is ever
 * called -- a mismatch means NOTHING is written (createBoqRevision itself is
 * never reached).
 */
async function applyStructuralRevision(
  ctx: RoundtripWriteContext,
  boqId: string,
  changes: UploadCellChange[]
): Promise<{ id: string; version: number }> {
  const boq = await getBoq({ orgId: ctx.orgId }, boqId)
  const byLine = groupChangesByLine(changes)

  for (const [lineItemId, cellChanges] of byLine) {
    const current = (boq.lineItems as Array<Record<string, unknown>>).find((l) => l.id === lineItemId)
    if (!current) throw new ServiceError(`Line item ${lineItemId} no longer exists -- the BOQ changed since this diff was computed. Re-run diff and try again. Nothing was applied.`, 409)
    for (const c of cellChanges) {
      const currentValue = current[c.field]
      const isStructural = c.columnClass === "structural"
      const currentNormalized = isStructural
        ? currentValue === null || currentValue === undefined
          ? null
          : String(currentValue)
        : currentValue === null || currentValue === undefined
          ? null
          : Number(currentValue as string)
      if (currentNormalized !== c.before) {
        throw new ServiceError(`Line item ${lineItemId}'s ${c.field} changed since this diff was computed. Re-run diff and try again -- nothing was applied.`, 409)
      }
    }
  }

  const itemCodeById = new Map((boq.lineItems as BoqLineItemRow[]).filter((l) => l.itemCode).map((l) => [l.id, l.itemCode!]))
  const lineItems: BoqLineItemInput[] = (boq.lineItems as BoqLineItemRow[]).map((row) => {
    const base = toLineItemInput(row, itemCodeById)
    const cellChanges = byLine.get(row.id)
    if (!cellChanges) return base
    const overlay: Partial<BoqLineItemInput> = {}
    for (const c of cellChanges) {
      if (c.field === "itemCode") overlay.itemCode = c.after === null ? undefined : String(c.after)
      else if (c.field === "description") overlay.description = String(c.after)
      else if (c.field === "unit") overlay.unit = String(c.after)
      else if (c.field === "qtyProject") overlay.qtyProject = c.after === null ? undefined : Number(c.after)
      else if (c.field === "rateProject") overlay.rateProject = c.after === null ? undefined : Number(c.after)
      else if (c.field === "qtyContract") overlay.qtyContract = c.after === null ? undefined : Number(c.after)
      else if (c.field === "rateContract") overlay.rateContract = c.after === null ? undefined : Number(c.after)
    }
    return { ...base, ...overlay }
  })

  const revision = await createBoqRevision(ctx, boqId, { lineItems })
  return { id: revision.id, version: revision.version }
}

/**
 * The one write entry point. Re-diffs the SAME parsed rows fresh (via
 * diffUpload, its own transaction) and requires the result's
 * confirmedDiffToken to match the caller-supplied one EXACTLY -- this is
 * what makes 7-06's "diff shown before apply" a real guarantee rather than a
 * UI convention: a token mismatch (the BOQ changed, or the caller is trying
 * to apply a diff they never actually reviewed) is refused outright, before
 * anything is written.
 */
export async function applyUpload(
  ctx: RoundtripWriteContext,
  boqId: string,
  parsedRows: ParsedUploadRow[],
  options: ApplyUploadOptions
): Promise<ApplyUploadResult> {
  const diff = await diffUpload(ctx, boqId, parsedRows, { evidenceArtefactRef: options.evidenceArtefactRef, contentHash: options.contentHash })

  if (diff.confirmedDiffToken !== options.confirmedDiffToken) {
    throw new ServiceError(
      "This diff no longer matches the current BOQ state -- it may have changed since you last previewed it, or confirmedDiffToken does not match this exact file/evidence combination. Re-run the diff preview and confirm again before applying. Nothing was applied.",
      409
    )
  }

  const shared = {
    rejectedRows: diff.rejectedRows,
    contractChangesPendingEvidence: diff.contractChangesPendingEvidence,
    linesNotInUpload: diff.linesNotInUpload,
    contentHash: options.contentHash,
  }

  if (diff.changes.length === 0) {
    return { applied: false, changesApplied: 0, revisionCreated: null, ...shared }
  }

  if (diff.hasStructuralChanges) {
    const revision = await applyStructuralRevision(ctx, boqId, diff.changes)
    return { applied: true, changesApplied: diff.changes.length, revisionCreated: revision, ...shared }
  }

  await applyInPlaceCellEdits(ctx, boqId, diff.changes)
  return { applied: true, changesApplied: diff.changes.length, revisionCreated: null, ...shared }
}
