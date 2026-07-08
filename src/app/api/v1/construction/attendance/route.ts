import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listAttendance, recordAttendance, ServiceError } from "@/lib/services/construction-labour-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ attendance: [] })

  try {
    const attendance = await listAttendance({ orgId: ctx.orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      rosterId: request.nextUrl.searchParams.get("rosterId") ?? undefined,
      attendanceDate: request.nextUrl.searchParams.get("attendanceDate") ?? undefined,
    })
    return NextResponse.json({ attendance })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction attendance list error:", error)
    return NextResponse.json({ error: "Failed to fetch attendance" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await recordAttendance({ orgId: ctx.orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction attendance record error:", error)
    return NextResponse.json({ error: "Failed to record attendance" }, { status: 500 })
  }
}
