import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listStageHistory, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

// Wave 3 (2026-07-21): listStageHistory already existed (Priority 15) but
// had no route at all -- neither leads nor opportunities detail could ever
// show a real stage-change timeline before this.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [] })

  try {
    const { id } = await params
    const items = await listStageHistory({ orgId }, "lead", id)
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM lead stage history error:", error)
    return NextResponse.json({ error: "Failed to fetch stage history" }, { status: 500 })
  }
}
