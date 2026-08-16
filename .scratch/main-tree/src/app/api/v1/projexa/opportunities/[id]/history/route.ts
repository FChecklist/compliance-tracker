// Priority 15 (Sales & CRM depth wave): stage-change ledger for one
// opportunity, thin alias over crm-service.ts's listStageHistory.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listStageHistory, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ history: [] })

  try {
    const { id } = await params
    const history = await listStageHistory({ orgId: ctx.orgId }, "opportunity", id)
    return NextResponse.json({ history })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa opportunity history error:", error)
    return NextResponse.json({ error: "Failed to fetch opportunity history" }, { status: 500 })
  }
}
