// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's updateRiskStatus -- the open -> mitigating ->
// closed workflow transition (a genuinely new capability this wave added
// to the underlying service, not present in the session-only /api/risks
// route before this wave).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateRiskStatus, ServiceError } from "@/lib/services/risk-register-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const updated = await updateRiskStatus(actorCtx, id, body.status)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa risk status update error:", error)
    return NextResponse.json({ error: "Failed to update risk status" }, { status: 500 })
  }
}
