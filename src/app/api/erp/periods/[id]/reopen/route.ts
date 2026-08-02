import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { reopenPeriod, ServiceError } from "@/lib/services/erp-financial-report-service"

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): replaces the previous inline requireRole(dbUser,
// "admin") literal with the centralized ERP_ACTION_ROLES["erp.fiscal_periods.reopen"]
// lookup. Same "admin" policy preserved (NOT loosened to "manager" just to
// fit this table's common "member or manager" framing) because reopening a
// closed accounting period reopens the books and is one of the most
// sensitive actions in any ERP -- the runbook's rule ("hard to undo ->
// manager") is a minimum bar, not a maximum, and this action warrants the
// stricter "admin" rank. See permission-service.ts's own comment and the
// PR's STEP 9 notes for the deviation rationale.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fiscal_periods.reopen")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const period = await reopenPeriod({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(period)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Period reopen error:", error)
    return NextResponse.json({ error: "Failed to reopen period" }, { status: 500 })
  }
}
