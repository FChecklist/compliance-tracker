import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateFieldServiceDispatch, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ dispatchId: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

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
