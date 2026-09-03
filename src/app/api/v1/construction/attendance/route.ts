import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  listAttendance,
  recordAttendance,
  recordAttendanceBatch,
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
    // R67 WS-C (C-08): TWO BODIES, ONE ROUTE. A body carrying `entries` marks
    // a whole crew in ONE transaction; every existing single-row caller
    // (AttendanceCreateClient's form, and any integration already pointed
    // here) keeps working untouched, because the branch is on the presence of
    // the new field and nothing about the old shape moved.
    //
    // DISCLOSURE, decision D-12: this branch and recordAttendanceBatch are
    // LANE D3'S. D3's version is not on main yet, so lane C carries them until
    // it lands; on merge-second this branch and the service function are
    // deleted in favour of D3's, and lane C keeps only its caller and tests.
    if (Array.isArray((body as { entries?: unknown })?.entries)) {
      const result = await recordAttendanceBatch({ orgId: ctx.orgId }, body)
      return NextResponse.json(result, { status: 201 })
    }
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
