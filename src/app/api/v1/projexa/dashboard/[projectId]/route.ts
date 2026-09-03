import { NextResponse } from "next/server"
import { requireAuthOrApiKey, hasRole } from "@/lib/supabase/auth-guard"
import { getProjectDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { projectId } = await params
    const dashboard = await getProjectDashboard({ orgId: ctx.orgId }, projectId)
    // R48 gap-closure (2026-08-30, F059) -- see the sibling org-level
    // route's comment for the full reasoning.
    if (ctx.dbUser && !hasRole(ctx.dbUser, "manager")) {
      return NextResponse.json({
        ...dashboard,
        budget: null, revenue: null, expenses: null,
        projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
        // R67 E-39: progressByBoqValuePct is the SAME number as percentByValue
        // under the name the UI uses. Redacting one and not the other would
        // have handed a non-manager the earned-value percentage through the
        // new field on the very same response -- exactly the F059 failure mode
        // this list exists to prevent. progressByActivityLogPct is NOT redacted,
        // for the same reason progressPercent beside it never was: it is a
        // completion percentage off the activity log, not a money figure.
        progressByBoqValuePct: null,
      })
    }
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch project dashboard" }, { status: 500 })
  }
}
