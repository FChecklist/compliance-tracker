import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listTicketIntelligenceItems, analyzeTicket, ServiceError } from "@/lib/services/ticket-intelligence-service"

type RouteContext = { params: Promise<{ id: string }> }

// Lists this ticket's past intelligence analysis runs.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [] })

  try {
    const { id } = await params
    const items = await listTicketIntelligenceItems({ orgId }, id)
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket intelligence list error:", error)
    return NextResponse.json({ error: "Failed to fetch ticket intelligence items" }, { status: 500 })
  }
}

// Triggers a new detection run against this ticket's real conversation
// content -- unlike email-intelligence's POST /api/email-intelligence
// (which submits raw content because no email entity exists yet), the
// ticket already exists, so this route only needs the ticket id.
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await analyzeTicket({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket intelligence analyze error:", error)
    return NextResponse.json({ error: "Failed to analyze ticket" }, { status: 500 })
  }
}
