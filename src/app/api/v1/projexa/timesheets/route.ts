// Priority 17 Wave 1: thin alias over pms-time-service.ts's
// listTimeEntriesForProject()/listTimeEntriesForIssue()/logTime(). No
// requirePmsEnabled() gate here -- see
// ../schedule/sprints/route.ts / ../meetings/route.ts for the same
// reasoning already established for pms_* substrate tables reached
// through /v1/projexa/*.
//
// `mine=true` is a route-level filter only (no new service function --
// pms-time-service.ts has no listTimeEntriesForUser()), so PROJEXA's own
// "My Timesheet" view can reuse the existing per-project listing without
// adding business logic here beyond a plain array filter.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listTimeEntriesForProject, listTimeEntriesForIssue, logTime, ServiceError } from "@/lib/services/pms-time-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ entries: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  const issueId = request.nextUrl.searchParams.get("issueId")
  const mine = request.nextUrl.searchParams.get("mine") === "true"
  if (!projectId && !issueId) return NextResponse.json({ error: "projectId or issueId query param is required" }, { status: 400 })

  try {
    let entries = issueId
      ? await listTimeEntriesForIssue({ orgId: ctx.orgId }, issueId)
      : await listTimeEntriesForProject({ orgId: ctx.orgId }, projectId!)
    if (mine) {
      const selfId = ctx.dbUser?.id
      entries = selfId ? entries.filter((e) => e.userId === selfId) : []
    }
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheets list error:", error)
    return NextResponse.json({ error: "Failed to fetch time entries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  // logTime() attributes the entry to ctx.userId (the logging user) --
  // matches the identical requirement already on /v1/pms/time-entries'
  // own POST (a real user, not a shared API key, must own a timesheet
  // entry).
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await logTime({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet create error:", error)
    return NextResponse.json({ error: "Failed to log time entry" }, { status: 500 })
  }
}
