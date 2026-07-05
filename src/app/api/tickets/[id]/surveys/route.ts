import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listTicketSurveys, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ surveys: [] })

  try {
    const { id } = await params
    const surveys = await listTicketSurveys({ orgId }, id)
    return NextResponse.json({ surveys })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket surveys list error:", error)
    return NextResponse.json({ error: "Failed to fetch surveys" }, { status: 500 })
  }
}
