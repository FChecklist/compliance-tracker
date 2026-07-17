import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { ignoreLine, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- now
// requires at least "member" rank (ERP_ACTION_ROLES["erp.banking.ignore_line"]).
// "member" (not "manager") because ignoreLine only updates the status
// field on a statement line to "ignored" (see erp-bank-reconciliation-service.ts)
// -- it does NOT post to the GL or move money. Routine reconciliation
// cleanup per the runbook's rule.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.banking.ignore_line")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const line = await ignoreLine({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(line)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ignore line error:", error)
    return NextResponse.json({ error: "Failed to ignore line" }, { status: 500 })
  }
}
