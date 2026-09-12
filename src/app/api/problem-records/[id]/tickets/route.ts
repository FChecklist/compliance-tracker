import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listTicketsForProblem, linkTicketToProblem, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ tickets: [] })

  try {
    const { id } = await params
    const linkedTickets = await listTicketsForProblem({ orgId }, id)
    return NextResponse.json({ tickets: linkedTickets })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Problem-linked tickets list error:", error)
    return NextResponse.json({ error: "Failed to fetch linked tickets" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Matches POST
  // /api/problem-records's own "member" bar (ticket-service.ts) -- linking an
  // existing ticket into a problem record's grouping is the same weight of
  // write as creating the problem record itself, not the higher "manager" bar
  // PATCH /api/problem-records/[id] uses (that one gates RCA closure/status
  // changes via checkProblemRecordClosure, a materially different concern).
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const link = await linkTicketToProblem({ orgId, userId: dbUser.id }, id, body.ticketId)
    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Problem-ticket link error:", error)
    return NextResponse.json({ error: "Failed to link ticket to problem" }, { status: 500 })
  }
}
