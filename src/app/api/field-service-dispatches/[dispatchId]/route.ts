import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateFieldServiceDispatch, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ dispatchId: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G5 misc gap-closure, 2026-09-05): this had NO role
  // gate at all -- matches /api/tickets/[id]/route.ts's own PATCH floor
  // ("team_member"), the ticket this dispatch belongs to. A field-service
  // dispatch is a ticket sub-resource of the same operational granularity
  // (status/notes), so it sits at the same bar as updating the ticket
  // itself, not a lower one.
  const roleCheck = requireRole(dbUser, "team_member")
  if (roleCheck) return roleCheck

  try {
    const { dispatchId } = await params
    const body = await request.json()
    const dispatch = await updateFieldServiceDispatch({ orgId, userId: dbUser.id }, dispatchId, { status: body.status, notes: body.notes })
    return NextResponse.json(dispatch)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Dispatch update error:", error)
    return NextResponse.json({ error: "Failed to update dispatch" }, { status: 500 })
  }
}
