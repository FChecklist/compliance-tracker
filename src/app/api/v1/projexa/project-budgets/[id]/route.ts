// Real-screen conversion (2026-08-30): the Budgets list never had a detail
// view -- getBudget()/updateBudgetLineItems() have always existed in
// erp-budget-service.ts but nothing on the v1/projexa surface exposed a
// single budget. Same construction-domain field naming as the sibling list
// route (project-budgets/route.ts's toProjectBudgetShape).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getBudget, updateBudgetLineItems, ServiceError } from "@/lib/services/erp-budget-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const budget = await getBudget({ orgId: ctx.orgId }, id)
    return NextResponse.json(budget)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project-budget get error:", error)
    return NextResponse.json({ error: "Failed to fetch project budget" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (!Array.isArray(body.lineItems)) return NextResponse.json({ error: "lineItems array is required" }, { status: 400 })
    const lineItems = await updateBudgetLineItems({ orgId: ctx.orgId }, id, body.lineItems)
    return NextResponse.json({ lineItems })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project-budget update error:", error)
    return NextResponse.json({ error: "Failed to update project budget" }, { status: 500 })
  }
}
