import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { signOffPeriod, ServiceError } from "@/lib/services/erp-financial-report-service"

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): replaces the previous inline requireRole(dbUser,
// "manager") literal with the centralized ERP_ACTION_ROLES["erp.fiscal_periods.sign_off"]
// lookup. Same "manager" policy, single source of truth. "manager" (not
// "member") because period sign-off is a financially significant
// attestation that the books for that period are complete.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fiscal_periods.sign_off")
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
