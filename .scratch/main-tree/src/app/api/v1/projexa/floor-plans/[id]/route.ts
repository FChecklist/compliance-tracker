import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getFloorPlan, updateFloorPlanStatus, ServiceError } from "@/lib/services/interior-floorplan-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const floorPlan = await getFloorPlan({ orgId: ctx.orgId }, id)
    return NextResponse.json(floorPlan)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa floor-plan get error:", error)
    return NextResponse.json({ error: "Failed to fetch floor plan" }, { status: 500 })
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
    if (body.action !== "status") return NextResponse.json({ error: "action must be 'status'" }, { status: 400 })
    const floorPlan = await updateFloorPlanStatus({ orgId: ctx.orgId }, id, body.status)
    return NextResponse.json(floorPlan)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa floor-plan update error:", error)
    return NextResponse.json({ error: "Failed to update floor plan" }, { status: 500 })
  }
}
