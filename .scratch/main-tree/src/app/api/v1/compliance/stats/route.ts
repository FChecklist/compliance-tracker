import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getComplianceStats } from "@/lib/services/compliance-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) {
    return NextResponse.json({
      total: 0, overdue: 0, dueThisWeek: 0, completed: 0, dueIn30Days: 0, safe: 0, noticeCount: 0,
      byDepartment: [], upcomingDeadlines: [], recentActivity: [],
    })
  }
  try {
    const result = await getComplianceStats({ orgId: ctx.orgId })
    return NextResponse.json(result)
  } catch (error) {
    console.error("v1 compliance stats error:", error)
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
