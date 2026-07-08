import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAttendance, recordAttendance, ServiceError } from "@/lib/services/construction-labour-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ attendance: [] })

  try {
    const attendance = await listAttendance({ orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      rosterId: request.nextUrl.searchParams.get("rosterId") ?? undefined,
      attendanceDate: request.nextUrl.searchParams.get("attendanceDate") ?? undefined,
    })
    return NextResponse.json({ attendance })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction attendance list error:", error)
    return NextResponse.json({ error: "Failed to fetch attendance" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await recordAttendance({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction attendance record error:", error)
    return NextResponse.json({ error: "Failed to record attendance" }, { status: 500 })
  }
}
