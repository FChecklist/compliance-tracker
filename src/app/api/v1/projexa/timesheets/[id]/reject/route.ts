// R39/R-C12: the Bearer-key-callable twin of /api/pms/time-entries/[id]/
// reject. Same manager+ gate as approve/route.ts.
//
// R39/R-C12 fix-2 (live-oracle finding): same resolveActingUser() fix as
// submit/approve -- see approve/route.ts's header comment for the full
// evidence trail (this route was equally dead-on-arrival from the real
// PROJEXA proxy before this fix, same root cause).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole, resolveActingUser } from "@/lib/supabase/auth-guard"
import { rejectTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
  if (actingUserErr) return actingUserErr
  const roleErr = requireRole(actingUser, "manager")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const entry = await rejectTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id, body?.rejectionReason)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet reject error:", error)
    return NextResponse.json({ error: "Failed to reject time entry" }, { status: 500 })
  }
}
