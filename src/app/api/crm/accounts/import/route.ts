/**
 * POST /api/crm/accounts/import -- Data Import/Export Template Fidelity
 * gap-closure. Accepts multipart/form-data: `file` (xlsx/xls/csv). Reuses
 * the existing generic spreadsheet parser (src/lib/ingest/parser.ts#
 * parseFile, the same one construction-boq-import-service.ts's
 * parseBoqSpreadsheet already wraps) rather than hand-rolling a second
 * CSV/XLSX tokenizer, then crm-accounts-service.ts's own header-aliasing +
 * row-level partial-success import.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { parseFile } from "@/lib/ingest/parser"
import { mapAccountImportRows, importAccountsFromRows, ServiceError } from "@/lib/services/crm-accounts-service"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 5 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseFile(buffer, file.name, file.type)
    if (!parsed.rows.length) return NextResponse.json({ error: "No usable rows found in this file" }, { status: 400 })

    const importRows = mapAccountImportRows(parsed.headers, parsed.rows)
    const result = await importAccountsFromRows({ orgId, userId: dbUser.id, dbUser }, importRows)
    return NextResponse.json(result, { status: result.created.length ? 201 : 200 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM accounts import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import accounts" }, { status: 500 })
  }
}
