import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listKpiDefinitions, createKpiDefinition, ServiceError } from "@/lib/services/construction-kpi-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ definitions: [] })

  try {
    const definitions = await listKpiDefinitions({ orgId }, request.nextUrl.searchParams.get("projectId") ?? undefined)
    return NextResponse.json({ definitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction KPI definitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch KPI definitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createKpiDefinition({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction KPI definition create error:", error)
    return NextResponse.json({ error: "Failed to create KPI definition" }, { status: 500 })
  }
}
