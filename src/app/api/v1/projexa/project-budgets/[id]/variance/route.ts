import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getBudgetVariance, ServiceError } from "@/lib/services/erp-budget-service"

// Real-screen conversion (2026-08-30): exposes the already-existing
// getBudgetVariance() (real Budget vs Actual, reading live off submitted
// journal-entry lines) -- was computed server-side but never reachable from
// PROJEXA, so the Budgets module had budget FIGURES with no way to see
// whether they were actually being tracked against.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const variance = await getBudgetVariance({ orgId: ctx.orgId }, id, asOfDate)
    return NextResponse.json(variance)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project-budget variance error:", error)
    return NextResponse.json({ error: "Failed to compute budget variance" }, { status: 500 })
  }
}
