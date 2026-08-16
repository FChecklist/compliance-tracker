import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listVoiceMemos, listMyVoiceTickets, ServiceError } from "@/lib/services/voice-ticket-service"

// Mirrors src/app/api/veri-chat/meetings/action-items/route.ts's own thin-
// wrapper shape -- the panel's Voice tab needs both "recent voice memos"
// (so a just-recorded memo's transcription status is visible) and "action
// items assigned to me from a voice memo" (the standalone-memo-only join;
// meeting-attached ones already appear in the Meetings tab's own aggregator
// since they were created via addMeetingActionItem()).
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ voiceMemos: [], items: [] })

  try {
    const [voiceMemos, items] = await Promise.all([
      listVoiceMemos({ orgId }),
      listMyVoiceTickets({ orgId, userId: dbUser.id }),
    ])
    return NextResponse.json({ voiceMemos, items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat voice tickets error:", error)
    return NextResponse.json({ error: "Failed to fetch voice tickets" }, { status: 500 })
  }
}
