// Wave 141: thin alias over pms-taxonomy-service.ts's listIssueStatuses()
// and pms-issue-service.ts's listIssues()/updateIssue() -- groups a
// project's pms_issues by pms_issue_statuses.group/position into
// Kanban-board columns, and lets PROJEXA's board UI drag an issue between
// columns (PATCH updates statusId). No requirePmsEnabled() gate here,
// matching every other /v1/projexa/* route (Waves 124/129/140) --
// pms_issues/pms_issue_statuses are PROJEXA's generic task/schedule
// substrate (already exposed read-only via schedule/gantt), not gated
// behind the separately-purchased PMS product branch.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listIssueStatuses } from "@/lib/services/pms-taxonomy-service"
import { listIssues, updateIssue, ServiceError } from "@/lib/services/pms-issue-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const [statuses, issues] = await Promise.all([
      listIssueStatuses({ orgId: ctx.orgId }, projectId),
      listIssues({ orgId: ctx.orgId }, projectId, {}),
    ])
    const columns = statuses
      .sort((a, b) => a.position - b.position)
      .map((status) => ({
        id: status.id, name: status.name, group: status.group, color: status.color, position: status.position,
        issues: issues.filter((issue) => issue.statusId === status.id),
      }))
    return NextResponse.json({ columns })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa board list error:", error)
    return NextResponse.json({ error: "Failed to build board data" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!body.issueId) return NextResponse.json({ error: "issueId is required" }, { status: 400 })
    if (!body.statusId) return NextResponse.json({ error: "statusId is required" }, { status: 400 })
    const issue = await updateIssue({ orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }, body.issueId, { statusId: body.statusId })
    return NextResponse.json(issue)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa board update error:", error)
    return NextResponse.json({ error: "Failed to update issue status" }, { status: 500 })
  }
}
