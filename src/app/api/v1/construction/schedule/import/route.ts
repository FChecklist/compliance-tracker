import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { importScheduleFromExcel, ServiceError } from "@/lib/services/construction-schedule-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId || !ctx.dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const projectId = formData.get("projectId") as string | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await importScheduleFromExcel({ orgId: ctx.orgId, userId: ctx.dbUser.id }, { projectId, buffer, fileName: file.name })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction schedule import error:", error)
    return NextResponse.json({ error: "Failed to import schedule" }, { status: 500 })
  }
}
