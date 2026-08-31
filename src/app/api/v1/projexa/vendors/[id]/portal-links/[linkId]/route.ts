// Real-screen conversion (2026-08-30): revoke half of the portal-links
// pair, see ../route.ts's own comment.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { revokePortalLink, ServiceError } from "@/lib/services/erp-vendor-master-service"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { linkId } = await params
    const link = await revokePortalLink({ orgId: ctx.orgId }, linkId)
    return NextResponse.json(link)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor portal-link revoke error:", error)
    return NextResponse.json({ error: "Failed to revoke portal link" }, { status: 500 })
  }
}
