// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's getGrcDashboard -- a rollup view (risk
// heatmap by likelihood x impact, risk counts by category/severity, open
// audit findings + overdue remediation count, policy status counts, vendor
// risk tier counts). Pure composition of the list functions this same
// service already exposes -- no new aggregation beyond simple counting.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getGrcDashboard, ServiceError } from "@/lib/services/risk-register-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const dashboard = await getGrcDashboard({ orgId: ctx.orgId })
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa grc-dashboard error:", error)
    return NextResponse.json({ error: "Failed to generate GRC dashboard" }, { status: 500 })
  }
}
