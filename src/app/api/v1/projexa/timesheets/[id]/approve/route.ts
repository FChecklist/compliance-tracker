// R39/R-C12 (v5 D-10: approval must BLOCK, never auto-approve): the
// Bearer-key-callable twin of /api/pms/time-entries/[id]/approve. Gated to
// a real manager+ dbUser -- an API key can never approve its own submitted
// hours, matching pms-time-service.ts's own self-approval guard.
//
// R39/R-C12 fix-2 (live-oracle finding): a hard `!ctx.dbUser` 400 made this
// unreachable from the real PROJEXA proxy, which only ever authenticates
// with a shared per-org API key (ctx.dbUser is always null there) -- see
// resolveActingUser()'s own doc comment in auth-guard.ts for the full
// evidence trail. Now resolves the real acting user via body.actorEmail for
// an API-key caller and role-gates THAT resolved user (still real,
// org-scoped, manager+) instead of the API key itself -- self-approval-block
// (reviewTimeEntry's `existing.userId === ctx.userId` check) still applies
// unchanged, now keyed off a real resolved person either way.
//
// R67 WS-H (item H-02): the decision closes the reviewer's Task Master row
// that submit minted. Sequenced, never nested, for the same D-06 reason the
// submit route documents -- and a failure to close is reported on the
// response rather than rolling back a decision that really was made.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole, resolveActingUser, readActingUserId } from "@/lib/supabase/auth-guard"
import { approveTimeEntry, ServiceError } from "@/lib/services/pms-time-service"
import { closeTimesheetReviewTask } from "@/lib/services/timesheet-review-task-service"

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
    const entry = await approveTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id)

    let reviewTaskClosed = 0
    let reviewTaskError: string | null = null
    try {
      const closed = await closeTimesheetReviewTask({ orgId: ctx.orgId, userId: actingUser!.id }, id, "approved", null)
      reviewTaskClosed = closed.closed
    } catch (taskError) {
      reviewTaskError = taskError instanceof Error ? taskError.message : "Could not close the review task"
      console.error("v1 projexa timesheet approved -- review task close failed (the decision IS recorded):", taskError)
    }

    return NextResponse.json({ ...entry, reviewTaskClosed, reviewTaskError })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet approve error:", error)
    return NextResponse.json({ error: "Failed to approve time entry" }, { status: 500 })
  }
}
