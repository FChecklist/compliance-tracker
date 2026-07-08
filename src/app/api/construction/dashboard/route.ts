import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getOrgDashboard, ServiceError } from "@/lib/services/construction-dashboard-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ totalProjects: 0, totalBudget: 0, totalRevenue: 0, totalExpenses: 0, projects: [] })

  try {
    const summary = await getOrgDashboard({ orgId }, {
      departmentId: request.nextUrl.searchParams.get("departmentId") ?? undefined,
    })
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction org dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 })
  }
}
