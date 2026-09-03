// R67 D-30 (Daily Attendance Sheet): the batch twin of ../route.ts's POST.
// One request marks the whole roster for one date inside a single
// withTenantContext transaction -- see recordAttendanceBatch()'s own header
// for why the one-row-per-call path could not be used for a 38-worker sheet.
// Same guard shape as every other construction write route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { recordAttendanceBatch, ServiceError } from "@/lib/services/construction-labour-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await recordAttendanceBatch({ orgId: ctx.orgId }, {
      projectId: body?.projectId,
      attendanceDate: body?.attendanceDate,
      rows: Array.isArray(body?.rows) ? body.rows : [],
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction attendance batch error:", error)
    return NextResponse.json({ error: "Failed to save the attendance sheet" }, { status: 500 })
  }
}
