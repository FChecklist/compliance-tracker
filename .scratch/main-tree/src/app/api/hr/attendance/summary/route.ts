import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getMonthlySummaries, ServiceError } from "@/lib/services/hr-attendance-service"
import { resolveAttendanceViewerScope } from "@/lib/services/hr-attendance-access"

// Access control: same fix as GET /api/hr/attendance -- this route
// previously had no role check at all, so any authenticated org member
// could read any other named employee's (or the whole org's) monthly
// attendance summary. See hr-attendance-access.ts for the full rationale.
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ summaries: [] })

  try {
    const params = request.nextUrl.searchParams
    const now = new Date()
    const month = Number(params.get("month")) || now.getUTCMonth() + 1
    const year = Number(params.get("year")) || now.getUTCFullYear()
    const scopedUserId = resolveAttendanceViewerScope(dbUser, params.get("userId") || undefined)
    const summaries = await getMonthlySummaries({ orgId }, {
      month, year,
      userId: scopedUserId,
      departmentId: params.get("departmentId") || undefined,
      companyId: params.get("companyId") || undefined,
    })
    return NextResponse.json({ summaries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Attendance summary error:", error)
    return NextResponse.json({ error: "Failed to compute attendance summary" }, { status: 500 })
  }
}
