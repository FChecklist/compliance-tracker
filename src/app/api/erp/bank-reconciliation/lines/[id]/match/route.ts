import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { matchLine, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

// VERIDIAN Review Framework remediation (Wave 4, Track 2: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- now
// requires at least "member" rank (ERP_ACTION_ROLES["erp.banking.match_line"]).
// "member" (not "manager") because matchLine only updates the status field
// on a statement line to "matched" and links it to an EXISTING journal
// entry (see erp-bank-reconciliation-service.ts) -- it does NOT create a
// new GL posting or move money. Routine reconciliation work per the
// runbook's rule.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.banking.match_line")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const { journalEntryId } = await request.json()
    if (!journalEntryId) return NextResponse.json({ error: "journalEntryId is required" }, { status: 400 })
    const line = await matchLine({ orgId, userId: dbUser.id, dbUser }, id, journalEntryId)
    return NextResponse.json(line)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Match line error:", error)
    return NextResponse.json({ error: "Failed to match line" }, { status: 500 })
  }
}
