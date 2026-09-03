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
import { requireAuthOrApiKey, requireRole, resolveActingUser, readActingUserId, readActingUserEmail } from "@/lib/supabase/auth-guard"
import { rejectTimeEntry, REJECTION_REASON_MIN_LENGTH, REJECTION_REASON_TOO_SHORT, ServiceError } from "@/lib/services/pms-time-service"
import { recordTimesheetDecisionTasks } from "@/lib/services/timesheet-review-task-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail ?? readActingUserEmail(request), readActingUserId(request))
  if (actingUserErr) return actingUserErr
  const roleErr = requireRole(actingUser, "manager")
  if (roleErr) return roleErr

  // Item H-02: "Reject opens a required Reason field of at least 5 characters".
  // Enforced here as well as in the screen, because a returned day whose reason
  // is blank tells the designer to fix something without saying what.
  const rejectionReason: string = (body?.rejectionReason ?? "").trim()
  if (rejectionReason.length < REJECTION_REASON_MIN_LENGTH) {
    return NextResponse.json({ error: REJECTION_REASON_TOO_SHORT }, { status: 400 })
  }

  try {
    const { id } = await params
    const entry = await rejectTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id, rejectionReason)
    const tasks = await recordTimesheetDecisionTasks(
      { orgId: ctx.orgId, userId: actingUser!.id },
      id,
      "rejected",
      rejectionReason,
      entry
    )
    return NextResponse.json({ ...entry, ...tasks })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet reject error:", error)
    return NextResponse.json({ error: "Failed to reject time entry" }, { status: 500 })
  }
}
