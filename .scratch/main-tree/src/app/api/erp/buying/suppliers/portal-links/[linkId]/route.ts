import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { revokePortalLink, ServiceError } from "@/lib/services/erp-vendor-master-service"

type RouteContext = { params: Promise<{ linkId: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { linkId } = await params
    const link = await revokePortalLink({ orgId }, linkId)
    return NextResponse.json(link)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier portal link revoke error:", error)
    return NextResponse.json({ error: "Failed to revoke portal link" }, { status: 500 })
  }
}
