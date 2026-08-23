// R39/R-C12: the Bearer-key-callable twin of /api/pms/time-entries/[id]/
// reject. Same manager+ gate as approve/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole } from "@/lib/supabase/auth-guard"
import { rejectTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

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
    const body = await request.json().catch(() => ({}))
    const entry = await rejectTimeEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id, body.rejectionReason)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet reject error:", error)
    return NextResponse.json({ error: "Failed to reject time entry" }, { status: 500 })
  }
}
