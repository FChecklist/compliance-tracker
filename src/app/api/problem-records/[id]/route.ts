import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateProblemRecord, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const problem = await updateProblemRecord({ orgId, userId: dbUser.id }, id, { status: body.status, rootCause: body.rootCause })
    return NextResponse.json(problem)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Problem record update error:", error)
    return NextResponse.json({ error: "Failed to update problem record" }, { status: 500 })
  }
}
