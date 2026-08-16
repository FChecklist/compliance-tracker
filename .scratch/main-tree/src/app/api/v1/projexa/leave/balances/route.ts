// Priority 15 (PROJEXA HR & Payroll, Wave 1): leave balance ledger.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listLeaveBalances, setLeaveBalance, ServiceError } from "@/lib/services/hr-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ balances: [] })

  try {
    const userId = request.nextUrl.searchParams.get("userId") || undefined
    const balances = await listLeaveBalances({ orgId: ctx.orgId }, userId)
    return NextResponse.json({ balances })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leave balances list error:", error)
    return NextResponse.json({ error: "Failed to fetch leave balances" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await setLeaveBalance({ orgId: ctx.orgId, userId: ctx.dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa leave balance set error:", error)
    return NextResponse.json({ error: "Failed to set leave balance" }, { status: 500 })
  }
}
