import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { cancelBudget, ServiceError } from "@/lib/services/erp-budget-service"

// Real-screen conversion (2026-08-30): exposes the already-existing
// cancelBudget() -- the real "remove this" action for a budget (financial
// records aren't hard-deleted in this codebase; cancelling is the designed
// lifecycle end-state, same shape as erp_journal_entry_status's 'cancelled').
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const budget = await cancelBudget({ orgId: ctx.orgId }, id)
    return NextResponse.json(budget)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project-budget cancel error:", error)
    return NextResponse.json({ error: "Failed to cancel project budget" }, { status: 500 })
  }
}
