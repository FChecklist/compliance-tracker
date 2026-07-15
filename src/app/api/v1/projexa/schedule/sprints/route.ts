// Priority 17 Wave 1: thin alias over pms-sprint-service.ts's
// listSprints()/createSprint(). No requirePmsEnabled() gate here, matching
// every other /v1/projexa/schedule/* and /v1/projexa/meetings route (Waves
// 124/129/140/141) -- pms_sprints is PROJEXA's generic sprint/cycle
// substrate here, same reasoning already applied to pms_issues
// (schedule/gantt) and pms_meetings (meetings), not the separately-
// purchased VERIDIAN AI PMS product's own surface (which is what
// /api/pms/sprints/* and requirePmsEnabled() actually gate).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSprints, createSprint, ServiceError } from "@/lib/services/pms-sprint-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ sprints: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const sprints = await listSprints({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ sprints })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sprints list error:", error)
    return NextResponse.json({ error: "Failed to fetch sprints" }, { status: 500 })
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
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const result = await createSprint({ orgId: ctx.orgId }, body.projectId, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sprint create error:", error)
    return NextResponse.json({ error: "Failed to create sprint" }, { status: 500 })
  }
}
