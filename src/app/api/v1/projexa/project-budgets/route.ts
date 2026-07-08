// Wave 124: thin alias over erp-budget-service.ts, construction-domain
// field names. Callers still need to route budget-to-project scoping
// through a cost center (erp_cost_centers.projectId) -- see
// construction-dashboard-service.ts's getProjectDashboard for the join
// this namespace's /api/v1/projexa/dashboard/{projectId} already computes.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBudgets, createBudget, ServiceError } from "@/lib/services/erp-budget-service"

function toProjectBudgetShape(b: Awaited<ReturnType<typeof listBudgets>>[number]) {
  return { id: b.id, name: b.name, fiscalYearId: b.fiscalYearId, costCenterId: b.costCenterId, status: b.status, actionIfExceeded: b.actionIfExceeded }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ projectBudgets: [] })

  try {
    const budgets = await listBudgets({ orgId: ctx.orgId })
    return NextResponse.json({ projectBudgets: budgets.map(toProjectBudgetShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project-budgets list error:", error)
    return NextResponse.json({ error: "Failed to fetch project budgets" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const budget = await createBudget({ orgId: ctx.orgId, userId: actorId }, {
      fiscalYearId: body.fiscalYearId, companyId: body.companyId, costCenterId: body.costCenterId,
      name: body.name, actionIfExceeded: body.actionIfExceeded, lineItems: body.lineItems ?? [],
    })
    return NextResponse.json(toProjectBudgetShape(budget), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa project-budget create error:", error)
    return NextResponse.json({ error: "Failed to create project budget" }, { status: 500 })
  }
}
