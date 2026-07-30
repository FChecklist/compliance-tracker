// Task #47 (PM-platform feature-parity gap analysis): compliance-tracker's
// own timesheet approval workflow (pms_time_entries.approvalStatus enum
// draft/submitted/approved/rejected) was fully wired at the internal,
// session-only /api/pms/time-entries/[id]/submit/route.ts, but never
// bridged to PROJEXA -- /v1/projexa/timesheets/* only had list (GET) + log
// (POST). This is a pure bridge-completeness fix (Owner mandate:
// compliance-tracker + PROJEXA are ONE system, PROJEXA is a thin client
// calling compliance-tracker via callVeridian()) -- no new business logic,
// just a thin alias over the exact same submitTimeEntry() the internal
// route already calls.
//
// Requires a real user session (ctx.dbUser), not a bare API key, for the
// same reason ../../route.ts's POST (logTime) and ../route.ts's DELETE
// (deleteTimeEntry) already do: submitTimeEntry() checks ctx.userId
// against the entry's own owner ("only the logging user may submit this
// entry") -- that check only means something for a real logged-in person,
// not a shared org-level API key with no individual identity. No
// requirePmsEnabled() gate, matching every other /v1/projexa/* route
// reaching pms_* tables (see ../route.ts's own header for the established
// reasoning).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { submitTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const { id } = await params
    const entry = await submitTimeEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet submit error:", error)
    return NextResponse.json({ error: "Failed to submit time entry" }, { status: 500 })
  }
}
