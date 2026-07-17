import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { getFixedAsset, updateFixedAsset, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const asset = await getFixedAsset({ orgId }, id)
    return NextResponse.json(asset)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fixed asset fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch fixed asset" }, { status: 500 })
  }
}

// VERIDIAN Review Framework remediation (Critical: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- now
// requires at least "member" rank (ERP_ACTION_ROLES["erp.fixed_assets.update"]).
// Low incremental risk in practice (updateFixedAsset itself already refuses
// to edit anything past "draft" status), but a viewer-tier account should
// not be able to edit a draft asset record either.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fixed_assets.update")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json()
    const asset = await updateFixedAsset({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(asset)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fixed asset update error:", error)
    return NextResponse.json({ error: "Failed to update fixed asset" }, { status: 500 })
  }
}
