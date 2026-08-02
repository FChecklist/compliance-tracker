// Task #46 (CRM feature-parity gap analysis): opportunity-side twin of
// leads/assignment-overview/route.ts -- same rationale, same read-only
// (no manager/write gate) precedent as sales-pipeline/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getAssignmentOverview, ServiceError } from "@/lib/services/crm-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const overview = await getAssignmentOverview({ orgId: ctx.orgId }, "opportunity")
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa opportunities assignment-overview error:", error)
    return NextResponse.json({ error: "Failed to fetch opportunity assignment overview" }, { status: 500 })
  }
}
