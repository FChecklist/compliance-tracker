import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listKpiDefinitions, createKpiDefinition, ServiceError } from "@/lib/services/construction-kpi-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ definitions: [] })

  try {
    const definitions = await listKpiDefinitions({ orgId: ctx.orgId }, request.nextUrl.searchParams.get("projectId") ?? undefined)
    return NextResponse.json({ definitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction KPI definitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch KPI definitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createKpiDefinition({ orgId: ctx.orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction KPI definition create error:", error)
    return NextResponse.json({ error: "Failed to create KPI definition" }, { status: 500 })
  }
}
