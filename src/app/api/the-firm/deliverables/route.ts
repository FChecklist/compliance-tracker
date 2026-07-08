import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listUpcomingDeliverables, ServiceError } from "@/lib/services/firm-engagement-service"

export async function GET(req: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const assignedToId = req.nextUrl.searchParams.get("assignedToId") ?? undefined
    const deliverables = await listUpcomingDeliverables({ orgId }, { assignedToId })
    return NextResponse.json({ deliverables })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List deliverables error:", error)
    return NextResponse.json({ error: "Failed to list deliverables" }, { status: 500 })
  }
}
