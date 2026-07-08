import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listKpiEntries, submitKpiEntry, ServiceError } from "@/lib/services/construction-kpi-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ entries: [] })

  const kpiDefinitionId = request.nextUrl.searchParams.get("kpiDefinitionId")
  if (!kpiDefinitionId) return NextResponse.json({ error: "kpiDefinitionId query param is required" }, { status: 400 })

  try {
    const entries = await listKpiEntries({ orgId: ctx.orgId }, kpiDefinitionId)
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction KPI entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch KPI entries" }, { status: 500 })
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
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await submitKpiEntry({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction KPI entry submit error:", error)
    return NextResponse.json({ error: "Failed to submit KPI entry" }, { status: 500 })
  }
}
