import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getFfeItem, updateFfeItemStatus, updateFfeItemDimensions, ServiceError } from "@/lib/services/interior-design-service"

type RouteContext = { params: Promise<{ id: string }> }

// Real-screen conversion (2026-08-30): the FF&E schedule never had a detail
// route -- only status could be advanced (via PATCH below), and dimensions
// (widthCm/depthCm/heightCm, needed once an item is placed into a floor
// plan) had a real backend function but no UI at all.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const item = await getFfeItem({ orgId: ctx.orgId }, id)
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa ffe get error:", error)
    return NextResponse.json({ error: "Failed to fetch FF&E item" }, { status: 500 })
  }
}

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
