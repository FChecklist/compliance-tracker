// Priority 15 (PROJEXA HR & Payroll, Wave 1): thin ALIASING route over
// hr-service.ts's leave-request ledger (real requestLeave/listLeaveRequests,
// not a stub).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listLeaveRequests, requestLeave, ServiceError } from "@/lib/services/hr-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ requests: [] })

  try {
    const userId = request.nextUrl.searchParams.get("userId") || undefined
    const requests = await listLeaveRequests({ orgId: ctx.orgId }, { userId })
    return NextResponse.json({ requests })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leave requests list error:", error)
    return NextResponse.json({ error: "Failed to fetch leave requests" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await requestLeave({ orgId: ctx.orgId, userId: ctx.dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leave request create error:", error)
    return NextResponse.json({ error: "Failed to create leave request" }, { status: 500 })
  }
}
