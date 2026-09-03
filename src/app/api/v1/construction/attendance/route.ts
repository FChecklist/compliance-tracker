import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  listAttendance,
  recordAttendance,
  ServiceError,
} from "@/lib/services/construction-labour-service"
import { withRouteTiming } from "@/lib/route-timing"

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    // R67 F-25 (R-241): ?date= for one day, ?from=/?to= for a range.
    // ?attendanceDate= is the original name and still works.
    // R67 F-06: `from`/`to` bound the log to a window (PROJEXA's /labour asks
    // for a window ending on the chosen day). Both optional -- omitting them
    // keeps the previous unbounded behaviour for every existing caller.
    //
    // R67 D-30/D-33 read the same window: the daily sheet asks for one date,
    // the worker object page's month history and the daily summary ask for a
    // range, and all three filter in SQL instead of pulling a project's whole
    // attendance ledger to the browser. Two lanes arrived at the same filter
    // set from opposite ends -- one to bound a list, one to ask a dated
    // question -- which is why the parameters below serve both unchanged.
    const attendance = await listAttendance({ orgId: ctx.orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      rosterId: request.nextUrl.searchParams.get("rosterId") ?? undefined,
      date: request.nextUrl.searchParams.get("date") ?? undefined,
      attendanceDate: request.nextUrl.searchParams.get("attendanceDate") ?? undefined,
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
    })
    return NextResponse.json({ attendance })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction attendance list error:", error)
    return NextResponse.json({ error: "Failed to fetch attendance" }, { status: 500 })
  }
}

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    // R67 WS-C (C-08) / DECISION D-12, MERGE-SECOND: this route originally
    // carried a second `entries`-shaped branch calling recordAttendanceBatch
    // directly, added while lane D3's own batch write (POST
    // /api/v1/construction/attendance/bulk, `rows`-shaped) was not yet on
    // main. D3's version has since landed and is canonical; that branch and
    // lane C's own recordAttendanceBatch have been removed in its favour (the
    // batch write now lives only at the /bulk route). Every single-row caller
    // below is unchanged.
    const result = await recordAttendance({ orgId: ctx.orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) {
      // R67 C-08: THE CODE TRAVELS WITH THE REFUSAL, so the client can tell
      // "already saved -- replace it?" apart from every other 409 without
      // matching on the wording of a sentence. Without this the only signal
      // was the prose, and PROJEXA's shell branched on a `code` that never
      // arrived -- so a foreman re-marking a crew got the raw sentence and no
      // Replace control at all.
      return NextResponse.json(
        error.code ? { error: error.message, code: error.code } : { error: error.message },
        { status: error.status }
      )
    }
    console.error("v1 construction attendance record error:", error)
    return NextResponse.json({ error: "Failed to record attendance" }, { status: 500 })
  }
}
