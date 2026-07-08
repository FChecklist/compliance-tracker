import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getStaffUtilizationSummary } from "@/lib/services/firm-practice-dashboard-service"
import { ServiceError } from "@/lib/services/compliance-service"

export async function GET(req: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const periodStart = req.nextUrl.searchParams.get("periodStart")
    const periodEnd = req.nextUrl.searchParams.get("periodEnd")
    if (!periodStart || !periodEnd) return NextResponse.json({ error: "periodStart and periodEnd are required" }, { status: 400 })
    const summary = await getStaffUtilizationSummary({ orgId }, periodStart, periodEnd)
    return NextResponse.json({ summary })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Get staff utilization summary error:", error)
    return NextResponse.json({ error: "Failed to get utilization summary" }, { status: 500 })
  }
}
