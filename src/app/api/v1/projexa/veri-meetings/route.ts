// Wave 143 (PROJEXA Minutes of Meetings): wires veri-meeting-service.ts --
// the real live-meeting-notes engine (AI summary/key-decisions/suggested
// action items, publish/lock, minutes amend-history) -- into PROJEXA's
// Bearer-key surface. PROJEXA's existing /api/meetings talks to
// pms-meeting-service.ts instead (basic scheduling CRUD only, no AI, no
// minutes/publish workflow) -- that route is untouched; this is a new,
// separate module PROJEXA's MoM screen calls instead.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listVeriMeetings, createVeriMeeting, ServiceError } from "@/lib/services/veri-meeting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ meetings: [] })

  try {
    const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined
    const meetings = await listVeriMeetings({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ meetings })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meetings list error:", error)
    return NextResponse.json({ error: "Failed to fetch meetings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  // R39/R-C04: ctx.apiKey?.id is not a real compliance.users row -- see
  // veriMeetings.createdById's schema.ts comment for the real production FK
  // violation this fallback caused.
  const actorId = ctx.dbUser?.id ?? null
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined
    const meeting = await createVeriMeeting(
      { orgId: ctx.orgId, userId: actorId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }) },
      {
        title: body.title, meetingType: body.meetingType, scheduledAt: body.scheduledAt,
        attendees: body.attendees, agenda: body.agenda,
        contextEntityType: projectId ? "project" : undefined, contextEntityId: projectId,
      }
    )
    return NextResponse.json(meeting, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meetings create error:", error)
    return NextResponse.json({ error: "Failed to create meeting" }, { status: 500 })
  }
}
