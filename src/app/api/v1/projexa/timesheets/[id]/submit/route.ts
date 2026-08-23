// R39/R-C12: the Bearer-key-callable twin of /api/pms/time-entries/[id]/
// submit (cookie-only requireAuth). Same "a real user, not a shared API
// key, must own this action" discipline the sibling timesheets routes
// already established -- submitting is inherently a self-action.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { submitTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const entry = await submitTimeEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet submit error:", error)
    return NextResponse.json({ error: "Failed to submit time entry" }, { status: 500 })
  }
}
