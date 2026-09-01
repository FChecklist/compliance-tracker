// R39/R-C04: the Bearer-key-callable twin of /api/veri-meetings/[id]/
// action-items (cookie-only requireAuth) -- same pattern as this surface's
// other routes. addMeetingActionItem requires a real assigneeUserId when
// the caller has no dbUser (API-key server-to-server calls, PROJEXA's
// normal path) -- ctx.userId being null is otherwise honest but useless as
// a task assignee.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { addMeetingActionItem, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? null
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (!actorId && !body.assigneeUserId) {
      return NextResponse.json({ error: "assigneeUserId is required when creating an action item without a signed-in session" }, { status: 400 })
    }
    const result = await addMeetingActionItem(
      { orgId: ctx.orgId, userId: actorId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }) },
      id,
      { title: body.title, assigneeUserId: body.assigneeUserId, dueDate: body.dueDate }
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting add action item error:", error)
    return NextResponse.json({ error: "Failed to add action item" }, { status: 500 })
  }
}
