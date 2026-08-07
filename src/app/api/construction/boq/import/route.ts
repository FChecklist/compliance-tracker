/**
 * POST /api/construction/boq/import
 * Accepts multipart/form-data: `file` (xlsx/xls/csv) + `projectId` + either
 * `title` (creates a brand-new BoQ, v1) or `parentBoqId` (creates the next
 * revision of an existing BoQ chain) -- same two entry points
 * construction-boq-service.ts already exposes via createBoq/createBoqRevision,
 * just fed from a parsed spreadsheet instead of a hand-built JSON body.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { parseBoqSpreadsheet, ServiceError } from "@/lib/services/construction-boq-import-service"
import { createBoq, createBoqRevision } from "@/lib/services/construction-boq-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const projectId = String(formData.get("projectId") || "")
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const parentBoqId = formData.get("parentBoqId") ? String(formData.get("parentBoqId")) : null
    const title = formData.get("title") ? String(formData.get("title")) : file.name.replace(/\.[^.]+$/, "")

    const buffer = Buffer.from(await file.arrayBuffer())
    const { lineItems, warnings, totalRows } = await parseBoqSpreadsheet(buffer, file.name, file.type)
    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No usable line items found in this spreadsheet", warnings }, { status: 400 })
    }

    const boq = parentBoqId
      ? await createBoqRevision({ orgId, userId: dbUser.id }, parentBoqId, { title, lineItems })
      : await createBoq({ orgId, userId: dbUser.id }, { projectId, title, lineItems })

    return NextResponse.json({ boq, importSummary: { totalRows, importedLineItems: lineItems.length, warnings } }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction BOQ import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import BOQ spreadsheet" }, { status: 500 })
  }
}
