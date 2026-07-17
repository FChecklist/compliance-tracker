import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { signOffPeriod, ServiceError } from "@/lib/services/erp-financial-report-service"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // manager: signing off is a managerial approval step
  const roleErr = requirePermissionForUser(dbUser, "erp.fiscal_year.sign_off_period")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const period = await signOffPeriod({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(period)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Period sign-off error:", error)
    return NextResponse.json({ error: "Failed to sign off period" }, { status: 500 })
  }
}
