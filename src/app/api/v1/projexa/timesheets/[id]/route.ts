// Priority 17 Wave 1: thin alias over pms-time-service.ts's
// deleteTimeEntry(). The service itself enforces "only the logging user
// may delete this entry" (a 403 from inside deleteTimeEntry()), so this
// route just needs a real user session to have any userId to check
// against.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { deleteTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const result = await deleteTimeEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet delete error:", error)
    return NextResponse.json({ error: "Failed to delete time entry" }, { status: 500 })
  }
}
