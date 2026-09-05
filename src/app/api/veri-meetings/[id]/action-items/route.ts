import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { addMeetingActionItem, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G7 final): had NO role gate at all. Gated at "member",
// not the "manager" bar this file's OTHER veri-meeting-service siblings use
// (create/update-details/minutes/publish/share-link) -- those all mutate the
// locked, audit-relevant meeting record itself. addMeetingActionItem() does
// not: its own header explicitly treats this as ongoing task work that must
// continue even after the meeting is published/locked, i.e. the same tier as
// creating any other task -- matched to POST /api/tasks's requireRoleOrScope
// (ctx, "member"), the same analogy this session already applied to
// email-intelligence's promote route for an identical "this just creates a
// task" action.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await addMeetingActionItem({ orgId, userId: dbUser.id, dbUser }, id, {
      title: body.title, assigneeUserId: body.assigneeUserId, dueDate: body.dueDate,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings add action item error:", error)
    return NextResponse.json({ error: "Failed to add action item" }, { status: 500 })
  }
}
