// R48/R64 gap-closure (2026-08-30) -- see the sibling submit/route.ts's own
// comment for the full reasoning. Manager-role-gated, same as the
// session-only /api/construction/boq/[id]/approve/route.ts, but via
// requireRoleOrScope so an API-key caller is gated on a real write scope
// instead (matching every other v1 write route's own convention).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { approveBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const boq = await approveBoq({ orgId: ctx.orgId, userId: actorId }, id)
    return NextResponse.json(boq)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ approve error:", error)
    return NextResponse.json({ error: "Failed to approve BOQ" }, { status: 500 })
  }
}
