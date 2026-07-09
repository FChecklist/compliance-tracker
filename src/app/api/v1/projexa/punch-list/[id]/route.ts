import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { markPunchListItemReadyForReview, verifyPunchListItemClosed, ServiceError } from "@/lib/services/construction-field-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const body = await request.json()
    if (body.action === "ready") {
      const item = await markPunchListItemReadyForReview({ orgId: ctx.orgId }, id)
      return NextResponse.json(item)
    }
    if (body.action === "verify") {
      const item = await verifyPunchListItemClosed({ orgId: ctx.orgId, userId: actorId }, id)
      return NextResponse.json(item)
    }
    return NextResponse.json({ error: "action must be 'ready' or 'verify'" }, { status: 400 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa punch-list update error:", error)
    return NextResponse.json({ error: "Failed to update punch list item" }, { status: 500 })
  }
}
