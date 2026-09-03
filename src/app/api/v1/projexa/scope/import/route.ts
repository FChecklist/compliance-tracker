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
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { parseBoqSpreadsheet, toPreviewRows, analyseBoqPreview, ServiceError, type BoqColumnMapping } from "@/lib/services/construction-boq-import-service"
import { createBoq, createBoqRevision } from "@/lib/services/construction-boq-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

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

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const dryRun = dryRunQuery || String(formData.get("dryRun") || "") === "true"

    const projectId = String(formData.get("projectId") || "")
    // A dry run has nothing to attach the parse to, so it does not need a
    // project -- the preview is about the FILE.
    if (!projectId && !dryRun) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const parentBoqId = formData.get("parentBoqId") ? String(formData.get("parentBoqId")) : null
    const title = formData.get("title") ? String(formData.get("title")) : file.name.replace(/\.[^.]+$/, "")

    // The "Map columns" step's corrections, as {field: header}. Malformed JSON
    // is ignored rather than 400ing the whole upload -- the auto-detected
    // mapping is still a usable answer, and the preview shows what was used.
    let mappingOverride: BoqColumnMapping | undefined
    const mappingRaw = formData.get("mapping")
    if (mappingRaw) {
      try { mappingOverride = JSON.parse(String(mappingRaw)) as BoqColumnMapping } catch { mappingOverride = undefined }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { lineItems, warnings, issues, totalRows, mapping, headers } =
      await parseBoqSpreadsheet(buffer, file.name, file.type, { mappingOverride })

    // BEFORE the empty-file 400 deliberately: a preview of a file that yielded
    // nothing must still be able to SAY so, with its issues attached, rather
    // than answering an error the screen has to translate.
    if (dryRun) {
      const blocking = issues.filter((i) => i.blocking)
      // The two lanes produced two per-row verdicts: D-25's toPreviewRows says
      // what will be SAVED (the canonical child-rate derivation applied), and
      // D22's analyseBoqPreview says what a human should LOOK AT (duplicate
      // codes, a forward parent reference, a missing category). They are merged
      // onto ONE row list by index rather than returned as two, so the screen
      // cannot show a row's figures from one list and its status from another.
      const preview = analyseBoqPreview(lineItems)
      const statusByIndex = new Map(preview.rows.map((r) => [r.index, r]))
      // Capped at 50: the preview is for a human to scan, and a 2,000-line
      // BOQ's full row list is a payload nobody reads. The summary below still
      // describes the WHOLE file, so "50 of 128 rows will import" can never be
      // produced by this cap.
      const rows = toPreviewRows(lineItems).slice(0, 50).map((row, i) => ({
        ...row,
        status: statusByIndex.get(i + 1)?.status ?? "ok",
        messages: statusByIndex.get(i + 1)?.messages ?? [],
      }))
      return NextResponse.json({
        dryRun: true,
        fileName: file.name,
        // The sheet's real column names, and what each field was matched to, so
        // the "Map columns" step can offer choices instead of asking a human to
        // type one.
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
      })
    }

    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No usable line items found in this spreadsheet", warnings }, { status: 400 })
    }

    // External API-key callers have no real user id -- record the key's id
    // so createdById still shows who/what created this row, same as v1
    // construction/boq's POST.
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const boq = parentBoqId
      ? await createBoqRevision({ orgId: ctx.orgId, userId: actorId }, parentBoqId, { title, lineItems })
      : await createBoq({ orgId: ctx.orgId, userId: actorId }, { projectId, title, lineItems })

    // R67 lane D22 (item D-52): totalValue is what the import screen's receipt
    // line names ("BOQ <title> v<n> created - <lines> lines, <currency>
    // <total>"). Summed over ROOT lines only, because a weighted sub-task's
    // amount is a share of its parent's (schema.ts's canonical child-rate
    // rule) -- the same rule boqTotal() applies on the PROJEXA side, so the
    // receipt can never disagree with the BOQ page it lands on.
    const totalValue = Math.round(
      lineItems.filter((l) => !l.parentItemCode).reduce((sum, l) => sum + l.quantity * l.rate, 0) * 100
    ) / 100
    return NextResponse.json({ boq, importSummary: { totalRows, importedLineItems: lineItems.length, totalValue, warnings } }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa scope import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import BOQ spreadsheet" }, { status: 500 })
  }
}
