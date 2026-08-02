import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitRaterFeedback, ServiceError } from "@/lib/services/performance-service"

type RouteContext = { params: Promise<{ id: string; raterId: string }> }

// The invited rater submits their own feedback -- no manager-role gate,
// matching acknowledgeReview's own "the subject of the action, not a
// manager, calls this" posture. The service layer itself is auth-agnostic
// (see submitRaterFeedback's own comment); a rater acting on someone
// else's invitation only succeeds if they know that raterId's opaque id,
// same trust boundary this repo's other self-service actions already
// accept (e.g. checkIn/checkOut).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { raterId } = await params
    const body = await request.json()
    const result = await submitRaterFeedback({ orgId, userId: dbUser.id }, raterId, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Rater feedback submit error:", error)
    return NextResponse.json({ error: "Failed to submit rater feedback" }, { status: 500 })
  }
}
