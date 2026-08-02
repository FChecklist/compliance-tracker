import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMyMeetingActionItems, ServiceError } from "@/lib/services/veri-meeting-service"

// Priority 18a (VERI Chat second-screen unification): thin wrapper over
// veri-meeting-service.ts's listMyMeetingActionItems -- the panel's Meetings
// tab needs "action items assigned to me across every meeting" and no
// existing route surfaced that cross-meeting view (only getVeriMeeting's
// per-meeting actionItems join existed before this).
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ items: [] })

  try {
    const items = await listMyMeetingActionItems({ orgId, userId: dbUser.id })
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat meeting action items error:", error)
    return NextResponse.json({ error: "Failed to fetch meeting action items" }, { status: 500 })
  }
}
