import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updatePlacement, removePlacement, ServiceError } from "@/lib/services/interior-floorplan-service"

type RouteContext = { params: Promise<{ id: string; placementId: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id, placementId } = await params
    const body = await request.json()
    const placement = await updatePlacement({ orgId: ctx.orgId }, id, placementId, body)
    return NextResponse.json(placement)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa placement update error:", error)
    return NextResponse.json({ error: "Failed to update placement" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id, placementId } = await params
    const result = await removePlacement({ orgId: ctx.orgId }, id, placementId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa placement remove error:", error)
    return NextResponse.json({ error: "Failed to remove placement" }, { status: 500 })
  }
}
