import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateReportSchedule, deleteReportSchedule, ServiceError } from "@/lib/services/report-schedule-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G4 reports): PATCH/DELETE previously had no role check
// at all. Matches the sibling POST /api/reports/schedules gate (same
// reasoning: an org-wide, notifying report/alert definition, same posture as
// metric-alert-rules).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateReportSchedule({ orgId }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report schedule update error:", error)
    return NextResponse.json({ error: "Failed to update report schedule" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    await deleteReportSchedule({ orgId }, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report schedule delete error:", error)
    return NextResponse.json({ error: "Failed to delete report schedule" }, { status: 500 })
  }
}
