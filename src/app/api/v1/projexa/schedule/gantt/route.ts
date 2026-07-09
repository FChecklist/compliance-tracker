// Wave 140: thin alias over schedule-service.ts's getGanttData(). No
// requirePmsEnabled() gate here, matching every other /v1/projexa/* route
// (Waves 124/129) -- pms_issues is PROJEXA's generic task/schedule
// substrate, not gated behind the separately-purchased PMS product branch.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getGanttData, ServiceError } from "@/lib/services/schedule-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const data = await getGanttData({ orgId: ctx.orgId }, projectId)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule gantt error:", error)
    return NextResponse.json({ error: "Failed to build Gantt data" }, { status: 500 })
  }
}
