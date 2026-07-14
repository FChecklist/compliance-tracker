// Wave 141: thin alias over pms-meeting-service.ts's addMeetingOutcome()
// (the "minutes of meeting" notes). No requirePmsEnabled() gate -- see
// meetings/route.ts's header.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { addMeetingOutcome, ServiceError } from "@/lib/services/pms-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const outcome = await addMeetingOutcome({ orgId: ctx.orgId }, id, body.notes)
    return NextResponse.json(outcome, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa meeting outcome create error:", error)
    return NextResponse.json({ error: "Failed to add meeting outcome" }, { status: 500 })
  }
}
