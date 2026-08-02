import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { listFixedAssets, createFixedAsset, ServiceError } from "@/lib/services/erp-fixed-assets-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ assets: [] })

  try {
    const status = request.nextUrl.searchParams.get("status") || undefined
    const assetCategoryId = request.nextUrl.searchParams.get("assetCategoryId") || undefined
    const departmentId = request.nextUrl.searchParams.get("departmentId") || undefined
    const assets = await listFixedAssets({ orgId }, { status, assetCategoryId, departmentId })
    return NextResponse.json({ assets })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fixed assets list error:", error)
    return NextResponse.json({ error: "Failed to fetch fixed assets" }, { status: 500 })
  }
}

// VERIDIAN Review Framework remediation (Critical: Access Control /
// Role-Based Permissions): previously gated only by requireAuth() -- any
// authenticated org member, including a read-only viewer/client_viewer/
// external_auditor account, could create a fixed asset. Now requires at
// least "member" rank via the shared permission-service.ts utility (see
// ERP_ACTION_ROLES["erp.fixed_assets.create"]).
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fixed_assets.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const asset = await createFixedAsset({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(asset, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fixed asset create error:", error)
    return NextResponse.json({ error: "Failed to create fixed asset" }, { status: 500 })
  }
}
