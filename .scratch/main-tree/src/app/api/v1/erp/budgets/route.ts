import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBudgets, createBudget, ServiceError } from "@/lib/services/erp-budget-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ budgets: [] })

  try {
    const budgets = await listBudgets({ orgId: ctx.orgId })
    return NextResponse.json({ budgets })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 erp budgets list error:", error)
    return NextResponse.json({ error: "Failed to fetch budgets" }, { status: 500 })
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
    const result = await createBudget({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 erp budget create error:", error)
    return NextResponse.json({ error: "Failed to create budget" }, { status: 500 })
  }
}
