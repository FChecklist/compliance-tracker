// R67 D-34 (R-091): bulk roster load from a spreadsheet.
//
// Same shape as the BOQ importer this is modelled on
// (v1/projexa/scope/import/route.ts): one route that answers `?dryRun=1` with a
// parse and nothing written, and a real POST that writes. The preview MUST come
// from this parse, not from a browser-side one -- PROJEXA is not allowed an
// XLSX library, and a second parser would be a second set of rules that can
// disagree with the one that imports.
//
// A dry run creates nothing, so it is gated as a read; the real import keeps the
// write role the roster POST already requires.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { parseRosterSpreadsheet, rosterImportSummary, ServiceError, type RosterImportRow } from "@/lib/services/construction-roster-import-service"
import { createRosterEntry } from "@/lib/services/construction-labour-service"
import { listSuppliers } from "@/lib/services/erp-buying-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB, same ceiling the BOQ importer uses

/**
 * Writes the importable rows, one at a time.
 *
 * SEQUENTIALLY, not Promise.all: createRosterEntry generates the next employee
 * code from the highest one already stored, so concurrent writes would race
 * each other into the same number.
 *
 * One row that the service refuses must not lose the other 37, so a failure is
 * recorded against its sheet row and the loop continues.
 */
async function writeRosterEntries(
  orgId: string,
  projectId: string,
  entries: RosterImportRow[],
  vendorIdByName: Map<string, string>
) {
  const imported: { name: string; employeeCode: string | null }[] = []
  const failures: { row: number; message: string }[] = []
  const unmatchedCompanies = new Set<string>()

  for (const entry of entries) {
    if (entry.skipped) continue
    const vendorId = entry.company ? vendorIdByName.get(entry.company.trim().toLowerCase()) : undefined
    if (entry.company && !vendorId) unmatchedCompanies.add(entry.company)
    try {
      const row = await createRosterEntry({ orgId }, {
        projectId,
        name: entry.name,
        employeeCode: entry.employeeCode ?? undefined,
        trade: entry.trade ?? undefined,
        vendorId,
        dailyRate: entry.dailyRate,
      })
      imported.push({ name: row.name, employeeCode: row.employeeCode })
    } catch (error) {
      failures.push({ row: entry.sheetRow, message: error instanceof ServiceError ? error.message : "Could not be saved" })
    }
  }

  return { imported, failures, unmatchedCompanies: [...unmatchedCompanies] }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1"
  if (!dryRun) {
    const roleErr = requireRoleOrScope(ctx, "member", "write")
    if (roleErr) return roleErr
  }
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const orgId = ctx.orgId

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const projectId = String(formData.get("projectId") || "")
    // A dry run has nothing to attach the parse to -- the preview is about the
    // FILE -- so it does not need a project.
    if (!projectId && !dryRun) return NextResponse.json({ error: "projectId is required" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const { entries, issues, totalRows } = await parseRosterSpreadsheet(buffer, file.name, file.type)
    const summary = rosterImportSummary(entries)

    if (dryRun) {
      return NextResponse.json({ dryRun: true, rows: entries, issues, summary: { ...summary, totalRows } })
    }

    if (summary.importable === 0) {
      return NextResponse.json({ error: "No usable rows in this spreadsheet", issues }, { status: 400 })
    }

    // The sheet names a company in words; the roster stores a vendor id. Matched
    // case-insensitively against this org's own suppliers, and an unmatched name
    // is NOT an error -- a subcontractor that is not on file yet is a real,
    // common situation, and the worker still belongs on the roster.
    const suppliers = await listSuppliers({ orgId })
    const vendorIdByName = new Map(suppliers.map((s) => [s.supplierName.trim().toLowerCase(), s.id]))

    const result = await writeRosterEntries(orgId, projectId, entries, vendorIdByName)

    return NextResponse.json({
      imported: result.imported.length,
      skipped: summary.skipped,
      failures: result.failures,
      unmatchedCompanies: result.unmatchedCompanies,
      workers: result.imported,
      issues,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa labour-roster import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import the roster spreadsheet" }, { status: 500 })
  }
}
