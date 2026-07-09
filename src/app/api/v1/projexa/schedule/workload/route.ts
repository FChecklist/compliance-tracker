import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getWorkload, createResourceAllocation, ServiceError } from "@/lib/services/schedule-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const capacityParam = request.nextUrl.searchParams.get("dailyCapacityHours")

  try {
    const workload = await getWorkload({ orgId: ctx.orgId }, projectId, capacityParam ? Number(capacityParam) : undefined)
    return NextResponse.json({ workload })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule workload error:", error)
    return NextResponse.json({ error: "Failed to compute workload" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.projectId || !body.userId || !body.allocatedHoursPerDay || !body.startDate || !body.endDate) {
      return NextResponse.json({ error: "projectId, userId, allocatedHoursPerDay, startDate, endDate are required" }, { status: 400 })
    }
    const row = await createResourceAllocation({ orgId: ctx.orgId }, body.projectId, {
      userId: body.userId, issueId: body.issueId, allocatedHoursPerDay: body.allocatedHoursPerDay,
      startDate: body.startDate, endDate: body.endDate,
    })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule workload create error:", error)
    return NextResponse.json({ error: "Failed to create resource allocation" }, { status: 500 })
  }
}
