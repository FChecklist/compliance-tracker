import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { closePeriod, ServiceError } from "@/lib/services/erp-financial-report-service"

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): replaces the previous inline requireRole(dbUser,
// "manager") literal with the centralized ERP_ACTION_ROLES["erp.fiscal_periods.close"]
// lookup. Same "manager" policy, single source of truth. "manager" (not
// "member") because closing a period is a hard-to-cleanly-reverse lock
// that blocks further posting to that period -- the runbook's "hard to
// undo once done" case.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fiscal_periods.close")
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
