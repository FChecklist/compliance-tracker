// R67 lane D22 (item D-48, rec R-123): POST /api/v1/projexa/schedule/import.
//
// The programme (schedule) equivalent of the shipped BOQ importer at
// ../../scope/import/route.ts, and deliberately the same shape as it: Bearer-
// key-capable auth (requireAuthOrApiKey, because PROJEXA calls this with an
// org API key, not a session cookie), requireRoleOrScope(ctx, "member",
// "write"), a 10 MB cap, and FormData in -- because PROJEXA must not gain an
// XLSX library, so the file bytes are parsed here.
//
// dryRun=true parses and answers {activities, warnings, blockingErrors}
// WITHOUT writing anything, which is what makes the three-step import screen
// (Choose file -> Preview -> Done) honest: the preview is the server's real
// reading of the file, not the client's guess at it.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  parseScheduleSpreadsheet, importScheduleActivities, resolveOrgDateFormat, ServiceError,
} from "@/lib/services/schedule-import-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB, same cap as the BOQ importer

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

    const orgDateFormat = await resolveOrgDateFormat(ctx.orgId)
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseScheduleSpreadsheet(buffer, file.name, file.type, { orgDateFormat })

    if (dryRun) {
      return NextResponse.json({ ...parsed, fileName: file.name, dryRun: true })
    }

    // A blocking error is exactly the state the preview refuses to import on,
    // so committing past one would make the preview a lie. 400 with the same
    // list the preview already showed, never a partial import.
    if (parsed.blockingErrors.length > 0) {
      return NextResponse.json({ error: parsed.blockingErrors[0], blockingErrors: parsed.blockingErrors, warnings: parsed.warnings }, { status: 400 })
    }

    // External API-key callers have no real user id -- record the key's id so
    // createdById still shows who/what created these rows, exactly as the BOQ
    // importer's own POST does.
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await importScheduleActivities({ orgId: ctx.orgId, userId: actorId }, { projectId, activities: parsed.activities })

    return NextResponse.json({
      ...result,
      fileName: file.name,
      importSummary: {
        totalRows: parsed.totalRows,
        importedActivities: parsed.activities.length,
        milestones: parsed.milestoneCount,
        warnings: parsed.warnings,
        dateInterpretation: parsed.dateInterpretation,
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule import error:", error)
    return NextResponse.json({ error: (error as Error).message || "Failed to import programme spreadsheet" }, { status: 500 })
  }
}
