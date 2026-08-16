import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateFfeItemStatus, updateFfeItemDimensions, ServiceError } from "@/lib/services/interior-design-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (body.action === "status") {
      const item = await updateFfeItemStatus({ orgId: ctx.orgId }, id, body.status)
      return NextResponse.json(item)
    }
    if (body.action === "dimensions") {
      const item = await updateFfeItemDimensions({ orgId: ctx.orgId }, id, body)
      return NextResponse.json(item)
    }
    return NextResponse.json({ error: "action must be 'status' or 'dimensions'" }, { status: 400 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa ffe update error:", error)
    return NextResponse.json({ error: "Failed to update FF&E item" }, { status: 500 })
  }
}
