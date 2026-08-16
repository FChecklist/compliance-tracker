import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
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
