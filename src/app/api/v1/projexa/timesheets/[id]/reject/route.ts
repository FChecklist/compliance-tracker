// Task #47 (PM-platform feature-parity gap analysis): bridges the
// internal, session-only /api/pms/time-entries/[id]/reject/route.ts to
// PROJEXA over the API-key-authed /v1/projexa/* surface -- see
// ../submit/route.ts's header for the full "why this exists" context.
// No new business logic: this is a thin alias over the exact same
// rejectTimeEntry() the internal route already calls, including the
// optional `rejectionReason` body field (read the same
// `.json().catch(() => ({}))` way the internal route does, so a caller
// with no body or a non-JSON body doesn't 500).
//
// Requires a real user session (ctx.dbUser), not a bare API key -- same
// reasoning as ../approve/route.ts (rejectTimeEntry() also enforces "the
// submitter cannot review their own time entry"). Replicates the internal
// route's own requireRole(dbUser, "manager") gate exactly. No
// requirePmsEnabled() gate, matching every other /v1/projexa/* route
// reaching pms_* tables.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole } from "@/lib/supabase/auth-guard"
import { rejectTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })
  const roleCheck = requireRole(ctx.dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const entry = await rejectTimeEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id, body?.rejectionReason)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet reject error:", error)
    return NextResponse.json({ error: "Failed to reject time entry" }, { status: 500 })
  }
}
