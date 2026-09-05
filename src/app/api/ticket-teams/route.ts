import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listTicketTeams, createTicketTeam, ServiceError } from "@/lib/services/ticket-service"

// Helpdesk gap-closure (tiered SLA + team routing, Phase 0 2026-07-27):
// admin CRUD for the routing target a ticket's teamId/SLA policy match
// against. See ticket-service.ts's createTicket/resolveSlaPolicy.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ teams: [] })

  try {
    const teams = await listTicketTeams({ orgId })
    return NextResponse.json({ teams })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket teams list error:", error)
    return NextResponse.json({ error: "Failed to fetch teams" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Matches this same
  // helpdesk admin-CRUD module's own sibling config resources, /api/sla-policies
  // and /api/escalation-rules (both require "admin") -- ticketTeams.leadUserId
  // is auto-added as a conversation participant on every ticket routed to the
  // team (createTicket, ticket-service.ts), so an unprivileged caller able to
  // set an arbitrary team lead could grant that person conversation access to
  // every ticket the team receives. That's a real access-control side effect
  // /api/business-hours-schedules (gated at the lower "manager") doesn't carry,
  // so this sits at the "admin" tier, not the lower one.
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const team = await createTicketTeam({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(team, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket team create error:", error)
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 })
  }
}
