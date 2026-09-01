// Real-screen conversion (2026-08-30, PROJEXA side): the Schedule module's
// Board/Gantt/Sprints/Timesheet tabs all reference a "task" (pms_issues) by
// id, but no v1 route ever exposed a single issue -- only list+create
// (schedule/route.ts) and a statusId-only PATCH (board/route.ts) existed.
// getIssue()/updateIssue() have always existed in pms-issue-service.ts; this
// just exposes them so PROJEXA can build a real Task Object Page instead of
// having no detail/edit screen for its core Schedule entity at all.
//
// No DELETE here: pms-issue-service.ts has no deleteIssue() anywhere in the
// codebase, and inventing a hard delete for a task with time entries,
// dependencies, and sprint membership attached is a real data-model decision,
// not a route-file afterthought. updateIssue()'s existing `isArchived` field
// is the real soft-delete equivalent already in the schema -- the frontend's
// "Delete" action PATCHes isArchived:true through this same route rather
// than needing a new endpoint.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getIssue, updateIssue, ServiceError, type IssuePatch } from "@/lib/services/pms-issue-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const { id } = await params

  try {
    const task = await getIssue({ orgId: ctx.orgId }, id)
    return NextResponse.json(task)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule task get error:", error)
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params

  try {
    const body = await request.json()
    const patch: IssuePatch = {
      title: body.title,
      description: body.description,
      statusId: body.statusId,
      priority: body.priority,
      assigneeIds: body.assigneeIds,
      milestoneId: body.milestoneId,
      startDate: body.startDate,
      dueDate: body.dueDate,
      completionPercentage: body.completionPercentage,
      isArchived: body.isArchived,
    }
    const task = await updateIssue({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id, dbUser: ctx.dbUser }, id, patch)
    return NextResponse.json(task)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule task update error:", error)
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
  }
}
