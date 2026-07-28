import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listScheduleWithProgress, ServiceError } from "@/lib/services/construction-schedule-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ items: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const items = await listScheduleWithProgress({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction schedule list error:", error)
    return NextResponse.json({ error: "Failed to fetch schedule" }, { status: 500 })
  }
}
