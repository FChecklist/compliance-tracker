import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getManpowerCostReport, ServiceError } from "@/lib/services/construction-labour-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ rows: [], dailyRollup: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const trade = request.nextUrl.searchParams.get("trade") ?? undefined

  try {
    const report = await getManpowerCostReport({ orgId: ctx.orgId }, projectId, { trade })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction manpower cost report error:", error)
    return NextResponse.json({ error: "Failed to build manpower cost report" }, { status: 500 })
  }
}
