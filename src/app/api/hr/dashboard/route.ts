import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getHrDashboardKpis } from "@/lib/services/hr-dashboard-service"
import { logger, getCorrelationId } from "@/lib/logger"

// V2-17 HR dashboard KPIs (cached -- see hr-dashboard-service.ts's own
// header for the caching rationale/precedent). Any authenticated org member
// can read these (same read-access posture as GET /api/hr/employees --
// headcount/pending-counts are not sensitive per-person data).
export async function GET(request: Request) {
  const correlationId = getCorrelationId(request)
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const kpis = await getHrDashboardKpis(orgId)
    return NextResponse.json({ kpis })
  } catch (error) {
    logger.error("Failed to compute HR dashboard KPIs", error, { correlationId, orgId, route: "/api/hr/dashboard" })
    return NextResponse.json({ error: "Failed to fetch HR dashboard KPIs" }, { status: 500 })
  }
}
