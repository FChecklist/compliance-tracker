// R48/R64 gap-closure (2026-08-30) -- see the sibling submit/route.ts's own
// comment for the full reasoning. Manager-role-gated, same as the
// session-only /api/construction/boq/[id]/approve/route.ts, but via
// requireRoleOrScope so an API-key caller is gated on a real write scope
// instead (matching every other v1 write route's own convention).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { approveBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    // Same fix, same root cause, as the sibling create route
    // (v1/construction/boq/route.ts POST) -- found by the same Playwright
    // spec: without this, `ctx.apiKey!.id` made every PROJEXA-originated
    // approval resolve to the SAME actor as every create, so approveBoq's
    // own self-approval guard ("You cannot approve a BOQ you created
    // yourself") fired for every PROJEXA approval regardless of which two
    // real, different users actually clicked Create and Approve. U-20b: no
    // acting-user header is now 400 ACTING_USER_REQUIRED, never the key id.
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const actorId = acting.person.id
    const boq = await approveBoq({ orgId: ctx.orgId, userId: actorId }, id)
    return NextResponse.json(boq)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ approve error:", error)
    return NextResponse.json({ error: "Failed to approve BOQ" }, { status: 500 })
  }
}
