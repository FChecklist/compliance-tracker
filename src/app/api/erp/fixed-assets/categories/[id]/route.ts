import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { updateAssetCategory, ServiceError } from "@/lib/services/erp-fixed-assets-service"

// VERIDIAN Review Framework remediation (Critical: Access Control /
// Role-Based Permissions): same "manager" bar as categories/route.ts's
// POST -- see that route's comment. Editing a category's GL account
// mapping is the same class of action as creating one.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.fixed_assets.category_manage")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json()
    const category = await updateAssetCategory({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(category)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset category update error:", error)
    return NextResponse.json({ error: "Failed to update asset category" }, { status: 500 })
  }
}
