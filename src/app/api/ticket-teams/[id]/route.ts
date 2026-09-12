import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateTicketTeam, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Matches this same
// helpdesk admin-CRUD module's own sibling config resources, /api/sla-policies
// and /api/escalation-rules (both require "admin"), and this route's own POST
// sibling ../route.ts -- see that file's comment for why "admin" and not the
// lower "manager" business-hours-schedules uses (leadUserId's real
// auto-participant access-control side effect).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const team = await updateTicketTeam({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(team)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket team update error:", error)
    return NextResponse.json({ error: "Failed to update team" }, { status: 500 })
  }
}
