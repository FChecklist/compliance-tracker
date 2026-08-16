import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled } from "@/lib/services/pms-enablement-service"
import { listMeetings, createMeeting, ServiceError } from "@/lib/services/pms-meeting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ meetings: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    await requirePmsEnabled(ctx.orgId)
    const meetings = await listMeetings({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ meetings })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 pms meetings list error:", error)
    return NextResponse.json({ error: "Failed to fetch meetings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    await requirePmsEnabled(ctx.orgId)
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const result = await createMeeting({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body.projectId, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 pms meeting create error:", error)
    return NextResponse.json({ error: "Failed to create meeting" }, { status: 500 })
  }
}
