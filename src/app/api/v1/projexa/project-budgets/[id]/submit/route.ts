import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitBudget, ServiceError } from "@/lib/services/erp-budget-service"

// Real-screen conversion (2026-08-30): exposes the already-existing
// submitBudget() -- unlike journal-entry/change-order submission, this one
// needs only {orgId, userId}, not a full ErpContext dbUser, so it genuinely
// works from PROJEXA's API-key context (no identity-bridge gap here).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const budget = await submitBudget({ orgId: ctx.orgId, userId: actorId }, id)
    return NextResponse.json(budget)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project-budget submit error:", error)
    return NextResponse.json({ error: "Failed to submit project budget" }, { status: 500 })
  }
}
