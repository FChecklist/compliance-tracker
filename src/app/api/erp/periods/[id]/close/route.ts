import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { closePeriod, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // manager: closing a period locks financial data, hard to undo
  const roleErr = requirePermissionForUser(dbUser, "erp.fiscal_year.close_period")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const period = await closePeriod({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(period)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Period close error:", error)
    return NextResponse.json({ error: "Failed to close period" }, { status: 500 })
  }
}
