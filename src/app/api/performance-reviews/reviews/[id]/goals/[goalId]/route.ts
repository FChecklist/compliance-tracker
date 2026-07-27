import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { rateReviewGoal, ServiceError } from "@/lib/services/performance-service"

type RouteContext = { params: Promise<{ id: string; goalId: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { goalId } = await params
    const body = await request.json()
    const result = await rateReviewGoal({ orgId, userId: dbUser.id }, goalId, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review goal rate error:", error)
    return NextResponse.json({ error: "Failed to rate review goal" }, { status: 500 })
  }
}
