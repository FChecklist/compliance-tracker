import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { getBudget, updateBudgetLineItems, ServiceError } from "@/lib/services/erp-budget-service"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const budget = await getBudget({ orgId }, id)
    return NextResponse.json(budget)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Budget get error:", error)
    return NextResponse.json({ error: "Failed to fetch budget" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const lineItems = await updateBudgetLineItems({ orgId }, id, body.lineItems)
    return NextResponse.json({ lineItems })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Budget update error:", error)
    return NextResponse.json({ error: "Failed to update budget" }, { status: 500 })
  }
}
