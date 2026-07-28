import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getMaterialCostReport, ServiceError } from "@/lib/services/construction-material-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ report: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const report = await getMaterialCostReport({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ report })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction material cost report error:", error)
    return NextResponse.json({ error: "Failed to build material cost report" }, { status: 500 })
  }
}
