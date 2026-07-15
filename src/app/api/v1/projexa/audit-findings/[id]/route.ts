// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's advanceAuditFindingCapaStatus -- the
// remediation (CAPA) status cycle: open -> in_progress -> closed.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { advanceAuditFindingCapaStatus, ServiceError } from "@/lib/services/risk-register-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const updated = await advanceAuditFindingCapaStatus(actorCtx, id)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa audit-finding update error:", error)
    return NextResponse.json({ error: "Failed to update audit finding" }, { status: 500 })
  }
}
