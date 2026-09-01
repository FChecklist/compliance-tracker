import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getSalesPipelineTrend, ServiceError } from "@/lib/services/crm-service"
import { resolveViewerScope } from "../route"

// VERIDIAN Review Framework gap-closure (2026-08-07, "Sales Dashboard"
// wave): "Notification & Alert Trigger Correctness" -- week-over-week
// Awarded-value trend, same role scoping as ../route.ts's GET.
export async function GET(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const requestedOwnerId = new URL(request.url).searchParams.get("ownerId")
    const restrictToOwnerId = resolveViewerScope(dbUser, requestedOwnerId)
    const trend = await getSalesPipelineTrend({ orgId }, { restrictToOwnerId })
    return NextResponse.json(trend)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM sales pipeline trend error:", error)
    return NextResponse.json({ error: "Failed to fetch sales pipeline trend" }, { status: 500 })
  }
}
