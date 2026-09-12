import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { dismissTicketIntelligenceItem, ServiceError } from "@/lib/services/ticket-intelligence-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G7 final): had NO role gate at all. dismissTicketIntelligenceItem()
// and promoteTicketIntelligenceItem() (../promote/route.ts) are the two mutually-exclusive
// outcomes of the same human review decision on a proposed ticket-intelligence item -- one
// archives it, the other creates a real task from it. Gated identically ("senior_professional")
// for that reason, matching ../promote's own already-established bar (this codebase's
// ticket-intelligence domain, not email-intelligence's lower "member" bar for the same-shaped
// dismiss/promote pair -- the two services set their own review-decision floor independently).
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "senior_professional")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const result = await dismissTicketIntelligenceItem({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket intelligence dismiss error:", error)
    return NextResponse.json({ error: "Failed to dismiss ticket intelligence item" }, { status: 500 })
  }
}
