// R39/R-C12 (v5 D-10: approval must BLOCK, never auto-approve): the
// Bearer-key-callable twin of /api/pms/time-entries/[id]/approve. Gated to
// a real manager+ dbUser -- an API key can never approve its own submitted
// hours, matching pms-time-service.ts's own self-approval guard.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole } from "@/lib/supabase/auth-guard"
import { approveTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })
  const roleErr = requireRole(ctx.dbUser, "manager")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const entry = await approveTimeEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet approve error:", error)
    return NextResponse.json({ error: "Failed to approve time entry" }, { status: 500 })
  }
}
