// Priority 16 Part 2 (PROJEXA-SCHEDULE-NO-CREATE-UI): thin alias over
// pms-issue-service.ts's listIssues()/createIssue() -- PROJEXA's Schedule
// module had a fully working backend (createIssue(), confirmed real at
// pms-issue-service.ts:93) but zero route/UI path to reach it: neither
// /api/v1/projexa/board (GET+PATCH only) nor any other PROJEXA route
// exposed a POST here. See control/priority16_e2e_testing_plan.md
// "GAP -- Schedule" for the full evidence trail. No requirePmsEnabled()
// gate here, matching every other /v1/projexa/schedule/* route
// (gantt/baselines/workload) and /v1/projexa/board -- pms_issues is
// PROJEXA's generic task/schedule substrate, not gated behind the
// separately-purchased PMS product branch.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listIssues, createIssue, ServiceError, type IssueInput } from "@/lib/services/pms-issue-service"
import { listIssueTypes } from "@/lib/services/pms-taxonomy-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ tasks: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const tasks = await listIssues({ orgId: ctx.orgId }, projectId, {
      statusId: request.nextUrl.searchParams.get("statusId") ?? undefined,
      assigneeId: request.nextUrl.searchParams.get("assigneeId") ?? undefined,
    })
    return NextResponse.json({ tasks })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule list error:", error)
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 })
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
    if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 })

    // typeId is required by createIssue() but PROJEXA's "New Task" dialog
    // treats it as optional (most users never think about issue "type" for
    // an ad-hoc task) -- default to the org's default type (seeded "Task"
    // type, see pms-enablement-service.ts) or its first type when a
    // specific typeId isn't supplied.
    let typeId = body.typeId as string | undefined
    if (!typeId) {
      const types = await listIssueTypes({ orgId: ctx.orgId })
      typeId = types.find((t) => t.isDefault)?.id ?? types[0]?.id
      if (!typeId) {
        return NextResponse.json(
          { error: "No issue types configured for this organisation -- ask an admin to set one up in VERIDIAN AI PMS" },
          { status: 400 }
        )
      }
    }

    const input: IssueInput = {
      projectId: body.projectId,
      typeId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      statusId: body.statusId,
      dueDate: body.dueDate,
      startDate: body.startDate,
      assigneeIds: body.assigneeIds,
    }
    const task = await createIssue({ orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }, input)
    return NextResponse.json(task, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa schedule task create error:", error)
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 })
  }
}
