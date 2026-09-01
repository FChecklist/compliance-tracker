import { NextResponse } from "next/server"
import { requireAuth, hasRole } from "@/lib/supabase/auth-guard"
import { getProjectDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { projectId } = await params
    const dashboard = await getProjectDashboard({ orgId }, projectId)
    // R48 gap-closure (2026-08-30, F059: "MEMBER cannot see budget or
    // margin"). getProjectDashboard() returns every financial figure
    // unconditionally -- there was no role gate anywhere in this route, so
    // a site-engineer-ranked ("member") account received the same budget/
    // revenue/expenses/value figures as a manager, just not rendered by the
    // UI (a client-side-only hide, not a real server-side control). Real
    // fix, matching this file's own hasRole()/ROLE_RANK convention: redact
    // the financial fields to null server-side for anyone below "manager"
    // rank, rather than gating the whole route -- a site engineer still
    // needs progressPercent/delayedTaskCount/photoCount/taskCount.
    if (!hasRole(dbUser, "manager")) {
      return NextResponse.json({
        ...dashboard,
        budget: null, revenue: null, expenses: null,
        projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
      })
    }
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction project dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch project dashboard" }, { status: 500 })
  }
}
