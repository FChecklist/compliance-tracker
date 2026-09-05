import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { dismissEmailIntelligenceItem, ServiceError } from "@/lib/services/email-intelligence-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G3-email-conv): had NO gate beyond requireAuth().
// dismissEmailIntelligenceItem() and promoteEmailIntelligenceItem() (this
// route's own sibling, ../promote/route.ts) are the two mutually-exclusive
// outcomes of the SAME human review decision on a proposed email-
// intelligence item -- one archives it, the other creates a real task from
// it. Gated identically ("member") for that reason: a review decision
// shouldn't have a lower bar to reject than to act on, and ../promote's own
// gate is itself matched to POST /api/tasks's requireRoleOrScope(ctx,
// "member") since promoting creates exactly that kind of object.
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const result = await dismissEmailIntelligenceItem({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Email intelligence dismiss error:", error)
    return NextResponse.json({ error: "Failed to dismiss email intelligence item" }, { status: 500 })
  }
}
