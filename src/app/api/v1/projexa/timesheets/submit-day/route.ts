// R67 WS-H (items H-01/H-03): "Submit today (4 rows, 7.50 h)" /
// "Submit day for review" -- the designer's single decision over a whole
// day of the Design Studio grid.
//
// WHY A ROUTE RATHER THAN THE CLIENT LOOPING /timesheets/[id]/submit: a
// loop of N POSTs can half-succeed, and there is no honest thing to show
// the designer when row 3 of 4 fails -- the day is neither submitted nor
// not. submitDayForReview() moves the whole day in ONE transaction, so the
// answer is always "all of it" or "none of it, and here is why".
//
// The reviewer's Task Master rows are minted AFTER that transaction commits
// (one per submitted entry), never inside it: D-06 forbids nesting
// withTenantContext, and pipeline_tasks is a different service's substrate.
// A mint failure does not undo the submit and is not silently swallowed --
// the response carries how many rows were minted and the real reason if
// fewer than expected.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, readActingUserId } from "@/lib/supabase/auth-guard"
import { submitDayForReview, ServiceError } from "@/lib/services/pms-time-service"
import { openTimesheetReviewTask, closeTimesheetReturnedTask } from "@/lib/services/timesheet-review-task-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail, readActingUserId(request))
    if (actingUserErr) return actingUserErr

    const result = await submitDayForReview(
      { orgId: ctx.orgId, userId: actingUser!.id },
      { projectId: body?.projectId, spentOn: body?.spentOn }
    )

    let reviewTasksCreated = 0
    let reviewTaskError: string | null = null
    for (const entry of result.entries) {
      try {
        await closeTimesheetReturnedTask({ orgId: ctx.orgId, userId: actingUser!.id }, entry.id)
        const minted = await openTimesheetReviewTask({ orgId: ctx.orgId }, {
          timeEntryId: entry.id,
          projectId: body.projectId,
          designerId: actingUser!.id,
          designerName: actingUser!.name,
          hours: entry.hours,
          issueNumber: entry.issue?.number ?? null,
          issueTitle: entry.issue?.title ?? null,
          spentOn: entry.spentOn,
        })
        if (minted.created) reviewTasksCreated += 1
      } catch (taskError) {
        reviewTaskError = taskError instanceof Error ? taskError.message : "Could not create the review task"
        console.error("v1 projexa timesheet submit-day -- review task mint failed (the day IS submitted):", taskError)
      }
    }

    return NextResponse.json({
      submitted: result.submitted,
      hours: result.hours,
      entries: result.entries,
      reviewTasksCreated,
      reviewTaskError,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet submit-day error:", error)
    return NextResponse.json({ error: "Failed to submit the day for review" }, { status: 500 })
  }
}
