import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { submitFixedAsset, ServiceError } from "@/lib/services/erp-fixed-assets-service"

// VERIDIAN Review Framework remediation (Critical: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- any
// authenticated org member could capitalize an asset and post its
// acquisition entry to the GL. Now requires "manager" rank
// (ERP_ACTION_ROLES["erp.fixed_assets.capitalize"]), matching this
// module's own disposal route's precedent for anything that commits a
// capital transaction to the ledger.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fixed_assets.capitalize")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const result = await submitFixedAsset({ orgId, userId: dbUser.id, dbUser }, id, { sourceAccountId: body.sourceAccountId })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fixed asset submit error:", error)
    return NextResponse.json({ error: "Failed to submit (capitalize) fixed asset" }, { status: 500 })
  }
}
