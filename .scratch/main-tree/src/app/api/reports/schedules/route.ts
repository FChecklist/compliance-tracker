import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listReportSchedules, createReportSchedule, ServiceError } from "@/lib/services/report-schedule-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ schedules: [] })

  try {
    const schedules = await listReportSchedules({ orgId })
    return NextResponse.json({ schedules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report schedules list error:", error)
    return NextResponse.json({ error: "Failed to fetch report schedules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createReportSchedule({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report schedule create error:", error)
    return NextResponse.json({ error: "Failed to create report schedule" }, { status: 500 })
  }
}
