// Task #47 (PM-platform feature-parity gap analysis): bridges the
// internal, session-only /api/pms/time-entries/[id]/approve/route.ts to
// PROJEXA over the API-key-authed /v1/projexa/* surface -- see
// ../submit/route.ts's header for the full "why this exists" context.
// No new business logic: this is a thin alias over the exact same
// approveTimeEntry() the internal route already calls.
//
// Requires a real user session (ctx.dbUser), not a bare API key -- same
// reasoning as ../submit/route.ts, plus approveTimeEntry() also enforces
// "the submitter cannot review their own time entry", another identity
// check that only means something for a real logged-in reviewer. Replicates
// the internal route's own requireRole(dbUser, "manager") gate exactly
// (manager rank or above only) -- there is no API-key equivalent of a
// role, so this cannot be satisfied by a write-scoped key alone. No
// requirePmsEnabled() gate, matching every other /v1/projexa/* route
// reaching pms_* tables.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole } from "@/lib/supabase/auth-guard"
import { approveTimeEntry, ServiceError } from "@/lib/services/pms-time-service"

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
    const entry = await approveTimeEntry({ orgId: ctx.orgId, userId: ctx.dbUser.id }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet approve error:", error)
    return NextResponse.json({ error: "Failed to approve time entry" }, { status: 500 })
  }
}
