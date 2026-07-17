import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { getRoster, getCourseCompletionSummaries, ServiceError, type ProgressStatus } from "@/lib/services/training-service"

// Manager-facing roster/completion dashboard -- "who has/hasn't completed
// what", org-wide and per-course. Matches hr-attendance-service.ts's
// getMonthlySummaries shape (a manager-gated rollup a dashboard table
// renders directly) -- see hr/attendance/page.tsx's Summary tab convention.
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ roster: [], summaries: [] })

  try {
    const params = request.nextUrl.searchParams
    const [roster, summaries] = await Promise.all([
      getRoster({ orgId }, {
        courseId: params.get("courseId") || undefined,
        departmentId: params.get("departmentId") || undefined,
        status: (params.get("status") as ProgressStatus) || undefined,
      }),
      getCourseCompletionSummaries({ orgId }),
    ])
    return NextResponse.json({ roster, summaries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch training dashboard" }, { status: 500 })
  }
}
