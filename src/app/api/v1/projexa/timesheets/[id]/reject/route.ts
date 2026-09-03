// R39/R-C12: the Bearer-key-callable twin of /api/pms/time-entries/[id]/
// reject. Same manager+ gate as approve/route.ts.
//
// R39/R-C12 fix-2 (live-oracle finding): same resolveActingUser() fix as
// submit/approve -- see approve/route.ts's header comment for the full
// evidence trail (this route was equally dead-on-arrival from the real
// PROJEXA proxy before this fix, same root cause).
//
// R67 WS-H (item H-02): the decision closes the reviewer's Task Master row
// that submit minted. Sequenced, never nested, for the same D-06 reason the
// submit route documents -- and a failure to close is reported on the
// response rather than rolling back a decision that really was made.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole, resolveActingUser, readActingUserId } from "@/lib/supabase/auth-guard"
import { rejectTimeEntry, getTimeEntry, ServiceError } from "@/lib/services/pms-time-service"
import { closeTimesheetReviewTask, openTimesheetReturnedTask } from "@/lib/services/timesheet-review-task-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail, readActingUserId(request))
  if (actingUserErr) return actingUserErr
  const roleErr = requireRole(actingUser, "manager")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const entry = await rejectTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id, body?.rejectionReason)

    let reviewTaskClosed = 0
    let returnedTaskCreated = false
    let reviewTaskError: string | null = null
    try {
      const closed = await closeTimesheetReviewTask({ orgId: ctx.orgId, userId: actingUser!.id }, id, "rejected", body?.rejectionReason ?? null)
      reviewTaskClosed = closed.closed

      // Item H-03: the returned entry becomes the DESIGNER's "Needs you"
      // row, carrying the manager's reason, so they never have to open the
      // entry to find out what to change. Sequenced, never nested (D-06).
      const detail = await getTimeEntry({ orgId: ctx.orgId }, id)
      const returned = await openTimesheetReturnedTask({ orgId: ctx.orgId }, {
        timeEntryId: id,
        projectId: detail.projectId,
        designerId: entry.userId,
        designerName: detail.loggedBy?.name ?? entry.userId,
        hours: entry.hours,
        issueNumber: detail.issue?.number ?? null,
        issueTitle: detail.issue?.title ?? null,
        spentOn: entry.spentOn,
        rejectionReason: body?.rejectionReason ?? null,
      })
      returnedTaskCreated = returned.created
    } catch (taskError) {
      reviewTaskError = taskError instanceof Error ? taskError.message : "Could not update the Task Master rows"
      console.error("v1 projexa timesheet rejected -- Task Master update failed (the decision IS recorded):", taskError)
    }

    return NextResponse.json({ ...entry, reviewTaskClosed, returnedTaskCreated, reviewTaskError })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet reject error:", error)
    return NextResponse.json({ error: "Failed to reject time entry" }, { status: 500 })
  }
}
