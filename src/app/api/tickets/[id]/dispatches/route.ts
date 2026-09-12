import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listFieldServiceDispatches, createFieldServiceDispatch, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ dispatches: [] })

  try {
    const { id } = await params
    const dispatches = await listFieldServiceDispatches({ orgId }, id)
    return NextResponse.json({ dispatches })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Dispatch list error:", error)
    return NextResponse.json({ error: "Failed to fetch dispatches" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Matches
  // /api/tickets/[id]'s own PATCH floor ("team_member") and PATCH
  // /api/field-service-dispatches/[dispatchId]'s already-established "team_member"
  // gate on this exact sub-resource -- creating a dispatch is the same
  // operational granularity as updating one or updating the ticket itself.
  const roleCheck = requireRole(dbUser, "team_member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const dispatch = await createFieldServiceDispatch({ orgId, userId: dbUser.id }, id, {
      technicianUserId: body.technicianUserId, scheduledAt: body.scheduledAt, addressText: body.addressText, notes: body.notes,
    })
    return NextResponse.json(dispatch, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Dispatch create error:", error)
    return NextResponse.json({ error: "Failed to create dispatch" }, { status: 500 })
  }
}
