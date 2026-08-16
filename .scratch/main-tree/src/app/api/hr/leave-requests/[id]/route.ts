import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { decideLeaveRequest, ServiceError } from "@/lib/services/hr-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
    }
    const result = await decideLeaveRequest({ orgId, userId: dbUser.id }, id, body.decision)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Leave request decision error:", error)
    return NextResponse.json({ error: "Failed to decide leave request" }, { status: 500 })
  }
}
