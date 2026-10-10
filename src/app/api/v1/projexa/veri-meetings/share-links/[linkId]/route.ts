// Real-screen conversion (2026-08-30): the Bearer-key-callable twin of
// /api/veri-meetings/share-links/[linkId] (cookie-only requireAuth,
// unreachable from PROJEXA) -- same R39/R-C04 pattern as this surface's
// sibling action-items/share-links POST routes. Revoking a share link had
// no PROJEXA-reachable route at all before this.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { revokeMeetingShareLink, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ linkId: string }> }

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { linkId } = await params
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const actorId = acting.person.id
    const meetingCtx = { orgId: ctx.orgId, userId: actorId, ...acting.actor }
    const result = await revokeMeetingShareLink(meetingCtx, linkId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting revoke share link error:", error)
    return NextResponse.json({ error: "Failed to revoke share link" }, { status: 500 })
  }
}
