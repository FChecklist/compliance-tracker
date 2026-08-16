import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateRoom, removeRoom, ServiceError } from "@/lib/services/interior-floorplan-service"

type RouteContext = { params: Promise<{ id: string; roomId: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id, roomId } = await params
    const body = await request.json()
    const room = await updateRoom({ orgId: ctx.orgId }, id, roomId, body)
    return NextResponse.json(room)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa room update error:", error)
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id, roomId } = await params
    const result = await removeRoom({ orgId: ctx.orgId }, id, roomId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa room remove error:", error)
    return NextResponse.json({ error: "Failed to remove room" }, { status: 500 })
  }
}
