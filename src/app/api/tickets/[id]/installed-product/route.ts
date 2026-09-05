import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { setTicketInstalledProduct, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Matches
// /api/tickets/[id]'s own PATCH floor ("team_member") -- this sets a plain
// field on the same ticket record (which unit it's about), the same
// operational granularity as updating status/priority/assignee there.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "team_member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const ticket = await setTicketInstalledProduct({ orgId, userId: dbUser.id }, id, body.installedProductId ?? null)
    return NextResponse.json(ticket)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket installed-product link error:", error)
    return NextResponse.json({ error: "Failed to link installed product" }, { status: 500 })
  }
}
