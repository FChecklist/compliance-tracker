import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { addVoiceMemoTicket, ServiceError } from "@/lib/services/voice-ticket-service"

// Mirrors src/app/api/veri-meetings/[id]/action-items/route.ts exactly --
// promotes one suggested (or freely typed) action item into a real task.
// addVoiceMemoTicket() itself decides whether that means delegating to
// veri-meeting-service.ts's addMeetingActionItem() (memo attached to a
// meeting) or this file's own addVoiceMemoActionItem() (standalone memo).
//
// R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Gated at "member",
// matching the veri-meetings action-items route this one mirrors exactly
// (see that file's own comment: creating a task from an action item sits at
// the same bar as POST /api/tasks, not the higher "manager" bar this
// service's OTHER sibling, POST /api/voice-tickets's own memo-upload gate,
// happens to also use here -- both land on "member" for this codebase's
// established task-creation floor).
type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await addVoiceMemoTicket({ orgId, userId: dbUser.id, dbUser }, id, {
      title: body.title, assigneeUserId: body.assigneeUserId, dueDate: body.dueDate,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Voice memo add action item error:", error)
    return NextResponse.json({ error: "Failed to add action item" }, { status: 500 })
  }
}
