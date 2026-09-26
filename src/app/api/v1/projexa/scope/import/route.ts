// RUN R10-21AUG point 2: exposes the existing BOQ-import pipeline
// (src/app/api/construction/boq/import/route.ts, unmodified -- see rollback
// note below) on the external /api/v1/projexa/* surface, so PROJEXA's
// Bearer-key callVeridianUpload() can reach it.
//
// NOT a bare `export { POST } from "@/app/api/construction/boq/import/route"`
// re-export, unlike src/app/api/v1/projexa/scope/route.ts's GET/POST. The
// existing import route uses session-cookie-only auth -- a plain
// re-export would 401 every PROJEXA call, which authenticates with a Bearer
// API key instead. This route duplicates that handler's body with
// requireAuthOrApiKey() + requireRoleOrScope() and derives actorId as
// ctx.dbUser?.id ?? ctx.apiKey!.id, exactly as src/app/api/v1/construction/
// boq/route.ts's POST already does for the non-import BOQ create endpoint.
//
// R67 D-25 x R67 lane D22 (items D-52/D-60): the DRY RUN, written by two lanes
// and merged into one. Both reached the same conclusion for the same reason --
// parseBoqSpreadsheet() was ALREADY a pure parse with no write of its own, so
// the preview a three-step import screen needs is this route returning after
// the parse, never a second parsing path in the browser (PROJEXA is not
// allowed an XLSX library, and a second parser is a second set of rules that
// can disagree with the one that imports). The preview the user approves is
// therefore, by construction, the same reading that gets committed.
//
// A dry run is a READ -- it needs no write role and creates nothing. The role
// gate reads the `?dryRun=1` QUERY parameter, because it has to be answered
// before the body is consumed; the `dryRun=true` FORM field lane D22's screen
// sends is honoured too, for the response shape only. A caller that sends only
// the form field has therefore already passed the write-role gate, which is
// stricter than it needs to be but never weaker.
//
// PROJEXA-BUILD-002 WP-01 (AW-103): a workbook spread over many sheets (a cover, a summary, one sheet per bill, the way a
// PDF-table export lays out a prospect's bill of quantities) has no Description column on its first sheet, so
// parseBoqSpreadsheet() refuses it with "Could not find a Description column". readUpload() below catches EXACTLY that refusal for
// an Excel file and reads the workbook with the deterministic multi-sheet reader (src/lib/ingest/multisheet-bill-reader.ts)
// instead. Nothing else changes: a file the single-sheet reader accepts never reaches the fallback, and any other error from
// it is rethrown unchanged. The fallback's dry run (?dryRun=1) returns the reader's totals, lump sums and questions and writes
// nothing; its commit is refused (400 RECONCILIATION_REQUIRED) when the lines do not add up to the totals the file prints,
// unless the caller sends acknowledgeShortfall=true.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveWriteActorId } from "@/lib/supabase/auth-guard"
import { parseBoqSpreadsheet, toPreviewRows, analyseBoqPreview, ServiceError, type BoqColumnMapping } from "@/lib/services/construction-boq-import-service"
import { createBoq, createBoqRevision } from "@/lib/services/construction-boq-service"
import { readWorkbookGrid } from "@/lib/ingest/parser"
import { hasBillSheets, readMultisheetBills, toBoqLineItems, type MultisheetBillResult } from "@/lib/ingest/multisheet-bill-reader"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

/**
 * The preview payload, assembled from ONE parse.
 *
 * Extracted rather than left inline in POST(): merging the two lanes' dry runs
 * pushed the handler's cyclomatic complexity past this repo's threshold of 20,
 * and a preview builder is a genuinely separate job from "authenticate, read
 * the upload, decide whether to write".
 */
function buildDryRunResponse(
  fileName: string,
  parsed: Awaited<ReturnType<typeof parseBoqSpreadsheet>>
) {
  const { lineItems, warnings, issues, totalRows, mapping, headers } = parsed
  const blocking = issues.filter((i) => i.blocking)
  // The two lanes produced two per-row verdicts: D-25's toPreviewRows says what
  // will be SAVED (the canonical child-rate derivation applied), and D22's
  // analyseBoqPreview says what a human should LOOK AT (duplicate codes, a
  // forward parent reference, a missing category). They are merged onto ONE row
  // list by index rather than returned as two, so the screen cannot show a row's
  // figures from one list and its status from another.
  const preview = analyseBoqPreview(lineItems)
  const statusByIndex = new Map(preview.rows.map((r) => [r.index, r]))
  // Capped at 50: the preview is for a human to scan, and a 2,000-line BOQ's
  // full row list is a payload nobody reads. The summary below still describes
  // the WHOLE file, so "50 of 128 rows will import" can never come from this cap.
  const rows = toPreviewRows(lineItems).slice(0, 50).map((row, i) => ({
    ...row,
    status: statusByIndex.get(i + 1)?.status ?? "ok",
    messages: statusByIndex.get(i + 1)?.messages ?? [],
  }))
  return {
    dryRun: true,
    fileName,
    // The sheet's real column names, and what each field was matched to, so the
    // "Map columns" step can offer choices instead of asking a human to type one.
    mapping,
    headers,
    rows,
    issues,
    warnings,
    summary: {
      totalRows,
      readyLines: lineItems.length,
      rowsWithErrors: new Set(blocking.map((i) => i.row)).size,
      willImport: preview.willImport,
      totalParsed: preview.totalParsed,
    },
  }
}

/**
 * The upload's non-file fields. Extracted for the same reason
 * buildDryRunResponse() is: reading five optional form fields is five branch
 * points, and POST() has to stay under this repo's complexity threshold.
 */
function readImportFields(formData: FormData, file: File, dryRunQuery: boolean) {
  // The "Map columns" step's corrections, as {field: header}. Malformed JSON is
  // ignored rather than 400ing the whole upload -- the auto-detected mapping is
  // still a usable answer, and the preview shows what was used.
  let mappingOverride: BoqColumnMapping | undefined
  const mappingRaw = formData.get("mapping")
  if (mappingRaw) {
    try { mappingOverride = JSON.parse(String(mappingRaw)) as BoqColumnMapping } catch { mappingOverride = undefined }
  }
  return {
    dryRun: dryRunQuery || String(formData.get("dryRun") || "") === "true",
    projectId: String(formData.get("projectId") || ""),
    parentBoqId: formData.get("parentBoqId") ? String(formData.get("parentBoqId")) : null,
    title: formData.get("title") ? String(formData.get("title")) : file.name.replace(/\.[^.]+$/, ""),
    mappingOverride,
  }
}

type ParsedBoq = Awaited<ReturnType<typeof parseBoqSpreadsheet>>

const EXCEL_EXTENSIONS = ["xlsx", "xls", "xlsm", "xlsb"]
const NO_DESCRIPTION_COLUMN = "Could not find a Description column"

/**
 * The upload read as a BOQ: one parse, from either reader. `multisheet` is set only when the fallback read the file.
 */
async function readUpload(
  buffer: Buffer,
  file: File,
  mappingOverride: BoqColumnMapping | undefined
): Promise<{ parsed: ParsedBoq; multisheet: MultisheetBillResult | null }> {
  try {
    return { parsed: await parseBoqSpreadsheet(buffer, file.name, file.type, { mappingOverride }), multisheet: null }
  } catch (error) {
    const extension = file.name.toLowerCase().split(".").pop() ?? ""
    const applies = error instanceof ServiceError && error.message.startsWith(NO_DESCRIPTION_COLUMN) && EXCEL_EXTENSIONS.includes(extension)
    if (!applies) throw error
    // The first sheet has no bill table. Read every sheet; when none has a bill header either, the original refusal stands.
    let grid: Awaited<ReturnType<typeof readWorkbookGrid>>
    try {
      grid = await readWorkbookGrid(buffer)
    } catch {
      throw error
    }
    if (!hasBillSheets(grid)) throw error
    const multisheet = readMultisheetBills(grid)
    const unpriced = multisheet.questions.filter((q) => q.kind === "no_rate" || q.kind === "packed_cell" || q.kind === "bad_quantity")
    const lineItems = toBoqLineItems(multisheet)
    return {
      multisheet,
      parsed: {
        lineItems,
        warnings: multisheet.warnings.map((w) => `${w.source.sheet} row ${w.source.row}: ${w.message}`),
        issues: [],
        mapping: {},
        headers: [],
        // Rows that held an item: the priced lines, the unpriced rows that became questions, and the lump-sum lines.
        totalRows: lineItems.length + unpriced.length,
      },
    }
  }
}

/** What the fallback adds to a response: the reader's own account of the file, so the caller sees totals, gaps and questions. */
function multisheetPayload(result: MultisheetBillResult) {
  return {
    reconciled: result.reconciled,
    totals: result.totals,
    diffs: result.diffs,
    lumpSums: result.lumpSums,
    questions: result.questions,
    sheets: result.sheets,
    projectName: result.projectName,
  }
}

/** The dry-run answer: the ordinary preview, plus the reader's own account of the file when the fallback read it. */
function dryRunBody(fileName: string, parsed: ParsedBoq, multisheet: MultisheetBillResult | null) {
  const preview = buildDryRunResponse(fileName, parsed)
  return multisheet ? { ...preview, source: "multisheet_bills", multisheet: multisheetPayload(multisheet) } : preview
}

/**
 * A workbook read by the fallback must add up to the totals it prints itself, or the caller says so on purpose
 * (acknowledgeShortfall=true). Null means the import may go ahead.
 */
function reconciliationRefusal(multisheet: MultisheetBillResult | null, formData: FormData): NextResponse | null {
  if (!multisheet || multisheet.reconciled || String(formData.get("acknowledgeShortfall") || "") === "true") return null
  return NextResponse.json(
    { error: "The lines do not add up to the totals the file prints", code: "RECONCILIATION_REQUIRED", multisheet: multisheetPayload(multisheet) },
    { status: 400 }
  )
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const dryRunQuery = request.nextUrl.searchParams.get("dryRun") === "1"
  // A dry run writes nothing, so it is gated as a read; a real import still
  // needs the write role it always did.
  if (!dryRunQuery) {
    const roleErr = requireRoleOrScope(ctx, "member", "write")
    if (roleErr) return roleErr
  }
  // IF ctx.orgId is falsy THEN 400, never an empty/silent success (error E-52).
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  // PROJEXA-E2E-001 actor-misattribution sweep: see resolveWriteActorId's own
  // header in auth-guard.ts -- createdById feeds construction-boq-service.ts's
  // approveBoq() isSelfApproval() check, same bug class as the already-fixed
  // BOQ cost-visibility gap. Resolved before the (potentially slow) file
  // parse below so a bad acting-user signal 400s early. A dry run never
  // reaches the write path this feeds, but resolving it unconditionally
  // keeps this route's control flow the same shape regardless of dryRun.
  const acting = await resolveWriteActorId(request, ctx)
  if (acting.error) return acting.error

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const { dryRun, projectId, parentBoqId, title, mappingOverride } = readImportFields(formData, file, dryRunQuery)
    // A dry run has nothing to attach the parse to, so it does not need a
    // project -- the preview is about the FILE.
    if (!projectId && !dryRun) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const { parsed, multisheet } = await readUpload(buffer, file, mappingOverride)
    const { lineItems, warnings, totalRows } = parsed

    // BEFORE the empty-file 400 deliberately: a preview of a file that yielded
    // nothing must still be able to SAY so, with its issues attached, rather
    // than answering an error the screen has to translate.
    if (dryRun) return NextResponse.json(dryRunBody(file.name, parsed, multisheet))

    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No usable line items found in this spreadsheet", warnings }, { status: 400 })
    }
    const refusal = reconciliationRefusal(multisheet, formData)
    if (refusal) return refusal

    const boq = parentBoqId
      ? await createBoqRevision({ orgId: ctx.orgId, userId: acting.actorId }, parentBoqId, { title, lineItems })
      : await createBoq({ orgId: ctx.orgId, userId: acting.actorId }, { projectId, title, lineItems })

    // R67 lane D22 (item D-52): totalValue is what the import screen's receipt
    // line names ("BOQ <title> v<n> created - <lines> lines, <currency>
    // <total>"). Summed over ROOT lines only, because a weighted sub-task's
    // amount is a share of its parent's (schema.ts's canonical child-rate
    // rule) -- the same rule boqTotal() applies on the PROJEXA side, so the
    // receipt can never disagree with the BOQ page it lands on.
    const totalValue = Math.round(
      lineItems.filter((l) => !l.parentItemCode).reduce((sum, l) => sum + l.quantity * l.rate, 0) * 100
    ) / 100
    const importSummary = { totalRows, importedLineItems: lineItems.length, totalValue, warnings }
    return NextResponse.json({ boq, importSummary: multisheet ? { ...importSummary, multisheet: multisheetPayload(multisheet) } : importSummary }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa scope import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import BOQ spreadsheet" }, { status: 500 })
  }
}
