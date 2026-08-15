import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getVeriMeeting, updateMeetingMinutes, publishVeriMeeting, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const meeting = await getVeriMeeting({ orgId: ctx.orgId }, id)
    return NextResponse.json(meeting)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting get error:", error)
    return NextResponse.json({ error: "Failed to fetch meeting" }, { status: 500 })
  }
}

// action: "update_minutes" (body.minutes) | "publish" -- kept as one PATCH
// route with a discriminator, matching this v1/projexa surface's existing
// convention for narrow state-transition endpoints (e.g. quotations'
// [id]/convert being its own route, but simple in-place transitions using
// a PATCH body action field elsewhere).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!ctx.orgId || !actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const meetingCtx = { orgId: ctx.orgId, userId: actorId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }) }

    if (body.action === "publish") {
      const meeting = await publishVeriMeeting(meetingCtx, id)
      return NextResponse.json(meeting)
    }

    if (typeof body.minutes === "string") {
      const meeting = await updateMeetingMinutes(meetingCtx, id, body.minutes)
      return NextResponse.json(meeting)
    }

    return NextResponse.json({ error: "Provide either { minutes } or { action: \"publish\" }" }, { status: 400 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting update error:", error)
    return NextResponse.json({ error: "Failed to update meeting" }, { status: 500 })
  }
}
