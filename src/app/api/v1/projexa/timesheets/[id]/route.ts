// Priority 17 Wave 1: thin alias over pms-time-service.ts's
// deleteTimeEntry(). The service itself enforces "only the logging user
// may delete this entry" (a 403 from inside deleteTimeEntry()), so this
// route just needs a real user session to have any userId to check
// against.
//
// R67 WS-H (item H-01, D-05). Two additions and one fix:
//   GET   -- the Design Studio object page opens ONE entry read-only with
//            facets Date / Project / Category / Task / Hours / Logged by /
//            Reviewed by. Nothing could answer that before: the list
//            endpoint needs a project and a day.
//   PATCH -- the object page's explicit Edit (draft-only, owner-only; the
//            service enforces both).
//   DELETE-- used to hard-400 for an API-key caller (`!ctx.dbUser`), which
//            made Delete unreachable from PROJEXA for exactly the reason
//            resolveActingUser() was written. It now resolves the acting
//            user the same way its sibling submit/approve/reject routes do,
//            so the service's "only the logging user may delete" check runs
//            against a real person rather than never running at all.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, readActingUserId, readActingUserEmail } from "@/lib/supabase/auth-guard"
import { deleteTimeEntry, getTimeEntry, updateTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const entry = await getTimeEntry({ orgId: ctx.orgId }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet read error:", error)
    return NextResponse.json({ error: "Failed to read time entry" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail ?? readActingUserEmail(request), readActingUserId(request))
    if (actingUserErr) return actingUserErr

    const { id } = await params
    const entry = await updateTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id, body)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet update error:", error)
    return NextResponse.json({ error: "Failed to update time entry" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail ?? readActingUserEmail(request), readActingUserId(request))
    if (actingUserErr) return actingUserErr

    const { id } = await params
    const result = await deleteTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet delete error:", error)
    return NextResponse.json({ error: "Failed to delete time entry" }, { status: 500 })
  }
}
