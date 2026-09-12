import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { generateMeetingIntelligence, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Gated at "member",
// this session's established bar for an AI-analysis call over data the
// caller already has read access to (same reasoning as the help/ask-class
// routes closed under G1/G4/G5) -- not the "manager" bar this file's OTHER
// veri-meeting-service siblings use for mutating the locked meeting record
// itself. generateMeetingIntelligence() is read-only over `minutes` (its own
// header: "never mutates meeting-level fields... safe to call on a
// published (locked) meeting"), so it doesn't carry the audit/lock concern
// that justifies "manager" for create/update/publish/share-link.
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const result = await generateMeetingIntelligence({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Meeting intelligence generation error:", error)
    return NextResponse.json({ error: "Failed to generate meeting intelligence" }, { status: 500 })
  }
}
