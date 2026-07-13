// Wave 141: thin alias over pms-meeting-service.ts's listMeetings()/
// createMeeting(). No requirePmsEnabled() gate here, matching every other
// /v1/projexa/* route (Waves 124/129/140) -- the existing session-only
// /api/v1/pms/meetings/route.ts gates on requirePmsEnabled() because it's
// the separately-purchased PMS product's own surface, but PROJEXA customers
// buy construction PM, not PMS; pms_meetings is PROJEXA's generic
// meetings/MOM substrate here, same reasoning as schedule/gantt's
// pms_issues and vendors' erp_suppliers.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listMeetings, createMeeting, ServiceError } from "@/lib/services/pms-meeting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ meetings: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const meetings = await listMeetings({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ meetings })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa meetings list error:", error)
    return NextResponse.json({ error: "Failed to fetch meetings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const result = await createMeeting({ orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }, body.projectId, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa meeting create error:", error)
    return NextResponse.json({ error: "Failed to create meeting" }, { status: 500 })
  }
}
