// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's updatePolicy -- 'edit' bumps the version and
// appends history; 'request_publish' opens a maker-checker approval request
// (VERIDIAN's own /api/approvals/[id]/decide is what actually publishes it).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updatePolicy, ServiceError } from "@/lib/services/risk-register-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body.action !== "edit" && body.action !== "request_publish") {
      return NextResponse.json({ error: "action must be 'edit' or 'request_publish'" }, { status: 400 })
    }
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const updated = await updatePolicy(actorCtx, id, body.action, body.note)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa policy update error:", error)
    return NextResponse.json({ error: "Failed to update policy" }, { status: 500 })
  }
}
