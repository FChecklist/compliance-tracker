// R67 lane D22 (item D-68, rec R-258): POST /api/v1/projexa/labour/import.
//
// The third of the three import endpoints a construction org needs, and
// deliberately the same shape as the two shipped ones (../../scope/import and
// ../../schedule/import): Bearer-key-capable auth (PROJEXA calls this with an
// org API key, not a session cookie), requireRoleOrScope(ctx, "member",
// "write"), a 10 MB cap, and FormData in -- because PROJEXA must not gain an
// XLSX library, so the file bytes are parsed here.
//
// dryRun=true parses and answers the per-row preview WITHOUT writing anything,
// which is what makes the import screen honest: what it shows is the server's
// real reading of the file, not the client's guess at it.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  parseRosterSpreadsheet, importRosterEntries, loadKnownCompanies, ServiceError,
  type ParsedRosterRow,
} from "@/lib/services/construction-roster-import-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB, same cap as the BOQ and programme importers

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  // IF ctx.orgId is falsy THEN 400, never an empty/silent success (error E-52).
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const projectId = String(formData.get("projectId") || "")
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const dryRun = String(formData.get("dryRun") || "") === "true"
    const skipRowsWithErrors = String(formData.get("skipRowsWithErrors") || "") === "true"
    const createVendors = String(formData.get("createVendors") || "") === "true"

    // The org's vendor list is read BEFORE parsing, in its own transaction --
    // never nested inside one (programme decision D-06).
    // The screen's correctable mapping row: field -> header, with "" meaning
    // "this field has no column in this file". Unparseable JSON is ignored
    // rather than 400'd -- the automatic match is a working fallback, and
    // failing the whole upload over a malformed hint would be worse.
    let mappingOverride: Record<string, unknown> | undefined
    const mappingRaw = formData.get("mapping")
    if (typeof mappingRaw === "string" && mappingRaw) {
      try {
        const parsedMapping: unknown = JSON.parse(mappingRaw)
        if (parsedMapping && typeof parsedMapping === "object") mappingOverride = parsedMapping as Record<string, unknown>
      } catch {
        mappingOverride = undefined
      }
    }

    const knownCompanies = await loadKnownCompanies(ctx.orgId)
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseRosterSpreadsheet(buffer, file.name, file.type, knownCompanies, mappingOverride)

    const rowsWithErrors = parsed.rows.filter((r: ParsedRosterRow) => r.errors.length > 0)

    if (dryRun) {
      return NextResponse.json({
        ...parsed,
        dryRun: true,
        fileName: file.name,
        readyRows: parsed.rows.length - rowsWithErrors.length,
        errorRows: rowsWithErrors.length,
      })
    }

    // A blocking error is exactly the state the preview refuses to import on,
    // so committing past one would make the preview a lie.
    if (parsed.blockingErrors.length > 0) {
      return NextResponse.json({ error: parsed.blockingErrors[0], blockingErrors: parsed.blockingErrors }, { status: 400 })
    }

    const result = await importRosterEntries({ orgId: ctx.orgId }, {
      projectId, rows: parsed.rows, skipRowsWithErrors, createVendors,
    })

    return NextResponse.json({
      ...result,
      fileName: file.name,
      importSummary: {
        totalRows: parsed.totalRows,
        importedWorkers: result.createdRosterIds.length,
        skippedRows: result.skippedRows,
        createdVendors: result.createdVendorNames,
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa labour import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import roster spreadsheet" }, { status: 500 })
  }
}
