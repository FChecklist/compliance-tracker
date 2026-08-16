import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listTickets, createTicket, ServiceError } from "@/lib/services/ticket-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ tickets: [] })

  try {
    const status = request.nextUrl.searchParams.get("status") || undefined
    const tickets = await listTickets({ orgId }, { status })
    return NextResponse.json({ tickets })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Tickets list error:", error)
    return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const ticket = await createTicket({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(ticket, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket create error:", error)
    return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 })
  }
}
