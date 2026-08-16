import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getTicketIntelligenceItem, ServiceError } from "@/lib/services/ticket-intelligence-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const item = await getTicketIntelligenceItem({ orgId }, id)
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket intelligence get error:", error)
    return NextResponse.json({ error: "Failed to fetch ticket intelligence item" }, { status: 500 })
  }
}
