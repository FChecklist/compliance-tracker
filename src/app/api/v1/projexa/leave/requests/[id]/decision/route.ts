// Priority 15 (PROJEXA HR & Payroll, Wave 1): approve/reject a leave request.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { decideLeaveRequest, ServiceError } from "@/lib/services/hr-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
    }
    const updated = await decideLeaveRequest({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id, body.decision)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leave decision error:", error)
    return NextResponse.json({ error: "Failed to decide leave request" }, { status: 500 })
  }
}
