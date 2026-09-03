// R67 D-31 (R-090): the trade-wise attendance summary, where the work happens.
//
// The numbers already existed -- attendanceReport() and manpowerCostReport()
// have been in construction-reports-service.ts since Wave 122 -- but the only
// way to reach them was the report catalogue, which PROJEXA renders as a
// read-only "Not yet viewable here" card. This endpoint composes those two
// aggregates (no new SQL grouping) so the Manpower screen can show them.
//
// A read: requireAuthOrApiKey only, matching the report dispatcher's own
// posture for operational site data.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { attendanceSummary, ServiceError } from "@/lib/services/construction-reports-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  // Both optional: omitting them is the all-time reading, exactly what the
  // underlying aggregates already answered before this route existed.
  const from = request.nextUrl.searchParams.get("from") ?? undefined
  const to = request.nextUrl.searchParams.get("to") ?? undefined

  try {
    const summary = await attendanceSummary({ orgId: ctx.orgId }, projectId, from, to)
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa attendance summary error:", error)
    return NextResponse.json({ error: "Failed to build the attendance summary" }, { status: 500 })
  }
}
