// Task #46 (CRM feature-parity gap analysis): thin alias over
// crm-service.ts's getAssignmentOverview -- the Total/Allocated/
// Un-Allocated + per-active-user breakdown dashboard. Read-only, so this
// follows sales-pipeline/route.ts's own precedent (no manager/write gate,
// just requireAuthOrApiKey -- any authenticated org member can view it).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getAssignmentOverview, ServiceError } from "@/lib/services/crm-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const overview = await getAssignmentOverview({ orgId: ctx.orgId }, "lead")
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leads assignment-overview error:", error)
    return NextResponse.json({ error: "Failed to fetch lead assignment overview" }, { status: 500 })
  }
}
