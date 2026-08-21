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
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { parseBoqSpreadsheet, ServiceError } from "@/lib/services/construction-boq-import-service"
import { createBoq, createBoqRevision } from "@/lib/services/construction-boq-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

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
    const parentBoqId = formData.get("parentBoqId") ? String(formData.get("parentBoqId")) : null
    const title = formData.get("title") ? String(formData.get("title")) : file.name.replace(/\.[^.]+$/, "")

    const buffer = Buffer.from(await file.arrayBuffer())
    const { lineItems, warnings, totalRows } = await parseBoqSpreadsheet(buffer, file.name, file.type)
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

    return NextResponse.json({ boq, importSummary: { totalRows, importedLineItems: lineItems.length, warnings } }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa scope import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import BOQ spreadsheet" }, { status: 500 })
  }
}
