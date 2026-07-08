import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled } from "@/lib/services/pms-enablement-service"
import { listTimeEntriesForProject, listTimeEntriesForIssue, logTime, ServiceError } from "@/lib/services/pms-time-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ entries: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  const issueId = request.nextUrl.searchParams.get("issueId")
  if (!projectId && !issueId) return NextResponse.json({ error: "projectId or issueId query param is required" }, { status: 400 })

  try {
    await requirePmsEnabled(ctx.orgId)
    const entries = issueId
      ? await listTimeEntriesForIssue({ orgId: ctx.orgId }, issueId)
      : await listTimeEntriesForProject({ orgId: ctx.orgId }, projectId!)
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 pms time entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch time entries" }, { status: 500 })
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
    const result = await logTime({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 pms time entry create error:", error)
    return NextResponse.json({ error: "Failed to log time entry" }, { status: 500 })
  }
}
