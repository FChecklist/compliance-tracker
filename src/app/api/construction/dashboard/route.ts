import { NextRequest, NextResponse } from "next/server"
import { requireAuth, hasRole } from "@/lib/supabase/auth-guard"
import { getOrgDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"

export async function GET(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ totalProjects: 0, totalBudget: null, totalLedgerBudget: 0, totalRevenue: 0, totalExpenses: 0, projects: [] })

  try {
    const summary = await getOrgDashboard({ orgId }, {
      departmentId: request.nextUrl.searchParams.get("departmentId") ?? undefined,
    })
    // R48 gap-closure (2026-08-30, F059) -- see the sibling [projectId]
    // route's comment for the full reasoning. Same redaction, applied to
    // the org-wide summary's totals and per-project figures.
    if (!hasRole(dbUser, "manager")) {
      return NextResponse.json({
        ...summary,
        // R67 E-06: totalLedgerBudget and the per-project budget are financial
        // figures too -- redacted alongside the one they were split out of.
        totalBudget: null, totalLedgerBudget: null, totalRevenue: null, totalExpenses: null,
        financialsRedacted: true,
        projects: summary.projects.map((p) => ({ ...p, revenue: null, expenses: null, earnedValue: null, percentByValue: null, budget: null })),
      })
    }
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction org dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 })
  }
}
