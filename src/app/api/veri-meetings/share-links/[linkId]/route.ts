import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { revokeMeetingShareLink, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ linkId: string }> }

// R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Matches its own
// direct sibling, POST ../../[id]/share-links (createMeetingShareLink),
// which requires "manager" -- revoking a share link is the exact inverse of
// creating one and controls the same real exposure (whether an external
// party has a live public URL onto this meeting's minutes), so it sits at
// the same bar, not a lower one.
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { linkId } = await params
    const result = await revokeMeetingShareLink({ orgId, userId: dbUser.id, dbUser }, linkId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings revoke share link error:", error)
    return NextResponse.json({ error: "Failed to revoke share link" }, { status: 500 })
  }
}
