import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled } from "@/lib/services/pms-enablement-service"
import { getGanttData, ServiceError } from "@/lib/services/schedule-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    await requirePmsEnabled(ctx.orgId)
    const data = await getGanttData({ orgId: ctx.orgId }, projectId)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("pms schedule gantt error:", error)
    return NextResponse.json({ error: "Failed to build Gantt data" }, { status: 500 })
  }
}
