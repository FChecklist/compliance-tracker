// R39/R-C12: the Bearer-key-callable twin of /api/pms/time-entries/[id]/
// submit (cookie-only requireAuth). Same "a real user, not a shared API
// key, must own this action" discipline the sibling timesheets routes
// already established -- submitting is inherently a self-action.
//
// R39/R-C12 fix-2 (live-oracle finding): a hard `!ctx.dbUser` 400 made this
// unreachable from the real PROJEXA proxy, which only ever authenticates
// with a shared per-org API key (ctx.dbUser is always null there) -- see
// resolveActingUser()'s own doc comment in auth-guard.ts for the full
// evidence trail. Now resolves the real acting user via body.actorEmail for
// an API-key caller, exactly as a session caller's own ctx.dbUser would.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, resolveActingUser } from "@/lib/supabase/auth-guard"
import { submitTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
  if (actingUserErr) return actingUserErr

  try {
    const { id } = await params
    const entry = await submitTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet submit error:", error)
    return NextResponse.json({ error: "Failed to submit time entry" }, { status: 500 })
  }
}
