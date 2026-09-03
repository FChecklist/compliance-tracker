// R39/R-C12: the Bearer-key-callable twin of /api/pms/time-entries/[id]/
// submit (cookie-only requireAuth). Same "a real user, not a shared API
// key, must own this action" discipline the sibling timesheets routes
// already established -- submitting is inherently a self-action.
//
// R39/R-C12 fix-2 (live-oracle finding): a hard `!ctx.dbUser` 400 made this
// unreachable from the real PROJEXA proxy, which only ever authenticates
// with a shared per-org API key (ctx.dbUser is always null there) -- see
// resolveActingUser()'s own doc comment in auth-guard.ts for the full
// evidence trail. Now resolves the real acting user via body.actorEmail for
// an API-key caller, exactly as a session caller's own ctx.dbUser would.
//
// R67 WS-H (item H-02): on submit, mint the reviewer's Task Master row.
// SEQUENCED, NOT NESTED: submitTimeEntry() and openTimesheetReviewTask()
// each open their own withTenantContext transaction, and D-06 forbids
// nesting one inside the other (the 5-connection app_runtime pool turns a
// nested transaction into a deadlock, which is the fault PR #1575 fixed).
// So the submit lands first and the mint follows; if the mint fails, the
// submit is NOT rolled back and is NOT reported as a failure either --
// the response says plainly that the entry was submitted and the review row
// was not created, with the real reason, so the designer is never told
// "nothing happened" about a write that did happen.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, resolveActingUser, readActingUserId } from "@/lib/supabase/auth-guard"
import { submitTimeEntry, getTimeEntry, ServiceError } from "@/lib/services/pms-time-service"
import { openTimesheetReviewTask, closeTimesheetReturnedTask } from "@/lib/services/timesheet-review-task-service"

type RouteContext = { params: Promise<{ id: string }> }

// R43_MGR_02 (production incident, live Vercel runtime telemetry): this
// route still produced "Vercel Runtime Timeout Error: Task timed out after
// 300 seconds" with ZERO HTTP response, as recently as 2026-08-25T04:13Z --
// about 33 minutes AFTER the R46 DB-client-timeout fix (tenant-scoped.ts /
// db/index.ts, connect_timeout/idle_timeout/statement_timeout) was already
// live in production (deployment dpl_D88atpNz66DxuhRCtRPFBPLzseB2, created
// 2026-08-25T03:40Z). So the hang is not in the DB layer any more -- every
// real query on this route now runs through a client bounded to ~25-35s.
// `request.json()` is the one remaining unbounded await in this handler --
// Next.js/Vercel impose no timeout of their own on reading/parsing the
// request body, so a stalled or incomplete body can ride all the way to
// Vercel's 300s hard function cap with nothing ever sent back, unlike a
// DB-side failure which now fails fast with a real JSON error. This bounds
// the body read to the same ~25s ceiling the rest of the write path
// already targets, so a stalled body fails fast and honestly instead of
// hanging silently for 300s. Same fix as the sibling POST /timesheets.
const REQUEST_BODY_READ_TIMEOUT_MS = 25_000

async function readJsonBody(request: NextRequest): Promise<any> {
  const timedOut = Symbol("timed-out")
  let timer: ReturnType<typeof setTimeout>
  const result = await Promise.race([
    request.json().catch(() => ({})),
    new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), REQUEST_BODY_READ_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer!)
  if (result === timedOut) throw new ServiceError("Timed out waiting for the request body", 408)
  return result
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await readJsonBody(request)
    const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail, readActingUserId(request))
    if (actingUserErr) return actingUserErr

    const { id } = await params
    const entry = await submitTimeEntry({ orgId: ctx.orgId, userId: actingUser!.id }, id)

    // Read back the enriched entry (task number/title, project) purely to
    // build the reviewer's row -- submitTimeEntry returns the bare row.
    let reviewTaskCreated = false
    let reviewTaskError: string | null = null
    try {
      // A re-submit after a return closes the designer's own "Needs you"
      // row first -- leaving it open would keep telling them to fix
      // something they have already fixed.
      await closeTimesheetReturnedTask({ orgId: ctx.orgId, userId: actingUser!.id }, id)
      const detail = await getTimeEntry({ orgId: ctx.orgId }, id)
      const result = await openTimesheetReviewTask({ orgId: ctx.orgId }, {
        timeEntryId: id,
        projectId: detail.projectId,
        designerId: actingUser!.id,
        designerName: actingUser!.name,
        hours: entry.hours,
        issueNumber: detail.issue?.number ?? null,
        issueTitle: detail.issue?.title ?? null,
        spentOn: entry.spentOn,
      })
      reviewTaskCreated = result.created
    } catch (taskError) {
      reviewTaskError = taskError instanceof Error ? taskError.message : "Could not create the review task"
      console.error("v1 projexa timesheet submit -- review task mint failed (the entry IS submitted):", taskError)
    }

    return NextResponse.json({ ...entry, reviewTaskCreated, reviewTaskError })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet submit error:", error)
    return NextResponse.json({ error: "Failed to submit time entry" }, { status: 500 })
  }
}
