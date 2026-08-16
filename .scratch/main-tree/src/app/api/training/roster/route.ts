import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { getCourseRoster, getOrgRosterSummary, ServiceError } from "@/lib/services/training-service"

// Trainer/manager roster dashboard: ?courseId=X returns the per-employee
// roster for that one course; no courseId returns the org-wide per-course
// completion summary. Matches hr-attendance-service.ts's own
// summary-vs-detail split (getMonthlySummaries vs listAttendance).
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const courseId = request.nextUrl.searchParams.get("courseId")
    if (courseId) {
      const roster = await getCourseRoster({ orgId }, courseId)
      return NextResponse.json({ roster })
    }
    const summary = await getOrgRosterSummary({ orgId })
    return NextResponse.json({ summary })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training roster error:", error)
    return NextResponse.json({ error: "Failed to fetch training roster" }, { status: 500 })
  }
}
