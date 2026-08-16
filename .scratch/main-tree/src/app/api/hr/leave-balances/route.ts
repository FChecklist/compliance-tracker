import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listLeaveBalances, setLeaveBalance, ServiceError } from "@/lib/services/hr-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ balances: [] })

  try {
    const userId = request.nextUrl.searchParams.get("userId") || undefined
    const balances = await listLeaveBalances({ orgId }, userId)
    return NextResponse.json({ balances })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Leave balances list error:", error)
    return NextResponse.json({ error: "Failed to fetch leave balances" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const balance = await setLeaveBalance({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(balance, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Leave balance set error:", error)
    return NextResponse.json({ error: "Failed to set leave balance" }, { status: 500 })
  }
}
