// R67 WS-H (item H-03, "Approve (bulk per day)"): the manager's mirror of
// submit-day. One decision over one designer's one day, in ONE transaction.
//
// WHY A ROUTE RATHER THAN THE REVIEW SCREEN LOOPING /timesheets/[id]/approve:
// the same reason submit-day exists, stated in its own header -- "a loop of N
// POSTs can half-succeed, and there is no honest thing to show" when row 3 of 4
// fails. On the manager's side the failure is worse, because a half-decided day
// re-renders as a queue entry they have already dealt with. reviewDayForReview()
// moves the whole day or none of it.
//
// The Task Master bookkeeping runs AFTER that transaction commits, one row per
// decided entry, never inside it: D-06 forbids nesting withTenantContext, and
// pipeline_tasks is a different service's substrate. A bookkeeping failure does
// not undo a decision that really was made -- it is reported on the response.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole, resolveActingUser, readActingUserId, readActingUserEmail } from "@/lib/supabase/auth-guard"
import { reviewDayForReview, ServiceError } from "@/lib/services/pms-time-service"
import { recordTimesheetDecisionTasks } from "@/lib/services/timesheet-review-task-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail ?? readActingUserEmail(request), readActingUserId(request))
  if (actingUserErr) return actingUserErr
  const roleErr = requireRole(actingUser, "manager")
  if (roleErr) return roleErr

  try {
    const result = await reviewDayForReview({ orgId: ctx.orgId, userId: actingUser!.id }, {
      designerId: body?.designerId,
      projectId: body?.projectId,
      spentOn: body?.spentOn,
      decision: body?.decision,
      rejectionReason: body?.rejectionReason,
    })

    let tasksUpdated = 0
    let reviewTaskError: string | null = null
    for (const entry of result.entries) {
      const tasks = await recordTimesheetDecisionTasks(
        { orgId: ctx.orgId, userId: actingUser!.id },
        entry.id,
        result.decision,
        result.decision === "rejected" ? (body?.rejectionReason ?? null) : null,
        entry
      )
      tasksUpdated += tasks.reviewTaskClosed
      if (tasks.reviewTaskError) reviewTaskError = tasks.reviewTaskError
    }

    return NextResponse.json({
      decided: result.decided,
      decision: result.decision,
      hours: result.hours,
      entries: result.entries,
      tasksUpdated,
      reviewTaskError,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet review-day error:", error)
    return NextResponse.json({ error: "Failed to record the review decision" }, { status: 500 })
  }
}
