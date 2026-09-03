import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listRoster, getLabourLanding, createRosterEntry, ServiceError } from "@/lib/services/construction-labour-service"
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

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    // R67 F-30 (R-274): PROJEXA's /labour landing wants the roster AND the
    // day's attendance summary. `?includeAttendanceSummary=1&date=YYYY-MM-DD`
    // answers both from ONE transaction, so the screen costs one hop instead
    // of two and the pool sees one connection instead of two. Without the
    // parameter the response is byte-for-byte what every existing caller
    // already gets.
    const wantsSummary = request.nextUrl.searchParams.get("includeAttendanceSummary") === "1"
    if (wantsSummary) {
      // The DAY is the caller's, never the server's: a summary computed from
      // the server's own UTC "today" would be the wrong day for a site in
      // Mumbai for five and a half hours out of every twenty-four.
      const date = request.nextUrl.searchParams.get("date")
      if (!date) return NextResponse.json({ error: "date query param is required with includeAttendanceSummary" }, { status: 400 })
      const landing = await getLabourLanding({ orgId: ctx.orgId }, projectId, { attendanceDate: date })
      return NextResponse.json(landing)
    }
    const roster = await listRoster({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ roster })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction labour roster list error:", error)
    return NextResponse.json({ error: "Failed to fetch labour roster" }, { status: 500 })
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
    const result = await createRosterEntry({ orgId: ctx.orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction labour roster create error:", error)
    return NextResponse.json({ error: "Failed to create roster entry" }, { status: 500 })
  }
}
