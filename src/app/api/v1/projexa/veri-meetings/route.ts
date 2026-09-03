// Wave 143 (PROJEXA Minutes of Meetings): wires veri-meeting-service.ts --
// the real live-meeting-notes engine (AI summary/key-decisions/suggested
// action items, publish/lock, minutes amend-history) -- into PROJEXA's
// Bearer-key surface. PROJEXA's existing /api/meetings talks to
// pms-meeting-service.ts instead (basic scheduling CRUD only, no AI, no
// minutes/publish workflow) -- that route is untouched; this is a new,
// separate module PROJEXA's MoM screen calls instead.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { listVeriMeetings, createVeriMeeting, ServiceError } from "@/lib/services/veri-meeting-service"
import { withRouteTiming } from "@/lib/route-timing"

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

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

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
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
        // R67 lane D22 (item D-58): minutes are typed live on the create
        // screen and the actions agreed in the room are saved with the
        // meeting, in one transaction -- see createVeriMeeting's own comment.
        minutes: body.minutes, actionItems: body.actionItems,
      }
    )
    return NextResponse.json(meeting, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meetings create error:", error)
    return NextResponse.json({ error: "Failed to create meeting" }, { status: 500 })
  }
}
