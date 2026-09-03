import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  listAttendance,
  recordAttendance,
  recordAttendanceBatch,
  ServiceError,
} from "@/lib/services/construction-labour-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

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
    // R67 WS-C (C-08): TWO BODIES, ONE ROUTE. A body carrying `entries` marks
    // a whole crew in ONE transaction; every existing single-row caller
    // (AttendanceCreateClient's form, and any integration already pointed
    // here) keeps working untouched, because the branch is on the presence of
    // the new field and nothing about the old shape moved.
    if (Array.isArray((body as { entries?: unknown })?.entries)) {
      const result = await recordAttendanceBatch({ orgId: ctx.orgId }, body)
      return NextResponse.json(result, { status: 201 })
    }
    const result = await recordAttendance({ orgId: ctx.orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) {
      // The CODE travels with the refusal, so the client can tell "already
      // saved -- replace it?" apart from every other 409 without matching on
      // the wording of a sentence.
      return NextResponse.json(
        error.code ? { error: error.message, code: error.code } : { error: error.message },
        { status: error.status }
      )
    }
    console.error("v1 construction attendance record error:", error)
    return NextResponse.json({ error: "Failed to record attendance" }, { status: 500 })
  }
}
