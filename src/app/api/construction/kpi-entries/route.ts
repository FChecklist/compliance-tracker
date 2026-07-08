import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listKpiEntries, submitKpiEntry, ServiceError } from "@/lib/services/construction-kpi-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [] })

  const kpiDefinitionId = request.nextUrl.searchParams.get("kpiDefinitionId")
  if (!kpiDefinitionId) return NextResponse.json({ error: "kpiDefinitionId query param is required" }, { status: 400 })

  try {
    const entries = await listKpiEntries({ orgId }, kpiDefinitionId)
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction KPI entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch KPI entries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await submitKpiEntry({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction KPI entry submit error:", error)
    return NextResponse.json({ error: "Failed to submit KPI entry" }, { status: 500 })
  }
}
