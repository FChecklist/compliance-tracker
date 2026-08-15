import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getClaimTimeline, ServiceError } from "@/lib/services/construction-billing-workflow-service"

// SD-007 "Sales Order Status Overview" -> "Claim Timeline" document-flow trace.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const timeline = await getClaimTimeline({ orgId }, id)
    return NextResponse.json(timeline)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Progress claim timeline error:", error)
    return NextResponse.json({ error: "Failed to fetch claim timeline" }, { status: 500 })
  }
}
